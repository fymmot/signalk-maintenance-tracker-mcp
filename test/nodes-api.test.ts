import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { registerRoutes, type RouterDeps } from '../src/api/router'
import { coerceConfig } from '../src/config'
import { createDispatcher } from '../src/mcp/dispatcher'
import type { MetricsProvider } from '../src/metrics/metricsProvider'
import type { NotificationEvaluator } from '../src/notifications/evaluator'
import { PhotoStore } from '../src/photos/PhotoStore'
import { Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'

function api() {
  const dir = mkdtempSync(join(tmpdir(), 'maint-nodes-'))
  const store = new Store(dir, new SchemaValidator(), { commit: async () => undefined })
  const metrics = { snapshot: () => ({ calendarTime: 20400 }) } as unknown as MetricsProvider
  const evaluator = { evaluateAll: async () => undefined } as unknown as NotificationEvaluator
  const deps: RouterDeps = {
    store,
    metrics,
    evaluator,
    config: coerceConfig({}),
    photos: new PhotoStore(dir),
    log: { debug: () => undefined, error: () => undefined }
  }
  const { router, call } = createDispatcher()
  registerRoutes(router, deps)
  return call
}

describe('node ids', () => {
  it('gives a second node with the same name its own id', async () => {
    const call = api()
    const a = await call('POST', '/nodes', { body: { name: 'Impeller', type: 'part' } })
    const b = await call('POST', '/nodes', { body: { name: 'Impeller', type: 'part' } })
    expect(a.body).toMatchObject({ id: 'impeller' })
    expect(b.body).toMatchObject({ id: 'impeller-2' })
    expect((await call('GET', '/nodes')).body).toHaveLength(2)
  })

  it('refuses to create over an id the client chose', async () => {
    const call = api()
    await call('POST', '/nodes', { body: { id: 'engine', name: 'Engine', type: 'system' } })
    const again = await call('POST', '/nodes', { body: { id: 'engine', name: 'Other', type: 'system' } })
    expect(again.status).toBe(409)
    expect((await call('GET', '/nodes/engine')).body).toMatchObject({ name: 'Engine' })
  })

  it('answers 400, not 500, for an id with bad characters', async () => {
    const call = api()
    expect((await call('GET', '/nodes/bad id')).status).toBe(400)
  })
})

describe('deleting nodes', () => {
  async function tree() {
    const call = api()
    await call('POST', '/nodes', { body: { id: 'engine', name: 'Engine', type: 'system' } })
    await call('POST', '/nodes', { body: { id: 'cooling', name: 'Cooling', type: 'component', parentId: 'engine' } })
    await call('POST', '/nodes', { body: { id: 'impeller', name: 'Impeller', type: 'part', parentId: 'cooling' } })
    await call('POST', '/nodes/impeller/service', { body: { description: 'Impeller replaced', triggerIds: [] } })
    return call
  }

  it('refuses a node with children and lists them', async () => {
    const call = await tree()
    const res = await call('DELETE', '/nodes/engine')
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ descendants: [{ id: 'impeller' }, { id: 'cooling' }] })
    expect((await call('GET', '/nodes')).body).toHaveLength(3)
  })

  it('removes the whole subtree with recursive=true and keeps the history', async () => {
    const call = await tree()
    const res = await call('DELETE', '/nodes/engine', { query: { recursive: 'true' } })
    expect(res.status).toBe(204)
    expect((await call('GET', '/nodes')).body).toEqual([])
    expect((await call('GET', '/logs')).body).toHaveLength(1)
  })

  it('deletes a leaf straight away and 404s an unknown node', async () => {
    const call = await tree()
    expect((await call('DELETE', '/nodes/impeller')).status).toBe(204)
    expect((await call('DELETE', '/nodes/nope')).status).toBe(404)
  })
})

describe('service cost', () => {
  it('upper-cases the currency and refuses one that is not a code', async () => {
    const call = api()
    await call('POST', '/nodes', { body: { id: 'tiller', name: 'Tiller', type: 'part' } })
    const ok = await call('POST', '/nodes/tiller/service', { body: { description: 'Bolts tightened', cost: 40, costCurrency: 'eur' } })
    expect(ok.body).toMatchObject({ cost: 40, costCurrency: 'EUR' })
    const bad = await call('POST', '/nodes/tiller/service', { body: { description: 'Again', cost: 40, costCurrency: 'euros' } })
    expect(bad.status).toBe(400)
  })
})

describe('work queue route', () => {
  it('returns the queue with a summary per system', async () => {
    const call = api()
    await call('POST', '/nodes', { body: { id: 'engine', name: 'Engine', type: 'system' } })
    const res = await call('GET', '/work')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ phase: { state: 'ashore' }, badgeCount: 0, systems: [{ nodeId: 'engine' }] })
  })
})

describe('starter boat', () => {
  it('creates the tree once, in the language asked for', async () => {
    const call = api()
    const preview = await call('GET', '/starter-boat', { query: { lang: 'sv' } })
    expect(preview.body).toContainEqual(expect.objectContaining({ id: 'propulsion', name: 'Framdrivning' }))

    const first = await call('POST', '/starter-boat', { body: { lang: 'sv' } })
    expect(first.status).toBe(201)
    const nodes = (await call('GET', '/nodes')).body as Array<{ id: string; name: string; parentId?: string; triggers: unknown[] }>
    expect(nodes.length).toBe((preview.body as unknown[]).length)
    expect(nodes.find((n) => n.id === 'raw-water-impeller')).toMatchObject({ name: 'Impeller', parentId: 'cooling' })
    expect(nodes.find((n) => n.id === 'raw-water-impeller')?.triggers).toHaveLength(2)
    // Season jobs keep their anchor; expiry jobs wait for the printed date.
    expect(nodes.find((n) => n.id === 'cooling')?.triggers).toMatchObject([{ metric: 'seasonAnchor', anchor: { milestone: 'haulout', offsetDays: 14 } }])
    expect(nodes.find((n) => n.id === 'flares')?.triggers).toMatchObject([{ metric: 'expiry', name: 'Byt ut' }])
    // Not only maintenance: fees and insurance come round on a date too.
    expect(nodes.find((n) => n.id === 'insurance')).toMatchObject({ name: 'Båtförsäkring', parentId: 'fees', triggers: [{ metric: 'expiry', name: 'Förnya' }] })

    const again = await call('POST', '/starter-boat', { body: {} })
    expect(again).toMatchObject({ status: 200, body: { created: 0 } })
  })
})
