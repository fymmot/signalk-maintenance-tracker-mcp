import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { atomicWriteFile } from '../store/atomicWrite'
import { ValidationError } from '../store/validation'
import type { Attachment } from '../types'
import { JpegError, sanitizeJpeg } from './jpeg'
import type { PendingPhoto } from '../types'

export type { PendingPhoto }

/**
 * Photos between the chat and the git-backed datastore.
 *
 * A photo pasted into a Claude conversation never reaches an MCP server: the
 * model holds pixels, not bytes. So the photo panel uploads each image to an
 * app-only tool, which lands it here as a *pending* upload and hands back a
 * `ph_…` handle. Only when a write names that handle does the photo move into
 * the repo, as `media/<sha256>.jpg`, referenced from the record's
 * `attachments`. An upload is not a commitment: unused handles expire after
 * PHOTO_TTL_MS, because git history never shrinks and a stray photo committed
 * by accident stays forever.
 *
 * Pending state lives in `.pending-photos/` (gitignored): one `<handle>.json`
 * sidecar per upload and one `<sha256>.jpg` per distinct image, so the same
 * photo uploaded twice is stored once.
 */

export const PHOTO_TTL_MS = 7 * 24 * 3600_000
/** Per photo, after decoding. The panel sends ~300 KB; this leaves room for a full-size phone JPEG. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024
export const MEDIA_DIR = 'media'
export const PENDING_DIR = '.pending-photos'

const HANDLE_PATTERN = /^ph_[0-9a-f]{12}$/
const MEDIA_ID_PATTERN = /^[0-9a-f]{64}\.jpg$/
const CAPTION_MAX = 200

export interface PhotoRef {
  handle: string
  caption?: string
}

export interface ResolvedPhotos {
  attachments: Attachment[]
  /** Repo-relative media paths to commit alongside the record. */
  mediaPaths: string[]
  handles: string[]
}

export function isMediaId(id: string): boolean {
  return MEDIA_ID_PATTERN.test(id)
}

export function isHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle)
}

export class PhotoStore {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private pendingDir(): string {
    return join(this.root, PENDING_DIR)
  }
  private sidecarPath(handle: string): string {
    return join(this.pendingDir(), `${handle}.json`)
  }
  private pendingBytesPath(id: string): string {
    return join(this.pendingDir(), id)
  }
  mediaRelPath(id: string): string {
    return join(MEDIA_DIR, id)
  }
  private mediaAbsPath(id: string): string {
    return join(this.root, MEDIA_DIR, id)
  }

  /** Stores one upload as pending and returns its handle. */
  async putPending(input: {
    contentBase64: string
    takenAt?: string
    note?: string
  }): Promise<PendingPhoto> {
    const b64 = (input.contentBase64 ?? '').replace(/^data:[^;]*;base64,/, '').trim()
    if (!b64) throw new ValidationError('No image data.')
    const raw = Buffer.from(b64, 'base64')
    if (raw.byteLength === 0) throw new ValidationError('The image decoded to nothing; it is not valid base64.')
    if (raw.byteLength > MAX_PHOTO_BYTES) {
      throw new ValidationError(
        `That photo is ${(raw.byteLength / 1048576).toFixed(1)} MB; the limit is ${MAX_PHOTO_BYTES / 1048576} MB.`
      )
    }
    let jpeg
    try {
      jpeg = sanitizeJpeg(raw)
    } catch (e) {
      if (e instanceof JpegError) throw new ValidationError(`${e.message} Photos must be JPEG.`)
      throw e
    }
    const id = `${createHash('sha256').update(jpeg.bytes).digest('hex')}.jpg`
    const bytesPath = this.pendingBytesPath(id)
    if (!(await exists(bytesPath)) && !(await exists(this.mediaAbsPath(id)))) {
      await fs.mkdir(this.pendingDir(), { recursive: true })
      await atomicWriteFile(bytesPath, jpeg.bytes)
    }
    const now = this.now()
    const photo: PendingPhoto = {
      handle: `ph_${randomBytes(6).toString('hex')}`,
      id,
      bytes: jpeg.bytes.byteLength,
      width: jpeg.width,
      height: jpeg.height,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PHOTO_TTL_MS).toISOString()
    }
    const takenAt = validIso(input.takenAt)
    if (takenAt) photo.takenAt = takenAt
    const note = input.note?.trim()
    if (note) photo.note = note.slice(0, 500)
    await atomicWriteFile(this.sidecarPath(photo.handle), JSON.stringify(photo, null, 2))
    return photo
  }

  async getPending(handle: string): Promise<PendingPhoto | null> {
    if (!isHandle(handle)) return null
    try {
      return JSON.parse(await fs.readFile(this.sidecarPath(handle), 'utf-8')) as PendingPhoto
    } catch (e) {
      if (isEnoent(e)) return null
      throw e
    }
  }

  /** Uploads newest first; linked ones only when asked for. */
  async listPending(opts: { includeLinked?: boolean } = {}): Promise<PendingPhoto[]> {
    const all = await this.readAllSidecars()
    return all
      .filter((p) => opts.includeLinked || !p.linkedTo?.length)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** The bytes behind a handle: still pending, or already in the repo. */
  async readHandleBytes(handle: string): Promise<Buffer | null> {
    const photo = await this.getPending(handle)
    if (!photo) return null
    return (await readIfExists(this.pendingBytesPath(photo.id))) ?? this.readMedia(photo.id)
  }

  async readMedia(id: string): Promise<Buffer | null> {
    if (!isMediaId(id)) return null
    return readIfExists(this.mediaAbsPath(id))
  }

  async mediaExists(id: string): Promise<boolean> {
    return isMediaId(id) && exists(this.mediaAbsPath(id))
  }

  /** Deletes uploads that will not be linked. Linked photos stay in the records that use them. */
  async discard(handles: string[]): Promise<{ discarded: string[]; notFound: string[] }> {
    const discarded: string[] = []
    const notFound: string[] = []
    for (const handle of handles) {
      const photo = await this.getPending(handle)
      if (!photo) {
        notFound.push(handle)
        continue
      }
      await fs.rm(this.sidecarPath(handle), { force: true })
      discarded.push(handle)
      await this.removePendingBytesIfUnreferenced(photo.id)
    }
    return { discarded, notFound }
  }

  /** Drops every handle older than the TTL; returns how many went. Linked or not, the repo has what it needs. */
  async sweep(): Promise<number> {
    const nowIso = this.now().toISOString()
    const expired = (await this.readAllSidecars()).filter((p) => p.expiresAt < nowIso)
    for (const photo of expired) {
      await fs.rm(this.sidecarPath(photo.handle), { force: true })
    }
    for (const id of new Set(expired.map((p) => p.id))) {
      await this.removePendingBytesIfUnreferenced(id)
    }
    return expired.length
  }

  /**
   * Turns `[{handle, caption}]` into attachments and copies each image into
   * `media/`. The copy is idempotent (content-addressed) and harmless if the
   * record write then fails: the handles stay usable, and the file is
   * committed by whichever write links it next. Call [markLinked] after the
   * record is saved.
   */
  async resolve(refs: unknown): Promise<ResolvedPhotos> {
    const list = parseRefs(refs)
    const out: ResolvedPhotos = { attachments: [], mediaPaths: [], handles: [] }
    const nowIso = this.now().toISOString()
    for (const ref of list) {
      const photo = await this.getPending(ref.handle)
      if (!photo) {
        throw new ValidationError(
          `No such photo: ${ref.handle}. It may have expired or been discarded; ` +
            'open the photo panel again to add it.'
        )
      }
      const media = this.mediaAbsPath(photo.id)
      if (!(await exists(media))) {
        const bytes = await readIfExists(this.pendingBytesPath(photo.id))
        if (!bytes) {
          throw new ValidationError(`${ref.handle} is recorded but its image is gone; add the photo again.`)
        }
        await atomicWriteFile(media, bytes)
      }
      const attachment: Attachment = {
        id: photo.id,
        addedAt: nowIso,
        width: photo.width,
        height: photo.height
      }
      const caption = ref.caption?.trim()
      if (caption) attachment.caption = caption.slice(0, CAPTION_MAX)
      if (photo.takenAt) attachment.takenAt = photo.takenAt
      if (!out.attachments.some((a) => a.id === attachment.id)) out.attachments.push(attachment)
      const rel = this.mediaRelPath(photo.id)
      if (!out.mediaPaths.includes(rel)) out.mediaPaths.push(rel)
      out.handles.push(ref.handle)
    }
    return out
  }

  /** Records where the handles went and frees their pending copies (the repo has them now). */
  async markLinked(handles: string[], target: string): Promise<void> {
    for (const handle of handles) {
      const photo = await this.getPending(handle)
      if (!photo) continue
      photo.linkedTo = [...new Set([...(photo.linkedTo ?? []), target])]
      await atomicWriteFile(this.sidecarPath(handle), JSON.stringify(photo, null, 2))
      await fs.rm(this.pendingBytesPath(photo.id), { force: true })
    }
  }

  private async readAllSidecars(): Promise<PendingPhoto[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.pendingDir())
    } catch (e) {
      if (isEnoent(e)) return []
      throw e
    }
    const out: PendingPhoto[] = []
    for (const name of names) {
      if (!/^ph_[0-9a-f]{12}\.json$/.test(name)) continue
      try {
        out.push(JSON.parse(await fs.readFile(join(this.pendingDir(), name), 'utf-8')) as PendingPhoto)
      } catch {
        // A sidecar that cannot be read is skipped rather than failing the whole list.
      }
    }
    return out
  }

  private async removePendingBytesIfUnreferenced(id: string): Promise<void> {
    const stillUsed = (await this.readAllSidecars()).some((p) => p.id === id && !p.linkedTo?.length)
    if (!stillUsed) await fs.rm(this.pendingBytesPath(id), { force: true })
  }
}

/** Validates the `photos` argument shape: `[{handle, caption?}]`; a bare handle string also works. */
export function parseRefs(raw: unknown): PhotoRef[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ValidationError('photos must be a list of {handle, caption?}.')
  return raw.map((item) => {
    if (typeof item === 'string') return { handle: item }
    const r = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const handle = typeof r.handle === 'string' ? r.handle : ''
    if (!isHandle(handle)) {
      throw new ValidationError(`'${handle || String(item)}' is not a photo handle (ph_ plus 12 hex characters).`)
    }
    return typeof r.caption === 'string' ? { handle, caption: r.caption } : { handle }
  })
}

function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const t = Date.parse(value)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path)
  } catch (e) {
    if (isEnoent(e)) return null
    throw e
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}
