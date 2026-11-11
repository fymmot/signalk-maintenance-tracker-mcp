import { useState } from 'preact/hooks'
import { signIn } from '../api/client'
import { t } from '../i18n'
import { refreshAll, refreshLogin } from '../state/store'
import { Dialog, TextField, focusFirstInvalid } from './ui'

/** Signal K sign-in. On success the session cookie authorises every later call. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await signIn(username.trim(), password)
      await refreshLogin()
      onClose()
      void refreshAll()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('auth.title')}
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="sign-in" class="btn btn-filled" disabled={busy || !username || !password}>
            {t('auth.submit')}
          </button>
        </>
      }
    >
      <p>{t('auth.body')}</p>
      <form
        id="sign-in"
        class="stack"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget as HTMLElement
          void submit().then(() => focusFirstInvalid(form))
        }}
      >
        <TextField label={t('auth.username')} value={username} onInput={setUsername} autoComplete="username" autoFocus />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          onInput={setPassword}
          autoComplete="current-password"
          error={failed ? t('auth.failed') : undefined}
        />
      </form>
    </Dialog>
  )
}
