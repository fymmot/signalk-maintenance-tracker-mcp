import { describe, expect, it } from 'vitest'
import type { Issue, Season, TimelineEntry } from '../../../src/types'
import { buildLogRows, chapterOf, logEntries, winterYears } from './log'

const stamp = '2026-01-01T00:00:00Z'
const seasons: Season[] = [
  { id: '2026', label: '2026 season', launchDate: '2026-04-26', hauloutDate: '2026-10-25', createdAt: stamp, updatedAt: stamp },
  { id: '2025', label: '2025 season', launchDate: '2025-04-12', hauloutDate: '2025-10-27', createdAt: stamp, updatedAt: stamp }
]
const day = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000)
const e = (datetime: string, kind: TimelineEntry['kind'], refId = 'x', title = kind): TimelineEntry => ({ datetime, kind, refId, title })
const titles = { season: (s: Season) => s.label ?? s.id, winter: (s: Season) => `Winter ${winterYears(s)}` }

describe('chapters', () => {
  it('puts an entry in the season it was afloat in, or the winter after', () => {
    expect(chapterOf(day('2026-07-01'), seasons)).toMatchObject({ kind: 'season', season: { id: '2026' } })
    expect(chapterOf(day('2026-10-25'), seasons)).toMatchObject({ kind: 'season', season: { id: '2026' } })
    expect(chapterOf(day('2026-11-02'), seasons)).toMatchObject({ kind: 'winter', season: { id: '2026' } })
    expect(chapterOf(day('2026-02-01'), seasons)).toMatchObject({ kind: 'winter', season: { id: '2025' } })
    expect(chapterOf(day('2024-06-01'), seasons)).toBeUndefined()
    expect(winterYears(seasons[0])).toBe('2026–27')
  })
})

describe('log rows', () => {
  it('opens chapters, closes seasons with a milestone and folds same-day jobs', () => {
    const issues = [{ id: 'i', resolvedAt: '2026-06-01T10:00:00Z' } as Issue]
    const entries = logEntries(
      [
        e('2026-11-02T10:00:00Z', 'service', 'a'),
        e('2026-11-02T12:00:00Z', 'service', 'b'),
        e('2026-10-25T08:00:00Z', 'haulout', '2026'),
        e('2026-06-01T10:00:00Z', 'issueResolved', 'i'),
        e('2026-04-26T08:00:00Z', 'launch', '2026'),
        e('2099-01-01T00:00:00Z', 'launch', 'future')
      ],
      'all',
      Date.parse('2026-11-03T00:00:00Z')
    )
    const rows = buildLogRows(entries, seasons, issues, titles)
    expect(rows.map((r) => r.type)).toEqual(['chapter', 'group', 'chapter', 'milestone', 'single', 'milestone'])
    expect(rows[0]).toMatchObject({ title: 'Winter 2026–27' })
    expect(rows[1]).toMatchObject({ kind: 'service', entries: [{ refId: 'b' }, { refId: 'a' }] })
    expect(rows[3]).toMatchObject({ daysAfloat: 182, issuesFixed: 1 })
    expect(rows[5]).toMatchObject({ daysAfloat: undefined })
  })

  it('filters by kind', () => {
    const all = [e('2026-05-01T00:00:00Z', 'service'), e('2026-05-02T00:00:00Z', 'event'), e('2026-05-03T00:00:00Z', 'launch')]
    expect(logEntries(all, 'events', Date.parse('2027-01-01')).map((x) => x.kind)).toEqual(['launch', 'event'])
    expect(logEntries(all, 'jobs', Date.parse('2027-01-01')).map((x) => x.kind)).toEqual(['service'])
  })
})
