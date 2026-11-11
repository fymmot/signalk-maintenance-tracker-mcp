import { describe, expect, it } from 'vitest'
import { backfillHistory, mergeIssue } from '../src/domain/issues'
import type { Issue } from '../src/types'

const NOW = new Date('2026-06-30T12:00:00.000Z')

function openIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'engine-panel',
    nodeId: 'propulsion-engine',
    title: 'Engine panel warning lights non-functional',
    status: 'open',
    severity: 'high',
    openedAt: '2026-06-11T15:31:12.357Z',
    updatedAt: '2026-06-11T15:31:12.357Z',
    history: [{ datetime: '2026-06-11T15:31:12.357Z', type: 'opened' }],
    ...overrides
  }
}

describe('mergeIssue', () => {
  it('seeds an opened history entry on create', () => {
    const created = mergeIssue(
      null,
      {
        id: 'new-issue',
        nodeId: 'rig',
        title: 'New issue',
        status: 'open',
        openedAt: '2026-06-30T12:00:00.000Z',
        updatedAt: '2026-06-30T12:00:00.000Z',
        history: []
      },
      NOW,
      { comment: 'Spotted during inspection', author: 'skipper' }
    )
    expect(created.history).toHaveLength(1)
    expect(created.history[0]).toMatchObject({
      type: 'opened',
      datetime: '2026-06-30T12:00:00.000Z',
      comment: 'Spotted during inspection',
      author: 'skipper'
    })
  })

  it('records a resolved entry with comment and stamps resolvedAt', () => {
    const existing = openIssue()
    const resolved = mergeIssue(
      existing,
      { ...existing, status: 'resolved' },
      NOW,
      { comment: 'Repaired ground connector on the 2-pin supply.' }
    )
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolvedAt).toBe(NOW.toISOString())
    const last = resolved.history.at(-1)
    expect(last).toMatchObject({
      type: 'resolved',
      status: 'resolved',
      comment: 'Repaired ground connector on the 2-pin supply.'
    })
  })

  it('records a status entry for open -> monitoring', () => {
    const existing = openIssue()
    const monitored = mergeIssue(existing, { ...existing, status: 'monitoring' }, NOW)
    expect(monitored.history.at(-1)).toMatchObject({ type: 'status', status: 'monitoring' })
  })

  it('records a comment entry when status is unchanged', () => {
    const existing = openIssue()
    const commented = mergeIssue(existing, { ...existing }, NOW, { comment: 'Still investigating.' })
    expect(commented.history.at(-1)).toMatchObject({ type: 'comment', comment: 'Still investigating.' })
  })

  it('does not append a comment entry when no comment is provided', () => {
    const existing = openIssue()
    const unchanged = mergeIssue(existing, { ...existing }, NOW)
    expect(unchanged.history).toHaveLength(existing.history.length)
  })

  it('records a reopened entry and clears resolvedAt', () => {
    const resolved = openIssue({
      status: 'resolved',
      resolvedAt: '2026-06-20T10:00:00.000Z',
      history: [
        { datetime: '2026-06-11T15:31:12.357Z', type: 'opened' },
        { datetime: '2026-06-20T10:00:00.000Z', type: 'resolved', status: 'resolved' }
      ]
    })
    const reopened = mergeIssue(resolved, { ...resolved, status: 'open' }, NOW, {
      comment: 'Fault came back.'
    })
    expect(reopened.resolvedAt).toBeUndefined()
    expect(reopened.history.at(-1)).toMatchObject({
      type: 'reopened',
      status: 'open',
      comment: 'Fault came back.'
    })
  })

  it('backfills missing history before appending', () => {
    const legacy = {
      id: 'legacy',
      nodeId: 'rig',
      title: 'Legacy issue',
      status: 'open',
      openedAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z'
    } as unknown as Issue
    const resolved = mergeIssue(legacy, { ...legacy, status: 'resolved' }, NOW, {
      comment: 'Done.'
    })
    expect(resolved.history[0]).toMatchObject({ type: 'opened', datetime: '2026-05-01T00:00:00.000Z' })
    expect(resolved.history.at(-1)).toMatchObject({ type: 'resolved', comment: 'Done.' })
  })
})

describe('backfillHistory', () => {
  it('returns an opened entry for an open issue', () => {
    const history = backfillHistory(openIssue())
    expect(history).toEqual([{ datetime: '2026-06-11T15:31:12.357Z', type: 'opened' }])
  })

  it('adds a resolved entry for a resolved issue', () => {
    const history = backfillHistory(
      openIssue({ status: 'resolved', resolvedAt: '2026-06-20T10:00:00.000Z' })
    )
    expect(history.map((h) => h.type)).toEqual(['opened', 'resolved'])
  })

  it('returns an empty array for null', () => {
    expect(backfillHistory(null)).toEqual([])
  })
})
