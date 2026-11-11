import type { PluginConfig } from '../config'
import { buildSeasonContext } from '../domain/seasons'
import { computeNodeDue, WarnLeadDefaults } from '../domain/triggers'
import type { MetricsProvider } from '../metrics/metricsProvider'
import type { Store } from '../store/Store'
import type { DueStatus, MetricType, NodeDue, PluginApp } from '../types'

export type NotificationState = 'normal' | 'warn' | 'alarm'

export interface MaintenanceNotification {
  path: string
  state: NotificationState
  message: string
}

const UNIT: Record<MetricType, string> = {
  calendarTime: 'days',
  engineHours: 'h',
  tripCount: 'trips',
  seasonAnchor: 'days',
  expiry: 'days'
}

function stateForStatus(status: DueStatus): NotificationState | null {
  switch (status) {
    case 'overdue':
      return 'alarm'
    case 'dueSoon':
      return 'warn'
    case 'ok':
      return 'normal'
    case 'unknown':
      return null
  }
}

/** Replaces Signal K path separators in an id segment so it stays one path level. */
function sanitizeSegment(id: string): string {
  return id.replace(/\./g, '-')
}

/**
 * Maps a node's computed due status to maintenance notifications (one per
 * trigger). `unknown` triggers (metric value unavailable) are skipped.
 */
export function notificationsForNode(due: NodeDue): MaintenanceNotification[] {
  const result: MaintenanceNotification[] = []
  for (const trigger of due.triggers) {
    const baseState = stateForStatus(trigger.status)
    if (baseState === null) continue
    const path = `notifications.maintenance.${sanitizeSegment(due.nodeId)}.${sanitizeSegment(
      trigger.triggerId
    )}`
    const remaining = Number.isFinite(trigger.remaining)
      ? Math.round(trigger.remaining * 10) / 10
      : trigger.remaining
    // An active snooze suppresses the warn/alarm: clear the notification (normal)
    // until it expires. The computed status itself stays truthful.
    const snoozed = trigger.snoozedUntil !== undefined && baseState !== 'normal'
    const state: NotificationState = snoozed ? 'normal' : baseState
    const message = snoozed
      ? `${due.name} - ${trigger.name}: snoozed (${remaining} ${UNIT[trigger.metric]} left)`
      : state === 'normal'
        ? `${due.name} - ${trigger.name}: ok (${remaining} ${UNIT[trigger.metric]} left)`
        : `${due.name} - ${trigger.name}: ${trigger.status} (${remaining} ${UNIT[trigger.metric]} left)`
    result.push({ path, state, message })
  }
  return result
}

/**
 * Re-evaluates all nodes on usage-metric change and on an hourly timer, emitting
 * `notifications.maintenance.*` deltas so the app, dashboard, and any other
 * Signal K notification subscriber get maintenance warnings for free.
 */
export class NotificationEvaluator {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly app: PluginApp,
    private readonly pluginId: string,
    private readonly store: Store,
    private readonly metrics: MetricsProvider,
    private readonly config: PluginConfig,
    private readonly log: { debug: (m: string) => void; error: (m: string) => void }
  ) {}

  private get warnDefaults(): WarnLeadDefaults {
    return {
      calendarTime: this.config.notifications.warnLeadDays,
      engineHours: this.config.notifications.warnLeadHours,
      tripCount: this.config.notifications.warnLeadTrips,
      expiry: this.config.notifications.warnLeadExpiryDays
    }
  }

  start(): void {
    if (!this.config.notifications.enabled) return
    this.metrics.onChange(() => void this.evaluateAll())
    this.timer = setInterval(() => void this.evaluateAll(), 60 * 60 * 1000)
    void this.evaluateAll()
  }

  async evaluateAll(): Promise<void> {
    if (!this.config.notifications.enabled) return
    try {
      const [nodes, seasons] = await Promise.all([
        this.store.listNodes(),
        this.store.listSeasons()
      ])
      const metrics = this.metrics.snapshot()
      const season = buildSeasonContext(seasons)
      for (const node of nodes) {
        const due = computeNodeDue(node, metrics, this.warnDefaults, season)
        for (const notification of notificationsForNode(due)) {
          this.emit(notification)
        }
      }
    } catch (e) {
      this.log.error(`notification evaluation failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private emit(notification: MaintenanceNotification): void {
    this.app.handleMessage(this.pluginId, {
      context: 'vessels.self',
      updates: [
        {
          source: { label: this.pluginId },
          timestamp: new Date().toISOString(),
          values: [
            {
              path: notification.path,
              value: {
                state: notification.state,
                method: notification.state === 'normal' ? [] : ['visual'],
                message: notification.message
              }
            }
          ]
        }
      ]
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
