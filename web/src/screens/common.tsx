import { Icon } from '../components/Icon'
import { snackbar } from '../components/ui'
import { t } from '../i18n'
import { isCompact } from '../lib/media'
import { refreshAll, refreshing } from '../state/store'

/**
 * Actions in a destination's app bar: refresh, and on phones a way to Settings
 * (the bottom bar holds five destinations, so Settings lives up here).
 */
export function DestinationActions() {
  return (
    <>
      <button
        type="button"
        class="icon-btn"
        aria-label={t('nav.refresh')}
        disabled={refreshing.value}
        onClick={async () => {
          await refreshAll()
          snackbar(t('common.upToDate'))
        }}
      >
        <Icon name="refresh" />
      </button>
      {isCompact.value && (
        <a class="icon-btn" href="#/settings" aria-label={t('nav.settings')}>
          <Icon name="settings" />
        </a>
      )}
    </>
  )
}
