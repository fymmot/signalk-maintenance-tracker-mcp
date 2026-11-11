import { isMediaId } from '../photos/PhotoStore'
import { ValidationError } from '../store/validation'
import type { Attachment } from '../types'

/**
 * Adds attachments to a list, once each. Linking a photo that is already there
 * updates its caption when the new link brings one. Returns undefined for an
 * empty result so a record without photos keeps no `attachments` key.
 */
export function mergeAttachments(
  existing: Attachment[] | undefined,
  add: Attachment[]
): Attachment[] | undefined {
  const out = (existing ?? []).map((a) => ({ ...a }))
  for (const a of add) {
    const same = out.find((x) => x.id === a.id)
    if (!same) out.push({ ...a })
    else if (a.caption) same.caption = a.caption
  }
  return out.length ? out : undefined
}

export function removeAttachments(
  list: Attachment[] | undefined,
  ids: Set<string>
): Attachment[] | undefined {
  const out = (list ?? []).filter((a) => !ids.has(a.id))
  return out.length ? out : undefined
}

/**
 * Sets or clears captions on photos already in a list (`{ [photoId]: caption }`;
 * an empty caption removes it). Photos not in the list are ignored.
 */
export function recaption(list: Attachment[] | undefined, captions: Map<string, string>): Attachment[] | undefined {
  if (!list || !captions.size) return list
  return list.map((a) => {
    if (!captions.has(a.id)) return a
    const caption = captions.get(a.id)!.trim().slice(0, 200)
    const next = { ...a }
    if (caption) next.caption = caption
    else delete next.caption
    return next
  })
}

/** Reads `captions: { [photoId]: string }` from a request body. */
export function parseCaptions(raw: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [id, caption] of Object.entries(raw as Record<string, unknown>)) {
    if (isMediaId(id) && typeof caption === 'string') out.set(id, caption)
  }
  return out
}

/**
 * Reads a client-sent `attachments` list — a full replacement, used to drop a
 * photo or fix a caption. Only ids of photos already in the repo are accepted
 * (new photos come in as `photos` handles); unknown fields are dropped.
 */
export function parseAttachmentList(raw: unknown, nowIso: string): Attachment[] {
  if (!Array.isArray(raw)) throw new ValidationError('attachments must be a list.')
  return raw.map((item) => {
    const r = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    if (!isMediaId(id)) throw new ValidationError(`'${id}' is not a photo id.`)
    const a: Attachment = { id, addedAt: typeof r.addedAt === 'string' ? r.addedAt : nowIso }
    if (typeof r.caption === 'string' && r.caption.trim()) a.caption = r.caption.trim()
    if (typeof r.takenAt === 'string') a.takenAt = r.takenAt
    if (typeof r.width === 'number') a.width = r.width
    if (typeof r.height === 'number') a.height = r.height
    return a
  })
}
