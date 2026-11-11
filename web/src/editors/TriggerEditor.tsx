import { useState } from 'preact/hooks'
import type { MetricType, SeasonMilestone, Trigger } from '../../../src/types'
import { updateNode } from '../api/maintenance'
import { SelectField, Sheet, SwitchRow, TextField } from '../components/ui'
import { t } from '../i18n'
import { formatNumber } from '../lib/format'
import { metricUnit } from '../lib/maint'
import { mutate, nodesById, work } from '../state/store'
import { dayToInput, inputToDay, num, SaveError, todayInput, useSubmit } from './common'

/*
 * One service interval on a node. Saved by PUTting the node with its whole trigger
 * list (the server replaces the list), so the other intervals go along unchanged.
 */

const METRICS: MetricType[] = ['calendarTime', 'engineHours', 'tripCount', 'seasonAnchor', 'expiry']

export function TriggerEditor({ nodeId, triggerId, onClose }: { nodeId: string; triggerId?: string; onClose: () => void }) {
  const node = nodesById.value.get(nodeId)
  const existing = node?.triggers.find((x) => x.id === triggerId)
  const readings = work.value?.metrics ?? {}

  const [name, setName] = useState(existing?.name ?? '')
  const [metric, setMetric] = useState<MetricType>(existing?.metric ?? 'calendarTime')
  const [interval, setIntervalText] = useState(existing?.interval ? String(existing.interval) : '')
  const [milestone, setMilestone] = useState<SeasonMilestone>(existing?.anchor?.milestone ?? 'launch')
  const [offset, setOffset] = useState(String(existing?.anchor?.offsetDays ?? -14))
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? '')
  const [warnLead, setWarnLead] = useState(existing?.warnLead !== undefined ? String(existing.warnLead) : '')
  const [lastDate, setLastDate] = useState(
    existing && (existing.metric === 'calendarTime') ? dayToInput(Math.floor(existing.lastServiceValue)) : todayInput()
  )
  const [lastValue, setLastValue] = useState(
    existing && (existing.metric === 'engineHours' || existing.metric === 'tripCount')
      ? String(existing.lastServiceValue)
      : metric === 'engineHours' && readings.engineHours !== undefined
        ? String(Math.round(readings.engineHours))
        : ''
  )
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [tried, setTried] = useState(false)
  const { busy, error, run } = useSubmit()

  if (!node) return null

  const counted = metric === 'calendarTime' || metric === 'engineHours' || metric === 'tripCount'
  const intervalN = num(interval)
  const errors = {
    name: !name.trim() ? t('nodeEditor.nameRequired') : undefined,
    interval: counted && !(intervalN && intervalN > 0) ? t('triggerEditor.intervalRequired') : undefined,
    expiresOn: metric === 'expiry' && !expiresOn ? t('triggerEditor.expiresRequired') : undefined
  }
  const valid = !errors.name && !errors.interval && !errors.expiresOn

  const build = (): Partial<Trigger> => {
    const base: Partial<Trigger> = {
      ...(existing ?? {}),
      name: name.trim(),
      metric,
      enabled,
      warnLead: num(warnLead),
      interval: counted ? intervalN : 0
    }
    delete base.anchor
    delete base.expiresOn
    if (metric === 'seasonAnchor') base.anchor = { milestone, offsetDays: Math.round(num(offset) ?? 0) }
    if (metric === 'expiry') base.expiresOn = expiresOn
    if (metric === 'calendarTime') {
      const day = inputToDay(lastDate)
      if (day !== undefined) {
        base.lastServiceValue = day
        base.lastServiceDate = new Date(day * 86_400_000).toISOString()
      }
    } else if (metric === 'engineHours' || metric === 'tripCount') {
      const v = num(lastValue)
      if (v !== undefined) base.lastServiceValue = v
      else if (!existing || existing.metric !== metric) delete base.lastServiceValue
    } else if (!existing || existing.metric !== metric) {
      // A new season or expiry interval: the server works out where its cycle starts.
      delete base.lastServiceValue
    }
    return base
  }

  const save = () => {
    setTried(true)
    if (!valid) return
    const trigger = build()
    const triggers = existing ? node.triggers.map((x) => (x.id === existing.id ? trigger : x)) : [...node.triggers, trigger]
    void run(async () => {
      await mutate(() => updateNode(node.id, { ...node, triggers }))
      onClose()
    })
  }

  const unit = metricUnit(metric === 'seasonAnchor' || metric === 'expiry' ? 'calendarTime' : metric)

  return (
    <Sheet
      title={existing ? t('triggerEditor.editTitle') : t('triggerEditor.newTitle')}
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
      <p class="body-m muted">{node.name}</p>
      <TextField
        label={t('triggerEditor.name')}
        hint={t('triggerEditor.nameHint')}
        value={name}
        onInput={setName}
        autoFocus={!existing}
        error={tried ? errors.name : undefined}
      />
      <SelectField<MetricType>
        label={t('triggerEditor.metric')}
        value={metric}
        onChange={(m) => {
          setMetric(m)
          if (m === 'engineHours' && !lastValue && readings.engineHours !== undefined) setLastValue(String(Math.round(readings.engineHours)))
        }}
        options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))}
      />

      {counted && (
        <TextField
          label={t(metric === 'engineHours' ? 'triggerEditor.intervalHours' : metric === 'tripCount' ? 'triggerEditor.intervalTrips' : 'triggerEditor.intervalDays')}
          type="number"
          inputMode="decimal"
          min={0}
          value={interval}
          onInput={setIntervalText}
          error={tried ? errors.interval : undefined}
        />
      )}
      {metric === 'calendarTime' && <TextField label={t('triggerEditor.lastDate')} type="date" value={lastDate} onInput={setLastDate} />}
      {metric === 'engineHours' && (
        <TextField
          label={t('triggerEditor.lastHours')}
          hint={readings.engineHours !== undefined ? t('triggerEditor.lastHoursNow', { n: formatNumber(readings.engineHours, 0) }) : undefined}
          type="number"
          inputMode="decimal"
          value={lastValue}
          onInput={setLastValue}
        />
      )}
      {metric === 'tripCount' && (
        <TextField label={t('triggerEditor.lastTrips')} type="number" inputMode="numeric" value={lastValue} onInput={setLastValue} />
      )}
      {metric === 'seasonAnchor' && (
        <div class="field-row">
          <SelectField<SeasonMilestone>
            label={t('triggerEditor.milestone')}
            value={milestone}
            onChange={setMilestone}
            options={[
              { value: 'launch', label: t('milestone.launch') },
              { value: 'haulout', label: t('milestone.haulout') }
            ]}
          />
          <TextField
            label={t('triggerEditor.offset')}
            hint={t('triggerEditor.offsetHint')}
            type="number"
            inputMode="numeric"
            value={offset}
            onInput={setOffset}
          />
        </div>
      )}
      {metric === 'expiry' && (
        <TextField
          label={t('triggerEditor.expiresOn')}
          hint={t('triggerEditor.expiresOnHint')}
          type="date"
          value={expiresOn.length === 7 ? `${expiresOn}-01` : expiresOn}
          onInput={setExpiresOn}
          error={tried ? errors.expiresOn : undefined}
        />
      )}

      <TextField
        label={t('triggerEditor.warnLead', { unit })}
        hint={t('triggerEditor.warnLeadHint')}
        type="number"
        inputMode="decimal"
        min={0}
        value={warnLead}
        onInput={setWarnLead}
      />
      <SwitchRow label={t('triggerEditor.enabled')} hint={t('triggerEditor.enabledHint')} checked={enabled} onChange={setEnabled} />
      <SaveError error={error} />
    </Sheet>
  )
}
