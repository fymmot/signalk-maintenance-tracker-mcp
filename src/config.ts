export interface GitConfig {
  remoteUrl: string
  pushEnabled: boolean
  pushDebounceSeconds: number
  authorName: string
  authorEmail: string
}

export interface NotificationsConfig {
  enabled: boolean
  /** Default warn lead times, used when a trigger has no explicit warnLead. */
  warnLeadDays: number
  warnLeadHours: number
  warnLeadTrips: number
  /** Days before an expiry date (flares, extinguishers) — long enough to buy a replacement. */
  warnLeadExpiryDays: number
}

/**
 * The built-in MCP bridge. When enabled (and an inbound token is set), the plugin
 * starts an HTTP listener on `port` that exposes the maintenance tools to Claude
 * connectors. Expose it via a public HTTPS tunnel; auth is this token, not Signal K's.
 */
export interface McpConfig {
  enabled: boolean
  port: number
  /** Bearer token Claude must send. The bridge does not start until this is set. */
  inboundToken: string
  /** Optional path secret for Claude web connectors (`/mcp/<secret>`). */
  urlSecret: string
  /** Optional comma-separated Host allowlist enabling DNS-rebinding protection. */
  allowedHosts: string
  /**
   * The public HTTPS address the tunnel or proxy gives this port, e.g.
   * `https://maintenance.example.com`. Not a secret; the web app builds the
   * connector URL from it.
   */
  publicUrl: string
}

export interface PluginConfig {
  /**
   * Signal K path of the engine-hours tracker plugin's persistent all-time
   * count. The raw `propulsion.main.runTime` historically had reset anomalies,
   * so point this at the tracker plugin's stable monotonic count.
   */
  engineHoursPath: string
  /** Optional Signal K path for a trip counter. Empty disables tripCount triggers. */
  tripCountPath: string
  git: GitConfig
  notifications: NotificationsConfig
  mcp: McpConfig
  logging: { debug: boolean }
}

export const DEFAULT_CONFIG: PluginConfig = {
  engineHoursPath: 'propulsion.main.runTime',
  tripCountPath: '',
  git: {
    remoteUrl: '',
    pushEnabled: false,
    pushDebounceSeconds: 30,
    authorName: 'signalk-maintenance-tracker-mcp',
    authorEmail: 'maintenance@localhost'
  },
  notifications: {
    enabled: true,
    warnLeadDays: 14,
    warnLeadHours: 10,
    warnLeadTrips: 1,
    warnLeadExpiryDays: 30
  },
  mcp: {
    enabled: true,
    port: 8766,
    inboundToken: '',
    urlSecret: '',
    allowedHosts: '',
    publicUrl: ''
  },
  logging: { debug: false }
}

export const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    engineHoursPath: {
      type: 'string',
      title: 'Engine-hours Signal K path',
      default: DEFAULT_CONFIG.engineHoursPath,
      description:
        "Path of the engine-hours tracker plugin's persistent all-time count (used for hours-based intervals). Values are read as seconds (Signal K runTime) and converted to hours. Confirm the real path from your running server."
    },
    tripCountPath: {
      type: 'string',
      title: 'Trip-count Signal K path (optional)',
      default: DEFAULT_CONFIG.tripCountPath,
      description: 'Leave empty if you do not track trip-count intervals.'
    },
    git: {
      type: 'object',
      title: 'Git-backed storage',
      properties: {
        remoteUrl: {
          type: 'string',
          title: 'Remote URL (private GitHub repo)',
          default: DEFAULT_CONFIG.git.remoteUrl,
          description: 'Off-SD-card backup target for the maintenance datastore. Leave empty for local-only.'
        },
        pushEnabled: {
          type: 'boolean',
          title: 'Push to remote',
          default: DEFAULT_CONFIG.git.pushEnabled
        }
      }
    },
    notifications: {
      type: 'object',
      title: 'Notifications',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Emit notifications.maintenance.* when due',
          default: DEFAULT_CONFIG.notifications.enabled
        },
        warnLeadDays: {
          type: 'number',
          title: 'Default warn lead (days)',
          default: DEFAULT_CONFIG.notifications.warnLeadDays
        },
        warnLeadHours: {
          type: 'number',
          title: 'Default warn lead (engine hours)',
          default: DEFAULT_CONFIG.notifications.warnLeadHours
        },
        warnLeadTrips: {
          type: 'number',
          title: 'Default warn lead (trips)',
          default: DEFAULT_CONFIG.notifications.warnLeadTrips
        },
        warnLeadExpiryDays: {
          type: 'number',
          title: 'Default warn lead before an expiry date (days)',
          default: DEFAULT_CONFIG.notifications.warnLeadExpiryDays
        }
      }
    },
    mcp: {
      type: 'object',
      title: 'MCP bridge (Claude access)',
      description:
        'Exposes the maintenance tools to Claude connectors on a dedicated HTTP port. Put this port behind a public HTTPS tunnel (e.g. Cloudflare); it uses the token below, not Signal K login.',
      properties: {
        enabled: {
          type: 'boolean',
          title: 'Enable the MCP bridge',
          default: DEFAULT_CONFIG.mcp.enabled
        },
        inboundToken: {
          type: 'string',
          title: 'Access token',
          default: DEFAULT_CONFIG.mcp.inboundToken,
          description:
            'A long random secret Claude must send as a Bearer token. The bridge stays off until this is set.'
        },
        port: {
          type: 'number',
          title: 'Port',
          default: DEFAULT_CONFIG.mcp.port,
          description: 'HTTP port the bridge listens on (route your tunnel here).'
        },
        urlSecret: {
          type: 'string',
          title: 'URL secret (Claude web, optional)',
          default: DEFAULT_CONFIG.mcp.urlSecret,
          description:
            'For Claude web connectors that cannot send a Bearer header: connect to https://<host>/mcp/<secret>. Leave empty otherwise.'
        },
        publicUrl: {
          type: 'string',
          title: 'Public address (optional)',
          default: DEFAULT_CONFIG.mcp.publicUrl,
          description:
            'The HTTPS address your tunnel or proxy gives this port, e.g. https://maintenance.example.com. Used to show the connector URL in the web app.'
        },
        allowedHosts: {
          type: 'string',
          title: 'Allowed hosts (optional)',
          default: DEFAULT_CONFIG.mcp.allowedHosts,
          description:
            'Comma-separated Host values (e.g. maintenance.example.com) to enable DNS-rebinding protection. Leave empty to accept any Host.'
        }
      }
    },
    logging: {
      type: 'object',
      title: 'Logging',
      properties: {
        debug: { type: 'boolean', title: 'Debug logging', default: DEFAULT_CONFIG.logging.debug }
      }
    }
  }
}

export const CONFIG_UISCHEMA = {
  git: {
    pushEnabled: { 'ui:widget': 'checkbox' }
  },
  notifications: {
    enabled: { 'ui:widget': 'checkbox' }
  },
  mcp: {
    enabled: { 'ui:widget': 'checkbox' },
    inboundToken: { 'ui:widget': 'password' },
    urlSecret: { 'ui:widget': 'password' }
  },
  logging: {
    debug: { 'ui:widget': 'checkbox' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Coerces raw plugin settings into a fully-populated, defaulted config. */
export function coerceConfig(settings: unknown): PluginConfig {
  const s = isRecord(settings) ? settings : {}
  const git = isRecord(s.git) ? s.git : {}
  const notifications = isRecord(s.notifications) ? s.notifications : {}
  const mcp = isRecord(s.mcp) ? s.mcp : {}
  const logging = isRecord(s.logging) ? s.logging : {}

  return {
    engineHoursPath: str(s.engineHoursPath, DEFAULT_CONFIG.engineHoursPath),
    tripCountPath: str(s.tripCountPath, DEFAULT_CONFIG.tripCountPath),
    git: {
      remoteUrl: str(git.remoteUrl, DEFAULT_CONFIG.git.remoteUrl),
      pushEnabled: bool(git.pushEnabled, DEFAULT_CONFIG.git.pushEnabled),
      pushDebounceSeconds: num(git.pushDebounceSeconds, DEFAULT_CONFIG.git.pushDebounceSeconds),
      authorName: str(git.authorName, DEFAULT_CONFIG.git.authorName),
      authorEmail: str(git.authorEmail, DEFAULT_CONFIG.git.authorEmail)
    },
    notifications: {
      enabled: bool(notifications.enabled, DEFAULT_CONFIG.notifications.enabled),
      warnLeadDays: num(notifications.warnLeadDays, DEFAULT_CONFIG.notifications.warnLeadDays),
      warnLeadHours: num(notifications.warnLeadHours, DEFAULT_CONFIG.notifications.warnLeadHours),
      warnLeadTrips: num(notifications.warnLeadTrips, DEFAULT_CONFIG.notifications.warnLeadTrips),
      warnLeadExpiryDays: num(
        notifications.warnLeadExpiryDays,
        DEFAULT_CONFIG.notifications.warnLeadExpiryDays
      )
    },
    mcp: {
      enabled: bool(mcp.enabled, DEFAULT_CONFIG.mcp.enabled),
      port: num(mcp.port, DEFAULT_CONFIG.mcp.port),
      inboundToken: str(mcp.inboundToken, DEFAULT_CONFIG.mcp.inboundToken).trim(),
      urlSecret: str(mcp.urlSecret, DEFAULT_CONFIG.mcp.urlSecret).trim(),
      allowedHosts: str(mcp.allowedHosts, DEFAULT_CONFIG.mcp.allowedHosts).trim(),
      publicUrl: str(mcp.publicUrl, DEFAULT_CONFIG.mcp.publicUrl).trim().replace(/\/+$/, '')
    },
    logging: { debug: bool(logging.debug, DEFAULT_CONFIG.logging.debug) }
  }
}
