import { useRef, useState } from 'preact/hooks'
import type { IssueSeverity, IssueStatus, SeasonMilestone } from '../../../src/types'
import { createIssue, markServiced, updateIssue } from '../api/maintenance'
import { Icon } from '../components/Icon'
import { PhotoPicker } from '../components/Photos'
import type { PendingPhoto } from '../../../src/types'
import { SelectField, Sheet, SwitchRow, TextField, snackbar } from '../components/ui'
import { t } from '../i18n'
import { nodePath } from '../lib/maint'
import { navigate } from '../lib/router'
import { issues, mutate, nodes, nodesById } from '../state/store'
import { SaveError, useSubmit } from './common'

/* Report a problem, or change one. A note goes into the issue's history. */
export function IssueEditor({
  id,
  nodeId,
  title: presetTitle,
  note: presetNote,
  onClose
}: {
  id?: string
  nodeId?: string
  title?: string
  note?: string
  onClose: () => void
}) {
  const existing = id ? issues.value.find((i) => i.id === id) : undefined
  const [title, setTitle] = useState(existing?.title ?? presetTitle ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [node, setNode] = useState(existing?.nodeId ?? nodeId ?? '')
  const [status, setStatus] = useState<IssueStatus>(existing?.status ?? 'open')
  const [severity, setSeverity] = useState<IssueSeverity>(existing?.severity ?? 'medium')
  const [fixBy, setFixBy] = useState<SeasonMilestone | ''>(existing?.fixBy ?? '')
  const [note, setNote] = useState(presetNote ?? '')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [tried, setTried] = useState(false)
  const { busy, error, run } = useSubmit()
  const byId = nodesById.value

  const nodeOptions = [
    { value: '', label: t('issueEditor.nodeNone') },
    ...[...nodes.value]
      .map((n) => ({ value: n.id, label: [nodePath(byId, n), n.name].filter(Boolean).join(' › ') }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ]

  const save = () => {
    setTried(true)
    if (!title.trim()) return
    void run(async () => {
      if (existing) {
        await mutate(() =>
          updateIssue(existing.id, {
            title: title.trim(),
            description: description.trim(),
            nodeId: node || undefined,
            status,
            severity,
            // Left out when unchanged; '' clears it.
            ...(fixBy !== (existing.fixBy ?? '') ? { fixBy } : {}),
            comment: note.trim() || undefined,
            photos: photos.length ? photos.map((p) => ({ handle: p.handle })) : undefined
          })
        )
        onClose()
      } else {
        const created = await mutate(() =>
          createIssue({
            title: title.trim(),
            description: description.trim() || undefined,
            nodeId: node || undefined,
            status: 'open',
            severity,
            fixBy: fixBy || undefined,
            comment: note.trim() || undefined,
            photos: photos.length ? photos.map((p) => ({ handle: p.handle })) : undefined
          })
        )
        onClose()
        navigate({ name: 'issue', id: created.id })
      }
    })
  }

  return (
    <Sheet
      title={existing ? t('issueEditor.editTitle') : t('issueEditor.newTitle')}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-filled" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <TextField
        label={t('issueEditor.title')}
        hint={t('issueEditor.titleHint')}
        value={title}
        onInput={setTitle}
        autoFocus={!existing}
        error={tried && !title.trim() ? t('issueEditor.titleRequired') : undefined}
      />
      <SelectField label={t('issueEditor.node')} value={node} onChange={setNode} options={nodeOptions} />
      <div class="field-row">
        <SelectField<IssueSeverity>
          label={t('issueEditor.severity')}
          value={severity}
          onChange={setSeverity}
          options={(['low', 'medium', 'high'] as const).map((s) => ({ value: s, label: t(`severity.${s}`) }))}
        />
        <SelectField<SeasonMilestone | ''>
          label={t('issueEditor.fixBy')}
          value={fixBy}
          onChange={setFixBy}
          options={[
            { value: '', label: t('issueEditor.fixByNone') },
            { value: 'launch', label: t('milestone.launch') },
            { value: 'haulout', label: t('milestone.haulout') }
          ]}
        />
      </div>
      {existing && (
        <SelectField<IssueStatus>
          label={t('issueEditor.status')}
          value={status}
          onChange={setStatus}
          options={(['open', 'monitoring', 'resolved'] as const).map((s) => ({ value: s, label: t(`issueStatus.${s}`) }))}
        />
      )}
      <TextField label={t('issueEditor.description')} value={description} onInput={setDescription} multiline />
      <TextField label={t('issueEditor.note')} hint={t('issueEditor.noteHint')} value={note} onInput={setNote} multiline />
      <PhotoPicker value={photos} onChange={setPhotos} />
      <SaveError error={error} />
    </Sheet>
  )
}

/**
 * Resolve an issue, optionally logging the fix as a job on its part (no intervals
 * reset). If the resolve fails after the job was logged, a retry reuses that log.
 */
export function ResolveIssueEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const issue = issues.value.find((i) => i.id === id)
  const node = issue ? nodesById.value.get(issue.nodeId) : undefined
  const [note, setNote] = useState('')
  const [logJob, setLogJob] = useState(!!node)
  const loggedId = useRef<string | undefined>(undefined)
  const { busy, error, run } = useSubmit()
  if (!issue) return null

  const save = () =>
    void run(async () => {
      const text = note.trim()
      await mutate(async () => {
        if (logJob && node && !loggedId.current) {
          const log = await markServiced(node.id, {
            triggerIds: [],
            datetime: new Date().toISOString(),
            description: text || issue.title,
            comment: text ? issue.title : undefined
          })
          loggedId.current = log.id
        }
        return updateIssue(issue.id, { status: 'resolved', comment: text || undefined, resolutionLogId: loggedId.current })
      })
      snackbar(t('resolve.done'))
      onClose()
    })

  return (
    <Sheet
      title={t('resolve.title')}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-filled" disabled={busy}>
            <Icon name="check" />
            {busy ? t('common.saving') : t('resolve.submit')}
          </button>
        </>
      }
    >
      <p class="title-m">{issue.title}</p>
      <TextField label={t('resolve.note')} value={note} onInput={setNote} multiline autoFocus />
      {node && <SwitchRow label={t('resolve.logJob', { name: node.name })} checked={logJob} onChange={setLogJob} />}
      <SaveError error={error} />
    </Sheet>
  )
}
