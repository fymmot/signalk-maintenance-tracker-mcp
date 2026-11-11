import { useState } from 'preact/hooks'
import type { Issue, IssueSeverity } from '../../../../src/types'
import { Icon } from '../../components/Icon'
import { AppBar, EmptyState, List, Row, Segmented } from '../../components/ui'
import { t, type MessageKey } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { severityIcon, severityLabel, severityTone } from '../../lib/maint'
import { isExpanded } from '../../lib/media'
import { hrefFor } from '../../lib/router'
import { openEditor } from '../../state/editors'
import { canWrite, issues, nodesById } from '../../state/store'
import { boatCrumb } from '../../lib/trail'

/* Every issue: active or resolved, narrowed by severity (Skerry's issues list). */

export function resolvedOn(i: Issue): string {
  return i.resolvedAt ?? i.updatedAt ?? i.openedAt
}

export function IssuesScreen() {
  const [show, setShow] = useState<'active' | 'resolved'>('active')
  const [severity, setSeverity] = useState<IssueSeverity | 'any'>('any')
  const byId = nodesById.value

  const list = issues.value
    .filter((i) => (show === 'active' ? i.status !== 'resolved' : i.status === 'resolved'))
    .filter((i) => severity === 'any' || i.severity === severity)
    .sort((a, b) => (show === 'active' ? b.openedAt.localeCompare(a.openedAt) : resolvedOn(b).localeCompare(resolvedOn(a))))

  return (
    <div>
      <AppBar
        title={t('issues.title')}
        trail={[boatCrumb()]}
        back={!isExpanded.value}
        actions={
          canWrite.value && (
            <button type="button" class="icon-btn" aria-label={t('issues.add')} onClick={() => openEditor({ kind: 'issue' })}>
              <Icon name="add" />
            </button>
          )
        }
      />
      <div class="pane-inner">
        <Segmented
          label={t('issues.filterLabel')}
          value={show}
          onChange={setShow}
          options={[
            { value: 'active', label: t('issues.active') },
            { value: 'resolved', label: t('issues.resolved') }
          ]}
        />
        <div class="chip-row" role="group" aria-label={t('issues.severityLabel')}>
          {(['any', 'high', 'medium', 'low'] as const).map((s) => (
            <button type="button" class="chip" aria-pressed={severity === s} onClick={() => setSeverity(s)}>
              {severity === s && <Icon name="check" />}
              {s === 'any' ? t('issues.severityAll') : severityLabel(s)}
            </button>
          ))}
        </div>
        {list.length ? (
          <List>
            {list.map((i) => {
              const node = byId.get(i.nodeId)
              return (
                <Row
                  icon={i.status === 'resolved' ? 'checkCircle' : severityIcon(i.severity)}
                  tone={i.status === 'resolved' ? undefined : severityTone(i.severity)}
                  title={i.title}
                  sub={
                    i.status === 'resolved'
                      ? [t('issues.resolvedOn', { date: formatIsoDay(resolvedOn(i)) }), node?.name].filter(Boolean).join(' · ')
                      : [t(`issueStatus.${i.status}` as MessageKey), severityLabel(i.severity), node?.name].filter(Boolean).join(' · ')
                  }
                  href={hrefFor({ name: 'issue', id: i.id })}
                />
              )
            })}
          </List>
        ) : (
          <EmptyState icon="checkCircle" title={show === 'active' ? t('issues.noActive') : t('issues.noResolved')} />
        )}
      </div>
    </div>
  )
}
