import { describe, expect, it } from 'vitest'
import { notificationsForNode } from '../src/notifications/evaluator'
import type { NodeDue } from '../src/types'

function due(overrides: Partial<NodeDue>): NodeDue {
  return {
    nodeId: 'impeller',
    name: 'Impeller',
    type: 'part',
    status: 'ok',
    triggers: [],
    ...overrides
  }
}

describe('notificationsForNode', () => {
  it('maps overdue to alarm and dueSoon to warn', () => {
    const notifications = notificationsForNode(
      due({
        triggers: [
          { triggerId: 'hours', name: 'Hours', metric: 'engineHours', due: 500, remaining: -5, status: 'overdue' },
          { triggerId: 'years', name: 'Years', metric: 'calendarTime', due: 730, remaining: 3, status: 'dueSoon' }
        ]
      })
    )
    expect(notifications).toHaveLength(2)
    expect(notifications[0]).toMatchObject({
      path: 'notifications.maintenance.impeller.hours',
      state: 'alarm'
    })
    expect(notifications[1]).toMatchObject({
      path: 'notifications.maintenance.impeller.years',
      state: 'warn'
    })
  })

  it('emits normal for ok triggers', () => {
    const notifications = notificationsForNode(
      due({
        triggers: [
          { triggerId: 'hours', name: 'Hours', metric: 'engineHours', due: 500, remaining: 400, status: 'ok' }
        ]
      })
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].state).toBe('normal')
  })

  it('skips unknown triggers', () => {
    const notifications = notificationsForNode(
      due({
        triggers: [
          { triggerId: 'hours', name: 'Hours', metric: 'engineHours', due: 500, remaining: Number.NaN, status: 'unknown' }
        ]
      })
    )
    expect(notifications).toHaveLength(0)
  })

  it('suppresses the alarm for a snoozed overdue trigger', () => {
    const notifications = notificationsForNode(
      due({
        triggers: [
          {
            triggerId: 'hours',
            name: 'Hours',
            metric: 'engineHours',
            due: 500,
            remaining: -5,
            status: 'overdue',
            snoozedUntil: '2999-01-01T00:00:00.000Z'
          }
        ]
      })
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].state).toBe('normal')
    expect(notifications[0].message).toContain('snoozed')
  })

  it('sanitizes dotted ids into single path segments', () => {
    const notifications = notificationsForNode(
      due({
        nodeId: 'engine.main',
        triggers: [
          { triggerId: 'oil.change', name: 'Oil', metric: 'engineHours', due: 100, remaining: -1, status: 'overdue' }
        ]
      })
    )
    expect(notifications[0].path).toBe('notifications.maintenance.engine-main.oil-change')
  })
})
