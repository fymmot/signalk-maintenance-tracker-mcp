// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { ServiceJob } from '../../../src/domain/work'
import type { Issue, MaintenanceNode, NodeDue } from '../../../src/types'
import { setLangPref } from '../i18n'
import { childState, subtreeSummary, summaryParts } from './maint'

const stamp = '2026-01-01T00:00:00Z'
const n = (id: string, type: MaintenanceNode['type'], parentId?: string): MaintenanceNode => ({
  id,
  type,
  parentId,
  name: id,
  triggers: [],
  createdAt: stamp,
  updatedAt: stamp
})
const nodes = [n('rig', 'system'), n('standing', 'component', 'rig'), n('winches', 'part', 'rig'), n('mainsail', 'part', 'rig'), n('galley', 'system')]
const job = (nodeId: string, remaining: number): ServiceJob => ({
  nodeId,
  nodeName: nodeId,
  trigger: { triggerId: 't', name: 'Service', metric: 'calendarTime', due: 0, remaining, status: remaining <= 0 ? 'overdue' : 'dueSoon' }
})
const issue = (id: string, nodeId: string, severity: Issue['severity']): Issue =>
  ({ id, nodeId, title: id, status: 'open', severity, openedAt: stamp, updatedAt: stamp, history: [] }) as Issue
const queue = {
  overdue: [job('winches', -120)],
  thisWeek: [job('galley', 3)],
  milestoneIssues: [issue('turnbuckles', 'standing', 'high')],
  openIssues: [issue('vhf', 'rig', 'medium'), issue('stove', 'galley', 'low')]
}
const due = (nodeId: string, status: NodeDue['status'], metric: 'seasonAnchor' | 'calendarTime' = 'calendarTime'): NodeDue => ({
  nodeId,
  name: nodeId,
  type: 'part',
  status,
  rollupStatus: status,
  triggers: [{ triggerId: 't', name: 'x', metric, due: 0, remaining: 1, status }]
})

describe('subtrees', () => {
  setLangPref('en')

  it('finds what needs doing under a node, including the node, from the work queue', () => {
    const s = subtreeSummary(nodes, queue, 'rig')
    expect(s.overdue.map((j) => j.nodeId)).toEqual(['winches'])
    expect(s.thisWeek).toEqual([])
    expect(s.issues.map((i) => i.id)).toEqual(['turnbuckles', 'vhf'])
    expect(summaryParts(s)).toEqual(['2 issues', '1 overdue'])
  })

  it('words each child by what it needs, and asks for a fix it cannot track', () => {
    const dues = new Map([
      ['mainsail', due('mainsail', 'unknown', 'seasonAnchor')],
      ['winches', due('winches', 'overdue')]
    ])
    expect(childState(nodes, dues, queue, 'winches')).toMatchObject({ kind: 'attention', tone: 'error', text: '1 overdue' })
    expect(childState(nodes, dues, queue, 'standing')).toMatchObject({ kind: 'attention', tone: 'error', text: '1 issue' })
    expect(childState(nodes, dues, queue, 'mainsail')).toMatchObject({ kind: 'fix', text: 'Needs a season date' })
    expect(childState(nodes, new Map([['winches', due('winches', 'ok')]]), null, 'winches')).toMatchObject({ kind: 'ok' })
    expect(childState(nodes, new Map(), null, 'mainsail')).toMatchObject({ kind: 'empty' })
  })
})
