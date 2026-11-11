import { batch, computed, signal } from '@preact/signals'
import type { SystemSummary, WorkQueue } from '../../../src/domain/work'
import type {
  BoatEvent,
  ChecklistRun,
  ChecklistTemplate,
  Issue,
  MaintenanceNode,
  NodeDue,
  PluginStatus,
  Season,
  TimelineEntry
} from '../../../src/types'
import { api, ApiError, loginStatus, type LoginStatus } from '../api/client'

/*
 * Everything the screens show, as signals. Mirrors Skerry's MaintenanceUiState:
 * refreshAll() loads every collection in parallel, a failed request keeps the data
 * it had, and every write refreshes afterwards.
 */

export type Work = WorkQueue & {
  systems: SystemSummary[]
  metrics: { engineHours?: number; tripCount?: number }
}

export const nodes = signal<MaintenanceNode[]>([])
export const due = signal<NodeDue[]>([])
export const work = signal<Work | null>(null)
export const issues = signal<Issue[]>([])
export const events = signal<BoatEvent[]>([])
export const seasons = signal<Season[]>([])
export const templates = signal<ChecklistTemplate[]>([])
export const runs = signal<ChecklistRun[]>([])
export const timeline = signal<TimelineEntry[]>([])
export const status = signal<PluginStatus | null>(null)
export const login = signal<LoginStatus | null>(null)

/** True until the first load has answered, one way or the other. */
export const loading = signal(true)
export const refreshing = signal(false)
/** Why the plugin can't be used at all; null when it can. */
export const unavailable = signal<null | 'notInstalled' | 'stopped' | 'signIn' | 'network'>(null)
/** The first load failed for another reason. */
export const loadError = signal<ApiError | null>(null)

export const nodesById = computed(() => new Map(nodes.value.map((n) => [n.id, n])))
export const dueById = computed(() => new Map(due.value.map((d) => [d.nodeId, d])))
export const isAdmin = computed(() => {
  const l = login.value
  // A server without security treats everyone as admin.
  return !!l && (l.authenticationRequired === false || l.userLevel === 'admin')
})
export const canWrite = computed(() => {
  const l = login.value
  if (!l) return true
  if (l.authenticationRequired === false) return true
  return l.status === 'loggedIn' && (l.userLevel === 'admin' || l.userLevel === 'readwrite')
})

async function load<T>(path: string, target: { value: T }): Promise<void> {
  target.value = await api<T>('GET', path)
}

let inFlight: Promise<void> | null = null

/** Loads everything. Concurrent calls share one refresh. */
export function refreshAll(): Promise<void> {
  if (inFlight) return inFlight
  refreshing.value = true
  inFlight = (async () => {
    const results = await Promise.allSettled([
      load('/nodes', nodes),
      load('/due', due),
      load('/work', work),
      load('/issues', issues),
      load('/events', events),
      load('/seasons', seasons),
      load('/checklists/templates', templates),
      load('/checklists/runs', runs),
      load('/timeline', timeline)
    ])
    const [nodesResult] = results
    batch(() => {
      if (nodesResult.status === 'rejected') {
        const e = nodesResult.reason
        const kind = e instanceof ApiError ? e.kind : 'network'
        unavailable.value =
          kind === 'notFound' ? 'notInstalled' : kind === 'stopped' ? 'stopped' : kind === 'auth' ? 'signIn' : kind === 'network' ? 'network' : null
        loadError.value = unavailable.value ? null : (e as ApiError)
      } else {
        unavailable.value = null
        loadError.value = null
      }
      loading.value = false
      refreshing.value = false
    })
  })().finally(() => {
    inFlight = null
  })
  void refreshStatus()
  return inFlight
}

/** /status is admin-only; others simply don't get the MCP and backup details. */
export async function refreshStatus(): Promise<void> {
  try {
    status.value = await api<PluginStatus>('GET', '/status')
  } catch {
    status.value = null
  }
}

export async function refreshLogin(): Promise<void> {
  try {
    login.value = await loginStatus()
  } catch {
    login.value = null
  }
}

/** Runs a write, then reloads. Errors go to the caller (editors keep them on screen). */
export async function mutate<T>(write: () => Promise<T>): Promise<T> {
  const result = await write()
  await refreshAll()
  return result
}
