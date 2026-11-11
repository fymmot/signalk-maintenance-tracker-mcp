import type { Issue, IssueHistoryEntry } from '../types'

export interface IssueMergeOptions {
  /** Free-text note to record in history for this change. */
  comment?: string
  author?: string
}

/**
 * Synthesizes a minimal history for a legacy issue that predates the audit
 * trail, derived from its timestamps: always an `opened` entry, plus a
 * `resolved` entry when the issue is currently resolved. Returns a fresh array.
 */
export function backfillHistory(issue: Issue | null): IssueHistoryEntry[] {
  if (!issue) return []
  const history: IssueHistoryEntry[] = [{ datetime: issue.openedAt, type: 'opened' }]
  if (issue.status === 'resolved' && issue.resolvedAt) {
    history.push({ datetime: issue.resolvedAt, type: 'resolved', status: 'resolved' })
  }
  return history
}

function existingHistory(existing: Issue | null): IssueHistoryEntry[] {
  if (!existing) return []
  if (Array.isArray(existing.history) && existing.history.length > 0) {
    return [...existing.history]
  }
  return backfillHistory(existing)
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim()
  return t ? t : undefined
}

/**
 * Merges an incoming issue update onto an existing record, refreshing
 * `updatedAt`, stamping `resolvedAt` when the status first becomes resolved,
 * and appending the matching audit-trail entry (opened / status / comment /
 * resolved / reopened) to `history`. A legacy record's history is backfilled
 * from its timestamps before the new entry is appended.
 */
export function mergeIssue(
  existing: Issue | null,
  incoming: Issue,
  now: Date,
  opts: IssueMergeOptions = {}
): Issue {
  const nowIso = now.toISOString()
  const comment = trimmed(opts.comment)
  const author = trimmed(opts.author)
  const history = existingHistory(existing)

  const merged: Issue = {
    ...incoming,
    openedAt: existing?.openedAt ?? incoming.openedAt ?? nowIso,
    updatedAt: nowIso,
    history
  }
  if (merged.status === 'resolved' && !merged.resolvedAt) {
    merged.resolvedAt = nowIso
  }
  if (merged.status !== 'resolved') {
    delete merged.resolvedAt
  }

  const base: { datetime: string; comment?: string; author?: string } = { datetime: nowIso }
  if (comment) base.comment = comment
  if (author) base.author = author

  if (!existing) {
    history.push({ ...base, datetime: merged.openedAt, type: 'opened' })
  } else if (existing.status !== merged.status) {
    if (merged.status === 'resolved') {
      history.push({ ...base, type: 'resolved', status: 'resolved' })
    } else if (existing.status === 'resolved') {
      history.push({ ...base, type: 'reopened', status: merged.status })
    } else {
      history.push({ ...base, type: 'status', status: merged.status })
    }
  } else if (comment) {
    history.push({ ...base, type: 'comment' })
  }

  return merged
}
