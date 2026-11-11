import { describe, expect, it } from 'vitest'
import {
  computeAllDue,
  computeNodeDue,
  computeTriggerStatus,
  nodeIssueStatus,
  worstStatus,
  WarnLeadDefaults
} from '../src/domain/triggers'
import type { Issue, MaintenanceNode, MetricsSnapshot, Trigger } from '../src/types'

const warnDefaults: WarnLeadDefaults = {
  calendarTime: 14,
  engineHours: 10,
  tripCount: 1,
  expiry: 30
}

function trigger(overrides: Partial<Trigger>): Trigger {
  return {
    id: 't1',
    name: 'Impeller',
    metric: 'engineHours',
    interval: 500,
    lastServiceValue: 0,
    lastServiceDate: '2026-01-01T00:00:00.000Z',
    enabled: true,
    ...overrides
  }
}

describe('computeTriggerStatus', () => {
  it('reports ok when remaining is comfortably above the warn lead', () => {
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 100 }
    const status = computeTriggerStatus(trigger({}), metrics, warnDefaults)
    expect(status.due).toBe(500)
    expect(status.remaining).toBe(400)
    expect(status.status).toBe('ok')
  })

  it('reports dueSoon within the warn lead', () => {
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 495 }
    const status = computeTriggerStatus(trigger({}), metrics, warnDefaults)
    expect(status.remaining).toBe(5)
    expect(status.status).toBe('dueSoon')
  })

  it('reports overdue when remaining is zero or negative', () => {
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 520 }
    const status = computeTriggerStatus(trigger({}), metrics, warnDefaults)
    expect(status.remaining).toBe(-20)
    expect(status.status).toBe('overdue')
  })

  it('honours a per-trigger warnLead override', () => {
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 450 }
    const status = computeTriggerStatus(trigger({ warnLead: 100 }), metrics, warnDefaults)
    expect(status.status).toBe('dueSoon')
  })

  it('is unknown when the metric value is unavailable', () => {
    const metrics: MetricsSnapshot = { calendarTime: 0 }
    const status = computeTriggerStatus(trigger({}), metrics, warnDefaults)
    expect(status.status).toBe('unknown')
    expect(Number.isNaN(status.remaining)).toBe(true)
  })
})

describe('worstStatus', () => {
  it('returns ok for an empty list', () => {
    expect(worstStatus([])).toBe('ok')
  })
  it('prefers overdue over everything', () => {
    expect(worstStatus(['ok', 'dueSoon', 'overdue', 'unknown'])).toBe('overdue')
  })
  it('prefers dueSoon over ok and unknown', () => {
    expect(worstStatus(['ok', 'unknown', 'dueSoon'])).toBe('dueSoon')
  })
  it('treats a known ok as better than unknown', () => {
    expect(worstStatus(['unknown', 'ok'])).toBe('ok')
  })
})

describe('computeNodeDue', () => {
  const node: MaintenanceNode = {
    id: 'impeller',
    type: 'part',
    name: 'Impeller',
    triggers: [
      trigger({ id: 'hours', metric: 'engineHours', interval: 500, lastServiceValue: 0 }),
      trigger({
        id: 'years',
        name: '2-year',
        metric: 'calendarTime',
        interval: 730,
        lastServiceValue: 0
      }),
      trigger({ id: 'off', metric: 'engineHours', interval: 1, lastServiceValue: 0, enabled: false })
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('uses whichever enabled trigger is most urgent and ignores disabled', () => {
    // engineHours overdue (520 > 500), calendarTime ok
    const metrics: MetricsSnapshot = { calendarTime: 10, engineHours: 520 }
    const due = computeNodeDue(node, metrics, warnDefaults)
    expect(due.triggers).toHaveLength(2)
    expect(due.status).toBe('overdue')
  })
})

describe('computeAllDue rollup', () => {
  function node(id: string, type: MaintenanceNode['type'], parentId: string | undefined, triggers: Trigger[]): MaintenanceNode {
    return {
      id,
      type,
      parentId,
      name: id,
      triggers,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }

  it('bubbles the worst descendant status up to ancestors', () => {
    const nodes: MaintenanceNode[] = [
      node('propulsion', 'system', undefined, []),
      node('engine', 'component', 'propulsion', []),
      node(
        'impeller',
        'part',
        'engine',
        [trigger({ id: 'h', metric: 'engineHours', interval: 500, lastServiceValue: 0 })]
      )
    ]
    // impeller overdue (520 > 500)
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 520 }
    const dues = computeAllDue(nodes, metrics, warnDefaults)
    const byId = Object.fromEntries(dues.map((d) => [d.nodeId, d]))

    // own status: only the part has triggers
    expect(byId.propulsion.status).toBe('ok')
    expect(byId.engine.status).toBe('ok')
    expect(byId.impeller.status).toBe('overdue')

    // rollup status: overdue bubbles up the tree
    expect(byId.propulsion.rollupStatus).toBe('overdue')
    expect(byId.engine.rollupStatus).toBe('overdue')
    expect(byId.impeller.rollupStatus).toBe('overdue')
  })

  it('treats an open medium/high issue as overdue and bubbles it up; ignores monitoring/low/resolved', () => {
    const nodes: MaintenanceNode[] = [
      node('propulsion', 'system', undefined, []),
      node('engine', 'component', 'propulsion', []),
      node('impeller', 'part', 'engine', [])
    ]
    const metrics: MetricsSnapshot = { calendarTime: 0, engineHours: 0 }

    function issue(overrides: Partial<Issue>): Issue {
      return {
        id: 'i1',
        nodeId: 'impeller',
        title: 'Leak',
        status: 'open',
        severity: 'high',
        openedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
      }
    }

    const withBlocking = computeAllDue(nodes, metrics, warnDefaults, undefined, [issue({})])
    const blockingById = Object.fromEntries(withBlocking.map((d) => [d.nodeId, d]))
    expect(blockingById.impeller.status).toBe('overdue')
    expect(blockingById.engine.rollupStatus).toBe('overdue')
    expect(blockingById.propulsion.rollupStatus).toBe('overdue')

    const ignored: Issue[] = [
      issue({ id: 'i2', status: 'monitoring', severity: 'high' }),
      issue({ id: 'i3', status: 'open', severity: 'low' }),
      issue({ id: 'i4', status: 'resolved', severity: 'high' })
    ]
    const withIgnored = computeAllDue(nodes, metrics, warnDefaults, undefined, ignored)
    expect(withIgnored.every((d) => d.status === 'ok' && d.rollupStatus === 'ok')).toBe(true)
  })
})

describe('nodeIssueStatus', () => {
  function issue(overrides: Partial<Issue>): Issue {
    return {
      id: 'i1',
      nodeId: 'n1',
      title: 'x',
      status: 'open',
      severity: 'medium',
      openedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides
    }
  }

  it('is overdue for open medium/high issues on the node', () => {
    expect(nodeIssueStatus('n1', [issue({ severity: 'medium' })])).toBe('overdue')
    expect(nodeIssueStatus('n1', [issue({ severity: 'high' })])).toBe('overdue')
  })

  it('is ok for monitoring, resolved, low, or missing severity', () => {
    expect(nodeIssueStatus('n1', [issue({ status: 'monitoring' })])).toBe('ok')
    expect(nodeIssueStatus('n1', [issue({ status: 'resolved' })])).toBe('ok')
    expect(nodeIssueStatus('n1', [issue({ severity: 'low' })])).toBe('ok')
    expect(nodeIssueStatus('n1', [issue({ severity: undefined })])).toBe('ok')
  })

  it('ignores issues belonging to other nodes', () => {
    expect(nodeIssueStatus('n1', [issue({ nodeId: 'other' })])).toBe('ok')
  })
})
