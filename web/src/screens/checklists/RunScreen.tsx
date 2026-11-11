import { useEffect, useState } from 'preact/hooks'
import type { ChecklistItemStatus, ChecklistRun, ChecklistRunResult } from '../../../../src/types'
import { errorKey } from '../../api/client'
import { deleteRun } from '../../api/maintenance'
import { Icon, type IconName } from '../../components/Icon'
import { PhotoStrip } from '../../components/Photos'
import { AppBar, ConfirmDialog, OverflowMenu, TextField, snackbar } from '../../components/ui'
import { t, tn } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { finishedRun, runProgress } from '../../lib/checklists'
import { isExpanded } from '../../lib/media'
import { navigate } from '../../lib/router'
import { openEditor } from '../../state/editors'
import { discardDraft, drafts, findRun, forgetRun, saveRun, saveState } from '../../state/runs'
import { canWrite, mutate, refreshAll, runs, templates } from '../../state/store'
import { Missing, missingTitle } from '../states'
import { checklistsCrumb, templateTrail } from '../../lib/trail'

/* Going through a checklist, one answer at a time. Every answer saves itself. */

const ANSWERS: Array<{ status: Exclude<ChecklistItemStatus, 'pending'>; icon: IconName }> = [
  { status: 'pass', icon: 'check' },
  { status: 'fail', icon: 'warning' },
  { status: 'skip', icon: 'skip' }
]

const STATUS_ICON: Record<ChecklistItemStatus, IconName> = { pass: 'checkCircle', fail: 'errorCircle', skip: 'skip', pending: 'circle' }

/** Saving / Saved on screen; only a failure is read out, not every keystroke. */
function SaveStatus({ id }: { id: string }) {
  const state = saveState.value.get(id) ?? 'idle'
  return (
    <>
      <span class={`fine save-status${state === 'failed' ? ' error-text' : ''}`} aria-hidden="true">
        {state === 'saving' ? t('cl.saving') : state === 'saved' ? t('cl.saved') : state === 'failed' ? t('cl.saveFailed') : ''}
      </span>
      <span class="visually-hidden" role="alert">
        {state === 'failed' ? t('cl.saveFailed') : ''}
      </span>
    </>
  )
}

function Answer({
  result,
  index,
  total,
  readOnly,
  nodeId,
  runName,
  photoTarget,
  onPhotos,
  onAnswer,
  onNote
}: {
  result: ChecklistRunResult
  index: number
  total: number
  readOnly: boolean
  nodeId?: string
  runName: string
  photoTarget?: { kind: 'run'; id: string; itemId: string }
  onPhotos: (record: unknown) => void
  onAnswer: (s: Exclude<ChecklistItemStatus, 'pending'>) => void
  onNote: (note: string) => void
}) {
  const [noteOpen, setNoteOpen] = useState(!!result.note)
  return (
    <div class="card card-outlined stack run-step" style={{ '--stack-gap': '12px' }}>
      <p class="label-l muted">{t('cl.step', { n: String(index + 1), total: String(total) })}</p>
      <p class="title-l run-step-text" tabIndex={-1}>
        {result.text}
      </p>
      {!readOnly && (
        <div class="button-group" role="group" aria-label={t('cl.answer', { step: result.text })}>
          {ANSWERS.map((a) => (
            <button type="button" class="seg seg-l" aria-pressed={result.status === a.status} onClick={() => onAnswer(a.status)}>
              <Icon name={a.icon} />
              {t(`cl.status.${a.status}`)}
            </button>
          ))}
        </div>
      )}
      {noteOpen || readOnly ? (
        (result.note || !readOnly) && (
          <TextField label={t('cl.note')} value={result.note ?? ''} onInput={onNote} multiline />
        )
      ) : (
        <div>
          <button type="button" class="btn btn-text" onClick={() => setNoteOpen(true)}>
            <Icon name="note" />
            {t('cl.addNote')}
          </button>
        </div>
      )}
      <PhotoStrip attachments={result.attachments} target={readOnly ? undefined : photoTarget} onChanged={onPhotos} />
      {result.status === 'fail' && !readOnly && (
        <div>
          <button
            type="button"
            class="btn btn-tonal"
            onClick={() =>
              openEditor({
                kind: 'issue',
                nodeId,
                title: result.text,
                note: [result.note, runName].filter(Boolean).join(' · ')
              })
            }
          >
            <Icon name="warning" />
            {t('cl.openIssue')}
          </button>
        </div>
      )}
    </div>
  )
}

export function RunScreen({ id }: { id: string }) {
  // Re-read on every save: drafts, the saver's copy and the store all change.
  void drafts.value
  void runs.value
  const saved = findRun(id)
  const [run, setRun] = useState<ChecklistRun | undefined>(saved)
  const [focus, setFocus] = useState<number | undefined>(undefined)
  const [stepMode, setStepMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // After an answer moves on, focus follows to the new step instead of falling to the page.
  const [moved, setMoved] = useState(0)
  useEffect(() => {
    if (moved) document.querySelector<HTMLElement>('.run-step .run-step-text')?.focus()
  }, [moved])

  useEffect(() => {
    if (!run && saved) setRun(saved)
  }, [saved?.id])

  // Leaving a draft nobody answered leaves nothing behind.
  useEffect(
    () => () => {
      const d = drafts.value.get(id)
      if (d && d.results.every((r) => r.status === 'pending' && !r.note)) discardDraft(id)
    },
    [id]
  )

  if (!run) {
    return (
      <div>
        <AppBar title={missingTitle()} trail={[checklistsCrumb()]} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const template = templates.value.find((x) => x.id === run.templateId)
  const p = runProgress(run)
  const readOnly = !!run.completedAt || !canWrite.value
  const firstPending = run.results.findIndex((r) => r.status === 'pending')
  const current = focus ?? (firstPending >= 0 ? firstPending : run.results.length - 1)

  const update = (next: ChecklistRun) => {
    setRun(next)
    void saveRun(next).catch(() => undefined)
  }
  const setResult = (i: number, patch: Partial<ChecklistRunResult>, advance = false) => {
    const results = run.results.map((r, j) => (j === i ? { ...r, ...patch, timestamp: new Date().toISOString() } : r))
    update({ ...run, results })
    if (advance) {
      const next = results.findIndex((r, j) => j > i && r.status === 'pending')
      setFocus(next >= 0 ? next : undefined)
      if (next >= 0) setMoved((m) => m + 1)
    }
  }

  const nodeFor = (r: ChecklistRunResult) => template?.items.find((i) => i.id === r.itemId)?.nodeId
  // Photos go on a saved run's step; a draft gets its first answer first.
  const photoTarget = (r: ChecklistRunResult) =>
    drafts.value.has(run.id) ? undefined : { kind: 'run' as const, id: run.id, itemId: r.itemId }
  const takePhotos = (record: unknown) => {
    const saved = record as ChecklistRun
    setRun((cur) =>
      cur && {
        ...cur,
        results: cur.results.map((r) => ({ ...r, attachments: saved.results?.find((x) => x.itemId === r.itemId)?.attachments }))
      }
    )
  }

  return (
    <div>
      <AppBar
        title={run.section ?? run.name}
        subtitle={formatIsoDay(run.startedAt)}
        trail={templateTrail(template)}
        back={!isExpanded.value}
        actions={
          <>
            <SaveStatus id={run.id} />
            {!readOnly && (
              <button
                type="button"
                class="icon-btn"
                aria-pressed={stepMode}
                aria-label={stepMode ? t('cl.showList') : t('cl.stepThrough')}
                onClick={() => setStepMode(!stepMode)}
              >
                <Icon name={stepMode ? 'list' : 'steps'} />
              </button>
            )}
            {canWrite.value && !drafts.value.has(run.id) && (
              <OverflowMenu items={[{ label: t('cl.deleteRun'), icon: 'delete', danger: true, onSelect: () => setDeleting(true) }]} />
            )}
          </>
        }
      />
      <div class="pane-inner">
        <div class="stack" style={{ '--stack-gap': '8px' }}>
          <div class="progress" role="progressbar" aria-label={run.name} aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
            <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
          </div>
          <p class="body-m muted">
            {run.completedAt
              ? [t('cl.finished', { date: formatIsoDay(run.completedAt) }), p.problems ? tn('cl.problems', p.problems) : ''].filter(Boolean).join(' · ')
              : tn('cl.progress', p.done, { total: String(p.total) })}
          </p>
        </div>

        {stepMode && !readOnly ? (
          <>
            <Answer
              key={current}
              result={run.results[current]}
              index={current}
              total={run.results.length}
              readOnly={false}
              nodeId={nodeFor(run.results[current])}
              runName={run.name}
              photoTarget={photoTarget(run.results[current])}
              onPhotos={takePhotos}
              onAnswer={(s) => setResult(current, { status: s }, s !== 'fail')}
              onNote={(note) => setResult(current, { note })}
            />
            <div class="row">
              <button type="button" class="btn btn-tonal" disabled={current === 0} onClick={() => setFocus(current - 1)}>
                <Icon name="back" />
                {t('cl.prev')}
              </button>
              <span class="grow" />
              <button type="button" class="btn btn-tonal" disabled={current >= run.results.length - 1} onClick={() => setFocus(current + 1)}>
                {t('cl.next')}
                <Icon name="chevron" />
              </button>
            </div>
          </>
        ) : (
          <ol class="run-steps">
            {run.results.map((r, i) =>
              i === current && !readOnly ? (
                <li>
                  <Answer
                    result={r}
                    index={i}
                    total={run.results.length}
                    readOnly={readOnly}
                    nodeId={nodeFor(r)}
                    runName={run.name}
                    photoTarget={photoTarget(r)}
                    onPhotos={takePhotos}
                    onAnswer={(s) => setResult(i, { status: s }, s !== 'fail')}
                    onNote={(note) => setResult(i, { note })}
                  />
                </li>
              ) : (
                <li>
                  <button type="button" class="li-btn run-row" disabled={readOnly && !r.note} onClick={() => setFocus(i)}>
                    <span class={`li-lead${r.status === 'fail' ? ' tone-error' : r.status === 'pass' ? ' tone-primary' : ''}`}>
                      <Icon name={STATUS_ICON[r.status]} />
                    </span>
                    <span class="li-body">
                      <span class="li-title">{r.text}</span>
                      <span class="li-sub">{[t(`cl.status.${r.status}`), r.note].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              )
            )}
          </ol>
        )}

        {!readOnly && (
          <div class="run-foot">
            <span class="body-m muted grow">{tn('cl.left', p.left)}</span>
            <button
              type="button"
              class="btn btn-filled"
              disabled={finishing}
              onClick={async () => {
                setFinishing(true)
                const done = finishedRun(run)
                setRun(done)
                try {
                  await saveRun(done, { immediate: true })
                  await refreshAll()
                } catch {
                  /* the save status says so */
                } finally {
                  setFinishing(false)
                }
              }}
            >
              <Icon name="check" />
              {t('cl.finish')}
            </button>
          </div>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={t('cl.deleteRunTitle')}
          body={t('cl.discardBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await mutate(() => deleteRun(run.id))
              forgetRun(run.id)
              navigate(template ? { name: 'checklist', id: template.id } : { name: 'checklists' }, { replace: true })
            } catch (e) {
              snackbar(t(errorKey(e)))
            }
          }}
        />
      )}
    </div>
  )
}
