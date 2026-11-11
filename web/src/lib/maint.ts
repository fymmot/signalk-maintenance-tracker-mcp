import type { ServiceJob } from '../../../src/domain/work'
import type {
  DueStatus,
  Issue,
  IssueSeverity,
  MaintenanceNode,
  NodeDue,
  Trigger,
  TriggerStatus
} from '../../../src/types'
import type { IconName } from '../components/Icon'
import type { Tone } from '../components/ui'
import { t, tn, type MessageKey } from '../i18n'
import { formatDay, formatDayShort, formatIsoDay, formatNumber } from './format'

/*
 * Maintenance helpers for the screens, ported from Skerry (MaintenanceViewModel.kt,
 * MaintenanceWorkTab.kt, MaintenanceNodeDetailScreen.kt, MaintenanceBoatTab.kt) so the
 * web app words and ranks things the same way. Days are UTC epoch days.
 */

const DATED = new Set(['calendarTime', 'seasonAnchor', 'expiry'])
const GUARD = 12

export function isDated(metric: string): boolean {
  return DATED.has(metric)
}

export function isoToDay(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : undefined
}

export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** The service time for a picked day: now if it is today, else that day at the current local time. */
export function isoDateTimeForDay(day: number, now = new Date()): string {
  const today = Math.floor(now.getTime() / 86_400_000)
  if (day === today) return now.toISOString()
  const [y, m, d] = dayToIso(day).split('-').map(Number)
  const local = new Date(now)
  local.setFullYear(y, m - 1, d)
  return local.toISOString()
}

// ---- Tree ----

export function childrenOf(nodes: MaintenanceNode[], id: string | undefined): MaintenanceNode[] {
  return nodes
    .filter((n) => (id ? n.parentId === id : !n.parentId))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** Ancestors, nearest last: [system, component] for a part. */
export function ancestors(byId: Map<string, MaintenanceNode>, node: MaintenanceNode): MaintenanceNode[] {
  const out: MaintenanceNode[] = []
  let cur = node.parentId ? byId.get(node.parentId) : undefined
  for (let i = 0; cur && i < GUARD; i++) {
    out.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

export function nodePath(byId: Map<string, MaintenanceNode>, node: MaintenanceNode): string {
  return ancestors(byId, node)
    .map((n) => n.name)
    .join(' › ')
}

export function rootOf(byId: Map<string, MaintenanceNode>, id: string): MaintenanceNode | undefined {
  let cur = byId.get(id)
  for (let i = 0; cur?.parentId && i < GUARD; i++) {
    const parent = byId.get(cur.parentId)
    if (!parent) break
    cur = parent
  }
  return cur
}

/** The node and everything under it, for "can't be its own parent" and subtree sums. */
export function descendantsAndSelf(nodes: MaintenanceNode[], id: string): Set<string> {
  const out = new Set([id])
  for (let changed = true, i = 0; changed && i < GUARD; i++) {
    changed = false
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id)
        changed = true
      }
    }
  }
  return out
}

// ---- Status ----

const STATUS_RANK: Record<DueStatus, number> = { overdue: 3, dueSoon: 2, unknown: 1, ok: 0 }

export function worseStatus(a: DueStatus, b: DueStatus): DueStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b
}

export function statusLabel(status: DueStatus | undefined): string {
  return t(`status.${status ?? 'unknown'}` as MessageKey)
}

export function statusTone(status: DueStatus | undefined): Tone {
  return status === 'overdue' ? 'error' : status === 'dueSoon' ? 'tertiary' : status === 'ok' ? 'ok' : undefined
}

export function statusIcon(status: DueStatus | undefined): IconName {
  return status === 'overdue' ? 'errorCircle' : status === 'dueSoon' ? 'schedule' : status === 'ok' ? 'checkCircle' : 'help'
}

/** A snoozed trigger counts as fine until its snooze ends. */
function triggerServiceStatus(t: TriggerStatus): DueStatus {
  return t.snoozedUntil ? 'ok' : t.status
}

/** Worst service status over the node and everything under it; open issues are not counted. */
export function serviceRollupStatus(nodes: MaintenanceNode[], dueById: Map<string, NodeDue>, id: string): DueStatus {
  let worst: DueStatus = 'ok'
  for (const nid of descendantsAndSelf(nodes, id)) {
    for (const tr of dueById.get(nid)?.triggers ?? []) worst = worseStatus(worst, triggerServiceStatus(tr))
  }
  return worst
}

/** The node's own enabled trigger closest to due, ties by least remaining. */
/**
 * The node's most pressing interval: worst status first, a snoozed one after one that is not,
 * then whichever is furthest through its interval (remaining values are in different units).
 */
export function ownServiceTrigger(due: NodeDue | undefined, triggers: Trigger[] = []): TriggerStatus | undefined {
  const list = due?.triggers ?? []
  const intervalLeft = (t: TriggerStatus): number => {
    if (!Number.isFinite(t.remaining)) return Infinity
    const interval = triggers.find((d) => d.id === t.triggerId)?.interval
    return interval && interval > 0 ? t.remaining / interval : t.remaining
  }
  return [...list].sort(
    (a, b) =>
      STATUS_RANK[triggerServiceStatus(b)] - STATUS_RANK[triggerServiceStatus(a)] ||
      Number(!!a.snoozedUntil) - Number(!!b.snoozedUntil) ||
      intervalLeft(a) - intervalLeft(b)
  )[0]
}

// ---- Issues ----

export function severityRank(s: IssueSeverity | undefined): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : s === 'low' ? 1 : 0
}

export function severityLabel(s: IssueSeverity | undefined): string {
  return t(`severity.${s ?? 'medium'}` as MessageKey)
}

/** High is error, medium tertiary, low neutral: and always said in words too. */
export function severityTone(s: IssueSeverity | undefined): Tone {
  return s === 'high' ? 'error' : s === 'medium' ? 'tertiary' : undefined
}

export function severityIcon(s: IssueSeverity | undefined): IconName {
  return s === 'high' ? 'warning' : s === 'medium' ? 'warning' : 'info'
}

export function openIssuesFor(issues: Issue[], nodeIds: Set<string>): Issue[] {
  return issues
    .filter((i) => i.status !== 'resolved' && nodeIds.has(i.nodeId))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.openedAt.localeCompare(a.openedAt))
}

export function worstSeverity(issues: Issue[]): IssueSeverity | undefined {
  return issues.reduce<IssueSeverity | undefined>(
    (w, i) => (severityRank(i.severity) > severityRank(w) ? i.severity : w),
    undefined
  )
}

// ---- Text ----

/** "In 3 days", "12 days over", "4 h left": the Work list's due text. */
export function jobDueText(job: ServiceJob, today: number): string {
  if (job.trigger.snoozedUntil) {
    const d = isoToDay(job.trigger.snoozedUntil)
    return t('due.snoozedUntil', { date: d !== undefined ? formatDayShort(d) : job.trigger.snoozedUntil })
  }
  const remaining = job.trigger.remaining ?? 0
  if (job.dueDay === undefined) {
    const left = Math.round(Math.abs(remaining))
    return job.trigger.metric === 'tripCount' ? tn('due.tripsLeft', left) : t('due.hoursLeft', { n: String(left) })
  }
  const days = job.dueDay - today
  if (days < -60) return tn('due.monthsOver', Math.floor(-days / 30))
  if (days < 0) return tn('due.daysOver', -days)
  if (days === 0) return t('due.today')
  if (days <= 7) return tn('due.inDays', days)
  return formatDayShort(job.dueDay)
}

/** A trigger card's line: "120 of 365 days left", "Overdue by 4 h", "Expires 3 Jun 2027". */
export function triggerRemainingText(trigger: Trigger, due: TriggerStatus | undefined): string {
  if (trigger.metric === 'expiry') {
    if (!trigger.expiresOn) return t('trigger.expiryUnknown')
    const date = formatIsoDay(trigger.expiresOn)
    return due?.status === 'overdue' ? t('trigger.expired', { date }) : t('trigger.expires', { date })
  }
  if (trigger.metric === 'seasonAnchor') {
    if (!due || due.status === 'unknown') return t('trigger.seasonUnknown')
    const d = due.due ?? undefined
    return d !== undefined && d !== null ? `${statusLabel(due.status)} · ${formatDay(Math.floor(d))}` : statusLabel(due.status)
  }
  const remaining = due?.remaining
  if (remaining === undefined || remaining === null || !trigger.interval) return statusLabel(due?.status)
  const n = String(Math.round(Math.abs(remaining)))
  const interval = String(Math.round(trigger.interval))
  const over = remaining < 0
  switch (trigger.metric) {
    case 'engineHours':
      return over ? t('trigger.overdueHours', { n }) : t('trigger.remainingHours', { n, interval })
    case 'tripCount':
      return over ? t('trigger.overdueTrips', { n }) : t('trigger.remainingTrips', { n, interval })
    default:
      return over ? t('trigger.overdueDays', { n }) : t('trigger.remainingDays', { n, interval })
  }
}

/** How much of the interval is used, 0–1, for the progress bar; undefined when it has none. */
export function triggerProgress(trigger: Trigger, due: TriggerStatus | undefined): number | undefined {
  const remaining = due?.remaining
  if (remaining === undefined || remaining === null || !trigger.interval || !Number.isFinite(remaining)) return undefined
  return Math.max(0, Math.min(1, 1 - remaining / trigger.interval))
}

export function anchorText(trigger: Trigger): string | undefined {
  const a = trigger.anchor
  if (!a) return undefined
  const milestone = t(`milestone.${a.milestone}` as MessageKey).toLowerCase()
  if (a.offsetDays < 0) return t('trigger.anchorBefore', { n: String(-a.offsetDays), milestone })
  if (a.offsetDays > 0) return t('trigger.anchorAfter', { n: String(a.offsetDays), milestone })
  return t('trigger.anchorAt', { milestone })
}

export function metricUnit(metric: string): string {
  return metric === 'engineHours' ? t('unit.hours') : metric === 'tripCount' ? t('unit.trips') : t('unit.days')
}

export function formatCost(cost: number, currency = 'SEK', locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cost)
  } catch {
    return `${formatNumber(cost, 0)} ${currency}`
  }
}

// ---- Icons ----

/** A picture for a system from its name, English or Swedish. Whole words or prefixes only. */
export function systemIcon(name: string): IconName {
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const has = (...stems: string[]) => words.some((w) => stems.some((s) => w.startsWith(s)))
  if (has('through', 'seacock', 'genomföring', 'bottenventil')) return 'water'
  if (has('rig', 'sail', 'segel', 'mast')) return 'sail'
  if (has('propulsion', 'engine', 'motor', 'drive', 'framdrivning')) return 'engine'
  if (has('electric', 'el', 'batter')) return 'bolt'
  if (has('propane', 'gasol', 'gas')) return 'propane'
  if (has('fuel', 'diesel', 'bränsle')) return 'fuel'
  if (has('heat', 'värme')) return 'heat'
  if (has('hull', 'deck', 'skrov', 'däck')) return 'hull'
  if (has('instrument', 'navigation')) return 'instruments'
  if (has('steer', 'styr', 'rudder', 'roder', 'tiller')) return 'steering'
  if (has('refrig', 'fridge', 'kyl')) return 'fridge'
  if (has('safety', 'säkerhet')) return 'lifebuoy'
  if (has('sanitation', 'toilet', 'toalett', 'head', 'sanitet')) return 'toilet'
  if (has('smart', 'computer', 'raspberry', 'dator')) return 'computer'
  if (has('fee', 'insurance', 'avgift', 'försäkring')) return 'fees'
  if (has('water', 'vatten')) return 'water'
  return 'wrench'
}

// ---- Subtrees: what a system or component holds ----

/** The work queue's view of everything under a node (and the node itself). */
export interface SubtreeSummary {
  overdue: ServiceJob[]
  thisWeek: ServiceJob[]
  /** Open and monitored issues, worst first, as the queue sorts them. */
  issues: Issue[]
}

interface QueueSlice {
  overdue: ServiceJob[]
  thisWeek: ServiceJob[]
  milestoneIssues: Issue[]
  openIssues: Issue[]
}

/**
 * Counts from the same work queue the Boat list summarises, filtered to the subtree,
 * so a system's page and its row on Boat always agree.
 */
export function subtreeSummary(nodes: MaintenanceNode[], queue: QueueSlice | null, id: string): SubtreeSummary {
  const ids = descendantsAndSelf(nodes, id)
  const inside = (nodeId: string) => ids.has(nodeId)
  return {
    overdue: (queue?.overdue ?? []).filter((j) => inside(j.nodeId)),
    thisWeek: (queue?.thisWeek ?? []).filter((j) => inside(j.nodeId)),
    issues: [...(queue?.milestoneIssues ?? []), ...(queue?.openIssues ?? [])].filter((i) => inside(i.nodeId))
  }
}

/** "3 issues · 1 overdue · 2 this week", the Boat list's wording; empty when all is well. */
export function summaryParts(s: SubtreeSummary): string[] {
  return [
    s.issues.length ? tn('boat.issues', s.issues.length) : '',
    s.overdue.length ? tn('boat.overdue', s.overdue.length) : '',
    s.thisWeek.length ? tn('boat.thisWeek', s.thisWeek.length) : ''
  ].filter(Boolean)
}

export type ChildKind = 'attention' | 'fix' | 'ok' | 'empty'

/**
 * One line of a container's contents: the child's state in words, with a tone.
 * `attention` has work or issues; `fix` can't be tracked until something is set
 * (a season date, an engine-hours reading); `ok` is up to date; `empty` has no
 * intervals anywhere under it.
 */
export function childState(
  nodes: MaintenanceNode[],
  dueById: Map<string, NodeDue>,
  queue: QueueSlice | null,
  id: string,
  { seasonKnown = true }: { seasonKnown?: boolean } = {}
): { kind: ChildKind; text: string; tone: Tone } {
  const s = subtreeSummary(nodes, queue, id)
  const parts = summaryParts(s)
  if (parts.length) {
    const urgent = s.overdue.length > 0 || s.issues.some((i) => i.severity === 'high')
    return { kind: 'attention', text: parts.join(' · '), tone: urgent ? 'error' : 'tertiary' }
  }
  const triggers = [...descendantsAndSelf(nodes, id)].flatMap((nid) => dueById.get(nid)?.triggers ?? [])
  // Without any season, every season job waits on the same missing date; leave that to the caller.
  const unknown = triggers.find((tr) => tr.status === 'unknown' && (seasonKnown || tr.metric !== 'seasonAnchor'))
  if (unknown) {
    return {
      kind: 'fix',
      text: unknown.metric === 'seasonAnchor' ? t('node.needsSeason') : unknown.metric === 'expiry' ? t('trigger.expiryUnknown') : t('node.needsReading'),
      tone: 'tertiary'
    }
  }
  return triggers.length ? { kind: 'ok', text: t('status.ok'), tone: 'ok' } : { kind: 'empty', text: t('boat.noIntervals'), tone: undefined }
}
