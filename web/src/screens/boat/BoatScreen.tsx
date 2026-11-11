import { useState } from 'preact/hooks'
import { searchNodes, type SystemSummary } from '../../../../src/domain/work'
import { Icon } from '../../components/Icon'
import { AppBar, List, Loading, Row, Section } from '../../components/ui'
import { t, tn } from '../../i18n'
import { formatDayShort } from '../../lib/format'
import { childState, nodePath, rootOf, systemIcon } from '../../lib/maint'
import { hrefFor, route } from '../../lib/router'
import { openEditor } from '../../state/editors'
import { canWrite, dueById, events, issues, loading, nodes, nodesById, seasons, unavailable, work } from '../../state/store'
import { DestinationActions } from '../common'
import { Unavailable } from '../states'
import { Onboarding, SeasonPrompt } from '../onboarding'

/*
 * Boat: the systems, those needing attention first (Skerry's Boat tab), a search across
 * parts, makers, models and serials, and the way to seasons, events and every issue.
 */

/** What a system needs, most pressing first: work, then a missing date, then what's next. */
function summaryText(s: SystemSummary): string {
  const parts = [
    s.openIssues ? tn('boat.issues', s.openIssues) : '',
    s.overdue ? tn('boat.overdue', s.overdue) : '',
    s.thisWeek ? tn('boat.thisWeek', s.thisWeek) : ''
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  // A job that can't be scheduled yet (no printed expiry, no season date) outranks a far-off
  // one. With no season at all the banner above says so once, so a row only repeats it
  // when it has nothing scheduled to show instead.
  const noSeason = seasons.value.length === 0
  const state = childState(nodes.value, dueById.value, work.value, s.nodeId, { seasonKnown: !noSeason })
  if (state.kind === 'fix') return state.text
  if (s.next?.dueDay !== undefined) return t('boat.next', { name: s.next.trigger.name, date: formatDayShort(s.next.dueDay) })
  const waiting = noSeason ? childState(nodes.value, dueById.value, work.value, s.nodeId) : state
  if (waiting.kind === 'fix') return waiting.text
  return s.hasSchedules ? t('boat.allGood') : t('boat.noIntervals')
}

function SystemRow({ s }: { s: SystemSummary }) {
  const r = route.value
  return (
    <Row
      icon={systemIcon(s.name)}
      tone={s.overdue || s.highIssues ? 'error' : s.needsAttention ? 'tertiary' : undefined}
      title={s.name}
      sub={summaryText(s)}
      href={hrefFor({ name: 'node', id: s.nodeId })}
      current={r.name === 'node' && r.id === s.nodeId}
    />
  )
}

export function BoatScreen() {
  const [query, setQuery] = useState('')
  const w = work.value
  const byId = nodesById.value

  const body = () => {
    if (loading.value && !w) return <Loading />
    if (unavailable.value) return <Unavailable />
    const systems = w?.systems ?? []
    const attention = systems.filter((s) => s.needsAttention)
    const good = systems.filter((s) => !s.needsAttention)
    const results = query.trim() ? searchNodes(nodes.value, query) : null
    const activeIssues = issues.value.filter((i) => i.status !== 'resolved').length

    return (
      <>
        <div class="search-field" role="search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            placeholder={t('boat.search')}
            aria-label={t('boat.search')}
          />
        </div>

        {results ? (
          results.length ? (
            <List label={t('boat.search')}>
              {results.map((n) => (
                <Row
                  icon={systemIcon(rootOf(byId, n.id)?.name ?? n.name)}
                  title={n.name}
                  sub={[nodePath(byId, n), [n.manufacturer, n.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                  href={hrefFor({ name: 'node', id: n.id })}
                />
              ))}
            </List>
          ) : (
            <p class="body-l muted" role="status">
              {t('boat.noMatch', { q: query.trim() })}
            </p>
          )
        ) : systems.length === 0 ? (
          <Onboarding />
        ) : (
          <>
            {seasons.value.length === 0 && <SeasonPrompt />}
            {attention.length > 0 && (
              <Section title={t('boat.attention')}>
                <List>
                  {attention.map((s) => (
                    <SystemRow s={s} />
                  ))}
                </List>
              </Section>
            )}
            {good.length > 0 && (
              <Section title={t('boat.allGood')}>
                <List>
                  {good.map((s) => (
                    <SystemRow s={s} />
                  ))}
                </List>
              </Section>
            )}
            {canWrite.value && (
              <div>
                <button type="button" class="btn btn-tonal" onClick={() => openEditor({ kind: 'node' })}>
                  <Icon name="add" />
                  {t('boat.addSystem')}
                </button>
              </div>
            )}
          </>
        )}

        {!results && (
          <Section title={t('boat.more')}>
            <List>
              <Row icon="warning" title={t('boat.issuesLink')} sub={tn('node.openIssues', activeIssues)} href={hrefFor({ name: 'issues' })} />
              <Row icon="calendar" title={t('boat.seasonsLink')} sub={tn('boat.seasons', seasons.value.length)} href={hrefFor({ name: 'seasons' })} />
              <Row icon="flag" title={t('boat.events')} sub={events.value.length ? String(events.value.length) : undefined} href={hrefFor({ name: 'events' })} />
            </List>
          </Section>
        )}
      </>
    )
  }

  return (
    <div>
      <AppBar title={t('nav.boat')} actions={<DestinationActions />} />
      <div class="pane-inner">{body()}</div>
    </div>
  )
}
