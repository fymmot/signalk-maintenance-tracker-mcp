import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, zipBytes } from '../web/src/lib/zip'

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it.skipIf(!hasUnzip)('writes an archive unzip accepts, folder first, UTF-8 intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    const file = join(dir, 'skill.zip')
    const text = '---\nname: boat-maintenance\n---\nÅ, ä, ö ✓\n'
    writeFileSync(file, zipBytes([{ path: 'boat-maintenance/SKILL.md', text }]))
    expect(execFileSync('unzip', ['-t', file]).toString()).toContain('No errors')
    execFileSync('unzip', ['-q', file, '-d', dir])
    expect(readFileSync(join(dir, 'boat-maintenance/SKILL.md'), 'utf8')).toBe(text)
  })
})
