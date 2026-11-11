import { promises as fs } from 'fs'
import { dirname } from 'path'

/**
 * Writes a file atomically: a temp file in the target directory is written,
 * `fsync`'d, then `rename`'d over the target. `rename` is atomic on the same
 * filesystem, so a power loss mid-write cannot leave a half-written record.
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  const handle = await fs.open(tmpPath, 'w')
  try {
    await (typeof data === 'string' ? handle.writeFile(data, 'utf-8') : handle.writeFile(data))
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    throw err
  }
}
