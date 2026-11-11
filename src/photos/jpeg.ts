/**
 * Just enough JPEG parsing to keep location data out of git history.
 *
 * The photo panel re-encodes every image on a canvas, which already drops EXIF.
 * This is the server's own guarantee: whatever reaches the upload route — the
 * panel, a script, an older panel — loses its metadata segments before it is
 * hashed and stored, because a git repo that once held a GPS fix keeps it.
 */

export interface SanitizedJpeg {
  bytes: Buffer
  width: number
  height: number
}

export class JpegError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JpegError'
  }
}

/** APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform) change how it looks. */
const KEEP_APP = new Set([0xe0, 0xe2, 0xee])

/** Start-of-frame markers that carry the image size (not DHT 0xC4, JPG 0xC8 or DAC 0xCC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * Returns the JPEG without its EXIF/XMP (APP1), IPTC (APP13), comment and other
 * application segments, plus its pixel size. Throws [JpegError] for anything
 * that is not a baseline or progressive JPEG.
 */
export function sanitizeJpeg(input: Buffer): SanitizedJpeg {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new JpegError('Not a JPEG image.')
  }
  const parts: Buffer[] = [input.subarray(0, 2)]
  let width = 0
  let height = 0
  let pos = 2
  while (pos < input.length) {
    if (input[pos] !== 0xff) throw new JpegError('Damaged JPEG: expected a marker.')
    // Any number of 0xFF fill bytes may precede a marker.
    while (pos < input.length && input[pos] === 0xff) pos++
    if (pos >= input.length) break
    const marker = input[pos]
    const markerStart = pos - 1
    pos++
    if (marker === 0xd9) {
      parts.push(input.subarray(markerStart, pos))
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(input.subarray(markerStart, pos))
      continue
    }
    if (pos + 2 > input.length) throw new JpegError('Damaged JPEG: truncated segment.')
    const length = input.readUInt16BE(pos)
    const end = pos + length
    if (length < 2 || end > input.length) throw new JpegError('Damaged JPEG: bad segment length.')
    if (isSof(marker)) {
      if (length < 7) throw new JpegError('Damaged JPEG: short frame header.')
      height = input.readUInt16BE(pos + 3)
      width = input.readUInt16BE(pos + 5)
    }
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the end; no metadata follows it.
      parts.push(input.subarray(markerStart))
      break
    }
    const isApp = marker >= 0xe0 && marker <= 0xef
    const dropped = (isApp && !KEEP_APP.has(marker)) || marker === 0xfe
    if (!dropped) parts.push(input.subarray(markerStart, end))
    pos = end
  }
  if (width === 0 || height === 0) throw new JpegError('Damaged JPEG: no image size found.')
  return { bytes: Buffer.concat(parts), width, height }
}
