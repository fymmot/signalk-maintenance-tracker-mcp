import type { PendingPhoto } from '../../../src/types'
import { uploadPhoto } from '../api/maintenance'

/*
 * Photos from this browser: decoded, redrawn on a canvas (which drops EXIF, GPS
 * included) and shrunk until they fit the byte budget, then uploaded as pending
 * photos for a write to link. The steps are the photo panel's (src/photos/panel.ts):
 * keep the two in step, since both feed the same git history.
 */

const STEPS: Array<[number, number]> = [
  [2000, 0.82],
  [1600, 0.8],
  [1280, 0.78]
]
const BUDGET = 450 * 1024

export function isImage(file: File): boolean {
  return /^image\//.test(file.type) || (!file.type && /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(file.name))
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall back to an <img>, which some formats need */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function encode(img: ImageBitmap | HTMLImageElement, edge: number, quality: number) {
  const w = img.width
  const h = img.height
  const scale = Math.min(1, edge / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', quality)
  const b64 = url.slice(url.indexOf(',') + 1)
  return { b64, bytes: Math.floor((b64.length * 3) / 4), width: c.width, height: c.height }
}

/** A JPEG of the photo that fits the budget, as base64. */
export async function prepare(file: File): Promise<{ b64: string; width: number; height: number }> {
  const img = await loadImage(file)
  let out = encode(img, STEPS[0][0], STEPS[0][1])
  for (const [edge, q] of STEPS) {
    out = encode(img, edge, q)
    if (out.bytes <= BUDGET) break
  }
  if ('close' in img) img.close()
  return out
}

/** Uploads photos one at a time, reporting progress; returns the pending photos. */
export async function uploadFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<PendingPhoto[]> {
  const out: PendingPhoto[] = []
  const images = files.filter(isImage)
  for (let i = 0; i < images.length; i++) {
    onProgress?.(i, images.length)
    const { b64 } = await prepare(images[i])
    const takenAt = images[i].lastModified ? new Date(images[i].lastModified).toISOString() : undefined
    out.push(await uploadPhoto(b64, takenAt))
  }
  onProgress?.(images.length, images.length)
  return out
}

/** Image files from a paste or a drop. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return [...data.files].filter(isImage)
}
