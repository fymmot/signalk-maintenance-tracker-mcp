import { computed, signal } from '@preact/signals'
import { en, type Messages } from './en'
import { sv } from './sv'

/*
 * Copy in English and Swedish. English is the source; `sv` must have every key (the
 * type checks it). Much of it is Skerry's shipping copy, so the phone and the web
 * app say the same thing in both languages.
 *
 *   t('work.empty')                     plain string
 *   t('work.dueInDays', { n: 3 })       {n} placeholders
 *   tn('issues.count', 2)               picks `issues.count.one` / `.other`, fills {n}
 */

export type Lang = 'en' | 'sv'
export type LangPref = Lang | 'auto'
export type MessageKey = keyof Messages

const CATALOGUES: Record<Lang, Messages> = { en, sv }
const STORAGE_KEY = 'maintenance.lang'

function readPref(): LangPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'en' || v === 'sv' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export const langPref = signal<LangPref>(readPref())

export const lang = computed<Lang>(() => {
  if (langPref.value !== 'auto') return langPref.value
  return navigator.languages.some((l) => l.toLowerCase().startsWith('sv')) ? 'sv' : 'en'
})

/** The BCP 47 locale for dates and numbers: Swedish, or the browser's English. */
export const locale = computed<string>(() => {
  if (lang.value === 'sv') return 'sv-SE'
  const en = navigator.languages.find((l) => l.toLowerCase().startsWith('en'))
  return en ?? 'en-GB'
})

export function setLangPref(pref: LangPref): void {
  langPref.value = pref
  try {
    if (pref === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

// Keep <html lang> right for screen readers and hyphenation.
lang.subscribe((l) => {
  document.documentElement.lang = l
})

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = CATALOGUES[lang.value][key] ?? en[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? formatParam(params[name]) : `{${name}}`
  )
}

type PluralBase = {
  [K in MessageKey]: K extends `${infer B}.one` ? B : never
}[MessageKey]

export function tn(base: PluralBase, n: number, params?: Record<string, string | number>): string {
  const rule = new Intl.PluralRules(locale.value).select(n)
  const key = (rule === 'one' ? `${base}.one` : `${base}.other`) as MessageKey
  return t(key, { n, ...params })
}

function formatParam(v: string | number): string {
  return typeof v === 'number' ? new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(v) : v
}
