import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerRoutes, type RouterDeps } from '../src/api/router'
import { coerceConfig } from '../src/config'
import {
  computeTriggerStatus,
  normalizeExpiryDate,
  type WarnLeadDefaults
} from '../src/domain/triggers'
import { createDispatcher } from '../src/mcp/dispatcher'
import type { MetricsProvider } from '../src/metrics/metricsProvider'
import type { NotificationEvaluator } from '../src/notifications/evaluator'
import { PhotoStore } from '../src/photos/PhotoStore'
import { Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'
import type { MaintenanceNode, ServiceLog, Trigger } from '../src/types'

const MS_PER_DAY = 86_400_000
const dayOf = (iso: string) => Date.parse(iso) / MS_PER_DAY

const warnDefaults: WarnLeadDefaults = { calendarTime: 14, engineHours: 10, tripCount: 1, expiry: 30 }

function flares(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'exp',
    name: 'Expires',
    metric: 'expiry',
    interval: 0,
    expiresOn: '2027-03-31',
    lastServiceValue: 0,
    lastServiceDate: '2026-01-01T00:00:00.000Z',
    enabled: true,
    ...overrides
  }
}

const statusOn = (date: string, t: Trigger = flares()) =>
  computeTriggerStatus(t, { calendarTime: dayOf(date) }, warnDefaults).status

describe('normalizeExpiryDate', () => {
  it('keeps a full date', () => {
    expect(normalizeExpiryDate('2027-03-14')).toBe('2027-03-14')
  })

  it('reads a month-only label as valid through that month', () => {
    expect(normalizeExpiryDate('2027-03')).toBe('2027-03-31')
    expect(normalizeExpiryDate('2028-02')).toBe('2028-02-29')
  })

  it('rejects impossible and malformed dates', () => {
    for (const bad of ['2027-02-30', '2027-13', '03/2027', '2027', '', 20270331, undefined]) {
      expect(normalizeExpiryDate(bad)).toBeUndefined()
    }
  })
})

describe('expiry trigger status', () => {
  it('is ok well before, dueSoon inside the 30-day lead, and overdue on the printed date', () => {
    expect(statusOn('2027-01-01')).toBe('ok')
    expect(statusOn('2027-03-15')).toBe('dueSoon')
    expect(statusOn('2027-03-30T23:59:00Z')).toBe('dueSoon')
    expect(statusOn('2027-03-31T00:00:00Z')).toBe('overdue')
  })

  it('reports the printed date as its due day', () => {
    const status = computeTriggerStatus(flares(), { calendarTime: dayOf('2027-01-01') }, warnDefaults)
    expect(status.due).toBe(dayOf('2027-03-31'))
  })

  it('honours its own warn lead', () => {
    expect(statusOn('2027-01-15', flares({ warnLead: 90 }))).toBe('dueSoon')
  })

  it('is unknown without a date', () => {
    expect(statusOn('2027-01-01', flares({ expiresOn: undefined }))).toBe('unknown')
  })
})

describe('expiry through the router', () => {
  let call: ReturnType<typeof createDispatcher>['call']

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maint-expiry-'))
    const deps: RouterDeps = {
      store: new Store(dir, new SchemaValidator(), { commit: async () => undefined }),
      metrics: { snapshot: () => ({ calendarTime: dayOf('2026-11-08') }) } as unknown as MetricsProvider,
      evaluator: { evaluateAll: async () => undefined } as unknown as NotificationEvaluator,
      config: coerceConfig({}),
      photos: new PhotoStore(dir),
      log: { debug: () => undefined, error: () => undefined }
    }
    const d = createDispatcher()
    registerRoutes(d.router, deps)
    call = d.call
    const created = await call('POST', '/nodes', {
      body: {
        id: 'extinguisher',
        type: 'part',
        name: 'Fire extinguisher',
        triggers: [
          { id: 'check', name: 'Yearly check', metric: 'calendarTime', interval: 365 },
          { id: 'exp', name: 'Expires', metric: 'expiry', expiresOn: '2027-03' }
        ]
      }
    })
    expect(created.status).toBe(201)
  })

  const expiryOf = async () =>
    ((await call('GET', '/nodes/extinguisher')).body as MaintenanceNode).triggers.find(
      (t) => t.id === 'exp'
    )?.expiresOn

  it('stores a month-only date as the last day of the month', async () => {
    expect(await expiryOf()).toBe('2027-03-31')
  })

  it('leaves the expiry alone on a plain service', async () => {
    const res = await call('POST', '/nodes/extinguisher/service', { body: { description: 'Checked' } })
    expect(res.status).toBe(201)
    expect((res.body as ServiceLog).triggerIds).toEqual(['check'])
    expect(await expiryOf()).toBe('2027-03-31')
  })

  it('renews with the replacement date and records it on the log', async () => {
    const res = await call('POST', '/nodes/extinguisher/service', {
      body: { description: 'Replaced', expiresOn: '2032-06-30' }
    })
    expect(res.status).toBe(201)
    expect((res.body as ServiceLog).triggerIds).toEqual(['check', 'exp'])
    expect((res.body as ServiceLog).expiresOn).toBe('2032-06-30')
    expect(await expiryOf()).toBe('2032-06-30')
  })

  it('refuses to renew a named expiry trigger without a date', async () => {
    const res = await call('POST', '/nodes/extinguisher/service', {
      body: { description: 'Replaced', triggerIds: ['exp'] }
    })
    expect(res.status).toBe(400)
    expect(await expiryOf()).toBe('2027-03-31')
  })

  it('rejects a malformed date', async () => {
    const res = await call('POST', '/nodes/extinguisher/service', {
      body: { description: 'Replaced', expiresOn: 'next year' }
    })
    expect(res.status).toBe(400)
  })

  it('reports due status from the date', async () => {
    const due = (await call('GET', '/due')).body as Array<{
      nodeId: string
      triggers: Array<{ triggerId: string; status: string }>
    }>
    const exp = due.find((d) => d.nodeId === 'extinguisher')?.triggers.find((t) => t.triggerId === 'exp')
    expect(exp?.status).toBe('ok')
  })
})
