import { describe, expect, it } from 'vitest'
import {
  buildSeasonContext,
  buildTimeline,
  currentSeason,
  dateToDayNumber,
  isAfloat
} from '../src/domain/seasons'
import {
  computeTriggerStatus,
  seasonAnchorDueDay,
  seasonAnchorStartValue,
  WarnLeadDefaults
} from '../src/domain/triggers'
import type {
  BoatEvent,
  ChecklistRun,
  Issue,
  MetricsSnapshot,
  Season,
  ServiceLog,
  Trigger
} from '../src/types'

const warnDefaults: WarnLeadDefaults = {
  calendarTime: 14,
  engineHours: 10,
  tripCount: 1,
  expiry: 30
}

const seasons: Season[] = [
  {
    id: '2026',
    label: '2026 season',
    launchDate: '2026-05-03',
    hauloutDate: '2026-10-18',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: '2027',
    label: '2027 season',
    launchDate: '2027-05-02',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
]

const context = buildSeasonContext(seasons)

/** Day-number for a date, asserting it parses. */
function day(date: string): number {
  const d = dateToDayNumber(date)
  expect(d).toBeDefined()
  return d as number
}

function metricsAt(date: string): MetricsSnapshot {
  return { calendarTime: day(date) }
}

function anchorTrigger(overrides: Partial<Trigger>): Trigger {
  return {
    id: 'antifoul',
    name: 'Antifoul before launch',
    metric: 'seasonAnchor',
    interval: 0,
    anchor: { milestone: 'launch', offsetDays: -14 },
    // Never serviced.
    lastServiceValue: 0,
    lastServiceDate: '2026-01-01T00:00:00.000Z',
    enabled: true,
    ...overrides
  }
}

describe('buildSeasonContext', () => {
  it('extracts sorted launch and haulout day-numbers', () => {
    expect(context.launchDays).toEqual([day('2026-05-03'), day('2027-05-02')])
    expect(context.hauloutDays).toEqual([day('2026-10-18')])
  })
})

describe('seasonAnchor trigger status', () => {
  it('is ok well before the anchored due date', () => {
    const status = computeTriggerStatus(anchorTrigger({}), metricsAt('2026-01-15'), warnDefaults, context)
    // due = 2026 launch - 14 days = 2026-04-19
    expect(status.due).toBe(day('2026-05-03') - 14)
    expect(status.status).toBe('ok')
  })

  it('is dueSoon within the warn lead of the anchored date', () => {
    const status = computeTriggerStatus(anchorTrigger({}), metricsAt('2026-04-15'), warnDefaults, context)
    expect(status.remaining).toBeCloseTo(day('2026-04-19') - day('2026-04-15'), 5)
    expect(status.status).toBe('dueSoon')
  })

  it('is overdue past the anchored date and stays anchored to the same launch until serviced', () => {
    const status = computeTriggerStatus(anchorTrigger({}), metricsAt('2026-05-10'), warnDefaults, context)
    expect(status.remaining).toBeLessThan(0)
    expect(status.status).toBe('overdue')
  })

  it('rolls forward to next season after the last service', () => {
    // Serviced 2026-05-01 → next launch is 2027-05-02
    const status = computeTriggerStatus(
      anchorTrigger({ lastServiceValue: day('2026-05-01') }),
      metricsAt('2026-05-10'),
      warnDefaults,
      context
    )
    expect(status.due).toBe(day('2027-05-02') - 14)
    expect(status.status).toBe('ok')
  })

  it('supports post-haulout anchoring with a positive offset', () => {
    // "winterize within 7 days of haulout"
    const status = computeTriggerStatus(
      anchorTrigger({ anchor: { milestone: 'haulout', offsetDays: 7 } }),
      metricsAt('2026-10-20'),
      warnDefaults,
      context
    )
    expect(status.due).toBe(day('2026-10-18') + 7)
    expect(status.status).toBe('dueSoon')
  })

  it('is unknown when the trigger has no anchor', () => {
    const status = computeTriggerStatus(
      anchorTrigger({ anchor: undefined }),
      metricsAt('2026-04-15'),
      warnDefaults,
      context
    )
    expect(status.status).toBe('unknown')
    expect(Number.isNaN(status.remaining)).toBe(true)
  })

  it('is unknown when no future milestone is known', () => {
    const status = computeTriggerStatus(
      anchorTrigger({ lastServiceValue: day('2028-01-01') }),
      metricsAt('2028-02-01'),
      warnDefaults,
      context
    )
    expect(status.status).toBe('unknown')
  })

  it('counts an early service toward the upcoming milestone', () => {
    // Antifoul done in March, during the layup before the 2026 launch.
    const status = computeTriggerStatus(
      anchorTrigger({ lastServiceValue: day('2026-03-20') }),
      metricsAt('2026-04-15'),
      warnDefaults,
      context
    )
    expect(status.due).toBe(day('2027-05-02') - 14)
    expect(status.status).toBe('ok')
  })

  it('is unknown when no seasons are defined', () => {
    const status = computeTriggerStatus(anchorTrigger({}), metricsAt('2026-04-15'), warnDefaults, {
      launchDays: [],
      hauloutDays: []
    })
    expect(status.status).toBe('unknown')
  })
})

describe('currentSeason / isAfloat', () => {
  it('returns the season in progress when afloat', () => {
    const now = new Date('2026-07-01T00:00:00.000Z')
    expect(currentSeason(seasons, now)?.id).toBe('2026')
    expect(isAfloat(seasons, now)).toBe(true)
  })

  it('returns null before launch', () => {
    expect(currentSeason(seasons, new Date('2026-04-01T00:00:00.000Z'))).toBeNull()
  })

  it('returns null after haulout', () => {
    expect(currentSeason(seasons, new Date('2026-12-01T00:00:00.000Z'))).toBeNull()
  })
})

describe('buildTimeline', () => {
  const logs: ServiceLog[] = [
    {
      id: 'log1',
      datetime: '2026-06-01T10:00:00.000Z',
      nodeId: 'impeller',
      description: 'Replaced impeller'
    }
  ]
  const events: BoatEvent[] = [
    {
      id: 'ev1',
      datetime: '2026-07-15T08:00:00.000Z',
      category: 'regatta',
      title: 'Round Gotland race',
      createdAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T08:00:00.000Z'
    }
  ]
  const runs: ChecklistRun[] = [
    {
      id: 'run1',
      templateId: 'spring-launch',
      name: 'Spring launch checklist',
      startedAt: '2026-05-20T09:00:00.000Z',
      completedAt: '2026-05-20T10:30:00.000Z',
      results: []
    }
  ]

  it('merges services, events, and season milestones newest first', () => {
    const timeline = buildTimeline(logs, events, seasons)
    const kinds = timeline.map((e) => e.kind)
    // Order by datetime desc: 2027 launch, 2026 haulout, regatta, service, 2026 launch
    expect(timeline[0].kind).toBe('launch') // 2027 launch
    expect(timeline[timeline.length - 1].kind).toBe('launch') // 2026 launch
    expect(kinds).toContain('service')
    expect(kinds).toContain('event')
    expect(kinds).toContain('haulout')
    // Sorted strictly descending
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].datetime >= timeline[i].datetime).toBe(true)
    }
  })

  it('filters by since', () => {
    const timeline = buildTimeline(logs, events, seasons, [], [], '2026-10-01T00:00:00.000Z')
    expect(timeline.every((e) => e.datetime >= '2026-10-01T00:00:00.000Z')).toBe(true)
    expect(timeline.some((e) => e.refId === 'log1')).toBe(false)
  })

  it('includes saved checklist runs, dated by completion', () => {
    const timeline = buildTimeline(logs, events, seasons, runs)
    const entry = timeline.find((e) => e.refId === 'run1')
    expect(entry?.kind).toBe('checklist')
    expect(entry?.datetime).toBe('2026-05-20T10:30:00.000Z')
    expect(entry?.title).toBe('Spring launch checklist')
  })

  it('dates an in-progress run by its start time', () => {
    const inProgress: ChecklistRun[] = [{ ...runs[0], completedAt: undefined }]
    const timeline = buildTimeline(logs, events, seasons, inProgress)
    const entry = timeline.find((e) => e.refId === 'run1')
    expect(entry?.datetime).toBe('2026-05-20T09:00:00.000Z')
  })

  it('emits issueOpened and issueResolved entries from issue history', () => {
    const issues: Issue[] = [
      {
        id: 'pump-broken',
        nodeId: 'foot-pump',
        title: 'Foot pump failed',
        status: 'resolved',
        openedAt: '2026-06-10T12:00:00.000Z',
        resolvedAt: '2026-06-20T15:00:00.000Z',
        updatedAt: '2026-06-20T15:00:00.000Z',
        history: [
          { datetime: '2026-06-10T12:00:00.000Z', type: 'opened' },
          {
            datetime: '2026-06-20T15:00:00.000Z',
            type: 'resolved',
            status: 'resolved',
            comment: 'Fitted a one-for-one replacement pump.'
          }
        ]
      }
    ]
    const timeline = buildTimeline(logs, events, seasons, [], issues)
    const opened = timeline.find((e) => e.kind === 'issueOpened' && e.refId === 'pump-broken')
    const resolved = timeline.find((e) => e.kind === 'issueResolved' && e.refId === 'pump-broken')
    expect(opened?.datetime).toBe('2026-06-10T12:00:00.000Z')
    expect(opened?.title).toBe('Foot pump failed')
    expect(opened?.nodeId).toBe('foot-pump')
    expect(resolved?.datetime).toBe('2026-06-20T15:00:00.000Z')
    expect(resolved?.note).toBe('Fitted a one-for-one replacement pump.')
  })

  it('backfills issue timeline entries from timestamps when history is absent', () => {
    const legacy = [
      {
        id: 'legacy-issue',
        nodeId: 'rig',
        title: 'Legacy issue',
        status: 'resolved',
        openedAt: '2026-05-01T00:00:00.000Z',
        resolvedAt: '2026-05-09T00:00:00.000Z',
        updatedAt: '2026-05-09T00:00:00.000Z'
      } as unknown as Issue
    ]
    const timeline = buildTimeline(logs, events, seasons, [], legacy)
    expect(timeline.some((e) => e.kind === 'issueOpened' && e.refId === 'legacy-issue')).toBe(true)
    expect(timeline.some((e) => e.kind === 'issueResolved' && e.refId === 'legacy-issue')).toBe(
      true
    )
  })
})

describe('seasonAnchor service window', () => {
  const twoSeasons = buildSeasonContext([
    { ...seasons[0] },
    { ...seasons[1], hauloutDate: '2027-10-17' }
  ])
  const haulout = (offsetDays: number, lastServiced: string): Trigger =>
    anchorTrigger({
      name: 'Empty & clean at haulout',
      anchor: { milestone: 'haulout', offsetDays },
      lastServiceValue: day(lastServiced)
    })

  it('clears this haulout when done in the weeks before it', () => {
    // The portapotti case: emptied 2026-10-10, hauled out 2026-10-18, due +3 days.
    const status = computeTriggerStatus(
      haulout(3, '2026-10-10'),
      metricsAt('2026-10-12'),
      warnDefaults,
      twoSeasons
    )
    expect(status.due).toBe(day('2027-10-17') + 3)
    expect(status.status).toBe('ok')
  })

  it('clears this haulout when done late', () => {
    expect(seasonAnchorDueDay(haulout(3, '2026-11-02'), twoSeasons)).toBe(day('2027-10-17') + 3)
  })

  it('does not count a service from before the season toward its haulout', () => {
    // Done during the 2026 spring layup, before that season's launch.
    expect(seasonAnchorDueDay(haulout(0, '2026-04-20'), twoSeasons)).toBe(day('2026-10-18'))
  })

  it('does not count a launch-task service from the season before', () => {
    // Done mid-2026 season: that belongs to the 2026 launch, not the 2027 one.
    const trigger = anchorTrigger({
      anchor: { milestone: 'launch', offsetDays: 0 },
      lastServiceValue: day('2026-07-01')
    })
    expect(seasonAnchorDueDay(trigger, twoSeasons)).toBe(day('2027-05-02'))
  })

  it('opens a post-haulout window no earlier than the previous due date', () => {
    // "Winterize within 14 days" done 2026-10-25 clears 2026 only, not 2027 as well.
    expect(seasonAnchorDueDay(haulout(14, '2026-10-25'), twoSeasons)).toBe(day('2027-10-17') + 14)
  })
})

describe('seasonAnchorStartValue', () => {
  const status = (anchor: Trigger['anchor'], created: string) => {
    const lastServiceValue = seasonAnchorStartValue(anchor!, context, day(created))
    return seasonAnchorDueDay(anchorTrigger({ anchor, lastServiceValue }), context)
  }

  it('leaves this haulout due when a haulout task is created mid-season', () => {
    expect(status({ milestone: 'haulout', offsetDays: 0 }, '2026-06-11')).toBe(day('2026-10-18'))
  })

  it('leaves a post-haulout task due when created inside its window', () => {
    expect(status({ milestone: 'haulout', offsetDays: 14 }, '2026-10-20')).toBe(day('2026-11-01'))
  })

  it('leaves the next launch due when a launch task is created during the layup', () => {
    expect(status({ milestone: 'launch', offsetDays: 0 }, '2026-12-01')).toBe(day('2027-05-02'))
  })

  it('does not count milestones from before a task existed when seasons come later', () => {
    // A starter boat made on 2026-11-11 with no seasons, then the owner enters 2026 and 2027.
    const created = { lastServiceValue: 0, lastServiceDate: '2026-11-11T09:00:00.000Z' }
    const beforeLaunch = anchorTrigger({ anchor: { milestone: 'launch', offsetDays: -14 }, ...created })
    const winterize = anchorTrigger({ anchor: { milestone: 'haulout', offsetDays: 30 }, ...created })
    expect(seasonAnchorDueDay(beforeLaunch, context)).toBe(day('2027-05-02') - 14)
    // Still open on the day it was made, so this winter's job stays due.
    expect(seasonAnchorDueDay(winterize, context)).toBe(day('2026-10-18') + 30)
  })

  it('stays clear of seasons added after the last known milestone', () => {
    // Created after the only haulout; a 2027 season entered later must still come due.
    const lastServiceValue = seasonAnchorStartValue(
      { milestone: 'haulout', offsetDays: 0 },
      context,
      day('2026-12-01')
    )
    const later = buildSeasonContext([seasons[0], { ...seasons[1], hauloutDate: '2027-10-17' }])
    const trigger = anchorTrigger({ anchor: { milestone: 'haulout', offsetDays: 0 }, lastServiceValue })
    expect(seasonAnchorDueDay(trigger, later)).toBe(day('2027-10-17'))
  })
})
