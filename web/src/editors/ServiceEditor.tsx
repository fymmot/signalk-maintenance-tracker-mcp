import { useMemo, useState } from 'preact/hooks'
import { markServiced } from '../api/maintenance'
import { Icon } from '../components/Icon'
import { PhotoPicker } from '../components/Photos'
import type { PendingPhoto } from '../../../src/types'
import { SelectField, Sheet, TextField, snackbar } from '../components/ui'
import { lang, t } from '../i18n'
import { formatDayShort } from '../lib/format'
import { isDated, isoDateTimeForDay, nodePath } from '../lib/maint'
import { dueById, mutate, nodes, nodesById } from '../state/store'
import { inputToDay, num, SaveError, todayInput, useSubmit } from './common'

/*
 * Log a job (Skerry's Mark serviced sheet). Which intervals it covers decides what
 * resets. From a Work row, exactly that interval is ticked; otherwise every ordinary
 * interval, plus season and expiry ones only once they are due: a mid-season job
 * mustn't clear the haulout task, and the yearly extinguisher check isn't a replacement.
 */
export function ServiceEditor({ nodeId, triggerIds, onClose }: { nodeId?: string; triggerIds?: string[]; onClose: () => void }) {
  const options = useMemo(() => [...nodes.value].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())), [])
  const [picked, setPicked] = useState(
    nodeId ?? options.find((n) => n.triggers.some((x) => x.enabled))?.id ?? options[0]?.id ?? ''
  )
  const node = nodesById.value.get(picked)
  const enabled = node?.triggers.filter((x) => x.enabled) ?? []
  const dues = dueById.value.get(picked)?.triggers ?? []

  const initialCovered = (id: string): Set<string> => {
    const n = nodesById.value.get(id)
    const ds = dueById.value.get(id)?.triggers ?? []
    if (triggerIds?.length && id === nodeId) return new Set(triggerIds)
    return new Set(
      (n?.triggers ?? [])
        .filter((x) => x.enabled)
        .filter((x) => {
          const status = ds.find((d) => d.triggerId === x.id)?.status
          return (x.metric !== 'seasonAnchor' && x.metric !== 'expiry') || status === 'dueSoon' || status === 'overdue'
        })
        .map((x) => x.id)
    )
  }
  const [covered, setCovered] = useState<Set<string>>(() => initialCovered(picked))
  const [date, setDate] = useState(todayInput())
  const [newExpiry, setNewExpiry] = useState('')
  const [description, setDescription] = useState('')
  const [more, setMore] = useState(false)
  const [parts, setParts] = useState('')
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState(lang.value === 'sv' ? 'SEK' : 'EUR')
  const [comment, setComment] = useState('')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [tried, setTried] = useState(false)
  const { busy, error, run } = useSubmit()

  const selected = enabled.filter((x) => covered.has(x.id))
  const renewsExpiry = selected.some((x) => x.metric === 'expiry')
  const fallback = selected.map((x) => x.name).join(', ')

  // What comes next once these reset: the soonest dated interval left untouched.
  const next = dues
    .filter((d) => !covered.has(d.triggerId) && isDated(d.metric) && d.due !== null && Number.isFinite(d.due))
    .sort((a, b) => a.due - b.due)[0]

  const errors = {
    expiry: renewsExpiry && !newExpiry ? t('service.expiryRequired') : undefined,
    nothing: !description.trim() && !selected.length
  }

  const save = () => {
    setTried(true)
    if (!node || errors.expiry || errors.nothing) return
    const day = inputToDay(date)
    void run(async () => {
      await mutate(() =>
        markServiced(node.id, {
          // Always explicit: the plugin reads a missing list as "reset every interval".
          triggerIds: selected.map((x) => x.id),
          datetime: day !== undefined ? isoDateTimeForDay(day) : new Date().toISOString(),
          description: description.trim() || fallback || node.name,
          comment: comment.trim() || undefined,
          partsReplaced: parts
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
          expiresOn: renewsExpiry ? newExpiry : undefined,
          cost: num(cost),
          costCurrency: num(cost) !== undefined ? currency.trim().toUpperCase() || undefined : undefined,
          photos: photos.length ? photos.map((p) => ({ handle: p.handle })) : undefined
        })
      )
      snackbar(t('service.logged'))
      onClose()
    })
  }

  const byId = nodesById.value
  return (
    <Sheet
      title={nodeId && node ? node.name : t('service.title')}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-filled" disabled={busy || !node}>
            <Icon name="check" />
            {busy ? t('common.saving') : t('service.submit')}
          </button>
        </>
      }
    >
      {!nodeId && options.length > 0 && (
        <SelectField
          label={t('service.node')}
          value={picked}
          onChange={(id) => {
            setPicked(id)
            setCovered(initialCovered(id))
          }}
          options={options.map((n) => ({ value: n.id, label: [nodePath(byId, n), n.name].filter(Boolean).join(' › ') }))}
        />
      )}

      {enabled.length > 0 && (
        <fieldset class="fieldset">
          <legend class="field-label">{t('service.covers')}</legend>
          <div class="chip-row wrap">
            {enabled.map((x) => {
              const on = covered.has(x.id)
              return (
                <button
                  type="button"
                  class="chip"
                  aria-pressed={on}
                  onClick={() => {
                    const nextSet = new Set(covered)
                    if (on) nextSet.delete(x.id)
                    else nextSet.add(x.id)
                    setCovered(nextSet)
                  }}
                >
                  {on && <Icon name="check" />}
                  {x.name}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {renewsExpiry && (
        <TextField
          label={t('service.newExpiry')}
          type="date"
          value={newExpiry}
          onInput={setNewExpiry}
          hint={t('service.expiryRequired')}
          error={tried ? errors.expiry : undefined}
        />
      )}
      <TextField label={t('service.date')} type="date" value={date} onInput={setDate} max={todayInput()} />
      <TextField
        label={t('service.description')}
        value={description}
        onInput={setDescription}
        hint={!description.trim() && fallback ? t('service.savedAs', { text: fallback }) : undefined}
        error={tried && errors.nothing ? t('service.descriptionRequired') : undefined}
      />

      {!more ? (
        <div>
          <button type="button" class="btn btn-text" onClick={() => setMore(true)}>
            <Icon name="add" />
            {t('service.more')}
          </button>
        </div>
      ) : (
        <>
          <TextField label={t('service.parts')} value={parts} onInput={setParts} />
          <div class="field-row">
            <TextField label={t('service.cost')} type="number" inputMode="decimal" min={0} value={cost} onInput={setCost} />
            <TextField label={t('service.currency')} value={currency} onInput={setCurrency} />
          </div>
          <TextField label={t('service.comment')} value={comment} onInput={setComment} multiline />
        </>
      )}

      <PhotoPicker value={photos} onChange={setPhotos} />

      {node && next && (
        <div class="banner tone-tertiary">
          <Icon name="schedule" />
          <p class="body-m">{t('service.next', { name: node.name, trigger: next.name, date: formatDayShort(Math.floor(next.due)) })}</p>
        </div>
      )}
      <SaveError error={error} />
    </Sheet>
  )
}
