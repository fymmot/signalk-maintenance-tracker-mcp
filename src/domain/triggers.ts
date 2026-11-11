import type {
  DueStatus,
  Issue,
  MaintenanceNode,
  MetricsSnapshot,
  MetricType,
  NodeDue,
  SeasonContext,
  Trigger,
  TriggerAnchor,
  TriggerStatus
} from '../types'

export interface WarnLeadDefaults {
  calendarTime: number
  engineHours: number
  tripCount: number
  /** Days before an expiry date — longer than a service lead, to buy the replacement. */
  expiry: number
}

export function defaultWarnLead(metric: MetricType, defaults: WarnLeadDefaults): number {
  switch (metric) {
    case 'calendarTime':
    case 'seasonAnchor':
      return defaults.calendarTime
    case 'engineHours':
      return defaults.engineHours
    case 'tripCount':
      return defaults.tripCount
    case 'expiry':
      return defaults.expiry
  }
}

export function currentMetricValue(
  metric: MetricType,
  metrics: MetricsSnapshot
): number | undefined {
  switch (metric) {
    case 'calendarTime':
    case 'seasonAnchor':
    case 'expiry':
      // All measured in days; "now" is today's day-number.
      return metrics.calendarTime
    case 'engineHours':
      return metrics.engineHours
    case 'tripCount':
      return metrics.tripCount
  }
}

interface AnchorCycle {
  /** Day-number the task is due (milestone + `offsetDays`). */
  due: number
  /** A service after this day-number counts toward the cycle (exclusive). */
  windowStart: number
}

/**
 * One cycle per occurrence of the anchored milestone, ascending. A cycle's
 * window opens at the opposite milestone before it — a haulout task can be done
 * any time during that season, a launch task any time during the layup before
 * it — but never before the previous cycle's due date, so one service can't
 * count twice. The first cycle with nothing before it opens at day 0.
 */
function anchorCycles(anchor: TriggerAnchor, season: SeasonContext): AnchorCycle[] {
  const own = anchor.milestone === 'launch' ? season.launchDays : season.hauloutDays
  const opposite = anchor.milestone === 'launch' ? season.hauloutDays : season.launchDays
  return own.map((day, i) => {
    const previousDue = i > 0 ? own[i - 1] + anchor.offsetDays : 0
    const seasonStart = opposite.filter((d) => d < day).pop() ?? 0
    return { due: day + anchor.offsetDays, windowStart: Math.max(previousDue, seasonStart, 0) }
  })
}

/**
 * Resolves a seasonAnchor trigger's due day-number: the due date of the first
 * cycle the last service doesn't fall in or after. A service counts toward a
 * cycle from the moment its window opens, so emptying the toilet a fortnight
 * before haulout clears this haulout, and a late service still clears it.
 * Returns `undefined` when the trigger has no anchor or no future milestone is
 * known (→ `unknown`).
 */
export function seasonAnchorDueDay(
  trigger: Trigger,
  season: SeasonContext | undefined
): number | undefined {
  const anchor = trigger.anchor
  if (!anchor || !season) return undefined
  const start = effectiveAnchorStart(trigger, anchor, season)
  return anchorCycles(anchor, season).find((c) => start <= c.windowStart)?.due
}

/**
 * A season task created before any season was entered starts at 0, which would make
 * every launch and haulout before it a missed job the moment the first season is
 * added (a new owner's starter boat, then their dates). Never serviced and created
 * on a known day, it starts where it would have with these seasons already there.
 */
function effectiveAnchorStart(trigger: Trigger, anchor: TriggerAnchor, season: SeasonContext): number {
  if (trigger.lastServiceValue !== 0) return trigger.lastServiceValue
  const created = Date.parse(trigger.lastServiceDate)
  if (!Number.isFinite(created)) return 0
  return seasonAnchorStartValue(anchor, season, Math.floor(created / MS_PER_DAY))
}

/**
 * The `lastServiceValue` a new seasonAnchor trigger starts from: the opening of
 * the cycle still ahead at `now`, so creating "empty the toilet at haulout"
 * mid-season leaves this haulout due instead of counting the creation as a
 * service. Past the last known cycle it is the latest milestone so far, which
 * every cycle added later opens after.
 */
export function seasonAnchorStartValue(
  anchor: TriggerAnchor,
  season: SeasonContext,
  now: number
): number {
  const open = anchorCycles(anchor, season).find((c) => c.due >= now)
  if (open) return open.windowStart
  const past = [...season.launchDays, ...season.hauloutDays].filter((d) => d <= now)
  return Math.max(0, ...past)
}

const MS_PER_DAY = 86_400_000
const EXPIRY_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

/**
 * Normalizes an expiry date to `YYYY-MM-DD`. Labels often print only a month
 * ("EXP 03/2027"), which means valid through that month, so `YYYY-MM` becomes
 * the month's last day. Returns `undefined` for anything else, including
 * impossible dates like 2027-02-30.
 */
export function normalizeExpiryDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const m = EXPIRY_DATE.exec(raw.trim())
  if (!m) return undefined
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return undefined
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = m[3] === undefined ? lastDay : Number(m[3])
  if (day < 1 || day > lastDay) return undefined
  return `${m[1]}-${m[2]}-${String(day).padStart(2, '0')}`
}

/**
 * An expiry trigger's due day-number: the printed date itself, so the plugin,
 * Claude and the app all name the date on the label ("replace by 31 Mar").
 * `undefined` when no date is set yet.
 */
export function expiryDueDay(trigger: Trigger): number | undefined {
  const date = normalizeExpiryDate(trigger.expiresOn)
  if (!date) return undefined
  return Date.parse(date) / MS_PER_DAY
}

const SEVERITY: Record<DueStatus, number> = {
  overdue: 3,
  dueSoon: 2,
  ok: 1,
  unknown: 0
}

/** Picks the most urgent status. Empty input is `ok` (nothing scheduled). */
export function worstStatus(statuses: DueStatus[]): DueStatus {
  if (statuses.length === 0) return 'ok'
  return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst))
}

/**
 * A node with an open, medium-or-high-severity issue is treated as `overdue`
 * (same as an overdue service trigger). `monitoring`/`resolved` issues and
 * `low`/missing severity are ignored.
 */
export function nodeIssueStatus(nodeId: string, issues: Issue[]): DueStatus {
  const blocking = issues.some(
    (i) => i.nodeId === nodeId && i.status === 'open' && (i.severity === 'medium' || i.severity === 'high')
  )
  return blocking ? 'overdue' : 'ok'
}

/**
 * Computes a single trigger's status. `due = lastServiceValue + interval`
 * (or a date for seasonAnchor and expiry triggers), `remaining = due - currentValue`.
 * If the trigger's metric value or date is unavailable the status is `unknown`
 * and `remaining` is `NaN`.
 */
export function computeTriggerStatus(
  trigger: Trigger,
  metrics: MetricsSnapshot,
  warnDefaults: WarnLeadDefaults,
  season?: SeasonContext
): TriggerStatus {
  const snoozedUntil = activeSnooze(trigger)
  let due: number
  if (trigger.metric === 'seasonAnchor' || trigger.metric === 'expiry') {
    const dateDue =
      trigger.metric === 'expiry' ? expiryDueDay(trigger) : seasonAnchorDueDay(trigger, season)
    if (dateDue === undefined) {
      return {
        triggerId: trigger.id,
        name: trigger.name,
        metric: trigger.metric,
        due: Number.NaN,
        remaining: Number.NaN,
        status: 'unknown',
        snoozedUntil
      }
    }
    due = dateDue
  } else {
    due = trigger.lastServiceValue + trigger.interval
  }
  const current = currentMetricValue(trigger.metric, metrics)
  if (current === undefined) {
    return {
      triggerId: trigger.id,
      name: trigger.name,
      metric: trigger.metric,
      due,
      remaining: Number.NaN,
      status: 'unknown',
      snoozedUntil
    }
  }
  const remaining = due - current
  const warnLead = trigger.warnLead ?? defaultWarnLead(trigger.metric, warnDefaults)
  let status: DueStatus
  if (remaining <= 0) status = 'overdue'
  else if (remaining <= warnLead) status = 'dueSoon'
  else status = 'ok'
  return {
    triggerId: trigger.id,
    name: trigger.name,
    metric: trigger.metric,
    due,
    remaining,
    status,
    snoozedUntil
  }
}

/**
 * Returns the trigger's snooze timestamp if it is still in the future (the
 * snooze is active), otherwise `undefined`. An expired snooze is treated as no
 * snooze so the alarm returns on its own.
 */
export function activeSnooze(trigger: Trigger, now: Date = new Date()): string | undefined {
  if (!trigger.snoozedUntil) return undefined
  const until = Date.parse(trigger.snoozedUntil)
  if (Number.isNaN(until)) return undefined
  return until > now.getTime() ? trigger.snoozedUntil : undefined
}

/**
 * Computes a node's due status across all its enabled triggers
 * ("whichever comes first" = the most urgent trigger drives the node).
 */
export function computeNodeDue(
  node: MaintenanceNode,
  metrics: MetricsSnapshot,
  warnDefaults: WarnLeadDefaults,
  season?: SeasonContext
): NodeDue {
  const triggers = node.triggers
    .filter((t) => t.enabled)
    .map((t) => computeTriggerStatus(t, metrics, warnDefaults, season))
  const status = worstStatus(triggers.map((t) => t.status))
  return {
    nodeId: node.id,
    name: node.name,
    type: node.type,
    status,
    // Default rollup to own status; computeAllDue refines it with descendants.
    rollupStatus: status,
    triggers
  }
}

/**
 * Computes due status for every node, and sets each node's `rollupStatus` to the
 * worst status of itself and all its descendants, so a System/Component reflects
 * the most urgent item anywhere beneath it.
 */
export function computeAllDue(
  nodes: MaintenanceNode[],
  metrics: MetricsSnapshot,
  warnDefaults: WarnLeadDefaults,
  season?: SeasonContext,
  issues: Issue[] = []
): NodeDue[] {
  const dues = nodes.map((n) => computeNodeDue(n, metrics, warnDefaults, season))
  // Blend qualifying open issues into each node's own status before rollup, so an
  // issue on a part propagates up to its component/system like an overdue trigger.
  for (const due of dues) {
    due.status = worstStatus([due.status, nodeIssueStatus(due.nodeId, issues)])
  }
  const ownStatusById = new Map(dues.map((d) => [d.nodeId, d.status]))

  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node.id)
    childrenByParent.set(node.parentId, list)
  }

  const rollupCache = new Map<string, DueStatus>()
  const computeRollup = (id: string, seen: Set<string>): DueStatus => {
    const cached = rollupCache.get(id)
    if (cached) return cached
    if (seen.has(id)) return ownStatusById.get(id) ?? 'ok' // cycle guard
    seen.add(id)
    const own = ownStatusById.get(id) ?? 'ok'
    const childStatuses = (childrenByParent.get(id) ?? []).map((childId) =>
      computeRollup(childId, seen)
    )
    const rollup = worstStatus([own, ...childStatuses])
    rollupCache.set(id, rollup)
    return rollup
  }

  for (const due of dues) {
    due.rollupStatus = computeRollup(due.nodeId, new Set())
  }
  return dues
}
