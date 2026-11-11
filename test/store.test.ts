import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NotFoundError, Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'
import type { Season } from '../src/types'

function season(id: string, label: string): Season {
  return {
    id,
    label,
    launchDate: '2026-04-26',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function makeStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'maint-store-'))
  const store = new Store(dir, new SchemaValidator(), { commit: async () => undefined })
  return { store, dir }
}

describe('Store cache', () => {
  it('serves reads after the first from memory', async () => {
    const { store, dir } = makeStore()
    await store.putSeason(season('2026', 'first'), 'create')
    expect(await store.listSeasons()).toHaveLength(1)
    // Gone from disk, still served: the collection was read once.
    rmSync(join(dir, 'seasons'), { recursive: true })
    expect((await store.getSeason('2026'))?.label).toBe('first')
  })

  it('loads records that were on disk before the first read', async () => {
    const { store, dir } = makeStore()
    mkdirSync(join(dir, 'seasons'))
    writeFileSync(join(dir, 'seasons', '2025.yml'), 'id: "2025"\nlabel: old\n')
    expect((await store.getSeason('2025'))?.label).toBe('old')
  })

  it('reflects writes and deletes', async () => {
    const { store } = makeStore()
    await store.putSeason(season('2026', 'first'), 'create')
    await store.listSeasons()
    await store.putSeason(season('2026', 'renamed'), 'update')
    await store.putSeason(season('2027', 'next'), 'create')
    expect((await store.listSeasons()).map((s) => s.label).sort()).toEqual(['next', 'renamed'])
    await store.deleteSeason('2026', 'delete')
    expect(await store.getSeason('2026')).toBeNull()
    await expect(store.deleteSeason('2026', 'again')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hands out copies, so mutating a read record changes nothing until saved', async () => {
    const { store } = makeStore()
    await store.putSeason(season('2026', 'first'), 'create')
    const read = await store.getSeason('2026')
    read!.label = 'mutated'
    ;(await store.listSeasons())[0].label = 'mutated too'
    expect((await store.getSeason('2026'))?.label).toBe('first')
  })

  it('keeps the cache unchanged when a write fails validation', async () => {
    const { store } = makeStore()
    await store.putSeason(season('2026', 'first'), 'create')
    const bad = { ...season('2026', 'bad'), launchDate: 42 } as unknown as Season
    await expect(store.putSeason(bad, 'bad')).rejects.toThrow()
    expect((await store.getSeason('2026'))?.label).toBe('first')
  })
})

describe('GitStore inside another repository', () => {
  it('makes the data directory a repository of its own and leaves the outer one alone', async () => {
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { GitStore } = await import('../src/store/git')
    const outer = mkdtempSync(join(tmpdir(), 'maint-outer-'))
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    try {
      git(outer, 'init', '-q')
    } catch {
      return // no git on this machine; the plugin tolerates that too
    }
    const data = join(outer, 'plugin-config-data', 'maintenance')
    mkdirSync(data, { recursive: true })
    const store = new GitStore(
      { dir: data, remoteUrl: '', pushEnabled: false, pushDebounceMs: 0, authorName: 'maint', authorEmail: 'm@localhost' },
      { debug: () => undefined, error: () => undefined }
    )
    await store.init()
    const { realpathSync } = await import('node:fs')
    expect(git(data, 'rev-parse', '--show-toplevel')).toBe(realpathSync(data))
    expect(() => git(outer, 'config', '--local', 'user.name')).toThrow()
  })
})
