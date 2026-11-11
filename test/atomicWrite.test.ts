import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { atomicWriteFile } from '../src/store/atomicWrite'

describe('atomicWriteFile', () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mt-atomic-'))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('creates parent directories and writes content', async () => {
    const path = join(dir, 'nested', 'deep', 'file.yml')
    await atomicWriteFile(path, 'hello: world\n')
    expect(await fs.readFile(path, 'utf-8')).toBe('hello: world\n')
  })

  it('overwrites existing content', async () => {
    const path = join(dir, 'file.yml')
    await atomicWriteFile(path, 'a: 1\n')
    await atomicWriteFile(path, 'a: 2\n')
    expect(await fs.readFile(path, 'utf-8')).toBe('a: 2\n')
  })

  it('leaves no temp files behind', async () => {
    const path = join(dir, 'clean.yml')
    await atomicWriteFile(path, 'x: y\n')
    const entries = await fs.readdir(dir)
    expect(entries.some((e) => e.includes('.tmp-'))).toBe(false)
  })
})
