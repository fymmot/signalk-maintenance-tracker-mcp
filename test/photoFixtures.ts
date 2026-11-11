/**
 * A structurally valid JPEG for tests: SOI, an optional EXIF segment carrying a
 * fake GPS string, a baseline frame header with the given size, a scan, EOI.
 * The scan bytes are not a decodable image — the server never decodes, it only
 * walks the segments — so `seed` varies the content (and therefore the hash).
 */
export function fakeJpeg(opts: { width?: number; height?: number; exif?: boolean; seed?: number } = {}): Buffer {
  const width = opts.width ?? 640
  const height = opts.height ?? 480
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  // APP0 JFIF
  parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]))
  if (opts.exif !== false) {
    const payload = Buffer.from('Exif\0\0GPSLatitude=59.3293N;GPSLongitude=18.0686E', 'latin1')
    const len = Buffer.alloc(2)
    len.writeUInt16BE(payload.length + 2)
    parts.push(Buffer.from([0xff, 0xe1]), len, payload)
  }
  // COM
  parts.push(Buffer.from([0xff, 0xfe, 0x00, 0x07]), Buffer.from('hello', 'latin1'))
  // SOF0: length 17, precision 8, height, width, 3 components
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  parts.push(sof)
  // SOS: length 12, 3 components
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]))
  parts.push(Buffer.from([0x12, 0x34, (opts.seed ?? 0) & 0xff, 0x56]))
  parts.push(Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}
