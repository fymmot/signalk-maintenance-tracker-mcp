import type {
  BoatEvent,
  ChecklistRun,
  Issue,
  Season,
  SeasonContext,
  ServiceLog,
  TimelineEntry
} from '../types'
import { backfillHistory } from './issues'

const MS_PER_DAY = 86_400_000

/**
 * Converts an ISO date (`YYYY-MM-DD` or a full date-time) to fractional
 * days-since-epoch, matching `MetricsSnapshot.calendarTime`. Returns `undefined`
 * for an unparseable value.
 */
export function dateToDayNumber(date: string | undefined): number | undefined {
  if (!date) return undefined
  const ms = Date.parse(date)
  return Number.isNaN(ms) ? undefined : ms / MS_PER_DAY
}

/** Builds the ascending launch/haulout day-number lists seasonAnchor triggers use. */
export function buildSeasonContext(seasons: Season[]): SeasonContext {
  const launchDays: number[] = []
  const hauloutDays: number[] = []
  for (const season of seasons) {
    const launch = dateToDayNumber(season.launchDate)
    if (launch !== undefined) launchDays.push(launch)
    const haulout = dateToDayNumber(season.hauloutDate)
    if (haulout !== undefined) hauloutDays.push(haulout)
  }
  launchDays.sort((a, b) => a - b)
  hauloutDays.sort((a, b) => a - b)
  return { launchDays, hauloutDays }
}

/**
 * The season currently in progress: launched on or before `now` and not yet
 * hauled out (or hauled out on/after `now`). When several match, the one with
 * the latest launch wins.
 */
export function currentSeason(seasons: Season[], now: Date = new Date()): Season | null {
  const nowDay = now.getTime() / MS_PER_DAY
  let best: { season: Season; launch: number } | null = null
  for (const season of seasons) {
    const launch = dateToDayNumber(season.launchDate)
    if (launch === undefined || launch > nowDay) continue
    const haulout = dateToDayNumber(season.hauloutDate)
    if (haulout !== undefined && haulout < nowDay) continue
    if (!best || launch > best.launch) best = { season, launch }
  }
  return best?.season ?? null
}

/** True when a launch is in the past with no later haulout — i.e. the boat is afloat. */
export function isAfloat(seasons: Season[], now: Date = new Date()): boolean {
  return currentSeason(seasons, now) !== null
}

function toIso(date: string): string {
  const ms = Date.parse(date)
  return Number.isNaN(ms) ? date : new Date(ms).toISOString()
}

/**
 * Merges service logs, events, season milestones, saved checklist runs, and
 * issue lifecycle (opened/resolved) into a single timeline, newest first.
 * Optionally filtered to entries at or after `since` (ISO). Checklist runs only
 * exist once a run has been saved, so they always represent a real, recorded
 * run (never a freshly-opened, unsaved one). Issue history is backfilled from
 * `openedAt`/`resolvedAt` for legacy records with no recorded history.
 */
export function buildTimeline(
  logs: ServiceLog[],
  events: BoatEvent[],
  seasons: Season[],
  runs: ChecklistRun[] = [],
  issues: Issue[] = [],
  since?: string
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const log of logs) {
    entries.push({
      datetime: log.datetime,
      kind: 'service',
      refId: log.id,
      title: log.description,
      nodeId: log.nodeId
    })
  }

  for (const event of events) {
    entries.push({
      datetime: event.datetime,
      kind: 'event',
      refId: event.id,
      title: event.title,
      category: event.category,
      nodeId: event.nodeId
    })
  }

  for (const season of seasons) {
    const label = season.label ?? season.id
    if (season.launchDate) {
      entries.push({
        datetime: toIso(season.launchDate),
        kind: 'launch',
        refId: season.id,
        title: `${label}: launched`
      })
    }
    if (season.hauloutDate) {
      entries.push({
        datetime: toIso(season.hauloutDate),
        kind: 'haulout',
        refId: season.id,
        title: `${label}: hauled out`
      })
    }
  }

  for (const run of runs) {
    const datetime = run.completedAt ?? run.startedAt
    if (!datetime) continue
    entries.push({
      datetime,
      kind: 'checklist',
      refId: run.id,
      title: run.name
    })
  }

  for (const issue of issues) {
    const history =
      Array.isArray(issue.history) && issue.history.length > 0
        ? issue.history
        : backfillHistory(issue)
    for (const entry of history) {
      if (entry.type === 'opened') {
        entries.push({
          datetime: entry.datetime,
          kind: 'issueOpened',
          refId: issue.id,
          title: issue.title,
          nodeId: issue.nodeId,
          ...(entry.comment ? { note: entry.comment } : {})
        })
      } else if (entry.type === 'resolved') {
        entries.push({
          datetime: entry.datetime,
          kind: 'issueResolved',
          refId: issue.id,
          title: issue.title,
          nodeId: issue.nodeId,
          ...(entry.comment ? { note: entry.comment } : {})
        })
      }
    }
  }

  const filtered = since ? entries.filter((e) => e.datetime >= since) : entries
  return filtered.sort((a, b) => b.datetime.localeCompare(a.datetime))
}
