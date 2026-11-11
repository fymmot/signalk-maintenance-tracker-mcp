import { promises as fs } from 'fs'
import { join } from 'path'
import { parse, stringify } from 'yaml'
import type {
  BoatEvent,
  ChecklistRun,
  ChecklistTemplate,
  Issue,
  MaintenanceNode,
  Season,
  ServiceLog
} from '../types'
import { atomicWriteFile } from './atomicWrite'
import { SchemaValidator, ValidationError } from './validation'

/** Anything that can record a git commit for changed paths. */
export interface Committer {
  commit(relPaths: string[], message: string): Promise<void>
}

const ID_PATTERN = /^[A-Za-z0-9._-]+$/

const SUBDIR = {
  nodes: 'nodes',
  logs: 'logs',
  issues: 'issues',
  seasons: 'seasons',
  events: 'events',
  templates: join('checklists', 'templates'),
  runs: join('checklists', 'runs')
} as const

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** The request clashes with what is stored (an id already taken, a node with children). */
export class ConflictError extends Error {
  constructor(
    message: string,
    /** Extra fields for the 409 body, e.g. the children blocking a delete. */
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'ConflictError'
  }
}

/**
 * Flat-YAML, one-file-per-record datastore. All writes are atomic and committed
 * to git. Reads tolerate a missing collection directory (returns empty).
 *
 * Each collection is read from disk once and then served from memory: parsing
 * every file on every request took seconds on a Pi's SD card. The plugin is
 * the only writer, so writes and deletes keep the cache current; edits made to
 * the files by hand need a plugin restart to show. Reads hand out copies, so a
 * caller mutating a record can't change what's cached before it is saved.
 */
export class Store {
  private readonly cache = new Map<string, Promise<Map<string, unknown>>>()

  constructor(
    private readonly root: string,
    private readonly validator: SchemaValidator,
    private readonly committer: Committer
  ) {}

  // ---- Nodes ----
  listNodes(): Promise<MaintenanceNode[]> {
    return this.readAll<MaintenanceNode>(SUBDIR.nodes)
  }
  getNode(id: string): Promise<MaintenanceNode | null> {
    return this.readOne<MaintenanceNode>(SUBDIR.nodes, id)
  }
  putNode(node: MaintenanceNode, message: string, extraPaths: string[] = []): Promise<void> {
    return this.writeOne(SUBDIR.nodes, node.id, 'MaintenanceNode', node, message, extraPaths)
  }
  deleteNode(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.nodes, id, message)
  }

  // ---- Service logs ----
  listLogs(): Promise<ServiceLog[]> {
    return this.readAll<ServiceLog>(SUBDIR.logs)
  }
  getLog(id: string): Promise<ServiceLog | null> {
    return this.readOne<ServiceLog>(SUBDIR.logs, id)
  }
  putLog(log: ServiceLog, message: string, extraPaths: string[] = []): Promise<void> {
    return this.writeOne(SUBDIR.logs, log.id, 'ServiceLog', log, message, extraPaths)
  }
  deleteLog(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.logs, id, message)
  }

  // ---- Issues ----
  listIssues(): Promise<Issue[]> {
    return this.readAll<Issue>(SUBDIR.issues)
  }
  getIssue(id: string): Promise<Issue | null> {
    return this.readOne<Issue>(SUBDIR.issues, id)
  }
  putIssue(issue: Issue, message: string, extraPaths: string[] = []): Promise<void> {
    return this.writeOne(SUBDIR.issues, issue.id, 'Issue', issue, message, extraPaths)
  }
  deleteIssue(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.issues, id, message)
  }

  // ---- Seasons ----
  listSeasons(): Promise<Season[]> {
    return this.readAll<Season>(SUBDIR.seasons)
  }
  getSeason(id: string): Promise<Season | null> {
    return this.readOne<Season>(SUBDIR.seasons, id)
  }
  putSeason(season: Season, message: string): Promise<void> {
    return this.writeOne(SUBDIR.seasons, season.id, 'Season', season, message)
  }
  deleteSeason(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.seasons, id, message)
  }

  // ---- Events ----
  listEvents(): Promise<BoatEvent[]> {
    return this.readAll<BoatEvent>(SUBDIR.events)
  }
  getEvent(id: string): Promise<BoatEvent | null> {
    return this.readOne<BoatEvent>(SUBDIR.events, id)
  }
  putEvent(event: BoatEvent, message: string, extraPaths: string[] = []): Promise<void> {
    return this.writeOne(SUBDIR.events, event.id, 'Event', event, message, extraPaths)
  }
  deleteEvent(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.events, id, message)
  }

  // ---- Checklist templates ----
  listTemplates(): Promise<ChecklistTemplate[]> {
    return this.readAll<ChecklistTemplate>(SUBDIR.templates)
  }
  getTemplate(id: string): Promise<ChecklistTemplate | null> {
    return this.readOne<ChecklistTemplate>(SUBDIR.templates, id)
  }
  putTemplate(template: ChecklistTemplate, message: string): Promise<void> {
    return this.writeOne(SUBDIR.templates, template.id, 'ChecklistTemplate', template, message)
  }
  deleteTemplate(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.templates, id, message)
  }

  // ---- Checklist runs ----
  listRuns(): Promise<ChecklistRun[]> {
    return this.readAll<ChecklistRun>(SUBDIR.runs)
  }
  getRun(id: string): Promise<ChecklistRun | null> {
    return this.readOne<ChecklistRun>(SUBDIR.runs, id)
  }
  putRun(run: ChecklistRun, message: string, extraPaths: string[] = []): Promise<void> {
    return this.writeOne(SUBDIR.runs, run.id, 'ChecklistRun', run, message, extraPaths)
  }
  deleteRun(id: string, message: string): Promise<void> {
    return this.removeOne(SUBDIR.runs, id, message)
  }

  // ---- Generic helpers ----
  private absPath(subdir: string, id: string): string {
    return join(this.root, subdir, `${id}.yml`)
  }
  private relPath(subdir: string, id: string): string {
    return join(subdir, `${id}.yml`)
  }

  private assertId(id: string): void {
    if (!ID_PATTERN.test(id)) {
      throw new ValidationError(`Invalid id "${id}": must match ${ID_PATTERN}`)
    }
  }

  private async readAll<T>(subdir: string): Promise<T[]> {
    const records = await this.collection(subdir)
    return [...records.values()].map((r) => structuredClone(r) as T)
  }

  private async readOne<T>(subdir: string, id: string): Promise<T | null> {
    this.assertId(id)
    const record = (await this.collection(subdir)).get(id)
    return record === undefined ? null : (structuredClone(record) as T)
  }

  private async writeOne<T>(
    subdir: string,
    id: string,
    schemaName: string,
    data: T,
    message: string,
    /** Repo-relative files written alongside the record (photos) to commit with it. */
    extraPaths: string[] = []
  ): Promise<void> {
    this.assertId(id)
    this.validator.validate(schemaName, data)
    const records = await this.collection(subdir)
    await atomicWriteFile(this.absPath(subdir, id), stringify(data))
    records.set(id, structuredClone(data))
    await this.committer.commit([this.relPath(subdir, id), ...extraPaths], message)
  }

  private async removeOne(subdir: string, id: string, message: string): Promise<void> {
    this.assertId(id)
    const records = await this.collection(subdir)
    const path = this.absPath(subdir, id)
    try {
      await fs.rm(path)
    } catch (e) {
      if (isEnoent(e)) throw new NotFoundError(`${subdir}/${id} not found`)
      throw e
    }
    records.delete(id)
    await this.committer.commit([this.relPath(subdir, id)], message)
  }

  /** The collection's records keyed by id, loaded from disk on first use. */
  private collection(subdir: string): Promise<Map<string, unknown>> {
    let loaded = this.cache.get(subdir)
    if (!loaded) {
      loaded = this.load(subdir)
      this.cache.set(subdir, loaded)
      // A failed read is retried on the next request rather than cached.
      loaded.catch(() => this.cache.delete(subdir))
    }
    return loaded
  }

  private async load(subdir: string): Promise<Map<string, unknown>> {
    let names: string[]
    try {
      names = await fs.readdir(join(this.root, subdir))
    } catch (e) {
      if (isEnoent(e)) return new Map()
      throw e
    }
    const files = names.filter((n) => n.endsWith('.yml'))
    const entries = await Promise.all(
      files.map(async (file): Promise<[string, unknown]> => {
        const content = await fs.readFile(join(this.root, subdir, file), 'utf-8')
        return [file.slice(0, -'.yml'.length), parse(content)]
      })
    )
    return new Map(entries)
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
}
