import { signInNeeded } from '../api/client'
import { EmptyState, Loading } from '../components/ui'
import { t } from '../i18n'
import { loading, refreshAll, unavailable } from '../state/store'

/** Why the plugin can't be used at all: not installed, stopped, signed out, unreachable. */
export function Unavailable() {
  const why = unavailable.value
  if (why === 'signIn') {
    return (
      <EmptyState
        icon="login"
        title={t('auth.title')}
        body={t('auth.body')}
        action={
          <button type="button" class="btn btn-filled" onClick={() => (signInNeeded.value = true)}>
            {t('auth.submit')}
          </button>
        }
      />
    )
  }
  if (why === 'stopped') return <EmptyState icon="info" title={t('error.notInstalled')} body={t('error.stopped')} />
  if (why === 'network') {
    return (
      <EmptyState
        icon="cloudOff"
        title={t('error.load')}
        body={t('error.network')}
        action={
          <button type="button" class="btn btn-tonal" onClick={() => void refreshAll()}>
            {t('common.retry')}
          </button>
        }
      />
    )
  }
  return <EmptyState icon="info" title={t('error.notInstalled')} body={t('error.notInstalledBody')} />
}

/** A record the route names but the data doesn't hold: still loading, gone, or unreachable. */
/** App bar title for a record not in the store: still loading, or gone. */
export function missingTitle(): string {
  return loading.value ? t('common.loading') : t('error.missing')
}

export function Missing() {
  if (loading.value) return <Loading />
  if (unavailable.value) return <Unavailable />
  return <EmptyState icon="inbox" title={t('error.missing')} body={t('error.missingBody')} />
}
