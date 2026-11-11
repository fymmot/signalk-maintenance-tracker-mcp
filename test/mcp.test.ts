import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RouterDeps } from '../src/api/router'
import { coerceConfig } from '../src/config'
import { createDispatcher } from '../src/mcp/dispatcher'
import { startMcpEndpoint, type RunningMcpEndpoint } from '../src/mcp/endpoint'
import { registerRoutes } from '../src/api/router'
import type { MetricsProvider } from '../src/metrics/metricsProvider'
import type { NotificationEvaluator } from '../src/notifications/evaluator'
import { PhotoStore } from '../src/photos/PhotoStore'
import { Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'

const PORT = 8793
const TOKEN = 'test-token-abcdefghijklmnopqrstuvwx'
const URL_BASE = `http://127.0.0.1:${PORT}/mcp`

function makeDeps(): RouterDeps {
  const dir = mkdtempSync(join(tmpdir(), 'maint-mcp-'))
  const store = new Store(dir, new SchemaValidator(), { commit: async () => undefined })
  // Fixed metric snapshot; the real providers need the SK app + timers we don't want here.
  const metrics = { snapshot: () => ({ calendarTime: 20000 }) } as unknown as MetricsProvider
  const evaluator = { evaluateAll: async () => undefined } as unknown as NotificationEvaluator
  const log = { debug: () => undefined, error: () => undefined }
  return { store, metrics, evaluator, config: coerceConfig({}), photos: new PhotoStore(dir), log }
}

const text = (r: { content: unknown }): string =>
  ((r.content as Array<{ type: string; text: string }>)[0]).text

describe('dispatcher', () => {
  it('routes to the same handlers the REST API uses', async () => {
    const { router, call } = createDispatcher()
    registerRoutes(router, makeDeps())

    const empty = await call('GET', '/nodes')
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual([])

    const created = await call('POST', '/nodes', { body: { type: 'system', name: 'Rig' } })
    expect(created.status).toBe(201)
    const id = (created.body as { id: string }).id

    const got = await call('GET', `/nodes/${id}`)
    expect(got.status).toBe(200)
    expect((got.body as { name: string }).name).toBe('Rig')

    const missing = await call('GET', '/nodes/does-not-exist')
    expect(missing.status).toBe(404)

    // Literal routes win over :param siblings (e.g. /seasons/current vs /seasons/:id).
    const season = await call('GET', '/seasons/current')
    expect(season.status).toBe(200)
    expect(season.body).toEqual({ afloat: false, season: null })
  })
})

describe('MCP endpoint', () => {
  let endpoint: RunningMcpEndpoint

  beforeAll(() => {
    const log = { debug: () => undefined, error: () => undefined }
    endpoint = startMcpEndpoint({
      port: PORT,
      inboundToken: TOKEN,
      version: '0.0.0-test',
      deps: makeDeps(),
      log
    })
  })

  afterAll(async () => {
    await endpoint.close()
  })

  it('rejects requests without the token', async () => {
    const res = await fetch(URL_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    })
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const res = await fetch(URL_BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer wrong'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    })
    expect(res.status).toBe(401)
  })

  it('lists all tools and round-trips a write+read with the token', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(URL_BASE), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } }
    })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(transport)

    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain('maintenance_due')
    expect(names).toContain('maintenance_mark_serviced')
    expect(names).toHaveLength(35)

    // Read-only tools carry the annotation.
    const due = tools.tools.find((t) => t.name === 'maintenance_due')
    expect(due?.annotations?.readOnlyHint).toBe(true)

    const created = await client.callTool({
      name: 'maintenance_create_node',
      arguments: { type: 'system', name: 'Steering' }
    })
    expect(text(created)).toContain('Steering')

    const list = await client.callTool({ name: 'maintenance_list_nodes', arguments: {} })
    expect(text(list)).toContain('Steering')

    // A cost keeps its currency, upper-cased.
    const steering = JSON.parse(text(created)) as { id: string }
    await client.callTool({
      name: 'maintenance_mark_serviced',
      arguments: { node_id: steering.id, description: 'Tiller bolts tightened', cost: 40, currency: 'eur' }
    })
    const logs = await client.callTool({ name: 'maintenance_node_logs', arguments: { node_id: steering.id } })
    expect(JSON.parse(text(logs))).toMatchObject([{ cost: 40, costCurrency: 'EUR' }])

    await client.close()
  })
})
