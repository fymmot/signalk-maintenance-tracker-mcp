import { signal } from '@preact/signals'
import type { ChecklistRun } from '../../../src/types'
import { createRun, updateRun } from '../api/maintenance'
import { runs } from './store'

/*
 * Checklist runs as you go through them. A run started here is a draft until its first
 * answer, so backing out of a checklist leaves nothing behind. After that every answer
 * autosaves: debounced half a second, one write at a time, retried after 0, 2, 5 and
 * 15 s, and again with the next answer if all of those fail (Skerry's autosave).
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** Started here and not yet saved. */
export const drafts = signal<Map<string, ChecklistRun>>(new Map())
export const saveState = signal<Map<string, SaveState>>(new Map())

const RETRIES = [0, 2000, 5000, 15000]
const DEBOUNCE = 500

interface Saver {
  latest?: ChecklistRun
  timer?: ReturnType<typeof setTimeout>
  chain: Promise<void>
  /** Everyone waiting for the next write to land. */
  waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>
}
const savers = new Map<string, Saver>()

function setState(id: string, s: SaveState): void {
  const next = new Map(saveState.value)
  next.set(id, s)
  saveState.value = next
}

export function findRun(id: string): ChecklistRun | undefined {
  return savers.get(id)?.latest ?? drafts.value.get(id) ?? runs.value.find((r) => r.id === id)
}

export function startDraft(run: ChecklistRun): void {
  const next = new Map(drafts.value)
  next.set(run.id, run)
  drafts.value = next
}

export function discardDraft(id: string): void {
  if (!drafts.value.has(id)) return
  const next = new Map(drafts.value)
  next.delete(id)
  drafts.value = next
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Keeps the store's copy in step, so lists show the answers without a reload. */
function remember(run: ChecklistRun): void {
  const list = runs.value
  runs.value = list.some((r) => r.id === run.id) ? list.map((r) => (r.id === run.id ? run : r)) : [...list, run]
}

async function write(run: ChecklistRun): Promise<void> {
  const isDraft = drafts.value.has(run.id) || !runs.value.some((r) => r.id === run.id)
  let lastError: unknown
  // Without `attachments`, the server keeps each step's photos: a photo added while
  // an answer was on its way can't be dropped by it.
  const body = { ...run, results: run.results.map(({ attachments: _photos, ...r }) => r) }
  for (const delay of RETRIES) {
    if (delay) await wait(delay)
    try {
      const saved = isDraft ? await createRun(body) : await updateRun(run.id, body)
      discardDraft(run.id)
      remember(saved ?? run)
      return
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

/** Records an answer now and saves it shortly. */
export function saveRun(run: ChecklistRun, opts: { immediate?: boolean } = {}): Promise<void> {
  let s = savers.get(run.id)
  if (!s) {
    s = { chain: Promise.resolve(), waiters: [] }
    savers.set(run.id, s)
  }
  const saver = s
  saver.latest = run
  if (drafts.value.has(run.id)) startDraft(run)
  setState(run.id, 'saving')
  if (saver.timer) clearTimeout(saver.timer)
  return new Promise((resolve, reject) => {
    saver.waiters.push({ resolve, reject })
    saver.timer = setTimeout(
      () => {
        saver.timer = undefined
        const waiters = saver.waiters.splice(0)
        // Writes go one after another; each takes the newest answers.
        saver.chain = saver.chain.then(async () => {
          const latest = saver.latest
          if (!latest) return
          try {
            await write(latest)
            if (saver.latest === latest) setState(run.id, 'saved')
            waiters.forEach((w) => w.resolve())
          } catch (e) {
            setState(run.id, 'failed')
            waiters.forEach((w) => w.reject(e))
          }
        })
      },
      opts.immediate ? 0 : DEBOUNCE
    )
  })
}

/** Forgets a run's local state once it has been deleted. */
export function forgetRun(id: string): void {
  savers.delete(id)
  discardDraft(id)
}
