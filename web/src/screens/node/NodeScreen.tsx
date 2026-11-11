import { useEffect, useState } from 'preact/hooks'
import type { MaintenanceNode, ServiceLog, Trigger, TriggerStatus } from '../../../../src/types'
import { nodeLogs, snooze, unsnooze, updateNode } from '../../api/maintenance'
import { errorKey } from '../../api/client'
import { Icon } from '../../components/Icon'
import { PhotoStrip } from '../../components/Photos'
import { AppBar, ConfirmDialog, Dialog, List, OverflowMenu, Pill, Row, Section, TextField, snackbar, type Tone } from '../../components/ui'
import { locale, t, tn, type MessageKey } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import {
  anchorText,
  childState,
  descendantsAndSelf,
  formatCost,
  jobDueText,
  openIssuesFor,
  ownServiceTrigger,
  severityIcon,
  severityLabel,
  severityTone,
  statusIcon,
  statusLabel,
  statusTone,
  subtreeSummary,
  systemIcon,
  triggerProgress,
  triggerRemainingText
} from '../../lib/maint'
import { isExpanded } from '../../lib/media'
import { hrefFor } from '../../lib/router'
import { focusedNodeId, openEditor } from '../../state/editors'
import { canWrite, dueById, issues, mutate, nodes, nodesById, timeline, work } from '../../state/store'
import { Missing, missingTitle } from '../states'
import { boatCrumb, nodeTrail } from '../../lib/trail'

/*
 * A system, component or part. A system or component is a map of what it holds; a
 * part is a task page for the thing itself. Items from deeper down appear once, and
 * always say where they live; counts are the Boat list's, so the two agree.
 */

const NOTES_FOLD = 180

function Notes({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > NOTES_FOLD
  return (
    <div class="stack" style={{ '--stack-gap': '4px' }}>
      <p class={`body-l pre-wrap${long && !open ? ' clamp-4' : ''}`}>{text}</p>
      {long && (
        <div>
          <button type="button" class="btn btn-text" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('common.showLess') : t('common.showMore')}
          </button>
        </div>
      )}
    </div>
  )
}

function SnoozeDialog({ onPick, onClose }: { onPick: (untilIso: string) => Promise<void>; onClose: () => void }) {
  const [date, setDate] = useState('')
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
  const pick = (iso: string) => async () => {
    await onPick(iso)
    onClose()
  }
  return (
    <Dialog
      title={t('snooze.title')}
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class="btn btn-filled"
            disabled={!date}
            // Through the end of the picked day, local time.
            onClick={pick(new Date(`${date}T23:59:59`).toISOString())}
          >
            {t('trigger.snooze')}
          </button>
        </>
      }
    >
      <p>{t('snooze.body')}</p>
      <div class="button-row">
        <button type="button" class="btn btn-tonal btn-s" onClick={pick(inDays(1))}>{t('snooze.1d')}</button>
        <button type="button" class="btn btn-tonal btn-s" onClick={pick(inDays(7))}>{t('snooze.1w')}</button>
        <button type="button" class="btn btn-tonal btn-s" onClick={pick(inDays(14))}>{t('snooze.2w')}</button>
        <button type="button" class="btn btn-tonal btn-s" onClick={pick(inDays(30))}>{t('snooze.1m')}</button>
      </div>
      <TextField label={t('snooze.until')} type="date" value={date} onInput={setDate} />
    </Dialog>
  )
}

function TriggerCard({ node, trigger, due }: { node: MaintenanceNode; trigger: Trigger; due?: TriggerStatus }) {
  const [snoozing, setSnoozing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const progress = trigger.enabled ? triggerProgress(trigger, due) : undefined
  const snoozed = !!trigger.snoozedUntil && Date.parse(trigger.snoozedUntil) > Date.now()
  const status = trigger.enabled ? due?.status : undefined
  const write = canWrite.value

  const saveTriggers = async (next: Trigger[]): Promise<void> => {
    try {
      await mutate(() => updateNode(node.id, { ...node, triggers: next }))
    } catch (e) {
      snackbar(t(errorKey(e)))
    }
  }

  return (
    <li class="trigger-card">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <div class="grow stack" style={{ '--stack-gap': '2px' }}>
          <p class="title-m">{trigger.name}</p>
          <p class="body-m muted">
            {[t(`metric.${trigger.metric}` as MessageKey), anchorText(trigger)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {write && (
          <OverflowMenu
            label={t('trigger.actions')}
            items={[
              { label: t('common.edit'), icon: 'edit', onSelect: () => openEditor({ kind: 'trigger', nodeId: node.id, triggerId: trigger.id }) },
              { label: t('trigger.markThis'), icon: 'check', onSelect: () => openEditor({ kind: 'service', nodeId: node.id, triggerIds: [trigger.id] }) },
              {
                label: trigger.enabled ? t('trigger.disable') : t('trigger.enable'),
                icon: trigger.enabled ? 'circle' : 'checkCircle',
                onSelect: () => void saveTriggers(node.triggers.map((x) => (x.id === trigger.id ? { ...x, enabled: !x.enabled } : x)))
              },
              { label: t('trigger.delete'), icon: 'delete', danger: true, onSelect: () => setDeleting(true) }
            ]}
          />
        )}
      </div>
      <p class={`body-l${status === 'overdue' && !snoozed ? ' error-text' : ''}`}>
        {trigger.enabled ? triggerRemainingText(trigger, due) : t('trigger.disabled')}
      </p>
      {progress !== undefined && (
        <div
          class={`progress${status === 'overdue' && !snoozed ? ' tone-error' : ''}`}
          role="progressbar"
          aria-label={trigger.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${progress * 100}%`, ...(snoozed ? { background: 'var(--md-outline)' } : {}) }} />
        </div>
      )}
      <div class="row wrap">
        {status && <Pill tone={snoozed ? undefined : statusTone(status)} icon={snoozed ? 'snooze' : statusIcon(status)}>{snoozed ? t('trigger.snoozedUntil', { date: formatIsoDay(trigger.snoozedUntil) }) : statusLabel(status)}</Pill>}
        <span class="grow" />
        {write && snoozed && (
          <button type="button" class="btn btn-text" onClick={() => void mutate(() => unsnooze(node.id, trigger.id)).catch((e) => snackbar(t(errorKey(e))))}>
            {t('trigger.unsnooze')}
          </button>
        )}
        {write && !snoozed && (status === 'overdue' || status === 'dueSoon') && (
          <button type="button" class="btn btn-text" onClick={() => setSnoozing(true)}>
            <Icon name="snooze" />
            {t('trigger.snooze')}
          </button>
        )}
      </div>
      {snoozing && (
        <SnoozeDialog
          onClose={() => setSnoozing(false)}
          onPick={async (until) => {
            await mutate(() => snooze(node.id, trigger.id, until)).catch((e) => snackbar(t(errorKey(e))))
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('trigger.deleteTitle')}
          body={t('trigger.deleteBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() => saveTriggers(node.triggers.filter((x) => x.id !== trigger.id))}
        />
      )}
    </li>
  )
}

/* ---- The two layouts -------------------------------------------------------------- */

/** Maker, model, serial, notes and photos: the same on both layouts. */
function Details({ node, write }: { node: MaintenanceNode; write: boolean }) {
  return (
    <div class="stack" style={{ '--stack-gap': '12px' }}>
      {(node.manufacturer || node.model || node.serial) && (
        <dl class="facts">
          {node.manufacturer && (
            <div>
              <dt>{t('node.manufacturer')}</dt>
              <dd>{node.manufacturer}</dd>
            </div>
          )}
          {node.model && (
            <div>
              <dt>{t('node.model')}</dt>
              <dd>{node.model}</dd>
            </div>
          )}
          {node.serial && (
            <div>
              <dt>{t('node.serial')}</dt>
              <dd>{node.serial}</dd>
            </div>
          )}
        </dl>
      )}
      {node.notes && <Notes text={node.notes} />}
      <PhotoStrip attachments={node.attachments} target={write ? { kind: 'node', id: node.id } : undefined} />
    </div>
  )
}

/** A status phrase on the right of a row, coloured to match, always in words. */
function StatusText({ text, tone, class: cls }: { text: string; tone: Tone; class?: string }) {
  return <span class={`status-text${tone ? ` tone-${tone}` : ''}${cls ? ` ${cls}` : ''}`}>{text}</span>
}

/**
 * A system or component is a map: one summary for everything under it, the things
 * that need action (each saying where it lives, listed once), and its contents with
 * their state in words. Healthy contents fold away while something needs attention.
 */
function ContainerView({ node }: { node: MaintenanceNode }) {
  const [showAll, setShowAll] = useState(false)
  const all = nodes.value
  const byId = nodesById.value
  const dues = dueById.value
  const queue = work.value
  const write = canWrite.value
  const s = subtreeSummary(all, queue, node.id)
  const today = queue?.today ?? Math.floor(Date.now() / 86_400_000)
  const where = (id: string) => (id === node.id ? undefined : byId.get(id)?.name)

  const children = all
    .filter((n) => n.parentId === node.id)
    .map((n) => ({ node: n, state: childState(all, dues, queue, n.id) }))
    .sort((a, b) => {
      const rank = { attention: 0, fix: 1, ok: 2, empty: 3 }
      return rank[a.state.kind] - rank[b.state.kind] || a.node.name.toLowerCase().localeCompare(b.node.name.toLowerCase())
    })
  const flagged = children.filter((c) => c.state.kind === 'attention' || c.state.kind === 'fix')
  const healthy = children.filter((c) => c.state.kind === 'ok' || c.state.kind === 'empty')
  const fold = flagged.length > 0 && healthy.length > 0 && !showAll
  const shown = fold ? flagged : children

  const subtree = descendantsAndSelf(all, node.id)
  const recent = timeline.value
    .filter((e) => (e.kind === 'service' || e.kind === 'issueResolved') && e.nodeId && subtree.has(e.nodeId))
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .slice(0, 5)

  const jobs = [...s.overdue, ...s.thisWeek]
  return (
    <>
      <Section
        title={t('node.needsAttention')}
        trailing={
          write && (
            <button type="button" class="btn btn-text" onClick={() => openEditor({ kind: 'issue', nodeId: node.id })}>
              <Icon name="add" />
              {t('node.addIssue')}
            </button>
          )
        }
      >
        {jobs.length || s.issues.length ? (
          <List>
            {jobs.map((j) => (
              <Row
                icon="wrench"
                tone={(j.trigger.remaining ?? 0) <= 0 ? 'error' : 'tertiary'}
                title={j.nodeName}
                sub={[j.trigger.name, jobDueText(j, today)].join(' · ')}
                href={hrefFor({ name: 'node', id: j.nodeId })}
                trailing={
                  write && (
                    <button
                      type="button"
                      class="icon-btn icon-btn-outlined"
                      aria-label={t('work.markDone', { name: `${j.nodeName}, ${j.trigger.name}` })}
                      onClick={() => openEditor({ kind: 'service', nodeId: j.nodeId, triggerIds: [j.trigger.triggerId] })}
                    >
                      <Icon name="check" />
                    </button>
                  )
                }
              />
            ))}
            {s.issues.map((i) => (
              <Row
                icon={severityIcon(i.severity)}
                tone={severityTone(i.severity)}
                title={i.title}
                sub={[severityLabel(i.severity), where(i.nodeId)].filter(Boolean).join(' · ')}
                href={hrefFor({ name: 'issue', id: i.id })}
              />
            ))}
          </List>
        ) : (
          <p class="body-m muted">{t('node.nothingNeeded')}</p>
        )}
      </Section>

      <Section
        title={t('node.contents')}
        trailing={
          write && (
            <button type="button" class="btn btn-text" onClick={() => openEditor({ kind: 'node', parentId: node.id })}>
              <Icon name="add" />
              {t('common.add')}
            </button>
          )
        }
      >
        {children.length ? (
          <>
            {/* The status sits on the right where there is room, under the name where there isn't. */}
            <List class="contents-list">
              {shown.map((c) => (
                <Row
                  icon={systemIcon(c.node.name)}
                  title={c.node.name}
                  sub={
                    <>
                      <span class="contents-type">{t(`nodeType.${c.node.type}` as MessageKey)}</span>
                      <StatusText text={c.state.text} tone={c.state.tone} class="contents-status-sub" />
                    </>
                  }
                  meta={<StatusText text={c.state.text} tone={c.state.tone} />}
                  href={hrefFor({ name: 'node', id: c.node.id })}
                />
              ))}
            </List>
            {fold && (
              <div>
                <button type="button" class="btn btn-text" aria-expanded={false} onClick={() => setShowAll(true)}>
                  <Icon name="chevronDown" />
                  {tn('node.moreHealthy', healthy.length)}
                </button>
              </div>
            )}
          </>
        ) : (
          <p class="body-m muted">{t('boat.noIntervals')}</p>
        )}
      </Section>

      {node.triggers.length > 0 && (
        <Section
          title={t('node.ownIntervals', { name: node.name })}
          trailing={
            write && (
              <button type="button" class="btn btn-text" onClick={() => openEditor({ kind: 'service', nodeId: node.id })}>
                <Icon name="check" />
                {t('node.markServiced')}
              </button>
            )
          }
        >
          <ul class="trigger-list">
            {node.triggers.map((tr) => (
              <TriggerCard node={node} trigger={tr} due={dues.get(node.id)?.triggers.find((d) => d.triggerId === tr.id)} />
            ))}
          </ul>
        </Section>
      )}

      {recent.length > 0 && (
        <Section title={t('node.recent')} trailing={<a class="btn btn-text" href={hrefFor({ name: 'log' })}>{t('node.seeLog')}</a>}>
          <List>
            {recent.map((e) => (
              <Row
                icon={e.kind === 'service' ? 'wrench' : 'checkCircle'}
                title={e.title}
                sub={[formatIsoDay(e.datetime), e.nodeId ? where(e.nodeId) : undefined].filter(Boolean).join(' · ')}
                href={e.kind === 'service' && e.nodeId ? hrefFor({ name: 'node', id: e.nodeId }) : hrefFor({ name: 'issue', id: e.refId })}
              />
            ))}
          </List>
        </Section>
      )}

      <details class="disclosure card">
        <summary class="title-m">{t('node.detailsAndPhotos')}</summary>
        <Details node={node} write={write} />
      </details>
    </>
  )
}

interface HistoryItem {
  key: string
  at: string
  title: string
  sub: string
  href?: string
  icon: 'wrench' | 'checkCircle'
}

/**
 * A part is a task page: what is next and the button to log it, then its own issues,
 * intervals, details and history. Nothing is lifted up from anywhere else.
 */
function PartView({ node }: { node: MaintenanceNode }) {
  const [logs, setLogs] = useState<ServiceLog[] | null>(null)
  const write = canWrite.value
  const own = dueById.value.get(node.id)
  const next = ownServiceTrigger(own, node.triggers)
  const nextTrigger = next ? node.triggers.find((x) => x.id === next.triggerId) : undefined
  const ownIssues = openIssuesFor(issues.value, new Set([node.id]))

  // The part's service logs; reloaded whenever the store refreshes (after a write).
  const stamp = nodes.value
  useEffect(() => {
    let live = true
    nodeLogs(node.id)
      .then((l) => live && setLogs(l))
      .catch(() => live && setLogs([]))
    return () => {
      live = false
    }
  }, [node.id, stamp])

  const resolved = issues.value.filter((i) => i.nodeId === node.id && i.status === 'resolved')
  const history: HistoryItem[] = [
    ...(logs ?? []).map(
      (l): HistoryItem => ({
        key: `log-${l.id}`,
        at: l.datetime,
        title: l.description,
        sub: [
          formatIsoDay(l.datetime),
          l.comment,
          l.cost !== undefined ? formatCost(l.cost, l.costCurrency ?? 'SEK', locale.value) : undefined,
          l.partsReplaced?.length ? t('node.partsReplaced', { parts: l.partsReplaced.join(', ') }) : undefined
        ]
          .filter(Boolean)
          .join(' · '),
        icon: 'wrench'
      })
    ),
    ...resolved.map(
      (i): HistoryItem => ({
        key: `issue-${i.id}`,
        at: i.resolvedAt ?? i.updatedAt,
        title: i.title,
        sub: `${t('node.issueResolved')} · ${formatIsoDay(i.resolvedAt ?? i.updatedAt)}`,
        href: hrefFor({ name: 'issue', id: i.id }),
        icon: 'checkCircle'
      })
    )
  ].sort((a, b) => b.at.localeCompare(a.at))

  const nextStatus = next ? (next.snoozedUntil ? 'ok' : next.status) : undefined
  const tone = statusTone(nextStatus)
  return (
    <>
      {next && nextTrigger ? (
        <div class={`card next-card${tone === 'error' ? ' card-error' : tone === 'tertiary' ? ' card-tertiary' : ' card-filled'}`}>
          <div class="stack" style={{ '--stack-gap': '4px' }}>
            <p class="label-l">
              {next.snoozedUntil
                ? t('trigger.snoozedUntil', { date: formatIsoDay(next.snoozedUntil) })
                : nextStatus === 'ok' && node.triggers.length > 1
                  ? t('node.allUpToDate')
                  : `${t('node.next')} · ${statusLabel(nextStatus)}`}
            </p>
            <p class="title-l emph">{nextTrigger.name}</p>
            <p class="body-l">{triggerRemainingText(nextTrigger, next)}</p>
          </div>
          {write && (
            <button type="button" class="btn btn-filled" onClick={() => openEditor({ kind: 'service', nodeId: node.id })}>
              <Icon name="check" />
              {t('node.markServiced')}
            </button>
          )}
        </div>
      ) : (
        <div class="card card-filled next-card">
          <div class="stack" style={{ '--stack-gap': '4px' }}>
            <p class="title-l emph">{t('node.noIntervalsYet')}</p>
            <p class="body-m">{t('node.noIntervalsHint')}</p>
          </div>
          {write && (
            <div class="button-row">
              <button type="button" class="btn btn-filled" onClick={() => openEditor({ kind: 'trigger', nodeId: node.id })}>
                <Icon name="add" />
                {t('node.addInterval')}
              </button>
              <button type="button" class="btn btn-tonal" onClick={() => openEditor({ kind: 'service', nodeId: node.id })}>
                <Icon name="check" />
                {t('node.markServiced')}
              </button>
            </div>
          )}
        </div>
      )}

      {(ownIssues.length > 0 || write) && (
        <Section
          title={t('node.issues')}
          trailing={
            write && (
              <button type="button" class="btn btn-text" onClick={() => openEditor({ kind: 'issue', nodeId: node.id })}>
                <Icon name="add" />
                {t('node.addIssue')}
              </button>
            )
          }
        >
          {ownIssues.length ? (
            <List>
              {ownIssues.map((i) => (
                <Row
                  icon={severityIcon(i.severity)}
                  tone={severityTone(i.severity)}
                  title={i.title}
                  sub={[severityLabel(i.severity), t(`issueStatus.${i.status}` as MessageKey)].join(' · ')}
                  href={hrefFor({ name: 'issue', id: i.id })}
                />
              ))}
            </List>
          ) : (
            <p class="body-m muted">{t('issues.noActive')}</p>
          )}
        </Section>
      )}

      {node.triggers.length > 0 && (
        <Section
          title={t('node.intervals')}
          trailing={
            write && (
              <button type="button" class="btn btn-text" onClick={() => openEditor({ kind: 'trigger', nodeId: node.id })}>
                <Icon name="add" />
                {t('common.add')}
              </button>
            )
          }
        >
          <ul class="trigger-list">
            {node.triggers.map((tr) => (
              <TriggerCard node={node} trigger={tr} due={own?.triggers.find((d) => d.triggerId === tr.id)} />
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('node.details')}>
        <Details node={node} write={write} />
      </Section>

      <Section title={t('node.history')}>
        {logs === null ? (
          <div class="progress is-indeterminate" role="progressbar" aria-label={t('common.loading')}>
            <span />
          </div>
        ) : history.length ? (
          <List>
            {history.map((h) => (
              <Row icon={h.icon} title={h.title} sub={h.sub} href={h.href} />
            ))}
          </List>
        ) : (
          <p class="body-m muted">{t('node.noHistory')}</p>
        )}
      </Section>
    </>
  )
}

export function NodeScreen({ id }: { id: string }) {
  const node = nodesById.value.get(id)

  useEffect(() => {
    focusedNodeId.value = id
    return () => {
      if (focusedNodeId.value === id) focusedNodeId.value = undefined
    }
  }, [id])

  if (!node) {
    return (
      <div>
        <AppBar title={missingTitle()} trail={[boatCrumb()]} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const container = node.type !== 'part' || nodes.value.some((n) => n.parentId === node.id)
  return (
    <div>
      <AppBar
        title={node.name}
        subtitle={t(`nodeType.${node.type}` as MessageKey)}
        trail={nodeTrail(node.id)}
        back={!isExpanded.value}
        actions={
          canWrite.value && (
            <button type="button" class="icon-btn" aria-label={t('node.edit')} onClick={() => openEditor({ kind: 'node', id: node.id })}>
              <Icon name="edit" />
            </button>
          )
        }
      />
      <div class="pane-inner">
        {container ? <ContainerView key={node.id} node={node} /> : <PartView key={node.id} node={node} />}
      </div>
    </div>
  )
}
