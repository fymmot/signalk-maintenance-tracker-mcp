import { useState } from 'preact/hooks'
import type { TimelineEntry, TimelineKind } from '../../../../src/types'
import { Icon, type IconName } from '../../components/Icon'
import { AppBar, EmptyState, List, Loading, Row } from '../../components/ui'
import { t, tn, type MessageKey } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { buildLogRows, logEntries, winterYears, type LogFilter } from '../../lib/log'
import { hrefFor, type Route } from '../../lib/router'
import { issues, loading, nodesById, seasons, timeline, unavailable } from '../../state/store'
import { DestinationActions } from '../common'
import { Unavailable } from '../states'

/* The boat's record in season chapters (Skerry's Log tab). */

const KIND_ICON: Record<TimelineKind, IconName> = {
  service: 'wrench',
  event: 'flag',
  launch: 'anchor',
  haulout: 'anchor',
  checklist: 'checklist',
  issueOpened: 'warning',
  issueResolved: 'checkCircle'
}

/** Where a log entry leads. */
export function entryRoute(e: TimelineEntry): Route | undefined {
  switch (e.kind) {
    case 'service':
      return e.nodeId ? { name: 'node', id: e.nodeId } : undefined
    case 'event':
      return { name: 'event', id: e.refId }
    case 'launch':
    case 'haulout':
      return { name: 'season', id: e.refId }
    case 'checklist':
      return { name: 'run', id: e.refId }
    case 'issueOpened':
    case 'issueResolved':
      return { name: 'issue', id: e.refId }
  }
}

function EntryRow({ entry }: { entry: TimelineEntry }) {
  const node = entry.nodeId ? nodesById.value.get(entry.nodeId) : undefined
  const to = entryRoute(entry)
  return (
    <Row
      icon={KIND_ICON[entry.kind]}
      tone={entry.kind === 'issueOpened' ? 'tertiary' : undefined}
      title={entry.title || t(`timeline.${entry.kind}` as MessageKey)}
      sub={[t(`timeline.${entry.kind}` as MessageKey), formatIsoDay(entry.datetime), node?.name].filter(Boolean).join(' · ')}
      href={to ? hrefFor(to) : undefined}
    />
  )
}

export function LogScreen() {
  const [filter, setFilter] = useState<LogFilter>('all')
  const body = () => {
    if (loading.value && !timeline.value.length) return <Loading />
    if (unavailable.value) return <Unavailable />
    const rows = buildLogRows(logEntries(timeline.value, filter), seasons.value, issues.value, {
      season: (s) => s.label ?? s.id,
      winter: (s) => t('log.winter', { years: winterYears(s) })
    })
    return (
      <>
        <div class="button-group scroll-x" role="group" aria-label={t('log.filterLabel')}>
          {(['all', 'jobs', 'issues', 'events', 'checklists'] as const).map((f) => (
            <button type="button" class="seg" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`log.${f}`)}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="log" title={t('log.empty')} />
        ) : (
          (() => {
            // Rows between two chapter headings make one segmented list.
            const blocks: Array<{ title?: string; key: string; rows: typeof rows }> = []
            for (const r of rows) {
              if (r.type === 'chapter') blocks.push({ title: r.title, key: r.key, rows: [] })
              else {
                if (!blocks.length) blocks.push({ key: 'none', rows: [] })
                blocks[blocks.length - 1].rows.push(r)
              }
            }
            return blocks.map((b) => (
              <section class="section" key={b.key}>
                {b.title && <h2 class="headline-s emph">{b.title}</h2>}
                <List>
                  {b.rows.map((r) => {
                    if (r.type === 'milestone') {
                      const to = entryRoute(r.entry)
                      return (
                        <li>
                          <a class="li-btn milestone-row" href={to ? hrefFor(to) : undefined}>
                            <span class="li-lead tone-tertiary">
                              <Icon name="anchor" />
                            </span>
                            <span class="li-body">
                              <span class="li-title">{`${t(`timeline.${r.entry.kind}` as MessageKey)} · ${formatIsoDay(r.entry.datetime)}`}</span>
                              {r.daysAfloat !== undefined && (
                                <span class="li-sub">
                                  {[tn('log.daysAfloat', r.daysAfloat), r.issuesFixed ? tn('log.issuesFixed', r.issuesFixed) : ''].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </span>
                          </a>
                        </li>
                      )
                    }
                    if (r.type === 'group') {
                      return (
                        <li class="log-group">
                          <p class="label-l log-group-head">
                            {tn(r.kind === 'service' ? 'log.jobsGroup' : 'log.issuesGroup', r.entries.length)} · {formatIsoDay(r.entries[0].datetime)}
                          </p>
                          <ul class="list">
                            {r.entries.map((e) => (
                              <EntryRow entry={e} />
                            ))}
                          </ul>
                        </li>
                      )
                    }
                    return r.type === 'single' ? <EntryRow entry={r.entry} /> : null
                  })}
                </List>
              </section>
            ))
          })()
        )}
      </>
    )
  }
  return (
    <div>
      <AppBar title={t('log.title')} actions={<DestinationActions />} />
      <div class="pane-inner">{body()}</div>
    </div>
  )
}
