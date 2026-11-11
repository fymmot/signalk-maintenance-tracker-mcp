import type { Issue, Season, TimelineEntry, TimelineKind } from '../../../src/types'

/*
 * The Log as chapters, ported from Skerry's MaintenanceHistoryScreen.kt: each season
 * afloat and each winter between, newest first. The haulout or launch that closes a
 * chapter is a milestone row (with how the season went), and same-day runs of jobs or
 * of issues found fold into one row.
 */

export type LogFilter = 'all' | 'jobs' | 'issues' | 'events' | 'checklists'

const FILTER_KINDS: Record<Exclude<LogFilter, 'all'>, TimelineKind[]> = {
  jobs: ['service'],
  issues: ['issueOpened', 'issueResolved'],
  events: ['event', 'launch', 'haulout'],
  checklists: ['checklist']
}

export function matchesFilter(filter: LogFilter, kind: TimelineKind): boolean {
  return filter === 'all' || FILTER_KINDS[filter].includes(kind)
}

export type LogRow =
  | { type: 'chapter'; title: string; key: string }
  | { type: 'milestone'; entry: TimelineEntry; daysAfloat?: number; issuesFixed?: number }
  | { type: 'single'; entry: TimelineEntry }
  | { type: 'group'; kind: TimelineKind; entries: TimelineEntry[] }

function day(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : undefined
}

/** The season an entry was afloat in, else the winter after one; undefined before any season. */
export function chapterOf(date: number, seasons: Season[]): { kind: 'season' | 'winter'; season: Season } | undefined {
  const dated = seasons
    .map((s) => ({ s, launch: day(s.launchDate), haulout: day(s.hauloutDate) }))
    .filter((x): x is { s: Season; launch: number; haulout: number | undefined } => x.launch !== undefined)
    .sort((a, b) => a.launch - b.launch)
  const afloat = [...dated].reverse().find((x) => date >= x.launch && (x.haulout === undefined || date <= x.haulout))
  if (afloat) return { kind: 'season', season: afloat.s }
  const before = [...dated].reverse().find((x) => x.haulout !== undefined && date > x.haulout)
  return before ? { kind: 'winter', season: before.s } : undefined
}

export function winterYears(season: Season): string {
  const ms = Date.parse(season.hauloutDate ?? '')
  if (!Number.isFinite(ms)) return season.id
  const y = new Date(ms).getUTCFullYear()
  return `${y}–${String((y + 1) % 100).padStart(2, '0')}`
}

export function buildLogRows(
  entries: TimelineEntry[],
  seasons: Season[],
  issues: Issue[],
  titles: { season: (s: Season) => string; winter: (s: Season) => string }
): LogRow[] {
  const rows: LogRow[] = []
  let chapter: string | undefined
  for (let i = 0; i < entries.length; ) {
    const entry = entries[i]
    const date = day(entry.datetime)
    const ch = date !== undefined ? chapterOf(date, seasons) : undefined
    const title = ch ? (ch.kind === 'season' ? titles.season(ch.season) : titles.winter(ch.season)) : undefined
    if (title !== undefined && title !== chapter) {
      rows.push({ type: 'chapter', title, key: `${ch!.kind}-${ch!.season.id}` })
      chapter = title
    }
    if (entry.kind === 'haulout' || entry.kind === 'launch') {
      const season = seasons.find((s) => s.id === entry.refId)
      const launch = day(season?.launchDate)
      const haulout = day(season?.hauloutDate)
      const closed = entry.kind === 'haulout' && launch !== undefined && haulout !== undefined
      rows.push({
        type: 'milestone',
        entry,
        daysAfloat: closed ? haulout! - launch! : undefined,
        issuesFixed: closed
          ? issues.filter((iss) => {
              const r = day(iss.resolvedAt)
              return r !== undefined && r >= launch! && r <= haulout!
            }).length
          : undefined
      })
      i++
      continue
    }
    let j = i + 1
    if (entry.kind === 'service' || entry.kind === 'issueOpened') {
      while (j < entries.length && entries[j].kind === entry.kind && day(entries[j].datetime) === date) j++
    }
    rows.push(j - i > 1 ? { type: 'group', kind: entry.kind, entries: entries.slice(i, j) } : { type: 'single', entry })
    i = j
  }
  return rows
}

/** Newest first, nothing in the future (a planned launch isn't history yet). */
export function logEntries(timeline: TimelineEntry[], filter: LogFilter, now = Date.now()): TimelineEntry[] {
  return timeline
    .filter((e) => matchesFilter(filter, e.kind) && Date.parse(e.datetime) <= now)
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
}
