import { useState } from 'preact/hooks'
import type { ChecklistRun, ChecklistTemplate } from '../../../../src/types'
import { errorKey } from '../../api/client'
import { deleteRun, deleteTemplate } from '../../api/maintenance'
import { Icon } from '../../components/Icon'
import { AppBar, ConfirmDialog, EmptyState, List, Loading, OverflowMenu, Row, Section, snackbar } from '../../components/ui'
import { t, tn } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { checklistSections, draftRun, runProgress } from '../../lib/checklists'
import { isExpanded } from '../../lib/media'
import { hrefFor, navigate, route } from '../../lib/router'
import { forgetRun, startDraft } from '../../state/runs'
import { canWrite, loading, mutate, runs, templates, unavailable, work } from '../../state/store'
import { DestinationActions } from '../common'
import { Missing, missingTitle, Unavailable } from '../states'
import { checklistsCrumb } from '../../lib/trail'

/* Checklists: runs in progress, runs left unfinished, your checklists, the last ones done. */

/** Starts a run of one section (or all of it) as a draft and opens it. */
export function startRun(template: ChecklistTemplate, section: string | undefined): void {
  const run = draftRun(template, section)
  startDraft(run)
  navigate({ name: 'run', id: run.id })
}

function lastActivity(run: ChecklistRun): string {
  return [run.startedAt, ...run.results.map((r) => r.timestamp ?? '')].sort().pop() ?? run.startedAt
}

function scheduleLabel(template: ChecklistTemplate, section: string | undefined): string | undefined {
  const entry = template.schedule?.find((s) => s.section === section)
  return entry ? (entry.milestone === 'haulout' ? t('cl.afterHaulout') : t('cl.atLaunch')) : undefined
}

export function ChecklistsScreen() {
  const [discarding, setDiscarding] = useState<ChecklistRun | null>(null)
  const w = work.value
  const r = route.value

  const body = () => {
    if (loading.value && !w) return <Loading />
    if (unavailable.value) return <Unavailable />
    const inProgress = w?.inProgressRuns ?? []
    const stale = w?.staleRuns ?? []
    const done = runs.value
      .filter((x) => x.completedAt)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 5)
    const list = [...templates.value].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    const lastRunOf = (id: string) =>
      runs.value
        .filter((x) => x.templateId === id)
        .map((x) => x.completedAt ?? x.startedAt)
        .sort()
        .pop()

    return (
      <>
        {inProgress.length > 0 && (
          <Section title={t('cl.inProgress')}>
            <List>
              {inProgress.map((run) => {
                const p = runProgress(run)
                return (
                  <Row
                    icon="checklist"
                    tone="primary"
                    title={run.section ? `${run.name} · ${run.section}` : run.name}
                    sub={tn('cl.progress', p.done, { total: String(p.total) })}
                    href={hrefFor({ name: 'run', id: run.id })}
                    current={r.name === 'run' && r.id === run.id}
                  />
                )
              })}
            </List>
          </Section>
        )}

        {stale.length > 0 && (
          <Section title={t('cl.unfinished')}>
            <List>
              {stale.map((run) => {
                const p = runProgress(run)
                return (
                  <Row
                    icon="pending"
                    title={run.section ? `${run.name} · ${run.section}` : run.name}
                    sub={`${t('cl.started', { date: formatIsoDay(lastActivity(run)) })} · ${tn('cl.progress', p.done, { total: String(p.total) })}`}
                    href={hrefFor({ name: 'run', id: run.id })}
                    trailing={
                      canWrite.value && (
                        <button type="button" class="btn btn-text" onClick={() => setDiscarding(run)} aria-label={t('cl.discardName', { name: run.name })}>
                          {t('cl.discard')}
                        </button>
                      )
                    }
                  />
                )
              })}
            </List>
          </Section>
        )}

        <Section
          title={t('cl.yours')}
          trailing={
            canWrite.value &&
            list.length > 0 && (
              <a class="btn btn-text" href={hrefFor({ name: 'checklistEdit' })}>
                <Icon name="add" />
                {t('cl.new')}
              </a>
            )
          }
        >
          {list.length ? (
            <List>
              {list.map((tpl) => {
                const sections = checklistSections(tpl)
                const last = lastRunOf(tpl.id)
                const multi = sections.length > 1
                return (
                  <Row
                    icon="checklist"
                    title={tpl.name}
                    sub={[
                      tn('cl.steps', tpl.items.length),
                      multi ? sections.map((s) => s.name ?? t('cl.untitled')).join(', ') : scheduleLabel(tpl, undefined),
                      last ? t('cl.lastRun', { date: formatIsoDay(last) }) : t('cl.neverRun')
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    href={hrefFor({ name: 'checklist', id: tpl.id })}
                    current={(r.name === 'checklist' || r.name === 'checklistEdit') && r.id === tpl.id}
                    trailing={
                      canWrite.value && (
                        <button
                          type="button"
                          class="icon-btn icon-btn-tonal"
                          aria-label={t('cl.startName', { name: tpl.name })}
                          onClick={() => (multi ? navigate({ name: 'checklist', id: tpl.id }) : startRun(tpl, sections[0]?.name))}
                        >
                          <Icon name="play" />
                        </button>
                      )
                    }
                  />
                )
              })}
            </List>
          ) : (
            <EmptyState
              icon="checklist"
              title={t('cl.empty')}
              body={t('cl.emptyBody')}
              action={
                canWrite.value && (
                  <a class="btn btn-filled" href={hrefFor({ name: 'checklistEdit' })}>
                    <Icon name="add" />
                    {t('cl.new')}
                  </a>
                )
              }
            />
          )}
        </Section>

        {done.length > 0 && (
          <Section title={t('cl.done')}>
            <List>
              {done.map((run) => {
                const p = runProgress(run)
                return (
                  <Row
                    icon={p.problems ? 'warning' : 'checkCircle'}
                    tone={p.problems ? 'tertiary' : undefined}
                    title={run.section ? `${run.name} · ${run.section}` : run.name}
                    sub={p.problems ? tn('cl.problems', p.problems) : t('cl.finished', { date: formatIsoDay(run.completedAt) })}
                    href={hrefFor({ name: 'run', id: run.id })}
                  />
                )
              })}
            </List>
          </Section>
        )}
      </>
    )
  }

  return (
    <div>
      <AppBar title={t('cl.title')} actions={<DestinationActions />} />
      <div class="pane-inner">{body()}</div>
      {discarding && (
        <ConfirmDialog
          title={t('cl.discardTitle')}
          body={t('cl.discardBody')}
          confirm={t('cl.discard')}
          danger
          onClose={() => setDiscarding(null)}
          onConfirm={async () => {
            try {
              await mutate(() => deleteRun(discarding.id))
              forgetRun(discarding.id)
            } catch (e) {
              snackbar(t(errorKey(e)))
            }
          }}
        />
      )}
    </div>
  )
}

/* One checklist: its sections with Start or Resume, and its past runs. */
export function ChecklistScreen({ id }: { id: string }) {
  const [deleting, setDeleting] = useState(false)
  const tpl = templates.value.find((x) => x.id === id)
  if (!tpl) {
    return (
      <div>
        <AppBar title={missingTitle()} trail={[checklistsCrumb()]} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }
  const sections = checklistSections(tpl)
  const tplRuns = runs.value.filter((x) => x.templateId === tpl.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const write = canWrite.value

  return (
    <div>
      <AppBar
        title={tpl.name}
        trail={[checklistsCrumb()]}
        back={!isExpanded.value}
        actions={
          write && (
            <>
              <a class="icon-btn" href={hrefFor({ name: 'checklistEdit', id: tpl.id })} aria-label={t('cl.editTitle')}>
                <Icon name="edit" />
              </a>
              <OverflowMenu items={[{ label: t('common.delete'), icon: 'delete', danger: true, onSelect: () => setDeleting(true) }]} />
            </>
          )
        }
      />
      <div class="pane-inner">
        {tpl.description && <p class="body-l pre-wrap">{tpl.description}</p>}
        {sections.map((s) => {
          const open = tplRuns.find((x) => !x.completedAt && x.section === s.name)
          const p = open ? runProgress(open) : undefined
          const schedule = scheduleLabel(tpl, s.name)
          return (
            <div class="card stack" style={{ '--stack-gap': '12px' }}>
              <div class="row">
                <h2 class="title-l grow">{s.name ?? (sections.length > 1 ? t('cl.untitled') : t('cl.whole'))}</h2>
                {write &&
                  (open ? (
                    <a class="btn btn-filled btn-s" href={hrefFor({ name: 'run', id: open.id })}>
                      <Icon name="play" />
                      {t('cl.resume')}
                    </a>
                  ) : (
                    <button type="button" class="btn btn-filled btn-s" onClick={() => startRun(tpl, s.name)}>
                      <Icon name="play" />
                      {t('cl.start')}
                    </button>
                  ))}
              </div>
              <p class="body-m muted">
                {[p ? tn('cl.progress', p.done, { total: String(p.total) }) : tn('cl.steps', s.items.length), schedule].filter(Boolean).join(' · ')}
              </p>
              <ul class="steps-preview">
                {s.items.slice(0, 4).map((i) => (
                  <li>{i.text}</li>
                ))}
              </ul>
              {s.items.length > 4 && <p class="fine">{tn('cl.moreSteps', s.items.length - 4)}</p>}
            </div>
          )
        })}

        {tplRuns.length > 0 && (
          <Section title={t('cl.runs')}>
            <List>
              {tplRuns.map((run) => {
                const p = runProgress(run)
                return (
                  <Row
                    icon={run.completedAt ? (p.problems ? 'warning' : 'checkCircle') : 'pending'}
                    title={[run.section, formatIsoDay(run.startedAt)].filter(Boolean).join(' · ')}
                    sub={
                      run.completedAt
                        ? [t('cl.finished', { date: formatIsoDay(run.completedAt) }), p.problems ? tn('cl.problems', p.problems) : ''].filter(Boolean).join(' · ')
                        : tn('cl.progress', p.done, { total: String(p.total) })
                    }
                    href={hrefFor({ name: 'run', id: run.id })}
                  />
                )
              })}
            </List>
          </Section>
        )}
        <p class="fine">{t('cl.runsKeep')}</p>
      </div>
      {deleting && (
        <ConfirmDialog
          title={t('cl.deleteTitle')}
          body={t('cl.deleteBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await mutate(() => deleteTemplate(tpl.id))
              navigate({ name: 'checklists' }, { replace: true })
            } catch (e) {
              snackbar(t(errorKey(e)))
            }
          }}
        />
      )}
    </div>
  )
}
