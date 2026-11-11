import { useState } from 'preact/hooks'
import { errorKey } from '../api/client'
import { createStarterBoat } from '../api/maintenance'
import { Icon, type IconName } from '../components/Icon'
import { snackbar } from '../components/ui'
import { lang, t } from '../i18n'
import { hrefFor, navigate } from '../lib/router'
import { openEditor } from '../state/editors'
import { canWrite, mutate } from '../state/store'

/*
 * The first run: a boat with no systems yet. Says what the app is for and offers three
 * ways in: a typical boat in one click, building your own, or connecting an assistant.
 */

function Choice({
  icon,
  title,
  hint,
  primary,
  onClick,
  href,
  busy
}: {
  icon: IconName
  title: string
  hint: string
  primary?: boolean
  onClick?: () => void
  href?: string
  busy?: boolean
}) {
  const body = (
    <>
      <span class={`li-lead${primary ? ' tone-primary' : ''}`}>{busy ? <span class="loader" aria-hidden="true" /> : <Icon name={icon} />}</span>
      <span class="li-body">
        <span class="li-title title-m">{title}</span>
        <span class="li-sub">{hint}</span>
      </span>
      <Icon name="chevron" class="li-trail" />
    </>
  )
  return (
    <li>
      {href ? (
        <a class={`li-btn onboard-choice${primary ? ' is-primary' : ''}`} href={href}>
          {body}
        </a>
      ) : (
        <button type="button" class={`li-btn onboard-choice${primary ? ' is-primary' : ''}`} onClick={onClick} disabled={busy} aria-busy={busy}>
          {body}
        </button>
      )}
    </li>
  )
}

export function Onboarding() {
  const [busy, setBusy] = useState(false)
  const write = canWrite.value

  const starter = async () => {
    setBusy(true)
    try {
      await mutate(() => createStarterBoat(lang.value))
      snackbar(t('onboard.created'))
      navigate({ name: 'boat' })
    } catch (e) {
      snackbar(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="onboard stack">
      <div class="onboard-hero">
        <span class="empty-art">
          <Icon name="boat" />
        </span>
        <h2 class="headline-m">{t('onboard.title')}</h2>
        <p class="body-l muted">{t('onboard.body')}</p>
      </div>
      <ul class="list">
        {write && (
          <Choice
            icon="boat"
            title={busy ? t('onboard.creating') : t('onboard.starter')}
            hint={t('onboard.starterHint')}
            primary
            busy={busy}
            onClick={() => void starter()}
          />
        )}
        {write && <Choice icon="add" title={t('onboard.own')} hint={t('onboard.ownHint')} onClick={() => openEditor({ kind: 'node' })} />}
        <Choice icon="plug" title={t('onboard.mcp')} hint={t('onboard.mcpHint')} href={hrefFor({ name: 'mcp' })} />
      </ul>
    </div>
  )
}

/** Once there is a boat but no season: what to do next. */
export function SeasonPrompt() {
  if (!canWrite.value) return null
  return (
    <a class="banner tone-tertiary onboard-next" href={hrefFor({ name: 'season' })}>
      <Icon name="calendar" />
      <span class="grow stack" style={{ '--stack-gap': '2px' }}>
        <span class="label-l">{t('onboard.next')}</span>
        <span class="title-m">{t('onboard.season')}</span>
        <span class="body-m">{t('onboard.seasonHint')}</span>
      </span>
      <Icon name="chevron" />
    </a>
  )
}
