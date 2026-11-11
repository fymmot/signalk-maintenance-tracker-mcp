/** A delta we emit via `app.handleMessage` (plain, unbranded shape). */
export interface OutgoingDelta {
  context: string
  updates: Array<{
    source?: { label: string }
    timestamp?: string
    values: Array<{ path: string; value: unknown }>
  }>
}

/** The subset of the Signal K server plugin app surface this plugin relies on. */
export interface PluginApp {
  debug: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  /** Plugin-private data directory; the maintenance datastore (a git repo) lives here. */
  getDataDirPath: () => string
  getSelfPath?: (path: string) => unknown
  handleMessage: (id: string, msg: OutgoingDelta) => void
  setPluginStatus?: (msg: string) => void
  setPluginError?: (msg: string) => void
  subscriptionmanager?: {
    subscribe: (
      subscription: unknown,
      unsubscribes: Array<() => void>,
      errorCallback: (err: unknown) => void,
      deltaCallback: (delta: SubscriptionDelta) => void
    ) => void
  }
}

/** Minimal delta shape we read from the subscription manager. */
export interface SubscriptionDelta {
  updates?: Array<{
    values?: Array<{ path: string; value: unknown }>
  }>
}

/** Minimal Express request/response surface used by the router (avoids an express type dep). */
export interface ApiRequest {
  params: Record<string, string>
  query: Record<string, string | string[] | undefined>
  body: unknown
}

export interface ApiResponse {
  status: (code: number) => ApiResponse
  /** Sets a response header (Express `res.set`). */
  set?: (field: string, value: string) => ApiResponse
  json: (body: unknown) => ApiResponse | void
  send: (body?: unknown) => ApiResponse | void
  sendStatus: (code: number) => ApiResponse | void
  contentType: (type: string) => ApiResponse
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>

export interface PluginRouter {
  get: (path: string, handler: ApiHandler) => void
  post: (path: string, handler: ApiHandler) => void
  put: (path: string, handler: ApiHandler) => void
  delete: (path: string, handler: ApiHandler) => void
  /**
   * Signal K 2.x: a registrar whose routes are open to `readonly` or `readwrite` users.
   * Routes registered directly on the router are admin-only.
   */
  access?: (level: 'readonly' | 'readwrite') => Omit<PluginRouter, 'access'>
}

export interface Plugin {
  id: string
  name: string
  description?: string
  schema: object | (() => object)
  uiSchema?: object | (() => object)
  start: (settings: unknown) => void
  stop: () => void | Promise<void>
  registerWithRouter?: (router: PluginRouter) => void
  getOpenApi?: () => object
}

/** What the UI shows about the datastore's history and backup. Never holds credentials. */
export interface GitStatus {
  ready: boolean
  remoteSet: boolean
  pushEnabled: boolean
  lastCommitAt?: string
  lastPushAt?: string
  /** Set when the most recent push failed; cleared by the next successful one. */
  lastPushError?: string
  lastError?: string
}

/** What the MCP server has been doing since it started. Holds no secrets. */
export interface McpRuntimeStatus {
  listening: boolean
  port: number
  startedAt?: string
  /** Requests that passed the token check, i.e. from Claude or another client you set up. */
  requestCount: number
  lastRequestAt?: string
  /** Requests turned away for a missing or wrong token. */
  unauthorizedCount: number
  lastUnauthorizedAt?: string
  /** The listener's last error, such as the port already being in use. */
  lastError?: string
  dnsRebindingProtection: boolean
  allowedHosts: string[]
}

/**
 * `GET /status`: the plugin's health for the web app. Holds no secrets: the MCP
 * token and URL secret are reported only as set or not.
 */
export type McpState = 'off' | 'needsToken' | 'starting' | 'running' | 'error'

export interface PluginStatus {
  version: string
  running: boolean
  git?: GitStatus
  notifications?: { enabled: boolean }
  metrics?: {
    engineHoursPath: string
    tripCountPath?: string
    calendarTime?: number
    engineHours?: number
    tripCount?: number
  }
  mcp?: {
    state: McpState
    enabled: boolean
    port: number
    tokenSet: boolean
    urlSecretSet: boolean
    publicUrl?: string
    allowedHosts: string[]
    runtime?: McpRuntimeStatus
  }
}

/** A photo uploaded but not yet linked to a record (`POST /photos/pending`). */
export interface PendingPhoto {
  handle: string
  /** The attachment id it will have once linked: `<sha256>.jpg`. */
  id: string
  bytes: number
  width: number
  height: number
  takenAt?: string
  note?: string
  createdAt: string
  expiresAt: string
  /** Records this handle has been linked to (`issue:<id>`, …); absent while unused. */
  linkedTo?: string[]
}

// ---- Domain records ----

/**
 * A photo attached to a record. The image lives in the datastore repo at
 * `media/<id>` and is served by `GET /media/:id`; `id` is its SHA-256 plus
 * `.jpg`, so the same photo on two records is one file.
 */
export interface Attachment {
  id: string
  /** A few words on what it shows ("Nameplate", "Crack at the stem fitting"). */
  caption?: string
  /** When the photo was taken, as far as the device said. */
  takenAt?: string
  addedAt: string
  width?: number
  height?: number
}

export type NodeType = 'system' | 'component' | 'part'
export type MetricType = 'calendarTime' | 'engineHours' | 'tripCount' | 'seasonAnchor' | 'expiry'

/** A season boundary a `seasonAnchor` trigger is measured against. */
export type SeasonMilestone = 'launch' | 'haulout'

/**
 * Anchors a `seasonAnchor` trigger to a season milestone. The due date is the
 * milestone shifted by `offsetDays` (negative = before the milestone, e.g.
 * "2 weeks before launch"); a service counts toward it from the opposite
 * milestone before it (see `seasonAnchorDueDay`).
 */
export interface TriggerAnchor {
  milestone: SeasonMilestone
  offsetDays: number
}

export interface Trigger {
  id: string
  name: string
  metric: MetricType
  /**
   * Days for calendarTime, hours for engineHours, trips for tripCount. Ignored
   * for seasonAnchor triggers (their cadence is the season cycle itself) and
   * for expiry triggers (each replacement brings its own printed date).
   */
  interval: number
  /** Anchor config; required for (and only used by) seasonAnchor triggers. */
  anchor?: TriggerAnchor
  /**
   * The last day the item is valid (`YYYY-MM-DD`), as printed on flares, fire
   * extinguishers, life-jacket cartridges and the like — the date to replace it
   * by. Required for (and only used by) `expiry` triggers; due on that day.
   * Absent means the date isn't known yet (→ `unknown`).
   */
  expiresOn?: string
  /** Lead amount (same unit as interval) before due at which to warn. */
  warnLead?: number
  /**
   * Metric value at last service (days-since-epoch for calendarTime,
   * seasonAnchor and expiry; hours for engineHours; trips for tripCount).
   */
  lastServiceValue: number
  lastServiceDate: string
  enabled: boolean
  /**
   * While set to a future ISO date-time, this trigger's `notifications.maintenance.*`
   * alarm is suppressed (the user "snoozed" it). The computed due status is
   * unaffected; only the emitted notification is cleared until this passes.
   */
  snoozedUntil?: string
}

export interface MaintenanceNode {
  id: string
  type: NodeType
  parentId?: string
  name: string
  manufacturer?: string
  model?: string
  serial?: string
  notes?: string
  /** Photos of the thing itself: nameplate, how it is fitted, wiring. */
  attachments?: Attachment[]
  triggers: Trigger[]
  createdAt: string
  updatedAt: string
}

export interface ServiceLog {
  id: string
  datetime: string
  nodeId: string
  triggerIds?: string[]
  description: string
  /** Optional short free-text note (e.g. "using 3M green + blue cap"). */
  comment?: string
  metrics?: Partial<Record<MetricType, number>>
  partsReplaced?: string[]
  /** The new expiry date set on the node's expiry triggers by this service. */
  expiresOn?: string
  /** Cost of the work, in `costCurrency`. */
  cost?: number
  /** ISO 4217 currency code for `cost`; defaults to SEK when omitted. */
  costCurrency?: string
  author?: string
  attachments?: Attachment[]
}

export type IssueStatus = 'open' | 'monitoring' | 'resolved'
export type IssueSeverity = 'low' | 'medium' | 'high'

export type IssueHistoryType = 'opened' | 'status' | 'comment' | 'resolved' | 'reopened'

/**
 * One entry in an issue's audit trail. Appended whenever the issue is opened,
 * commented on, or transitions status. Lets the timeline show when an issue was
 * opened and resolved (with the resolution comment) instead of describing the
 * same work again as a generic boat event.
 */
export interface IssueHistoryEntry {
  datetime: string
  type: IssueHistoryType
  /** New status when `type` is 'status' | 'resolved' | 'reopened'. */
  status?: IssueStatus
  /** Free-text note (resolution detail, progress update, ...). */
  comment?: string
  author?: string
  /** Photos that go with this update ("the crack has grown"). */
  attachments?: Attachment[]
}

export interface Issue {
  id: string
  nodeId: string
  title: string
  description?: string
  status: IssueStatus
  severity?: IssueSeverity
  openedAt: string
  resolvedAt?: string
  resolutionLogId?: string
  /** The season milestone this should be fixed by ("replace before launch"). */
  fixBy?: SeasonMilestone
  updatedAt: string
  /** Photos of the defect as it was reported. Later ones go on history entries. */
  attachments?: Attachment[]
  /** Append-only audit trail of opens, status changes, and comments. */
  history: IssueHistoryEntry[]
}

/**
 * A boat season delimited by a launch (splash) and haulout date. Used to scope
 * reporting to "this season" and as the anchor for seasonAnchor triggers. Both
 * dates are optional so a season can be created at launch and closed at haulout.
 */
export interface Season {
  id: string
  label?: string
  /** ISO date (date or date-time). The boat is afloat from this date. */
  launchDate?: string
  /** ISO date (date or date-time). Absent while the boat is still afloat. */
  hauloutDate?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

/**
 * A free-form, boat-related happening for the timeline. Only adjacent to
 * maintenance ("bought the boat", "moved home port", "did a regatta") but
 * stored alongside it so the app timeline can render everything together.
 * `category` is intentionally an open string; common values are documented in
 * the OpenAPI schema.
 */
export interface BoatEvent {
  id: string
  datetime: string
  category: string
  title: string
  description?: string
  /** Optional link to a maintenance node (e.g. "replaced the boom" → rig). */
  nodeId?: string
  location?: string
  attachments?: Attachment[]
  createdAt: string
  updatedAt: string
}

export interface ChecklistItemTemplate {
  id: string
  text: string
  category?: string
  /** The node a failed check is about, so a client can open the issue there. */
  nodeId?: string
}

/**
 * When a client should suggest running a checklist (or one section of it):
 * around a season milestone, until `withinDays` after it.
 */
export interface ChecklistSchedule {
  /** The item `category` this entry covers; absent = the whole checklist. */
  section?: string
  milestone: SeasonMilestone
  withinDays?: number
}

export interface ChecklistTemplate {
  id: string
  name: string
  description?: string
  items: ChecklistItemTemplate[]
  schedule?: ChecklistSchedule[]
  createdAt: string
  updatedAt: string
}

export type ChecklistItemStatus = 'pending' | 'pass' | 'fail' | 'skip'

export interface ChecklistRunResult {
  itemId: string
  text: string
  status: ChecklistItemStatus
  note?: string
  timestamp?: string
  attachments?: Attachment[]
}

export interface ChecklistRun {
  id: string
  templateId: string
  name: string
  /** The template section (item `category`) this run covers; absent = all of it. */
  section?: string
  startedAt: string
  completedAt?: string
  author?: string
  results: ChecklistRunResult[]
}

// ---- Computed read models ----

export type DueStatus = 'ok' | 'dueSoon' | 'overdue' | 'unknown'

export interface TriggerStatus {
  triggerId: string
  name: string
  metric: MetricType
  due: number
  remaining: number
  status: DueStatus
  /** Echoed from the trigger when an active snooze is suppressing its alarm. */
  snoozedUntil?: string
}

export interface NodeDue {
  nodeId: string
  name: string
  type: NodeType
  /** Status from this node's own triggers only. */
  status: DueStatus
  /** Worst status of this node and all its descendants (child-to-parent rollup). */
  rollupStatus: DueStatus
  triggers: TriggerStatus[]
}

/** Current values of each tracked metric, used to compute trigger status. */
export interface MetricsSnapshot {
  calendarTime: number
  engineHours?: number
  tripCount?: number
}

/**
 * Season milestone dates expressed as days-since-epoch (matching `calendarTime`
 * units), ascending, so seasonAnchor triggers can find the next launch/haulout.
 */
export interface SeasonContext {
  launchDays: number[]
  hauloutDays: number[]
}

export type TimelineKind =
  | 'service'
  | 'event'
  | 'launch'
  | 'haulout'
  | 'checklist'
  | 'issueOpened'
  | 'issueResolved'

/** A unified, chronologically sortable timeline entry merged across records. */
export interface TimelineEntry {
  datetime: string
  kind: TimelineKind
  /** Id of the source record (service log / event / season / issue). */
  refId: string
  title: string
  category?: string
  nodeId?: string
  /** Optional note, e.g. an issue's resolution comment. */
  note?: string
}
