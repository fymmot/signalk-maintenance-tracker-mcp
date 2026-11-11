import type {
  ChecklistRun,
  ChecklistTemplate,
  Issue,
  IssueSeverity,
  MaintenanceNode,
  NodeDue,
  Season,
  SeasonMilestone,
  TriggerStatus
} from '../types'

/*
 * The work queue: one list of what needs doing, built from the `/due` triggers, the
 * open issues, the checklists and the seasons. Ported from Skerry's MaintenanceWork.kt
 * so every client (the web app, the Android app, MCP) groups work the same way.
 *
 * Days are UTC epoch days throughout, the same day numbers `due` uses on calendar,
 * season-anchor and expiry triggers.
 */

const MS_PER_DAY = 86_400_000

/** Days ahead that count as "this week". */
export const WORK_THIS_WEEK_DAYS = 7
/** A checklist suggestion opens this many days before its milestone. */
export const CHECKLIST_LEAD_DAYS = 7
/** Default for `ChecklistSchedule.withinDays`. */
export const CHECKLIST_DEFAULT_WITHIN_DAYS = 14
/** An unfinished run untouched for this long is offered for discard instead of resume. */
export const STALE_RUN_DAYS = 14

/** A `YYYY-MM-DD` date or ISO date-time as a UTC epoch day; undefined when absent or invalid. */
export function isoToEpochDay(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / MS_PER_DAY) : undefined
}

export function epochDayToIsoDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

export function todayEpochDay(now: Date = new Date()): number {
  return Math.floor(now.getTime() / MS_PER_DAY)
}

const DATED_METRICS = new Set(['calendarTime', 'seasonAnchor', 'expiry'])

/** Where the boat is in its season, derived from the season list. */
export type SeasonPhase =
  | { state: 'ashore'; hauledOut?: number; nextLaunch?: number }
  | { state: 'afloat'; launched: number; plannedHaulout?: number }

export function nextMilestone(phase: SeasonPhase): SeasonMilestone {
  return phase.state === 'afloat' ? 'haulout' : 'launch'
}

export function nextMilestoneDay(phase: SeasonPhase): number | undefined {
  return phase.state === 'afloat' ? phase.plannedHaulout : phase.nextLaunch
}

/**
 * Afloat when a season has launched and not yet hauled out (haulout day itself still
 * counts as afloat). Otherwise ashore since the latest haulout, waiting for the
 * earliest future launch. `/seasons/current` can't say this: ashore it has no season.
 */
export function seasonPhase(seasons: Season[], today: number): SeasonPhase {
  let current: { launch: number; haulout?: number } | undefined
  for (const s of seasons) {
    const launch = isoToEpochDay(s.launchDate)
    if (launch === undefined) continue
    const haulout = isoToEpochDay(s.hauloutDate)
    if (launch <= today && (haulout === undefined || haulout >= today)) {
      if (!current || launch > current.launch) current = { launch, haulout }
    }
  }
  if (current) return { state: 'afloat', launched: current.launch, plannedHaulout: current.haulout }
  const hauled = seasons.map((s) => isoToEpochDay(s.hauloutDate)).filter((d): d is number => d !== undefined && d <= today)
  const launches = seasons.map((s) => isoToEpochDay(s.launchDate)).filter((d): d is number => d !== undefined && d > today)
  return {
    state: 'ashore',
    hauledOut: hauled.length ? Math.max(...hauled) : undefined,
    nextLaunch: launches.length ? Math.min(...launches) : undefined
  }
}

/** One service interval that needs doing. */
export interface ServiceJob {
  nodeId: string
  nodeName: string
  trigger: TriggerStatus
  /** For calendar, season-anchor and expiry triggers; undefined for hours and trips. */
  dueDay?: number
}

/** A checklist (or one section of it) whose schedule window is open now. */
export interface SuggestedChecklist {
  templateId: string
  templateName: string
  section?: string
  milestone: SeasonMilestone
  milestoneDay: number
}

export interface WorkQueue {
  today: number
  phase: SeasonPhase
  nextMilestone: SeasonMilestone
  nextMilestoneDay?: number
  thisWeek: ServiceJob[]
  overdue: ServiceJob[]
  snoozed: ServiceJob[]
  /** Due after this week but by the next milestone. */
  beforeMilestone: ServiceJob[]
  /** Open issues marked to fix by the next milestone. */
  milestoneIssues: Issue[]
  /** Every other open or monitored issue, worst first. */
  openIssues: Issue[]
  suggestedChecklists: SuggestedChecklist[]
  inProgressRuns: ChecklistRun[]
  staleRuns: ChecklistRun[]
  /** What wants doing now: this week + overdue. Issues have their own count. */
  badgeCount: number
}

type JobGroup = 'thisWeek' | 'overdue' | 'snoozed' | 'beforeMilestone'

function finite(n: number | null | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function jobDueDay(t: TriggerStatus): number | undefined {
  const due = finite(t.due)
  return DATED_METRICS.has(t.metric) && due !== undefined ? Math.floor(due) : undefined
}

function classify(t: TriggerStatus, dueDay: number | undefined, today: number, milestoneDay: number | undefined): JobGroup | undefined {
  const remaining = finite(t.remaining)
  if (remaining === undefined) return undefined
  if (remaining <= 0) return t.snoozedUntil ? 'snoozed' : 'overdue'
  const weekEnd = today + WORK_THIS_WEEK_DAYS
  if (dueDay !== undefined && dueDay <= weekEnd) return 'thisWeek'
  // Engine hours and trips have no date; the warning window stands in for "soon".
  if (dueDay === undefined && t.status === 'dueSoon') return 'thisWeek'
  if (dueDay !== undefined && milestoneDay !== undefined && dueDay <= milestoneDay) return 'beforeMilestone'
  return undefined
}

/**
 * Every due trigger as a job, grouped. Uses trigger data only, never `NodeDue.status`,
 * which an open medium/high issue makes overdue.
 */
function groupJobs(due: NodeDue[], today: number, milestoneDay: number | undefined): Record<JobGroup, ServiceJob[]> {
  const groups: Record<JobGroup, ServiceJob[]> = { thisWeek: [], overdue: [], snoozed: [], beforeMilestone: [] }
  for (const node of due) {
    for (const trigger of node.triggers) {
      const dueDay = jobDueDay(trigger)
      const group = classify(trigger, dueDay, today, milestoneDay)
      if (group) groups[group].push({ nodeId: node.nodeId, nodeName: node.name || node.nodeId, trigger, dueDay })
    }
  }
  // Soonest (or most overdue) first; dateless jobs by least headroom.
  const key = (j: ServiceJob): [number, number] => [j.dueDay ?? Infinity, finite(j.trigger.remaining) ?? Infinity]
  for (const list of Object.values(groups)) {
    list.sort((a, b) => {
      const [ad, ar] = key(a)
      const [bd, br] = key(b)
      return ad !== bd ? ad - bd : ar - br
    })
  }
  return groups
}

/** The badge alone, for callers that only have `/due`. */
export function workBadgeCount(due: NodeDue[], today: number): number {
  const jobs = groupJobs(due, today, undefined)
  return jobs.thisWeek.length + jobs.overdue.length
}

export function severityRank(severity: IssueSeverity | undefined): number {
  return severity === 'high' ? 3 : severity === 'medium' ? 2 : severity === 'low' ? 1 : 0
}

/** The last time anyone touched a run: its newest answer, else when it started. */
export function lastActivityDay(run: ChecklistRun): number | undefined {
  const days = [...run.results.map((r) => isoToEpochDay(r.timestamp)), isoToEpochDay(run.startedAt)].filter(
    (d): d is number => d !== undefined
  )
  return days.length ? Math.max(...days) : undefined
}

function milestoneDays(seasons: Season[], milestone: SeasonMilestone): number[] {
  return seasons
    .map((s) => isoToEpochDay(milestone === 'haulout' ? s.hauloutDate : s.launchDate))
    .filter((d): d is number => d !== undefined)
}

export function suggestedChecklists(
  templates: ChecklistTemplate[],
  runs: ChecklistRun[],
  seasons: Season[],
  today: number
): SuggestedChecklist[] {
  const result: SuggestedChecklist[] = []
  for (const template of templates) {
    for (const entry of template.schedule ?? []) {
      const within = entry.withinDays ?? CHECKLIST_DEFAULT_WITHIN_DAYS
      const milestoneDay = milestoneDays(seasons, entry.milestone).find(
        (d) => today >= d - CHECKLIST_LEAD_DAYS && today <= d + within
      )
      if (milestoneDay === undefined) continue
      const windowStart = milestoneDay - CHECKLIST_LEAD_DAYS
      const alreadyStarted = runs.some((run) => {
        const started = isoToEpochDay(run.startedAt)
        return run.templateId === template.id && run.section === entry.section && started !== undefined && started >= windowStart
      })
      if (!alreadyStarted) {
        result.push({
          templateId: template.id,
          templateName: template.name,
          section: entry.section,
          milestone: entry.milestone,
          milestoneDay
        })
      }
    }
  }
  return result
}

/** Open (and monitored) issues, worst severity first, then newest. */
export function openIssuesSorted(issues: Issue[]): Issue[] {
  return issues
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.openedAt ?? '').localeCompare(a.openedAt ?? ''))
}

export function buildWorkQueue(
  due: NodeDue[],
  issues: Issue[],
  templates: ChecklistTemplate[],
  runs: ChecklistRun[],
  seasons: Season[],
  today: number
): WorkQueue {
  const phase = seasonPhase(seasons, today)
  const milestone = nextMilestone(phase)
  const milestoneDay = nextMilestoneDay(phase)
  const jobs = groupJobs(due, today, milestoneDay)
  const open = openIssuesSorted(issues)
  const milestoneIssues = open.filter((i) => i.fixBy === milestone)
  const otherIssues = open.filter((i) => i.fixBy !== milestone)
  const staleBefore = today - STALE_RUN_DAYS
  const byActivityDesc = (a: ChecklistRun, b: ChecklistRun): number =>
    (lastActivityDay(b) ?? -Infinity) - (lastActivityDay(a) ?? -Infinity)
  const unfinished = runs.filter((r) => !r.completedAt)
  const isStale = (r: ChecklistRun): boolean => {
    const last = lastActivityDay(r)
    return last === undefined || last < staleBefore
  }
  return {
    today,
    phase,
    nextMilestone: milestone,
    nextMilestoneDay: milestoneDay,
    thisWeek: jobs.thisWeek,
    overdue: jobs.overdue,
    snoozed: jobs.snoozed,
    beforeMilestone: jobs.beforeMilestone,
    milestoneIssues,
    openIssues: otherIssues,
    suggestedChecklists: suggestedChecklists(templates, runs, seasons, today),
    inProgressRuns: unfinished.filter((r) => !isStale(r)).sort(byActivityDesc),
    staleRuns: unfinished.filter(isStale).sort(byActivityDesc),
    badgeCount: jobs.thisWeek.length + jobs.overdue.length
  }
}

/** What a top-level system's row on the Boat tab says about everything under it. */
export interface SystemSummary {
  nodeId: string
  name: string
  openIssues: number
  highIssues: number
  overdue: number
  thisWeek: number
  /** The soonest dated job further out than this week, if any. */
  next?: ServiceJob
  hasSchedules: boolean
  needsAttention: boolean
}

/** One summary per top-level system: those needing attention first, worst first, then by name. */
export function systemSummaries(nodes: MaintenanceNode[], due: NodeDue[], queue: WorkQueue): SystemSummary[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const root = (id: string): string => {
    let cur = byId.get(id)
    if (!cur) return id
    for (let guard = 0; cur.parentId && guard < 12; guard++) {
      const parent = byId.get(cur.parentId)
      if (!parent) break
      cur = parent
    }
    return cur.id
  }
  const count = <T>(items: T[], idOf: (t: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    for (const item of items) {
      const r = root(idOf(item))
      m.set(r, [...(m.get(r) ?? []), item])
    }
    return m
  }
  const issues = count([...queue.milestoneIssues, ...queue.openIssues], (i) => i.nodeId)
  const overdue = count(queue.overdue, (j) => j.nodeId)
  const week = count(queue.thisWeek, (j) => j.nodeId)
  const weekEnd = queue.today + WORK_THIS_WEEK_DAYS
  const later: ServiceJob[] = []
  for (const node of due) {
    for (const t of node.triggers) {
      const d = jobDueDay(t)
      if (d !== undefined && d > weekEnd && (finite(t.remaining) ?? 0) > 0) {
        later.push({ nodeId: node.nodeId, nodeName: node.name || node.nodeId, trigger: t, dueDay: d })
      }
    }
  }
  const laterByRoot = count(later, (j) => j.nodeId)
  const scheduled = new Set(due.filter((d) => d.triggers.length > 0).map((d) => root(d.nodeId)))

  return nodes
    .filter((n) => !n.parentId)
    .map((system): SystemSummary => {
      const sysIssues = issues.get(system.id) ?? []
      const o = overdue.get(system.id)?.length ?? 0
      const w = week.get(system.id)?.length ?? 0
      const next = (laterByRoot.get(system.id) ?? []).reduce<ServiceJob | undefined>(
        (best, j) => (!best || (j.dueDay ?? Infinity) < (best.dueDay ?? Infinity) ? j : best),
        undefined
      )
      return {
        nodeId: system.id,
        name: system.name,
        openIssues: sysIssues.length,
        highIssues: sysIssues.filter((i) => i.severity === 'high').length,
        overdue: o,
        thisWeek: w,
        next,
        hasSchedules: scheduled.has(system.id),
        needsAttention: sysIssues.length > 0 || o > 0 || w > 0
      }
    })
    .sort(
      (a, b) =>
        Number(b.needsAttention) - Number(a.needsAttention) ||
        b.overdue + b.highIssues - (a.overdue + a.highIssues) ||
        b.openIssues + b.thisWeek - (a.openIssues + a.thisWeek) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
}

/**
 * Nodes matching every word of `query` across name, maker, model, serial and notes.
 * Nodes whose name holds every word come first, then by name.
 */
export function searchNodes(nodes: MaintenanceNode[], query: string): MaintenanceNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hay = (n: MaintenanceNode): string =>
    [n.name, n.manufacturer, n.model, n.serial, n.notes].filter(Boolean).join(' ').toLowerCase()
  const nameHit = (n: MaintenanceNode): boolean => words.every((w) => n.name.toLowerCase().includes(w))
  return nodes
    .filter((n) => words.every((w) => hay(n).includes(w)))
    .sort((a, b) => Number(nameHit(b)) - Number(nameHit(a)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}
