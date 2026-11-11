import { useState } from 'preact/hooks'
import { createEvent, deleteEvent, updateEvent } from '../../api/maintenance'
import { Icon } from '../../components/Icon'
import { PhotoStrip } from '../../components/Photos'
import { AppBar, ConfirmDialog, EmptyState, List, Row, SelectField, TextField, focusFirstInvalid } from '../../components/ui'
import { t, type MessageKey } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { nodePath } from '../../lib/maint'
import { isExpanded } from '../../lib/media'
import { hrefFor, navigate } from '../../lib/router'
import { canWrite, events, mutate, nodes, nodesById } from '../../state/store'
import { SaveError, todayInput, useSubmit } from '../../editors/common'
import { Missing } from '../states'
import { boatCrumb } from '../../lib/trail'

const eventsTrail = () => [boatCrumb(), { label: t('events.title'), route: { name: 'events' as const } }]

/* Boat events: the timeline's milestones and notes that aren't maintenance. */

export const EVENT_CATEGORIES = ['acquisition', 'mooring', 'regatta', 'upgrade', 'incident', 'milestone', 'note'] as const

export function categoryLabel(c: string): string {
  return (EVENT_CATEGORIES as readonly string[]).includes(c) ? t(`eventCategory.${c}` as MessageKey) : c
}

export function EventsScreen() {
  const [category, setCategory] = useState<string>('all')
  const byId = nodesById.value
  const list = events.value.filter((e) => category === 'all' || e.category === category).sort((a, b) => b.datetime.localeCompare(a.datetime))
  return (
    <div>
      <AppBar
        title={t('events.title')}
        trail={[boatCrumb()]}
        back={!isExpanded.value}
        actions={
          canWrite.value && (
            <a class="icon-btn" href={hrefFor({ name: 'event' })} aria-label={t('events.add')}>
              <Icon name="add" />
            </a>
          )
        }
      />
      <div class="pane-inner">
        <div class="chip-row" role="group" aria-label={t('events.filterLabel')}>
          {['all', ...EVENT_CATEGORIES].map((c) => (
            <button type="button" class="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {category === c && <Icon name="check" />}
              {c === 'all' ? t('events.all') : categoryLabel(c)}
            </button>
          ))}
        </div>
        {list.length ? (
          <List>
            {list.map((e) => (
              <Row
                icon="flag"
                title={e.title}
                sub={[categoryLabel(e.category), formatIsoDay(e.datetime), e.nodeId ? byId.get(e.nodeId)?.name : undefined, e.location].filter(Boolean).join(' · ')}
                href={hrefFor({ name: 'event', id: e.id })}
              />
            ))}
          </List>
        ) : (
          <EmptyState icon="flag" title={t('events.empty')} body={t('events.emptyBody')} />
        )}
      </div>
    </div>
  )
}

export function EventScreen({ id }: { id?: string }) {
  const existing = id ? events.value.find((e) => e.id === id) : undefined
  const [category, setCategory] = useState(existing?.category ?? 'note')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [date, setDate] = useState(existing ? existing.datetime.slice(0, 10) : todayInput())
  const [description, setDescription] = useState(existing?.description ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [node, setNode] = useState(existing?.nodeId ?? '')
  const [tried, setTried] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { busy, error, run } = useSubmit()
  const byId = nodesById.value

  if (id && !existing) {
    return (
      <div>
        <AppBar title={t('event.editTitle')} trail={eventsTrail()} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const categories = [...EVENT_CATEGORIES, ...(existing && !(EVENT_CATEGORIES as readonly string[]).includes(existing.category) ? [existing.category] : [])]

  const save = () => {
    setTried(true)
    if (!title.trim()) return
    // Keep the time of day when the date is unchanged; otherwise midday UTC on the new date.
    const datetime = existing && existing.datetime.slice(0, 10) === date ? existing.datetime : `${date}T12:00:00.000Z`
    const body = {
      category,
      title: title.trim(),
      datetime,
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      nodeId: node || undefined
    }
    void run(async () => {
      if (existing) await mutate(() => updateEvent(existing.id, body))
      else await mutate(() => createEvent(body))
      navigate({ name: 'events' }, { replace: true })
    })
  }

  return (
    <div>
      <AppBar title={existing ? t('event.editTitle') : t('event.newTitle')} trail={eventsTrail()} back={!isExpanded.value} />
      <form
        class="pane-inner"
        onSubmit={(e) => {
          e.preventDefault()
          save()
          focusFirstInvalid(e.currentTarget as HTMLElement)
        }}
        noValidate
      >
        {existing && <PhotoStrip attachments={existing.attachments} target={{ kind: 'event', id: existing.id }} />}
        <SelectField label={t('event.category')} value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: categoryLabel(c) }))} />
        <TextField label={t('event.title')} value={title} onInput={setTitle} autoFocus={!existing} error={tried && !title.trim() ? t('event.titleRequired') : undefined} />
        <TextField label={t('event.date')} type="date" value={date} onInput={setDate} />
        <TextField label={t('event.description')} value={description} onInput={setDescription} multiline />
        <TextField label={t('event.location')} value={location} onInput={setLocation} />
        <SelectField
          label={t('event.node')}
          value={node}
          onChange={setNode}
          options={[
            { value: '', label: t('event.nodeNone') },
            ...[...nodes.value].map((n) => ({ value: n.id, label: [nodePath(byId, n), n.name].filter(Boolean).join(' › ') })).sort((a, b) => a.label.localeCompare(b.label))
          ]}
        />
        <SaveError error={error} />
        {canWrite.value && (
          <div class="button-row">
            <button type="submit" class="btn btn-filled" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            {existing && (
              <button type="button" class="btn btn-text btn-danger" onClick={() => setDeleting(true)}>
                <Icon name="delete" />
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </form>
      {deleting && existing && (
        <ConfirmDialog
          title={t('event.deleteTitle')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await run(async () => {
              await mutate(() => deleteEvent(existing.id))
              navigate({ name: 'events' }, { replace: true })
            })
          }}
        />
      )}
    </div>
  )
}
