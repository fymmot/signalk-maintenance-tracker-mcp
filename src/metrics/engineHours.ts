import type { PluginApp, SubscriptionDelta } from '../types'

export interface MetricLogger {
  debug: (msg: string) => void
  error: (msg: string) => void
}

/** Signal K `propulsion.*.runTime` (and similar) values are seconds; intervals use hours. */
export const SECONDS_PER_HOUR = 3600

export function engineHoursFromRunTime(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds / SECONDS_PER_HOUR
}

/**
 * Subscribes to a single numeric Signal K path on `vessels.self` and caches the
 * latest value. Used for the engine-hours all-time count and (optionally) a trip
 * counter. The plugin never derives its own counter; it consumes these paths.
 */
export class NumericPathSource {
  private value: number | undefined
  private readonly unsubscribes: Array<() => void> = []
  private readonly listeners: Array<(value: number) => void> = []

  constructor(
    private readonly app: PluginApp,
    private readonly path: string,
    private readonly log: MetricLogger
  ) {}

  get(): number | undefined {
    return this.value
  }

  onChange(listener: (value: number) => void): void {
    this.listeners.push(listener)
  }

  start(): void {
    if (!this.path) return
    const manager = this.app.subscriptionmanager
    if (!manager) {
      this.log.error(`subscriptionmanager unavailable; cannot track ${this.path}`)
      return
    }
    const subscription = {
      context: 'vessels.self',
      subscribe: [{ path: this.path, period: 1000 }]
    }
    manager.subscribe(
      subscription,
      this.unsubscribes,
      (err) => this.log.error(`subscription error for ${this.path}: ${String(err)}`),
      (delta: SubscriptionDelta) => this.handleDelta(delta)
    )
    this.log.debug(`tracking ${this.path}`)
  }

  private handleDelta(delta: SubscriptionDelta): void {
    if (!delta.updates) return
    for (const update of delta.updates) {
      if (!update.values) continue
      for (const v of update.values) {
        if (v.path === this.path && typeof v.value === 'number' && Number.isFinite(v.value)) {
          this.value = v.value
          for (const listener of this.listeners) listener(v.value)
        }
      }
    }
  }

  stop(): void {
    this.unsubscribes.forEach((f) => f())
    this.unsubscribes.length = 0
  }
}
