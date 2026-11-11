import { locale } from '../i18n'

/*
 * Dates, times and numbers in the user's language. Maintenance days are UTC epoch
 * days (the plugin's convention), shown as calendar dates without a time-zone shift.
 */

const MS_PER_DAY = 86_400_000

export function epochDayToDate(day: number): Date {
  return new Date(day * MS_PER_DAY)
}

/** "3 Jun 2026" / "3 juni 2026". */
export function formatDay(day: number): string {
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    epochDayToDate(day)
  )
}

/**
 * "Mon 3 Jun" / "mån 3 juni" for dates within half a year, where the year is obvious;
 * further out the year replaces the weekday ("3 Jun 2031"), so a date next November
 * doesn't read as this one.
 */
export function formatDayShort(day: number): string {
  if (Math.abs(day - Math.floor(Date.now() / MS_PER_DAY)) > 182) return formatDay(day)
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    epochDayToDate(day)
  )
}

/** A date from an ISO string ("2026-06-03" or a date-time), as a calendar date. */
export function formatIsoDay(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  // Date-only strings are UTC midnight; date-times are shown in local time.
  const dateOnly = /^\d{4}-\d{2}(-\d{2})?$/.test(iso)
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : undefined
  }).format(new Date(ms))
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

/** "3 minutes ago", "in 2 days": for times near now. */
export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  const sec = Math.round((ms - now) / 1000)
  const abs = Math.abs(sec)
  if (abs < 60) return rtf.format(sec, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 86400 * 45) return rtf.format(Math.round(sec / 86400), 'day')
  return formatDateTime(iso)
}

export function formatNumber(n: number, maxFraction = 1): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: maxFraction }).format(n)
}

export function todayDay(now = new Date()): number {
  return Math.floor(now.getTime() / MS_PER_DAY)
}
