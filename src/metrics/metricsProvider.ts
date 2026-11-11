import type { PluginConfig } from '../config'
import type { MetricsSnapshot, PluginApp } from '../types'
import { engineHoursFromRunTime, MetricLogger, NumericPathSource } from './engineHours'

const MS_PER_DAY = 86_400_000

/**
 * Provides the current value of every tracked metric. `calendarTime` is computed
 * as fractional days since the Unix epoch (so calendar and usage metrics share
 * the same `lastServiceValue + interval` math); `engineHours` is derived from a
 * cached Signal K path (seconds → hours); `tripCount` comes from its path as-is.
 */
export class MetricsProvider {
  private readonly engineHours: NumericPathSource
  private readonly tripCount?: NumericPathSource

  constructor(app: PluginApp, config: PluginConfig, log: MetricLogger) {
    this.engineHours = new NumericPathSource(app, config.engineHoursPath, log)
    if (config.tripCountPath) {
      this.tripCount = new NumericPathSource(app, config.tripCountPath, log)
    }
  }

  start(): void {
    this.engineHours.start()
    this.tripCount?.start()
  }

  stop(): void {
    this.engineHours.stop()
    this.tripCount?.stop()
  }

  /** Registers a callback fired whenever any usage metric changes. */
  onChange(listener: () => void): void {
    this.engineHours.onChange(() => listener())
    this.tripCount?.onChange(() => listener())
  }

  snapshot(now: Date = new Date()): MetricsSnapshot {
    return {
      calendarTime: now.getTime() / MS_PER_DAY,
      engineHours: engineHoursFromRunTime(this.engineHours.get()),
      tripCount: this.tripCount?.get()
    }
  }
}
