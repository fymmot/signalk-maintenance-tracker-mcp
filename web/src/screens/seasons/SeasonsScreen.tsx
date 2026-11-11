import { useState } from 'preact/hooks'
import { createSeason, deleteSeason, updateSeason } from '../../api/maintenance'
import { Icon } from '../../components/Icon'
import { AppBar, ConfirmDialog, EmptyState, List, Pill, Row, TextField, focusFirstInvalid } from '../../components/ui'
import { t } from '../../i18n'
import { formatIsoDay } from '../../lib/format'
import { isExpanded } from '../../lib/media'
import { hrefFor, navigate } from '../../lib/router'
import { canWrite, mutate, seasons, work } from '../../state/store'
import { SaveError, useSubmit } from '../../editors/common'
import { Missing } from '../states'
import { boatCrumb } from '../../lib/trail'

const seasonsTrail = () => [boatCrumb(), { label: t('seasons.title'), route: { name: 'seasons' as const } }]

/* Seasons: a launch and a haulout date each. They anchor season deadlines and the Log's chapters. */

export function SeasonsScreen() {
  const list = [...seasons.value].sort((a, b) => (b.launchDate ?? '').localeCompare(a.launchDate ?? ''))
  const phase = work.value?.phase
  const afloatId =
    phase?.state === 'afloat' ? list.find((s) => s.launchDate && Math.floor(Date.parse(s.launchDate) / 86_400_000) === phase.launched)?.id : undefined
  return (
    <div>
      <AppBar
        title={t('seasons.title')}
        trail={[boatCrumb()]}
        back={!isExpanded.value}
        actions={
          canWrite.value && (
            <a class="icon-btn" href={hrefFor({ name: 'season' })} aria-label={t('seasons.add')}>
              <Icon name="add" />
            </a>
          )
        }
      />
      <div class="pane-inner">
        {list.length ? (
          <List>
            {list.map((s) => (
              <Row
                icon="calendar"
                tone={s.id === afloatId ? 'primary' : undefined}
                title={s.label ?? s.id}
                sub={
                  s.launchDate && s.hauloutDate
                    ? `${formatIsoDay(s.launchDate)} – ${formatIsoDay(s.hauloutDate)}`
                    : s.launchDate
                      ? t('seasons.afloatSince', { date: formatIsoDay(s.launchDate) })
                      : t('seasons.noDates')
                }
                meta={s.id === afloatId && <Pill tone="primary">{t('seasons.afloat')}</Pill>}
                href={hrefFor({ name: 'season', id: s.id })}
              />
            ))}
          </List>
        ) : (
          <EmptyState
            icon="calendar"
            title={t('seasons.empty')}
            body={t('seasons.emptyBody')}
            action={
              canWrite.value && (
                <a class="btn btn-filled" href={hrefFor({ name: 'season' })}>
                  <Icon name="add" />
                  {t('seasons.add')}
                </a>
              )
            }
          />
        )}
      </div>
    </div>
  )
}

const dateOnly = (iso?: string) => (iso ? iso.slice(0, 10) : '')

export function SeasonScreen({ id }: { id?: string }) {
  const existing = id ? seasons.value.find((s) => s.id === id) : undefined
  const [label, setLabel] = useState(existing?.label ?? '')
  const [launch, setLaunch] = useState(dateOnly(existing?.launchDate))
  const [haulout, setHaulout] = useState(dateOnly(existing?.hauloutDate))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [tried, setTried] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { busy, error, run } = useSubmit()

  if (id && !existing) {
    return (
      <div>
        <AppBar title={t('season.editTitle')} trail={seasonsTrail()} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const missing = !label.trim() && !launch
  const order = launch && haulout && haulout < launch
  const save = () => {
    setTried(true)
    if (missing || order) return
    const body = { label: label.trim() || undefined, launchDate: launch || undefined, hauloutDate: haulout || undefined, notes: notes.trim() || undefined }
    void run(async () => {
      if (existing) await mutate(() => updateSeason(existing.id, body))
      else await mutate(() => createSeason(body))
      navigate({ name: 'seasons' }, { replace: true })
    })
  }

  return (
    <div>
      <AppBar title={existing ? t('season.editTitle') : t('season.newTitle')} trail={seasonsTrail()} back={!isExpanded.value} />
      <form
        class="pane-inner"
        onSubmit={(e) => {
          e.preventDefault()
          save()
          focusFirstInvalid(e.currentTarget as HTMLElement)
        }}
        noValidate
      >
        <TextField label={t('season.label')} hint={t('season.labelHint')} value={label} onInput={setLabel} />
        <div class="field-row">
          <TextField label={t('season.launch')} type="date" value={launch} onInput={setLaunch} />
          <TextField label={t('season.haulout')} type="date" value={haulout} onInput={setHaulout} error={tried && order ? t('season.order') : undefined} />
        </div>
        <TextField label={t('season.notes')} value={notes} onInput={setNotes} multiline />
        {tried && missing && (
          <p class="body-m error-text" role="alert">
            {t('season.required')}
          </p>
        )}
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
          title={t('season.deleteTitle')}
          body={t('season.deleteBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await run(async () => {
              await mutate(() => deleteSeason(existing.id))
              navigate({ name: 'seasons' }, { replace: true })
            })
          }}
        />
      )}
    </div>
  )
}
