import { useState } from 'preact/hooks'
import type { ServiceJob, SeasonPhase } from '../../../../src/domain/work'
import type { ChecklistRun, Issue } from '../../../../src/types'
import { Icon } from '../../components/Icon'
import { AppBar, Banner, EmptyState, List, Loading, Row, Section } from '../../components/ui'
import { t, tn } from '../../i18n'
import { formatDayShort } from '../../lib/format'
import { jobDueText, rootOf, severityIcon, severityLabel, severityTone } from '../../lib/maint'
import { hrefFor, navigate, route } from '../../lib/router'
import { openEditor } from '../../state/editors'
import { canWrite, loadError, loading, nodes, nodesById, refreshAll, seasons, templates, unavailable, work } from '../../state/store'
import { DestinationActions } from '../common'
import { Unavailable } from '../states'
import { Onboarding, SeasonPrompt } from '../onboarding'

/*
 * Work: what wants doing now, from GET /work (the same grouping as Skerry's Work tab).
 * The season hero counts down to the next milestone; tiles jump to their section;
 * chips narrow the list to one system.
 */

function currentId(kind: 'node' | 'issue' | 'run'): string | undefined {
  const r = route.value
  return r.name === kind ? r.id : undefined
}

function SeasonHero({ phase, today, counts }: { phase: SeasonPhase; today: number; counts: { week: number; overdue: number; issues: number } }) {
  const afloat = phase.state === 'afloat'
  const target = afloat ? phase.plannedHaulout : phase.nextLaunch
  const from = afloat ? phase.launched : phase.hauledOut
  const big = target !== undefined ? target - today : from !== undefined ? today - from : undefined
  const unit =
    target !== undefined
      ? tn(afloat ? 'work.daysToHaulout' : 'work.daysToLaunch', big ?? 0)
      : tn(afloat ? 'work.daysAfloat' : 'work.daysAshore', big ?? 0)
  const jobs = work.value ? [...work.value.thisWeek, ...work.value.beforeMilestone] : []
  const span = from !== undefined && target !== undefined && target > from ? target - from : undefined
  const pos = (day: number) => (span ? Math.max(0, Math.min(1, (day - from!) / span)) * 100 : 0)

  const jump = (id: string) => () => {
    const el = document.getElementById(id)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }

  return (
    <div class="card card-filled hero">
      <p class="label-l muted">{afloat ? t('work.afloat') : t('work.ashore')}</p>
      {big !== undefined ? (
        <p class="hero-count">
          <span class="display-m hero-number">{big}</span> <span class="title-l">{unit}</span>
        </p>
      ) : (
        <p class="title-l">{t('work.noLaunch')}</p>
      )}

      {span !== undefined && (
        <div
          class="hero-track"
          role="img"
          aria-label={t('work.timelineLabel', { from: formatDayShort(from!), to: formatDayShort(target!), today: formatDayShort(today) })}
        >
          <span class="hero-track-fill" style={{ width: `${pos(today)}%` }} />
          {jobs
            .filter((j) => j.dueDay !== undefined)
            .map((j) => (
              <span class="hero-dot" style={{ left: `${pos(j.dueDay!)}%` }} />
            ))}
          <span class="hero-today" style={{ left: `${pos(today)}%` }} />
        </div>
      )}
      {(from !== undefined || target !== undefined) && (
        <div class="row hero-ends fine">
          <span class="grow">
            {from !== undefined && (afloat ? t('work.launched', { date: formatDayShort(from) }) : t('work.hauledOut', { date: formatDayShort(from) }))}
          </span>
          {target !== undefined && (
            <span>{afloat ? t('work.hauloutOn', { date: formatDayShort(target) }) : t('work.launchOn', { date: formatDayShort(target) })}</span>
          )}
        </div>
      )}
      {!afloat && target === undefined && canWrite.value && (
        <div>
          <a class="btn btn-tonal" href={hrefFor({ name: 'season' })}>
            <Icon name="calendar" />
            {t('work.addLaunch')}
          </a>
        </div>
      )}

      <div class="tiles">
        <button type="button" class="tile" disabled={!counts.week} onClick={jump('work-week')}>
          <span class="tile-value">{counts.week}</span>
          <span class="tile-label">{t('work.tileThisWeek')}</span>
        </button>
        <button type="button" class={`tile${counts.overdue ? ' tone-error' : ''}`} disabled={!counts.overdue} onClick={jump('work-overdue')}>
          <span class="tile-value">{counts.overdue}</span>
          <span class="tile-label">{tn('work.tileOverdue', counts.overdue)}</span>
        </button>
        <button type="button" class="tile" disabled={!counts.issues} onClick={jump('work-issues')}>
          <span class="tile-value">{counts.issues}</span>
          <span class="tile-label">{tn('work.tileIssues', counts.issues)}</span>
        </button>
      </div>
    </div>
  )
}

function JobRow({ job, today }: { job: ServiceJob; today: number }) {
  const byId = nodesById.value
  const root = rootOf(byId, job.nodeId)
  const sub = [jobDueText(job, today), job.trigger.name, root && root.id !== job.nodeId ? root.name : undefined].filter(Boolean).join(' · ')
  const overdue = (job.trigger.remaining ?? 0) <= 0 && !job.trigger.snoozedUntil
  return (
    <Row
      icon={job.trigger.snoozedUntil ? 'snooze' : 'wrench'}
      tone={overdue ? 'error' : undefined}
      title={job.nodeName}
      sub={sub}
      href={hrefFor({ name: 'node', id: job.nodeId })}
      current={currentId('node') === job.nodeId}
      trailing={
        canWrite.value && !job.trigger.snoozedUntil ? (
          <button
            type="button"
            class="icon-btn icon-btn-outlined"
            aria-label={t('work.markDone', { name: `${job.nodeName}, ${job.trigger.name}` })}
            onClick={() => openEditor({ kind: 'service', nodeId: job.nodeId, triggerIds: [job.trigger.triggerId] })}
          >
            <Icon name="check" />
          </button>
        ) : undefined
      }
    />
  )
}

export function IssueRow({ issue }: { issue: Issue }) {
  const node = nodesById.value.get(issue.nodeId)
  return (
    <Row
      icon={severityIcon(issue.severity)}
      tone={severityTone(issue.severity)}
      title={issue.title}
      sub={[severityLabel(issue.severity), node?.name].filter(Boolean).join(' · ')}
      href={hrefFor({ name: 'issue', id: issue.id })}
      current={currentId('issue') === issue.id}
    />
  )
}

function RunRow({ run }: { run: ChecklistRun }) {
  const done = run.results.filter((r) => r.status !== 'pending').length
  return (
    <Row
      icon="checklist"
      tone="primary"
      title={run.section ? `${run.name} · ${run.section}` : run.name}
      sub={t('work.checklistProgress', { done: String(done), total: String(run.results.length) })}
      href={hrefFor({ name: 'run', id: run.id })}
      current={currentId('run') === run.id}
    />
  )
}

export function WorkScreen() {
  const [picked, setSystem] = useState<string | null>(null)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const w = work.value
  const byId = nodesById.value

  const body = () => {
    if (loading.value && !w) return <Loading />
    if (unavailable.value) return <Unavailable />
    if (!w) return null
    if (nodes.value.length === 0) return <Onboarding />
    // One chip per system with something on the list; only worth showing for two or more.
    const counts = new Map<string, number>()
    for (const id of [...w.thisWeek, ...w.overdue, ...w.beforeMilestone].map((j) => j.nodeId).concat([...w.milestoneIssues, ...w.openIssues].map((i) => i.nodeId))) {
      const r = rootOf(byId, id)
      if (r) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
    }
    const chips = [...counts.entries()].sort((a, b) => b[1] - a[1])
    // A picked system whose chip has gone (its work is done) stops filtering.
    const system = picked && counts.has(picked) ? picked : null
    const inSystem = (nodeId: string) => !system || rootOf(byId, nodeId)?.id === system
    const thisWeek = w.thisWeek.filter((j) => inSystem(j.nodeId))
    const overdue = w.overdue.filter((j) => inSystem(j.nodeId))
    const snoozed = w.snoozed.filter((j) => inSystem(j.nodeId))
    const before = w.beforeMilestone.filter((j) => inSystem(j.nodeId))
    const milestoneIssues = w.milestoneIssues.filter((i) => inSystem(i.nodeId))
    const openIssues = w.openIssues.filter((i) => inSystem(i.nodeId))
    const checklists = system ? [] : w.suggestedChecklists
    const runs = system ? [] : w.inProgressRuns
    const weekCount = w.thisWeek.length + w.suggestedChecklists.length + w.inProgressRuns.length


    const nothing =
      !thisWeek.length && !overdue.length && !before.length && !milestoneIssues.length && !openIssues.length && !checklists.length && !runs.length && !snoozed.length

    return (
      <>
        {loadError.value && (
          <Banner tone="error" icon="warning" action={<button type="button" class="btn btn-text" onClick={() => void refreshAll()}>{t('common.retry')}</button>}>
            <p class="title-s">{t('error.load')}</p>
          </Banner>
        )}
        {seasons.value.length === 0 && <SeasonPrompt />}
        <SeasonHero phase={w.phase} today={w.today} counts={{ week: weekCount, overdue: w.overdue.length, issues: w.milestoneIssues.length + w.openIssues.length }} />

        {chips.length > 1 && (
          <div class="chip-row" role="group" aria-label={t('work.filterLabel')}>
            <button type="button" class="chip" aria-pressed={!system} onClick={() => setSystem(null)}>
              {!system && <Icon name="check" />}
              {t('work.filterAll')}
            </button>
            {chips.map(([id, n]) => (
              <button type="button" class="chip" aria-pressed={system === id} onClick={() => setSystem(system === id ? null : id)}>
                {system === id && <Icon name="check" />}
                {byId.get(id)?.name} <span class="chip-count">{n}</span>
              </button>
            ))}
          </div>
        )}

        {nothing && <EmptyState icon="checkCircle" title={t('work.empty')} body={t('work.emptyBody')} />}

        {(thisWeek.length > 0 || checklists.length > 0 || runs.length > 0) && (
          <Section title={t('work.thisWeek')} id="work-week">
            <List>
              {checklists.map((c) => {
                const tpl = templates.value.find((x) => x.id === c.templateId)
                return (
                  <Row
                    icon="play"
                    tone="primary"
                    title={c.section ? `${c.templateName} · ${c.section}` : c.templateName}
                    sub={t('work.checklist')}
                    href={tpl ? hrefFor({ name: 'checklist', id: tpl.id }) : undefined}
                  />
                )
              })}
              {runs.map((r) => (
                <RunRow run={r} />
              ))}
              {thisWeek.map((j) => (
                <JobRow job={j} today={w.today} />
              ))}
            </List>
          </Section>
        )}

        {(overdue.length > 0 || snoozed.length > 0) && (
          <Section title={t('work.overdue')} id="work-overdue">
            {overdue.length > 0 && (
              <List>
                {overdue.map((j) => (
                  <JobRow job={j} today={w.today} />
                ))}
              </List>
            )}
            {snoozed.length > 0 && (
              <>
                <button type="button" class="btn btn-text" aria-expanded={showSnoozed} onClick={() => setShowSnoozed(!showSnoozed)}>
                  <Icon name={showSnoozed ? 'chevronDown' : 'chevron'} />
                  {tn('work.snoozed', snoozed.length)}
                </button>
                {showSnoozed && (
                  <List>
                    {snoozed.map((j) => (
                      <JobRow job={j} today={w.today} />
                    ))}
                  </List>
                )}
              </>
            )}
          </Section>
        )}

        {(before.length > 0 || milestoneIssues.length > 0) && (
          <Section
            title={w.nextMilestone === 'launch' ? t('work.beforeLaunch') : t('work.beforeHaulout')}
            trailing={w.nextMilestoneDay !== undefined && <span class="fine">{t('work.by', { date: formatDayShort(w.nextMilestoneDay) })}</span>}
          >
            <List>
              {milestoneIssues.map((i) => (
                <IssueRow issue={i} />
              ))}
              {before.map((j) => (
                <JobRow job={j} today={w.today} />
              ))}
            </List>
          </Section>
        )}

        {openIssues.length > 0 && (
          <Section title={t('work.openIssues')} id="work-issues">
            <List>
              {openIssues.slice(0, 4).map((i) => (
                <IssueRow issue={i} />
              ))}
            </List>
            {openIssues.length > 4 && (
              <div>
                <button type="button" class="btn btn-text" onClick={() => navigate({ name: 'issues' })}>
                  {tn('work.showAllIssues', w.milestoneIssues.length + w.openIssues.length)}
                </button>
              </div>
            )}
          </Section>
        )}
      </>
    )
  }

  return (
    <div>
      <AppBar title={t('nav.work')} actions={<DestinationActions />} />
      <div class="pane-inner">{body()}</div>
    </div>
  )
}
