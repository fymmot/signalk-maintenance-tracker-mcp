import { useState } from 'preact/hooks'
import type { IssueHistoryEntry } from '../../../../src/types'
import { errorKey } from '../../api/client'
import { deleteIssue, updateIssue } from '../../api/maintenance'
import { Icon } from '../../components/Icon'
import { PhotoStrip } from '../../components/Photos'
import { AppBar, ConfirmDialog, List, OverflowMenu, Pill, Row, Section, TextField, snackbar } from '../../components/ui'
import { t, type MessageKey } from '../../i18n'
import { formatDateTime, formatIsoDay } from '../../lib/format'
import { severityIcon, severityLabel, severityTone, systemIcon } from '../../lib/maint'
import { isExpanded } from '../../lib/media'
import { hrefFor, navigate } from '../../lib/router'
import { openEditor } from '../../state/editors'
import { canWrite, issues, mutate, nodesById } from '../../state/store'
import { Missing, missingTitle } from '../states'
import { boatCrumb, nodeTrail } from '../../lib/trail'

/* One issue: what it is, its progress, an update box, and the actions for its status. */

const HISTORY_LABEL: Record<IssueHistoryEntry['type'], MessageKey> = {
  opened: 'issue.history.opened',
  resolved: 'issue.history.resolved',
  reopened: 'issue.history.reopened',
  comment: 'issue.history.comment',
  status: 'issue.history.status'
}

export function IssueScreen({ id }: { id: string }) {
  const issue = issues.value.find((i) => i.id === id)
  const [update, setUpdate] = useState('')
  const [posting, setPosting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [descOpen, setDescOpen] = useState(false)

  if (!issue) {
    return (
      <div>
        <AppBar title={missingTitle()} trail={[boatCrumb()]} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const node = nodesById.value.get(issue.nodeId)
  const others = issues.value.filter((i) => i.nodeId === issue.nodeId && i.id !== issue.id && i.status !== 'resolved')
  const write = canWrite.value
  const history = [...issue.history].sort((a, b) => a.datetime.localeCompare(b.datetime))
  const longDesc = (issue.description?.length ?? 0) > 280

  const setStatus = (status: 'open' | 'monitoring') =>
    void mutate(() => updateIssue(issue.id, { status })).catch((e) => snackbar(t(errorKey(e))))

  const post = async () => {
    const comment = update.trim()
    if (!comment) return
    setPosting(true)
    try {
      await mutate(() => updateIssue(issue.id, { comment }))
      setUpdate('')
    } catch (e) {
      snackbar(t(errorKey(e)))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div>
      <AppBar
        title={issue.title}
        trail={nodeTrail(issue.nodeId, true)}
        back={!isExpanded.value}
        actions={
          write && (
            <>
              <button type="button" class="icon-btn" aria-label={t('common.edit')} onClick={() => openEditor({ kind: 'issue', id: issue.id })}>
                <Icon name="edit" />
              </button>
              <OverflowMenu items={[{ label: t('common.delete'), icon: 'delete', danger: true, onSelect: () => setDeleting(true) }]} />
            </>
          )
        }
      />
      <div class="pane-inner">
        <div class="stack" style={{ '--stack-gap': '12px' }}>
          <div class="row wrap">
            <Pill tone={severityTone(issue.severity)} icon={severityIcon(issue.severity)}>
              {severityLabel(issue.severity)}
            </Pill>
            <Pill tone={issue.status === 'resolved' ? 'ok' : undefined} icon={issue.status === 'resolved' ? 'checkCircle' : issue.status === 'monitoring' ? 'eye' : 'circle'}>
              {t(`issueStatus.${issue.status}` as MessageKey)}
            </Pill>
            {issue.fixBy && issue.status !== 'resolved' && (
              <Pill icon="flag">{t('issue.fixBy', { milestone: t(`milestone.${issue.fixBy}` as MessageKey).toLowerCase() })}</Pill>
            )}
          </div>
          <p class="fine">{t('issue.opened', { date: formatIsoDay(issue.openedAt) })}</p>
          {issue.description && (
            <div>
              <p class={`body-l pre-wrap${longDesc && !descOpen ? ' clamp-4' : ''}`}>{issue.description}</p>
              {longDesc && (
                <button type="button" class="btn btn-text" aria-expanded={descOpen} onClick={() => setDescOpen(!descOpen)}>
                  {descOpen ? t('common.showLess') : t('common.showMore')}
                </button>
              )}
            </div>
          )}
        </div>

        <PhotoStrip attachments={issue.attachments} target={write ? { kind: 'issue', id: issue.id } : undefined} />

        {write && (
          <div class="button-row">
            {issue.status === 'open' && (
              <button type="button" class="btn btn-tonal" onClick={() => setStatus('monitoring')}>
                <Icon name="eye" />
                {t('issue.monitor')}
              </button>
            )}
            {issue.status !== 'resolved' ? (
              <button type="button" class="btn btn-filled" onClick={() => openEditor({ kind: 'resolveIssue', id: issue.id })}>
                <Icon name="check" />
                {t('issue.resolve')}
              </button>
            ) : (
              <button type="button" class="btn btn-tonal" onClick={() => setStatus('open')}>
                <Icon name="undo" />
                {t('issue.reopen')}
              </button>
            )}
          </div>
        )}

        <Section title={t('issue.progress')}>
          <ol class="timeline">
            {history.map((h) => (
              <li>
                <span class="timeline-dot" aria-hidden="true">
                  {h.author ? h.author.slice(0, 1).toUpperCase() : <Icon name={h.type === 'resolved' ? 'check' : h.type === 'comment' ? 'note' : 'warning'} />}
                </span>
                <div class="stack" style={{ '--stack-gap': '4px' }}>
                  <p class="label-l">
                    {[h.author, t(HISTORY_LABEL[h.type]), formatDateTime(h.datetime)].filter(Boolean).join(' · ')}
                  </p>
                  {h.comment && <p class="body-m pre-wrap bubble">{h.comment}</p>}
                  <PhotoStrip attachments={h.attachments} />
                </div>
              </li>
            ))}
          </ol>
          {write && (
            <form
              class="stack"
              style={{ '--stack-gap': '8px' }}
              onSubmit={(e) => {
                e.preventDefault()
                void post()
              }}
            >
              <TextField label={t('issue.addUpdate')} value={update} onInput={setUpdate} multiline />
              <div>
                <button type="submit" class="btn btn-tonal" disabled={posting || !update.trim()}>
                  <Icon name="send" />
                  {t('issue.postUpdate')}
                </button>
              </div>
            </form>
          )}
        </Section>

        {node && (
          <Section title={t('issue.related')}>
            <List>
              <Row icon={systemIcon(node.name)} title={node.name} href={hrefFor({ name: 'node', id: node.id })} />
            </List>
          </Section>
        )}
        {node && others.length > 0 && (
          <Section title={t('issue.alsoOn', { name: node.name })}>
            <List>
              {others.map((o) => (
                <Row icon={severityIcon(o.severity)} tone={severityTone(o.severity)} title={o.title} sub={severityLabel(o.severity)} href={hrefFor({ name: 'issue', id: o.id })} />
              ))}
            </List>
          </Section>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={t('issue.deleteTitle')}
          body={t('issue.deleteBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            try {
              await mutate(() => deleteIssue(issue.id))
              navigate(node ? { name: 'node', id: node.id } : { name: 'issues' }, { replace: true })
            } catch (e) {
              snackbar(t(errorKey(e)))
            }
          }}
        />
      )}
    </div>
  )
}
