import { useState } from 'preact/hooks'
import { errorKey } from '../api/client'
import { t } from '../i18n'

/** A submit in flight and its error, kept on screen in the editor (Skerry's MaintenanceSaveError). */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (write: () => Promise<void>): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(undefined)
    try {
      await write()
      return true
    } catch (e) {
      setError(t(errorKey(e)))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function SaveError({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p class="body-m error-text" role="alert">
      {t('error.save')} {error !== t('error.save') ? error : ''}
    </p>
  )
}

/** Today as YYYY-MM-DD in local time, for date inputs. */
export function todayInput(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** A YYYY-MM-DD input value as a UTC epoch day (the plugin's day number). */
export function inputToDay(value: string): number | undefined {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : undefined
}

export function dayToInput(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** A number field's value, or undefined when empty or not a number. */
export function num(value: string): number | undefined {
  const v = value.trim().replace(',', '.')
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
