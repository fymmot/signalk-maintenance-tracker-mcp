import { describe, expect, it } from 'vitest'
import {
  buildWorkQueue,
  isoToEpochDay,
  searchNodes,
  seasonPhase,
  systemSummaries,
  workBadgeCount
} from '../src/domain/work'
import type { ChecklistRun, ChecklistTemplate, Issue, MaintenanceNode, NodeDue, Season, TriggerStatus } from '../src/types'

/*
 * The work queue against a real boat on 1 Nov 2026: hauled out on 25 Oct, launching
 * 25 Apr 2027. The trigger numbers are the plugin's own `/due` output from that day.
 * Same cases as Skerry's MaintenanceWorkTest, so both clients group work alike.
 */

const day = (iso: string): number => isoToEpochDay(iso)!
const today = day('2026-11-01')
const stamp = '2026-01-01T00:00:00Z'

const seasons: Season[] = [
  { id: '2027', launchDate: '2027-04-25', createdAt: stamp, updatedAt: stamp },
  { id: '2026', launchDate: '2026-04-26', hauloutDate: '2026-10-25', createdAt: stamp, updatedAt: stamp },
  { id: '2025', launchDate: '2025-04-12', hauloutDate: '2025-10-27', createdAt: stamp, updatedAt: stamp }
]

function trigger(
  id: string,
  metric: TriggerStatus['metric'],
  due: number | null,
  remaining: number | null,
  status: TriggerStatus['status'],
  snoozedUntil?: string
): TriggerStatus {
  // `null` is what NaN becomes in the JSON the clients see.
  return { triggerId: id, name: id, metric, due: due as number, remaining: remaining as number, status, snoozedUntil }
}

function node(nodeId: string, name: string, triggers: TriggerStatus[], status: NodeDue['status'] = 'ok'): NodeDue {
  return { nodeId, name, type: 'part', status, rollupStatus: status, triggers }
}

const due: NodeDue[] = [
  node('cooling-system', 'Cooling system', [trigger('winterize', 'seasonAnchor', 20765, 6.16, 'dueSoon')]),
  node('halyard-winches', 'Halyard winches', [trigger('5y', 'calendarTime', 20634.5, -124.3, 'overdue')]),
  node('impeller', 'Raw-water impeller', [
    trigger('2y', 'calendarTime', 20605.5, -153.3, 'overdue', '2027-04-25T22:00:00Z'),
    trigger('500h', 'engineHours', 1200, 260.8, 'ok')
  ]),
  node('cockpit-teak', 'Cockpit teak', [trigger('boracol', 'seasonAnchor', 20919, 160.2, 'ok')]),
  node('coolant', 'Coolant', [trigger('1y', 'calendarTime', 20980.8, 222, 'ok')]),
  node('pre-filter', 'Pre-filter', [trigger('drain', 'engineHours', 950, 4, 'dueSoon')]),
  node('portapotti', 'Portapotti', [trigger('haulout', 'seasonAnchor', null, null, 'unknown')]),
  // Overdue in NodeDue.status only because of an open issue; it has no triggers to do.
  node('deck-hardware', 'Deck hardware', [], 'overdue')
]

function issue(id: string, nodeId: string, status: Issue['status'], severity: Issue['severity'], openedAt: string, fixBy?: Issue['fixBy']): Issue {
  return { id, nodeId, title: id, status, severity, openedAt, fixBy, updatedAt: openedAt, history: [] }
}

const issues: Issue[] = [
  issue('turnbuckles', 'rig-standing', 'open', 'high', '2026-10-30T09:39:04Z', 'launch'),
  issue('tiller', 'tiller', 'open', 'high', '2026-06-11T15:30:04Z'),
  issue('vhf', 'vhf', 'monitoring', 'medium', '2026-06-11T15:54:39Z'),
  issue('windex', 'windex', 'open', 'low', '2026-10-19T18:19:00Z'),
  issue('bilge', 'bilge', 'resolved', 'medium', '2026-06-11T15:33:07Z')
]

const winterStorage: ChecklistTemplate = {
  id: 'winter',
  name: 'Winter storage',
  items: [
    { id: 'a', text: 'Bring the Pi home', category: 'After haulout' },
    { id: 'b', text: 'Refit the solar fuses', category: 'At launch' }
  ],
  schedule: [
    { section: 'After haulout', milestone: 'haulout', withinDays: 14 },
    { section: 'At launch', milestone: 'launch' }
  ],
  createdAt: stamp,
  updatedAt: stamp
}

function run(id: string, templateId: string, startedAt: string, extra: Partial<ChecklistRun> = {}): ChecklistRun {
  return { id, templateId, name: templateId, startedAt, results: [], ...extra }
}

const queue = (runs: ChecklistRun[] = [], on = today) => buildWorkQueue(due, issues, [winterStorage], runs, seasons, on)
const ids = <T extends { nodeId: string }>(list: T[]) => list.map((j) => j.nodeId)

describe('season phase', () => {
  it('ashore waits for the next launch, not the current season', () => {
    expect(seasonPhase(seasons, today)).toEqual({ state: 'ashore', hauledOut: day('2026-10-25'), nextLaunch: day('2027-04-25') })
  })

  it('is afloat until and including haulout day', () => {
    const afloat = { state: 'afloat', launched: day('2026-04-26'), plannedHaulout: day('2026-10-25') }
    expect(seasonPhase(seasons, day('2026-07-01'))).toEqual(afloat)
    expect(seasonPhase(seasons, day('2026-10-25'))).toEqual(afloat)
    expect(queue([], day('2026-07-01')).nextMilestone).toBe('haulout')
  })
})

describe('work queue', () => {
  it('groups jobs by trigger data, not the issue-blended node status', () => {
    const q = queue()
    expect(ids(q.thisWeek)).toEqual(['cooling-system', 'pre-filter'])
    expect(q.thisWeek[0].dueDay).toBe(day('2026-11-08'))
    expect(ids(q.overdue)).toEqual(['halyard-winches'])
    expect(ids(q.snoozed)).toEqual(['impeller'])
    expect(ids(q.beforeMilestone)).toEqual(['cockpit-teak'])
    expect(q.beforeMilestone[0].dueDay).toBe(day('2027-04-11'))
    const all = ids([...q.thisWeek, ...q.overdue, ...q.snoozed, ...q.beforeMilestone])
    expect(all).not.toContain('coolant')
    expect(all).not.toContain('portapotti')
    expect(all).not.toContain('deck-hardware')
    expect(q.badgeCount).toBe(3)
  })

  it('gives the home badge the same count as the queue', () => {
    expect(workBadgeCount(due, today)).toBe(queue().badgeCount)
  })

  it('separates issues to fix by the next milestone and drops resolved ones', () => {
    const q = queue()
    expect(q.milestoneIssues.map((i) => i.id)).toEqual(['turnbuckles'])
    expect(q.openIssues.map((i) => i.id)).toEqual(['tiller', 'vhf', 'windex'])
    // Afloat, the next milestone is haulout, so a fix-by-launch issue is just an open issue.
    const summer = queue([], day('2026-07-01'))
    expect(summer.milestoneIssues).toEqual([])
    expect(summer.openIssues[0].id).toBe('turnbuckles')
  })

  it('suggests a scheduled section in its window until a run starts', () => {
    const suggested = queue().suggestedChecklists
    expect(suggested).toHaveLength(1)
    expect(suggested[0].section).toBe('After haulout')
    expect(suggested[0].milestoneDay).toBe(day('2026-10-25'))

    const started = run('r1', 'winter', '2026-10-26T17:00:00Z', { section: 'After haulout' })
    expect(queue([started]).suggestedChecklists).toEqual([])
    // A run from last season's window doesn't count for this one.
    const old = { ...started, id: 'r0', startedAt: '2025-10-28T10:00:00Z' }
    expect(queue([old]).suggestedChecklists).toHaveLength(1)
    // The launch section opens a week before launch and closes two weeks after.
    expect(queue([], day('2027-04-19')).suggestedChecklists.map((s) => s.section)).toEqual(['At launch'])
    expect(queue([], day('2027-05-10')).suggestedChecklists).toEqual([])
  })

  it('treats unfinished runs as stale after two quiet weeks', () => {
    const june = run('june', 'engine', '2026-06-12T16:19:27Z')
    const recent = run('oct', 'winter', '2026-10-10T10:00:00Z', {
      results: [{ itemId: 'a', text: 'Bring the Pi home', status: 'pass', timestamp: '2026-10-26T17:00:00Z' }]
    })
    const done = run('test', 'test', '2026-06-12T10:19:23Z', { completedAt: '2026-06-12T10:19:37Z' })
    const q = queue([june, recent, done])
    expect(q.inProgressRuns.map((r) => r.id)).toEqual(['oct'])
    expect(q.staleRuns.map((r) => r.id)).toEqual(['june'])
  })
})

describe('system summaries', () => {
  const n = (id: string, type: MaintenanceNode['type'], name: string, parentId?: string): MaintenanceNode => ({
    id,
    type,
    name,
    parentId,
    triggers: [],
    createdAt: stamp,
    updatedAt: stamp
  })

  it('puts systems that need attention first', () => {
    const nodes = [
      n('rig', 'system', 'Rig & sails'),
      n('rig-standing', 'component', 'Standing rigging', 'rig'),
      n('halyard-winches', 'part', 'Halyard winches', 'rig'),
      n('hull', 'system', 'Hull & deck'),
      n('cockpit-teak', 'component', 'Cockpit teak', 'hull'),
      n('galley', 'system', 'Galley')
    ]
    const rigIssues = issues
      .map((i) => (i.id === 'turnbuckles' ? i : { ...i, nodeId: 'rig-standing' }))
      .filter((i) => i.status !== 'resolved')
    const q = buildWorkQueue(due, rigIssues, [], [], seasons, today)
    const summaries = systemSummaries(nodes, due, q)
    expect(summaries.map((s) => s.nodeId)).toEqual(['rig', 'galley', 'hull'])
    expect(summaries[0]).toMatchObject({ overdue: 1, needsAttention: true })
    expect(summaries[2]).toMatchObject({ needsAttention: false, hasSchedules: true })
    expect(summaries[2].next?.nodeId).toBe('cockpit-teak')
    expect(summaries[1].hasSchedules).toBe(false)
  })
})

describe('search', () => {
  const base = { triggers: [], createdAt: stamp, updatedAt: stamp }
  const nodes: MaintenanceNode[] = [
    { ...base, id: 'a', type: 'part', name: 'Raw-water impeller', manufacturer: 'Yanmar' },
    { ...base, id: 'b', type: 'component', name: 'Main engine', manufacturer: 'Yanmar', model: '3YM20' },
    { ...base, id: 'c', type: 'component', name: 'Batteries', serial: 'EW-280' }
  ]

  it('matches every word across name, maker, model and serial', () => {
    expect(searchNodes(nodes, 'yanmar').map((x) => x.id)).toEqual(['b', 'a'])
    expect(searchNodes(nodes, 'yanmar 3ym').map((x) => x.id)).toEqual(['b'])
    expect(searchNodes(nodes, 'ew-280').map((x) => x.id)).toEqual(['c'])
    expect(searchNodes(nodes, '  ')).toEqual([])
  })
})
