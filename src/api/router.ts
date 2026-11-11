import type { PluginConfig } from '../config'
import { mergeAttachments, parseAttachmentList, parseCaptions, recaption, removeAttachments } from '../domain/attachments'
import { instantiateRun } from '../domain/checklists'
import { mergeIssue } from '../domain/issues'
import { buildSeasonContext, buildTimeline, currentSeason } from '../domain/seasons'
import {
  computeAllDue,
  currentMetricValue,
  normalizeExpiryDate,
  seasonAnchorStartValue,
  WarnLeadDefaults
} from '../domain/triggers'
import type { MetricsProvider } from '../metrics/metricsProvider'
import type { NotificationEvaluator } from '../notifications/evaluator'
import { isMediaId, type PhotoStore, type ResolvedPhotos } from '../photos/PhotoStore'
import { ConflictError, NotFoundError, Store } from '../store/Store'
import { ValidationError } from '../store/validation'
import type {
  ApiHandler,
  ApiRequest,
  ApiResponse,
  Attachment,
  BoatEvent,
  ChecklistRun,
  ChecklistRunResult,
  ChecklistSchedule,
  ChecklistTemplate,
  Issue,
  IssueHistoryEntry,
  MaintenanceNode,
  MetricsSnapshot,
  PluginRouter,
  Season,
  SeasonContext,
  SeasonMilestone,
  ServiceLog,
  Trigger,
  TriggerAnchor
} from '../types'
import { logId, shortId, slugify } from '../util/ids'
import { buildWorkQueue, systemSummaries, todayEpochDay } from '../domain/work'
import { starterNodes } from '../domain/starterBoat'

export interface RouterDeps {
  store: Store
  metrics: MetricsProvider
  evaluator: NotificationEvaluator
  config: PluginConfig
  photos: PhotoStore
  log: { debug: (m: string) => void; error: (m: string) => void }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** An ISO 4217 code, upper-cased; anything else that was sent is a 400. */
function currencyCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw new ValidationError('costCurrency must be a three-letter ISO 4217 code, like EUR')
  }
  return value.trim().toUpperCase()
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function warnDefaults(config: PluginConfig): WarnLeadDefaults {
  return {
    calendarTime: config.notifications.warnLeadDays,
    engineHours: config.notifications.warnLeadHours,
    tripCount: config.notifications.warnLeadTrips,
    expiry: config.notifications.warnLeadExpiryDays
  }
}

function milestoneOf(value: unknown): SeasonMilestone | undefined {
  return value === 'launch' || value === 'haulout' ? value : undefined
}

function normalizeAnchor(raw: unknown): TriggerAnchor | undefined {
  const a = asRecord(raw)
  const milestone = milestoneOf(a.milestone)
  if (!milestone) return undefined
  return { milestone, offsetDays: num(a.offsetDays) ?? 0 }
}

/** Drops entries without a valid milestone; an empty result clears the schedule. */
function normalizeSchedule(raw: unknown[]): ChecklistSchedule[] | undefined {
  const schedule: ChecklistSchedule[] = []
  for (const entry of raw) {
    const e = asRecord(entry)
    const milestone = milestoneOf(e.milestone)
    if (!milestone) continue
    const item: ChecklistSchedule = { milestone }
    const section = str(e.section)
    if (section) item.section = section
    const withinDays = num(e.withinDays)
    if (withinDays !== undefined && withinDays >= 0) item.withinDays = withinDays
    schedule.push(item)
  }
  return schedule.length > 0 ? schedule : undefined
}

function normalizeTrigger(
  raw: unknown,
  metrics: MetricsSnapshot,
  nowIso: string,
  season: SeasonContext
): Trigger {
  const t = asRecord(raw)
  const metric = (str(t.metric) ?? 'calendarTime') as Trigger['metric']
  const anchor = metric === 'seasonAnchor' ? normalizeAnchor(t.anchor) : undefined
  // A season task that has never been done starts at the opening of its
  // current cycle; "now" would count its creation as this season's service.
  const lastServiceValue =
    num(t.lastServiceValue) ??
    (anchor ? seasonAnchorStartValue(anchor, season, metrics.calendarTime) : undefined) ??
    currentMetricValue(metric, metrics) ??
    0
  const trigger: Trigger = {
    id: str(t.id) ?? shortId(),
    name: str(t.name) ?? 'Service',
    metric,
    interval: num(t.interval) ?? 0,
    warnLead: num(t.warnLead),
    lastServiceValue,
    lastServiceDate: str(t.lastServiceDate) ?? nowIso,
    enabled: typeof t.enabled === 'boolean' ? t.enabled : true
  }
  const snoozedUntil = str(t.snoozedUntil)
  if (snoozedUntil) trigger.snoozedUntil = snoozedUntil
  if (anchor) trigger.anchor = anchor
  if (metric === 'expiry') {
    const expiresOn = normalizeExpiryDate(t.expiresOn)
    if (expiresOn) trigger.expiresOn = expiresOn
  }
  return trigger
}

function normalizeNode(
  body: unknown,
  existing: MaintenanceNode | null,
  metrics: MetricsSnapshot,
  now: Date,
  season: SeasonContext
): MaintenanceNode {
  const b = asRecord(body)
  const nowIso = now.toISOString()
  const name = str(b.name) ?? existing?.name ?? 'Unnamed'
  const triggersRaw = Array.isArray(b.triggers) ? b.triggers : []
  return {
    id: str(b.id) ?? existing?.id ?? slugify(name),
    type: (str(b.type) ?? existing?.type ?? 'part') as MaintenanceNode['type'],
    parentId: str(b.parentId) ?? existing?.parentId,
    name,
    manufacturer: str(b.manufacturer) ?? existing?.manufacturer,
    model: str(b.model) ?? existing?.model,
    serial: str(b.serial) ?? existing?.serial,
    notes: str(b.notes) ?? existing?.notes,
    triggers: triggersRaw.map((t) => normalizeTrigger(t, metrics, nowIso, season)),
    createdAt: existing?.createdAt ?? str(b.createdAt) ?? nowIso,
    updatedAt: nowIso
  }
}

/** The listed keys of `r` that are present, for carrying them onto a normalized copy. */
function pick(r: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]))
}

function snapshotToMetrics(snapshot: MetricsSnapshot): ServiceLog['metrics'] {
  const metrics: NonNullable<ServiceLog['metrics']> = { calendarTime: snapshot.calendarTime }
  if (snapshot.engineHours !== undefined) metrics.engineHours = snapshot.engineHours
  if (snapshot.tripCount !== undefined) metrics.tripCount = snapshot.tripCount
  return metrics
}

/**
 * Guards referential integrity on write: rejects a record whose `nodeId` /
 * `parentId` points at a node that doesn't exist. A missing/empty ref is
 * allowed (the field is optional); only a non-empty, unresolvable ref is a 400.
 */
async function assertNodeRef(
  store: Store,
  nodeId: string | undefined,
  field = 'nodeId'
): Promise<void> {
  if (!nodeId) return
  if (!(await store.getNode(nodeId))) {
    throw new ValidationError(`${field} '${nodeId}' does not match any existing node`)
  }
}

export interface CollectedRoute {
  method: 'get' | 'post' | 'put' | 'delete'
  path: string
  handler: ApiHandler
}

/**
 * The route table `registerRoutes` builds for `deps`, in registration order. The order
 * and paths never depend on `deps`, so two tables line up index for index.
 */
export function collectRoutes(deps: RouterDeps): CollectedRoute[] {
  const routes: CollectedRoute[] = []
  const add =
    (method: CollectedRoute['method']) =>
    (path: string, handler: ApiHandler): void => {
      routes.push({ method, path, handler })
    }
  registerRoutes({ get: add('get'), post: add('post'), put: add('put'), delete: add('delete') }, deps)
  return routes
}

/** `base`, or `base-2`, `base-3`… when that id is taken. */
async function freeNodeId(store: Store, base: string): Promise<string> {
  const taken = new Set((await store.listNodes()).map((n) => n.id))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Every node under `id`, children after their own children, so deleting in order never orphans one. */
function descendantsDeepestFirst(nodes: MaintenanceNode[], id: string): MaintenanceNode[] {
  const children = new Map<string, MaintenanceNode[]>()
  for (const n of nodes) {
    if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n])
  }
  const out: MaintenanceNode[] = []
  const seen = new Set([id])
  const visit = (parent: string): void => {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      visit(child.id)
      out.push(child)
    }
  }
  visit(id)
  return out
}

/** Registers all maintenance REST routes onto the plugin's Express router. */
export function registerRoutes(router: PluginRouter, deps: RouterDeps): void {
  const { store, metrics, evaluator, config, photos, log } = deps

  const handleError = (e: unknown, res: ApiResponse): void => {
    if (e instanceof NotFoundError) {
      res.sendStatus(404)
      return
    }
    if (e instanceof ValidationError) {
      res.status(400).json({ message: e.message })
      return
    }
    if (e instanceof ConflictError) {
      res.status(409).json({ ...e.details, message: e.message })
      return
    }
    const message = e instanceof Error ? e.message : String(e)
    log.error(message)
    res.status(500).json({ message })
  }

  const wrap =
    (fn: ApiHandler): ApiHandler =>
    (req, res) =>
      Promise.resolve(fn(req, res)).catch((e) => handleError(e, res))

  // ---- Photo plumbing shared by the record writes ----
  // A write body may carry `photos: [{handle, caption?}]` (new photos from the
  // panel) and/or `attachments` (a full replacement of what is there, to drop a
  // photo or fix a caption). Resolve after the cheap checks: resolving copies
  // the image into media/, which the record's commit then picks up.

  /** The record's list after an `attachments` replacement, if the body has one. */
  const replacedAttachments = async (
    b: Record<string, unknown>,
    existing: Attachment[] | undefined,
    nowIso: string
  ): Promise<Attachment[] | undefined> => {
    if (!('attachments' in b)) return existing
    if (b.attachments === null) return undefined
    const list = parseAttachmentList(b.attachments, nowIso)
    for (const a of list) {
      if (!(await photos.mediaExists(a.id))) {
        throw new ValidationError(`No photo ${a.id} in the repo; add new photos as handles in \`photos\`.`)
      }
      // Keep what the server knows about the photo; the client sends id and caption.
      const known = existing?.find((x) => x.id === a.id)
      if (known) Object.assign(a, { ...known, caption: a.caption })
    }
    return list.length ? list : undefined
  }

  const markLinked = async (resolved: ResolvedPhotos, target: string): Promise<void> => {
    if (resolved.handles.length) await photos.markLinked(resolved.handles, target)
  }

  /**
   * Checklist results with their photos: `photos` on a result become its
   * attachments; a result sent without `attachments` keeps the ones it had,
   * so a client that doesn't know about photos can't drop them.
   */
  const resultsWithPhotos = async (
    rawResults: unknown[],
    existing: ChecklistRunResult[],
    nowIso: string
  ): Promise<{ results: ChecklistRunResult[]; resolved: ResolvedPhotos }> => {
    const all: ResolvedPhotos = { attachments: [], mediaPaths: [], handles: [] }
    const results: ChecklistRunResult[] = []
    for (const raw of rawResults) {
      const r = asRecord(raw)
      const { photos: refs, ...rest } = r
      const result = { ...rest } as unknown as ChecklistRunResult
      const before = existing.find((x) => x.itemId === result.itemId)?.attachments
      const base = await replacedAttachments(r, before, nowIso)
      const resolved = await photos.resolve(refs)
      const attachments = mergeAttachments(base, resolved.attachments)
      if (attachments) result.attachments = attachments
      else delete result.attachments
      all.mediaPaths.push(...resolved.mediaPaths.filter((p) => !all.mediaPaths.includes(p)))
      all.handles.push(...resolved.handles)
      results.push(result)
    }
    return { results, resolved: all }
  }

  // ---- Photos ----
  // Pending uploads from the photo panel; a write naming a handle moves the
  // photo into the repo (see photos/PhotoStore.ts).
  router.post(
    '/photos/pending',
    wrap(async (req, res) => {
      const b = asRecord(req.body)
      const photo = await photos.putPending({
        contentBase64: str(b.contentBase64) ?? '',
        takenAt: str(b.takenAt),
        note: str(b.note)
      })
      res.status(201).json(photo)
    })
  )

  router.get(
    '/photos/pending',
    wrap(async (req, res) => {
      const includeLinked = req.query.includeLinked === 'true'
      res.json(await photos.listPending({ includeLinked }))
    })
  )

  router.get(
    '/photos/pending/:handle',
    wrap(async (req, res) => {
      const bytes = await photos.readHandleBytes(req.params.handle)
      if (!bytes) {
        res.sendStatus(404)
        return
      }
      // A handle always names the same photo; it only expires.
      res.set?.('Cache-Control', 'private, max-age=3600')
      res.contentType('image/jpeg')
      res.send(bytes)
    })
  )

  router.delete(
    '/photos/pending/:handle',
    wrap(async (req, res) => {
      const { discarded } = await photos.discard([req.params.handle])
      res.sendStatus(discarded.length ? 204 : 404)
    })
  )

  router.post(
    '/photos/sweep',
    wrap(async (_req, res) => {
      res.json({ expired: await photos.sweep() })
    })
  )

  router.get(
    '/media/:id',
    wrap(async (req, res) => {
      const id = req.params.id
      const bytes = isMediaId(id) ? await photos.readMedia(id) : null
      if (!bytes) {
        res.sendStatus(404)
        return
      }
      // Content-addressed: the bytes behind an id never change.
      res.set?.('Cache-Control', 'public, max-age=31536000, immutable')
      res.contentType('image/jpeg')
      res.send(bytes)
    })
  )

  // Adds photos to (or removes them from) a record that already exists — the
  // only way to put a photo on a service log, which has no update route.
  router.post(
    '/attachments',
    wrap(async (req, res) => {
      const b = asRecord(req.body)
      const kind = str(b.kind)
      const id = str(b.id)
      if (!kind || !id) {
        res.status(400).json({ message: 'kind and id are required' })
        return
      }
      const remove = new Set(
        Array.isArray(b.remove) ? (b.remove.filter((x) => typeof x === 'string') as string[]) : []
      )
      const refs = b.photos
      const captions = parseCaptions(b.captions)
      if (!remove.size && !captions.size && !(Array.isArray(refs) && refs.length)) {
        res.status(400).json({ message: 'photos, remove or captions is required' })
        return
      }
      const nowIso = new Date().toISOString()
      const target = `${kind}:${id}`
      const update = (list: Attachment[] | undefined, add: Attachment[]) =>
        mergeAttachments(recaption(removeAttachments(list, remove), captions), add)

      if (kind === 'node' || kind === 'log' || kind === 'issue' || kind === 'event') {
        const record =
          kind === 'node'
            ? await store.getNode(id)
            : kind === 'log'
              ? await store.getLog(id)
              : kind === 'issue'
                ? await store.getIssue(id)
                : await store.getEvent(id)
        if (!record) {
          res.sendStatus(404)
          return
        }
        const resolved = await photos.resolve(refs)
        record.attachments = update(record.attachments, resolved.attachments)
        const message = `Photos on ${kind} ${id}`
        if ('updatedAt' in record) record.updatedAt = nowIso
        if (kind === 'issue') {
          const issue = record as Issue
          // Removing or recaptioning a photo on an issue does the same on its updates.
          if (remove.size || captions.size) {
            issue.history = (issue.history ?? []).map((h) => {
              const kept = recaption(removeAttachments(h.attachments, remove), captions)
              const entry = { ...h }
              if (kept) entry.attachments = kept
              else delete entry.attachments
              return entry
            })
          }
          await store.putIssue(issue, message, resolved.mediaPaths)
        } else if (kind === 'node') {
          await store.putNode(record as MaintenanceNode, message, resolved.mediaPaths)
        } else if (kind === 'log') {
          await store.putLog(record as ServiceLog, message, resolved.mediaPaths)
        } else {
          await store.putEvent(record as BoatEvent, message, resolved.mediaPaths)
        }
        await markLinked(resolved, target)
        res.json(record)
        return
      }

      if (kind === 'run') {
        const run = await store.getRun(id)
        if (!run) {
          res.sendStatus(404)
          return
        }
        const itemId = str(b.itemId)
        const result = run.results.find((r) => r.itemId === itemId)
        if (!result) {
          res.status(400).json({ message: 'itemId must name a result in this run' })
          return
        }
        const resolved = await photos.resolve(refs)
        const attachments = update(result.attachments, resolved.attachments)
        if (attachments) result.attachments = attachments
        else delete result.attachments
        await store.putRun(run, `Photos on checklist run ${id}`, resolved.mediaPaths)
        await markLinked(resolved, target)
        res.json(run)
        return
      }

      res.status(400).json({ message: "kind must be 'node', 'log', 'issue', 'event' or 'run'" })
    })
  )

  // ---- Nodes ----
  router.get(
    '/nodes',
    wrap(async (_req, res) => {
      res.json(await store.listNodes())
    })
  )

  router.post(
    '/nodes',
    wrap(async (req, res) => {
      const now = new Date()
      const season = buildSeasonContext(await store.listSeasons())
      const b = asRecord(req.body)
      const node = normalizeNode(b, null, metrics.snapshot(now), now, season)
      if (str(b.id)) {
        // An id the client chose must not silently replace another node.
        if (await store.getNode(node.id)) {
          throw new ConflictError(`A node with id '${node.id}' already exists; update it with PUT.`, { id: node.id })
        }
      } else {
        // An id made from the name: two parts called "Impeller" get impeller and impeller-2.
        node.id = await freeNodeId(store, node.id)
      }
      await assertNodeRef(store, node.parentId, 'parentId')
      const resolved = await photos.resolve(b.photos)
      node.attachments = mergeAttachments(
        await replacedAttachments(b, undefined, node.updatedAt),
        resolved.attachments
      )
      await store.putNode(node, `Create node ${node.id}`, resolved.mediaPaths)
      await markLinked(resolved, `node:${node.id}`)
      void evaluator.evaluateAll()
      res.status(201).json(node)
    })
  )

  // ---- Starter boat ----
  // The suggested tree (GET) and creating it (POST): every node not already there, by
  // id, so running it twice adds nothing. `lang` picks English or Swedish names.
  router.get(
    '/starter-boat',
    wrap(async (req, res) => {
      res.json(starterNodes(req.query.lang === 'sv' ? 'sv' : 'en'))
    })
  )

  router.post(
    '/starter-boat',
    wrap(async (req, res) => {
      const b = asRecord(req.body)
      const lang = b.lang === 'sv' || req.query.lang === 'sv' ? 'sv' : 'en'
      const now = new Date()
      const season = buildSeasonContext(await store.listSeasons())
      const snapshot = metrics.snapshot(now)
      const existing = new Set((await store.listNodes()).map((n) => n.id))
      const created: string[] = []
      for (const body of starterNodes(lang)) {
        if (existing.has(body.id)) continue
        const node = normalizeNode(body, null, snapshot, now, season)
        await store.putNode(node, `Starter boat: ${node.name}`)
        created.push(node.id)
      }
      void evaluator.evaluateAll()
      res.status(created.length ? 201 : 200).json({ created: created.length, skipped: starterNodes(lang).length - created.length, ids: created })
    })
  )

  router.get(
    '/nodes/:id',
    wrap(async (req, res) => {
      const node = await store.getNode(req.params.id)
      if (!node) {
        res.sendStatus(404)
        return
      }
      res.json(node)
    })
  )

  router.put(
    '/nodes/:id',
    wrap(async (req, res) => {
      const existing = await store.getNode(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const now = new Date()
      const body: Record<string, unknown> = { ...asRecord(req.body), id: req.params.id }
      const season = buildSeasonContext(await store.listSeasons())
      const node = normalizeNode(body, existing, metrics.snapshot(now), now, season)
      await assertNodeRef(store, node.parentId, 'parentId')
      const resolved = await photos.resolve(body.photos)
      node.attachments = mergeAttachments(
        await replacedAttachments(body, existing.attachments, node.updatedAt),
        resolved.attachments
      )
      await store.putNode(node, `Update node ${node.id}`, resolved.mediaPaths)
      await markLinked(resolved, `node:${node.id}`)
      void evaluator.evaluateAll()
      res.json(node)
    })
  )

  // A node with children is only deleted with ?recursive=true, which removes the
  // whole subtree, deepest first. Service logs, issues and events that point at a
  // deleted node stay: they are the boat's history.
  router.delete(
    '/nodes/:id',
    wrap(async (req, res) => {
      const id = req.params.id
      const nodes = await store.listNodes()
      if (!nodes.some((n) => n.id === id)) {
        res.sendStatus(404)
        return
      }
      const subtree = descendantsDeepestFirst(nodes, id)
      if (subtree.length && req.query.recursive !== 'true') {
        throw new ConflictError(
          `This node has ${subtree.length} node(s) under it. Delete with ?recursive=true to remove them too.`,
          { descendants: subtree.map((n) => ({ id: n.id, name: n.name, type: n.type })) }
        )
      }
      for (const child of subtree) await store.deleteNode(child.id, `Delete node ${child.id} (under ${id})`)
      await store.deleteNode(id, `Delete node ${id}`)
      void evaluator.evaluateAll()
      res.sendStatus(204)
    })
  )

  router.get(
    '/nodes/:id/logs',
    wrap(async (req, res) => {
      const logs = await store.listLogs()
      res.json(
        logs
          .filter((l) => l.nodeId === req.params.id)
          .sort((a, b) => b.datetime.localeCompare(a.datetime))
      )
    })
  )

  // ---- Service action ----
  router.post(
    '/nodes/:id/service',
    wrap(async (req, res) => {
      const node = await store.getNode(req.params.id)
      if (!node) {
        res.sendStatus(404)
        return
      }
      const body = asRecord(req.body)
      const description = str(body.description)
      if (!description) {
        res.status(400).json({ message: 'description is required' })
        return
      }
      // An expiry trigger renews only with the replacement's printed date: a
      // routine check of the extinguisher must not wipe the date it expires on.
      const expiresOn = normalizeExpiryDate(body.expiresOn)
      if (body.expiresOn != null && !expiresOn) {
        res.status(400).json({ message: 'expiresOn must be a date (YYYY-MM-DD or YYYY-MM)' })
        return
      }
      const now = body.datetime ? new Date(str(body.datetime) as string) : new Date()
      const nowIso = now.toISOString()
      const snapshot = metrics.snapshot(now)
      const isExpiry = (id: string) => node.triggers.some((t) => t.id === id && t.metric === 'expiry')
      const requested = Array.isArray(body.triggerIds)
        ? (body.triggerIds.filter((x) => typeof x === 'string') as string[])
        : node.triggers
            .filter((t) => t.enabled && (t.metric !== 'expiry' || expiresOn))
            .map((t) => t.id)
      if (!expiresOn && requested.some(isExpiry)) {
        res.status(400).json({
          message: 'expiresOn is required to renew an expiry trigger: the date on the replacement'
        })
        return
      }
      const requestedSet = new Set(requested)

      node.triggers = node.triggers.map((t) => {
        if (!requestedSet.has(t.id)) return t
        const renewed: Trigger = {
          ...t,
          lastServiceValue: currentMetricValue(t.metric, snapshot) ?? t.lastServiceValue,
          lastServiceDate: nowIso
        }
        if (t.metric === 'expiry' && expiresOn) renewed.expiresOn = expiresOn
        return renewed
      })
      node.updatedAt = nowIso

      const serviceLog: ServiceLog = {
        id: logId(now, slugify(node.name)),
        datetime: nowIso,
        nodeId: node.id,
        triggerIds: requested,
        description,
        comment: str(body.comment),
        metrics: snapshotToMetrics(snapshot),
        partsReplaced: Array.isArray(body.partsReplaced)
          ? (body.partsReplaced.filter((x) => typeof x === 'string') as string[])
          : undefined,
        expiresOn: requested.some(isExpiry) ? expiresOn : undefined,
        cost: num(body.cost),
        costCurrency: currencyCode(body.costCurrency),
        author: str(body.author)
      }
      const resolved = await photos.resolve(body.photos)
      if (resolved.attachments.length) serviceLog.attachments = resolved.attachments

      await store.putLog(serviceLog, `Service ${node.id}: ${description}`, resolved.mediaPaths)
      await markLinked(resolved, `log:${serviceLog.id}`)
      await store.putNode(node, `Reset triggers for ${node.id}`)
      void evaluator.evaluateAll()
      res.status(201).json(serviceLog)
    })
  )

  // ---- Snooze a trigger's notification ----
  router.post(
    '/nodes/:id/triggers/:triggerId/snooze',
    wrap(async (req, res) => {
      const node = await store.getNode(req.params.id)
      if (!node) {
        res.sendStatus(404)
        return
      }
      const trigger = node.triggers.find((t) => t.id === req.params.triggerId)
      if (!trigger) {
        res.sendStatus(404)
        return
      }
      const body = asRecord(req.body)
      const now = new Date()
      // Accept either an explicit `until` ISO date-time or a `days` duration.
      let untilIso = str(body.until)
      if (!untilIso) {
        const days = num(body.days)
        if (days === undefined || days <= 0) {
          res.status(400).json({ message: 'until (ISO) or days (> 0) is required' })
          return
        }
        untilIso = new Date(now.getTime() + days * 86_400_000).toISOString()
      } else if (Number.isNaN(Date.parse(untilIso))) {
        res.status(400).json({ message: 'until must be a valid ISO date-time' })
        return
      }
      trigger.snoozedUntil = untilIso
      node.updatedAt = now.toISOString()
      await store.putNode(node, `Snooze ${node.id}/${trigger.id} until ${untilIso}`)
      void evaluator.evaluateAll()
      res.json(trigger)
    })
  )

  router.delete(
    '/nodes/:id/triggers/:triggerId/snooze',
    wrap(async (req, res) => {
      const node = await store.getNode(req.params.id)
      if (!node) {
        res.sendStatus(404)
        return
      }
      const trigger = node.triggers.find((t) => t.id === req.params.triggerId)
      if (!trigger) {
        res.sendStatus(404)
        return
      }
      delete trigger.snoozedUntil
      node.updatedAt = new Date().toISOString()
      await store.putNode(node, `Clear snooze ${node.id}/${trigger.id}`)
      void evaluator.evaluateAll()
      res.json(trigger)
    })
  )

  // ---- Due rollup ----
  router.get(
    '/due',
    wrap(async (_req, res) => {
      const [nodes, seasons, issues] = await Promise.all([
        store.listNodes(),
        store.listSeasons(),
        store.listIssues()
      ])
      const season = buildSeasonContext(seasons)
      res.json(computeAllDue(nodes, metrics.snapshot(), warnDefaults(config), season, issues))
    })
  )

  // The work queue every client shows: jobs this week, overdue, snoozed and before
  // the next milestone, issues, checklist suggestions and runs, and a summary per
  // system. Days are UTC epoch days (see domain/work.ts).
  router.get(
    '/work',
    wrap(async (_req, res) => {
      const now = new Date()
      const [nodes, seasons, issues, templates, runs] = await Promise.all([
        store.listNodes(),
        store.listSeasons(),
        store.listIssues(),
        store.listTemplates(),
        store.listRuns()
      ])
      const snapshot = metrics.snapshot(now)
      const due = computeAllDue(nodes, snapshot, warnDefaults(config), buildSeasonContext(seasons), issues)
      const queue = buildWorkQueue(due, issues, templates, runs, seasons, todayEpochDay(now))
      res.json({
        ...queue,
        systems: systemSummaries(nodes, due, queue),
        // Current readings, so a client can show "now 1234 h" and prefill a service.
        metrics: { engineHours: snapshot.engineHours, tripCount: snapshot.tripCount }
      })
    })
  )

  // ---- Logs ----
  router.get(
    '/logs',
    wrap(async (req, res) => {
      const logs = await store.listLogs()
      const since = typeof req.query.since === 'string' ? req.query.since : undefined
      const filtered = since ? logs.filter((l) => l.datetime >= since) : logs
      res.json(filtered.sort((a, b) => b.datetime.localeCompare(a.datetime)))
    })
  )

  router.get(
    '/logs/:id',
    wrap(async (req, res) => {
      const entry = await store.getLog(req.params.id)
      if (!entry) {
        res.sendStatus(404)
        return
      }
      res.json(entry)
    })
  )

  router.delete(
    '/logs/:id',
    wrap(async (req, res) => {
      await store.deleteLog(req.params.id, `Delete service log ${req.params.id}`)
      res.sendStatus(204)
    })
  )

  // ---- Issues ----
  router.get(
    '/issues',
    wrap(async (_req, res) => {
      res.json(await store.listIssues())
    })
  )

  router.post(
    '/issues',
    wrap(async (req, res) => {
      const now = new Date()
      const b = asRecord(req.body)
      const title = str(b.title)
      if (!title) {
        res.status(400).json({ message: 'title is required' })
        return
      }
      await assertNodeRef(store, str(b.nodeId))
      const issue: Issue = mergeIssue(
        null,
        {
          id: str(b.id) ?? `${slugify(title)}-${shortId()}`,
          nodeId: str(b.nodeId) ?? '',
          title,
          description: str(b.description),
          status: (str(b.status) ?? 'open') as Issue['status'],
          severity: str(b.severity) as Issue['severity'] | undefined,
          openedAt: str(b.openedAt) ?? now.toISOString(),
          resolutionLogId: str(b.resolutionLogId),
          fixBy: milestoneOf(b.fixBy),
          updatedAt: now.toISOString(),
          history: []
        },
        now,
        { comment: str(b.comment), author: str(b.author) }
      )
      const resolved = await photos.resolve(b.photos)
      issue.attachments = mergeAttachments(
        await replacedAttachments(b, undefined, issue.updatedAt),
        resolved.attachments
      )
      await store.putIssue(issue, `Create issue ${issue.id}`, resolved.mediaPaths)
      await markLinked(resolved, `issue:${issue.id}`)
      res.status(201).json(issue)
    })
  )

  router.get(
    '/issues/:id',
    wrap(async (req, res) => {
      const issue = await store.getIssue(req.params.id)
      if (!issue) {
        res.sendStatus(404)
        return
      }
      res.json(issue)
    })
  )

  router.put(
    '/issues/:id',
    wrap(async (req, res) => {
      const existing = await store.getIssue(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const now = new Date()
      const b = asRecord(req.body)
      const incoming: Issue = {
        ...existing,
        nodeId: str(b.nodeId) ?? existing.nodeId,
        title: str(b.title) ?? existing.title,
        description: 'description' in b ? str(b.description) : existing.description,
        status: (str(b.status) ?? existing.status) as Issue['status'],
        severity: 'severity' in b ? (str(b.severity) as Issue['severity']) : existing.severity,
        resolutionLogId:
          'resolutionLogId' in b ? str(b.resolutionLogId) : existing.resolutionLogId,
        fixBy: 'fixBy' in b ? milestoneOf(b.fixBy) : existing.fixBy,
        id: req.params.id
      }
      await assertNodeRef(store, incoming.nodeId)
      incoming.attachments = await replacedAttachments(b, existing.attachments, now.toISOString())
      const issue = mergeIssue(existing, incoming, now, {
        comment: str(b.comment),
        author: str(b.author)
      })
      // Photos sent with an update belong to that update ("the crack has grown"),
      // so they go on the history entry it appended — or on a new comment entry
      // when the update changed nothing else.
      const resolved = await photos.resolve(b.photos)
      if (resolved.attachments.length) {
        const appended = issue.history.length > (existing.history?.length ?? 0)
        if (appended) {
          const entry = issue.history[issue.history.length - 1]
          entry.attachments = mergeAttachments(entry.attachments, resolved.attachments)
        } else {
          const entry: IssueHistoryEntry = {
            datetime: issue.updatedAt,
            type: 'comment',
            attachments: resolved.attachments
          }
          const author = str(b.author)?.trim()
          if (author) entry.author = author
          issue.history.push(entry)
        }
      }
      await store.putIssue(issue, `Update issue ${issue.id}`, resolved.mediaPaths)
      await markLinked(resolved, `issue:${issue.id}`)
      res.json(issue)
    })
  )

  router.delete(
    '/issues/:id',
    wrap(async (req, res) => {
      await store.deleteIssue(req.params.id, `Delete issue ${req.params.id}`)
      res.sendStatus(204)
    })
  )

  // ---- Seasons ----
  router.get(
    '/seasons',
    wrap(async (_req, res) => {
      const seasons = await store.listSeasons()
      res.json(seasons.sort((a, b) => (b.launchDate ?? '').localeCompare(a.launchDate ?? '')))
    })
  )

  router.get(
    '/seasons/current',
    wrap(async (_req, res) => {
      const seasons = await store.listSeasons()
      const season = currentSeason(seasons)
      if (!season) {
        res.json({ afloat: false, season: null })
        return
      }
      res.json({ afloat: true, season })
    })
  )

  router.post(
    '/seasons',
    wrap(async (req, res) => {
      const now = new Date()
      const season = normalizeSeason(req.body, null, now)
      await store.putSeason(season, `Create season ${season.id}`)
      void evaluator.evaluateAll()
      res.status(201).json(season)
    })
  )

  router.get(
    '/seasons/:id',
    wrap(async (req, res) => {
      const season = await store.getSeason(req.params.id)
      if (!season) {
        res.sendStatus(404)
        return
      }
      res.json(season)
    })
  )

  router.put(
    '/seasons/:id',
    wrap(async (req, res) => {
      const existing = await store.getSeason(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const now = new Date()
      const body: Record<string, unknown> = { ...asRecord(req.body), id: req.params.id }
      const season = normalizeSeason(body, existing, now)
      await store.putSeason(season, `Update season ${season.id}`)
      void evaluator.evaluateAll()
      res.json(season)
    })
  )

  router.delete(
    '/seasons/:id',
    wrap(async (req, res) => {
      await store.deleteSeason(req.params.id, `Delete season ${req.params.id}`)
      void evaluator.evaluateAll()
      res.sendStatus(204)
    })
  )

  // ---- Events ----
  router.get(
    '/events',
    wrap(async (req, res) => {
      const events = await store.listEvents()
      const since = typeof req.query.since === 'string' ? req.query.since : undefined
      const category = typeof req.query.category === 'string' ? req.query.category : undefined
      const filtered = events.filter(
        (e) => (!since || e.datetime >= since) && (!category || e.category === category)
      )
      res.json(filtered.sort((a, b) => b.datetime.localeCompare(a.datetime)))
    })
  )

  router.post(
    '/events',
    wrap(async (req, res) => {
      const b = asRecord(req.body)
      const title = str(b.title)
      if (!title) {
        res.status(400).json({ message: 'title is required' })
        return
      }
      const event = normalizeEvent(req.body, null, new Date())
      await assertNodeRef(store, event.nodeId)
      const resolved = await photos.resolve(b.photos)
      event.attachments = mergeAttachments(
        await replacedAttachments(b, undefined, event.updatedAt),
        resolved.attachments
      )
      await store.putEvent(event, `Create event ${event.id}`, resolved.mediaPaths)
      await markLinked(resolved, `event:${event.id}`)
      res.status(201).json(event)
    })
  )

  router.get(
    '/events/:id',
    wrap(async (req, res) => {
      const event = await store.getEvent(req.params.id)
      if (!event) {
        res.sendStatus(404)
        return
      }
      res.json(event)
    })
  )

  router.put(
    '/events/:id',
    wrap(async (req, res) => {
      const existing = await store.getEvent(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const body: Record<string, unknown> = { ...asRecord(req.body), id: req.params.id }
      const event = normalizeEvent(body, existing, new Date())
      await assertNodeRef(store, event.nodeId)
      const resolved = await photos.resolve(body.photos)
      event.attachments = mergeAttachments(
        await replacedAttachments(body, existing.attachments, event.updatedAt),
        resolved.attachments
      )
      await store.putEvent(event, `Update event ${event.id}`, resolved.mediaPaths)
      await markLinked(resolved, `event:${event.id}`)
      res.json(event)
    })
  )

  router.delete(
    '/events/:id',
    wrap(async (req, res) => {
      await store.deleteEvent(req.params.id, `Delete event ${req.params.id}`)
      res.sendStatus(204)
    })
  )

  // ---- Timeline (merged read model) ----
  router.get(
    '/timeline',
    wrap(async (req, res) => {
      const [logs, events, seasons, runs, issues] = await Promise.all([
        store.listLogs(),
        store.listEvents(),
        store.listSeasons(),
        store.listRuns(),
        store.listIssues()
      ])
      const since = typeof req.query.since === 'string' ? req.query.since : undefined
      res.json(buildTimeline(logs, events, seasons, runs, issues, since))
    })
  )

  // ---- Checklist templates ----
  router.get(
    '/checklists/templates',
    wrap(async (_req, res) => {
      res.json(await store.listTemplates())
    })
  )

  router.post(
    '/checklists/templates',
    wrap(async (req, res) => {
      const now = new Date()
      const template = normalizeTemplate(req.body, null, now)
      await store.putTemplate(template, `Create checklist template ${template.id}`)
      res.status(201).json(template)
    })
  )

  router.get(
    '/checklists/templates/:id',
    wrap(async (req, res) => {
      const template = await store.getTemplate(req.params.id)
      if (!template) {
        res.sendStatus(404)
        return
      }
      res.json(template)
    })
  )

  router.put(
    '/checklists/templates/:id',
    wrap(async (req, res) => {
      const existing = await store.getTemplate(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const now = new Date()
      const body: Record<string, unknown> = { ...asRecord(req.body), id: req.params.id }
      const template = normalizeTemplate(body, existing, now)
      await store.putTemplate(template, `Update checklist template ${template.id}`)
      res.json(template)
    })
  )

  router.delete(
    '/checklists/templates/:id',
    wrap(async (req, res) => {
      await store.deleteTemplate(req.params.id, `Delete checklist template ${req.params.id}`)
      res.sendStatus(204)
    })
  )

  // ---- Checklist runs ----
  router.get(
    '/checklists/runs',
    wrap(async (_req, res) => {
      res.json(await store.listRuns())
    })
  )

  router.post(
    '/checklists/runs',
    wrap(async (req, res) => {
      const b = asRecord(req.body)
      const templateId = str(b.templateId)
      if (!templateId) {
        res.status(400).json({ message: 'templateId is required' })
        return
      }
      const template = await store.getTemplate(templateId)
      if (!template) {
        res.sendStatus(404)
        return
      }
      // A body carrying `results` is a fully-recorded run the client built
      // locally and is saving for the first time (so an opened-but-discarded
      // run never reaches the store); a bare `templateId` instantiates a fresh
      // run server-side for API/back-compat callers.
      const now = new Date()
      const run = Array.isArray(b.results)
        ? normalizeRun(b, template, now)
        : instantiateRun(template, str(b.author), now)
      let resolved: ResolvedPhotos = { attachments: [], mediaPaths: [], handles: [] }
      if (Array.isArray(b.results)) {
        // normalizeRun has already shaped each result; carry each one's photos across.
        const raw = b.results.map((r, i) => ({ ...run.results[i], ...pick(asRecord(r), 'photos', 'attachments') }))
        const out = await resultsWithPhotos(raw, [], now.toISOString())
        run.results = out.results
        resolved = out.resolved
      }
      await store.putRun(run, `Save checklist run ${run.id}`, resolved.mediaPaths)
      await markLinked(resolved, `run:${run.id}`)
      res.status(201).json(run)
    })
  )

  router.get(
    '/checklists/runs/:id',
    wrap(async (req, res) => {
      const run = await store.getRun(req.params.id)
      if (!run) {
        res.sendStatus(404)
        return
      }
      res.json(run)
    })
  )

  router.put(
    '/checklists/runs/:id',
    wrap(async (req, res) => {
      const existing = await store.getRun(req.params.id)
      if (!existing) {
        res.sendStatus(404)
        return
      }
      const b = asRecord(req.body)
      const run = { ...existing, ...b, id: req.params.id } as ChecklistRun
      let resolved: ResolvedPhotos = { attachments: [], mediaPaths: [], handles: [] }
      if (Array.isArray(b.results)) {
        const out = await resultsWithPhotos(b.results, existing.results, new Date().toISOString())
        run.results = out.results
        resolved = out.resolved
      }
      await store.putRun(run, `Update checklist run ${run.id}`, resolved.mediaPaths)
      await markLinked(resolved, `run:${run.id}`)
      res.json(run)
    })
  )

  router.delete(
    '/checklists/runs/:id',
    wrap(async (req, res) => {
      await store.deleteRun(req.params.id, `Delete checklist run ${req.params.id}`)
      res.sendStatus(204)
    })
  )
}

function normalizeSeason(body: unknown, existing: Season | null, now: Date): Season {
  const b = asRecord(body)
  const nowIso = now.toISOString()
  const label = str(b.label) ?? existing?.label
  const fallbackId = label ? slugify(label) : `season-${shortId()}`
  return {
    id: str(b.id) ?? existing?.id ?? fallbackId,
    label,
    launchDate: str(b.launchDate) ?? existing?.launchDate,
    hauloutDate: str(b.hauloutDate) ?? existing?.hauloutDate,
    notes: str(b.notes) ?? existing?.notes,
    createdAt: existing?.createdAt ?? str(b.createdAt) ?? nowIso,
    updatedAt: nowIso
  }
}

function normalizeEvent(body: unknown, existing: BoatEvent | null, now: Date): BoatEvent {
  const b = asRecord(body)
  const nowIso = now.toISOString()
  const title = str(b.title) ?? existing?.title ?? 'Event'
  const datetime = str(b.datetime) ?? existing?.datetime ?? nowIso
  return {
    id: str(b.id) ?? existing?.id ?? logId(new Date(datetime), slugify(title)),
    datetime,
    category: str(b.category) ?? existing?.category ?? 'note',
    title,
    description: str(b.description) ?? existing?.description,
    nodeId: str(b.nodeId) ?? existing?.nodeId,
    location: str(b.location) ?? existing?.location,
    createdAt: existing?.createdAt ?? str(b.createdAt) ?? nowIso,
    updatedAt: nowIso
  }
}

function normalizeRun(body: unknown, template: ChecklistTemplate, now: Date): ChecklistRun {
  const b = asRecord(body)
  const nowIso = now.toISOString()
  const resultsRaw = Array.isArray(b.results) ? b.results : []
  const run: ChecklistRun = {
    id: str(b.id) ?? logId(now, slugify(template.name)),
    templateId: template.id,
    name: str(b.name) ?? template.name,
    section: str(b.section),
    startedAt: str(b.startedAt) ?? nowIso,
    results: resultsRaw.map((raw) => {
      const r = asRecord(raw)
      const result: ChecklistRunResult = {
        itemId: str(r.itemId) ?? shortId(),
        text: str(r.text) ?? '',
        status: (str(r.status) ?? 'pending') as ChecklistRunResult['status']
      }
      const note = str(r.note)
      if (note) result.note = note
      const timestamp = str(r.timestamp)
      if (timestamp) result.timestamp = timestamp
      return result
    })
  }
  const completedAt = str(b.completedAt)
  if (completedAt) run.completedAt = completedAt
  const author = str(b.author)
  if (author) run.author = author
  return run
}

function normalizeTemplate(
  body: unknown,
  existing: ChecklistTemplate | null,
  now: Date
): ChecklistTemplate {
  const b = asRecord(body)
  const nowIso = now.toISOString()
  const name = str(b.name) ?? existing?.name ?? 'Checklist'
  const itemsRaw = Array.isArray(b.items) ? b.items : existing?.items ?? []
  return {
    id: str(b.id) ?? existing?.id ?? slugify(name),
    name,
    description: str(b.description) ?? existing?.description,
    items: itemsRaw.map((raw) => {
      const item = asRecord(raw)
      return {
        id: str(item.id) ?? shortId(),
        text: str(item.text) ?? '',
        category: str(item.category),
        nodeId: str(item.nodeId)
      }
    }),
    schedule: Array.isArray(b.schedule) ? normalizeSchedule(b.schedule) : existing?.schedule,
    createdAt: existing?.createdAt ?? str(b.createdAt) ?? nowIso,
    updatedAt: nowIso
  }
}
