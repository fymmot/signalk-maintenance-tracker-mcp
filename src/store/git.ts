import { promises as fs } from 'fs'
import { join } from 'path'
import { CheckRepoActions, simpleGit, type SimpleGit } from 'simple-git'
import type { GitStatus } from '../types'

export type { GitStatus }

export interface GitLogger {
  debug: (msg: string) => void
  error: (msg: string) => void
}

export interface GitStoreOptions {
  dir: string
  remoteUrl: string
  pushEnabled: boolean
  pushDebounceMs: number
  authorName: string
  authorEmail: string
}

/**
 * Wraps the datastore directory as a git repository. Every mutation is committed;
 * pushes to the (optional) private remote are debounced and run in the background
 * so a mutation never blocks on the network, and a push failure never fails a write.
 */
export class GitStore {
  private readonly git: SimpleGit
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private pushPending = false
  private ready = false
  private lastCommitAt?: string
  private lastPushAt?: string
  private lastPushError?: string
  private lastError?: string

  constructor(
    private readonly opts: GitStoreOptions,
    private readonly log: GitLogger
  ) {
    this.git = simpleGit({ baseDir: opts.dir, timeout: { block: 60_000 } })
  }

  async init(): Promise<void> {
    await fs.mkdir(this.opts.dir, { recursive: true })
    // The data directory must be a repository of its own. A plain checkIsRepo() is
    // true anywhere inside another repository (a ~/.signalk kept under git, say),
    // and the commits and the identity set below would then land in that one.
    const isRoot = await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false)
    if (!isRoot) {
      await this.git.init()
    }
    await this.git.addConfig('user.name', this.opts.authorName)
    await this.git.addConfig('user.email', this.opts.authorEmail)
    await fs
      // Photo uploads wait in .pending-photos/ until a record links them; only
      // then do they enter history, as media/<sha256>.jpg.
      .writeFile(join(this.opts.dir, '.gitignore'), '*.tmp-*\n.pending-photos/\n', 'utf-8')
      .catch(() => undefined)
    await this.configureRemote()
    this.ready = true
  }

  status(): GitStatus {
    return {
      ready: this.ready,
      remoteSet: !!this.opts.remoteUrl,
      pushEnabled: this.opts.pushEnabled && !!this.opts.remoteUrl,
      lastCommitAt: this.lastCommitAt,
      lastPushAt: this.lastPushAt,
      lastPushError: this.lastPushError,
      lastError: this.lastError
    }
  }

  private async configureRemote(): Promise<void> {
    if (!this.opts.remoteUrl) return
    try {
      const remotes = await this.git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      if (!origin) {
        await this.git.addRemote('origin', this.opts.remoteUrl)
      } else if (origin.refs.push !== this.opts.remoteUrl) {
        await this.git.remote(['set-url', 'origin', this.opts.remoteUrl])
      }
    } catch (e) {
      this.lastError = `git remote config failed: ${errMessage(e)}`
      this.log.error(this.lastError)
    }
  }

  /** Stages the given paths (relative to the repo) and commits. Tolerant of no-op commits. */
  async commit(relPaths: string[], message: string): Promise<void> {
    try {
      await this.git.add(relPaths)
      const status = await this.git.status()
      if (status.staged.length === 0) {
        this.log.debug(`git: nothing to commit for "${message}"`)
        return
      }
      await this.git.commit(message)
      this.lastCommitAt = new Date().toISOString()
      this.schedulePush()
    } catch (e) {
      this.lastError = `git commit failed: ${errMessage(e)}`
      this.log.error(this.lastError)
    }
  }

  private schedulePush(): void {
    if (!this.opts.pushEnabled || !this.opts.remoteUrl) return
    this.pushPending = true
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      if (this.pushPending) {
        this.pushPending = false
        void this.push()
      }
    }, this.opts.pushDebounceMs)
  }

  private async push(): Promise<void> {
    try {
      await this.git.push('origin', 'HEAD')
      this.lastPushAt = new Date().toISOString()
      this.lastPushError = undefined
      this.log.debug('git push ok')
    } catch (e) {
      this.lastPushError = errMessage(e)
      this.log.error(`git push failed: ${this.lastPushError}`)
    }
  }

  /** Forces any pending push to run now (used on plugin stop). */
  async flush(): Promise<void> {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    if (this.pushPending) {
      this.pushPending = false
      await this.push()
    }
  }

  stop(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
  }
}

/** The error text with any credentials in a URL (`https://user:token@host`) masked. */
function errMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/\/\/[^/@\s]+@/g, '//***@')
}
