import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerRoutes, type RouterDeps } from '../src/api/router'
import { coerceConfig } from '../src/config'
import { createDispatcher } from '../src/mcp/dispatcher'
import type { MetricsProvider } from '../src/metrics/metricsProvider'
import type { NotificationEvaluator } from '../src/notifications/evaluator'
import { PhotoStore } from '../src/photos/PhotoStore'
import { Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'
import type { ChecklistRun, ChecklistTemplate, Issue } from '../src/types'

/**
 * Round-trips the optional fields the app's season-first redesign reads: issue `fixBy`, template
 * `schedule` and item `nodeId`, and run `section`. Goes through the real router and a real Store,
 * so the openapi schemas (all `additionalProperties: false`) are exercised too.
 */
function makeDeps(): RouterDeps {
  const dir = mkdtempSync(join(tmpdir(), 'maint-fields-'))
  const store = new Store(dir, new SchemaValidator(), { commit: async () => undefined })
  const metrics = { snapshot: () => ({ calendarTime: 20000 }) } as unknown as MetricsProvider
  const evaluator = { evaluateAll: async () => undefined } as unknown as NotificationEvaluator
  const log = { debug: () => undefined, error: () => undefined }
  return { store, metrics, evaluator, config: coerceConfig({}), photos: new PhotoStore(dir), log }
}

let call: ReturnType<typeof createDispatcher>['call']

beforeEach(async () => {
  const d = createDispatcher()
  registerRoutes(d.router, makeDeps())
  call = d.call
  await call('POST', '/nodes', { body: { id: 'rig', type: 'system', name: 'Rig' } })
})

describe('issue fixBy', () => {
  async function create(body: Record<string, unknown>): Promise<Issue> {
    const res = await call('POST', '/issues', { body: { nodeId: 'rig', title: 'Turnbuckles', ...body } })
    expect(res.status).toBe(201)
    return res.body as Issue
  }

  it('stores a valid milestone and ignores anything else', async () => {
    expect((await create({ fixBy: 'launch' })).fixBy).toBe('launch')
    expect((await create({ fixBy: 'tomorrow' })).fixBy).toBeUndefined()
  })

  it('keeps it on an unrelated update, changes it, and clears it with null', async () => {
    const issue = await create({ fixBy: 'launch' })
    const kept = await call('PUT', `/issues/${issue.id}`, { body: { comment: 'Ordered parts' } })
    expect((kept.body as Issue).fixBy).toBe('launch')

    const changed = await call('PUT', `/issues/${issue.id}`, { body: { fixBy: 'haulout' } })
    expect((changed.body as Issue).fixBy).toBe('haulout')

    const cleared = await call('PUT', `/issues/${issue.id}`, { body: { fixBy: null } })
    expect(cleared.status).toBe(200)
    expect((cleared.body as Issue).fixBy).toBeUndefined()
    const reread = await call('GET', `/issues/${issue.id}`)
    expect((reread.body as Issue).fixBy).toBeUndefined()
  })
})

describe('checklist template schedule and item nodeId', () => {
  const items = [
    { id: 'a', text: 'Bring the Pi home', category: 'After haulout', nodeId: 'rig' },
    { id: 'b', text: 'Refit the solar fuses', category: 'At launch' }
  ]

  async function create(body: Record<string, unknown>): Promise<ChecklistTemplate> {
    const res = await call('POST', '/checklists/templates', { body: { name: 'Winter storage', items, ...body } })
    expect(res.status).toBe(201)
    return res.body as ChecklistTemplate
  }

  it('keeps valid schedule entries and drops ones without a milestone', async () => {
    const template = await create({
      schedule: [
        { section: 'After haulout', milestone: 'haulout', withinDays: 14 },
        { section: 'At launch', milestone: 'launch' },
        { section: 'Broken', milestone: 'someday' }
      ]
    })
    expect(template.schedule).toEqual([
      { section: 'After haulout', milestone: 'haulout', withinDays: 14 },
      { section: 'At launch', milestone: 'launch' }
    ])
    expect(template.items[0]).toEqual(items[0])
  })

  it('survives an update that omits it, and an empty list clears it', async () => {
    const template = await create({ schedule: [{ milestone: 'launch' }] })
    const renamed = await call('PUT', `/checklists/templates/${template.id}`, {
      body: { name: 'Winter storage – batteries & Pi', items }
    })
    expect(renamed.status).toBe(200)
    expect((renamed.body as ChecklistTemplate).schedule).toEqual([{ milestone: 'launch' }])
    expect((renamed.body as ChecklistTemplate).items[0].nodeId).toBe('rig')

    const cleared = await call('PUT', `/checklists/templates/${template.id}`, { body: { schedule: [] } })
    expect((cleared.body as ChecklistTemplate).schedule).toBeUndefined()
  })
})

describe('checklist run section', () => {
  it('stores the section and only the results the client sent', async () => {
    const template = (
      await call('POST', '/checklists/templates', {
        body: {
          name: 'Winter storage',
          items: [
            { id: 'a', text: 'Bring the Pi home', category: 'After haulout' },
            { id: 'b', text: 'Refit the solar fuses', category: 'At launch' }
          ]
        }
      })
    ).body as ChecklistTemplate

    const res = await call('POST', '/checklists/runs', {
      body: {
        templateId: template.id,
        section: 'After haulout',
        results: [{ itemId: 'a', text: 'Bring the Pi home', status: 'pass' }]
      }
    })
    expect(res.status).toBe(201)
    const run = res.body as ChecklistRun
    expect(run.section).toBe('After haulout')
    expect(run.results.map((r) => r.itemId)).toEqual(['a'])

    const updated = await call('PUT', `/checklists/runs/${run.id}`, {
      body: { results: [{ itemId: 'a', text: 'Bring the Pi home', status: 'fail', note: 'Left aboard' }] }
    })
    expect(updated.status).toBe(200)
    expect((updated.body as ChecklistRun).section).toBe('After haulout')

    // Unknown fields are still refused by the record schema.
    const refused = await call('PUT', `/checklists/runs/${run.id}`, { body: { bogus: true } })
    expect(refused.status).toBe(400)
  })
})
