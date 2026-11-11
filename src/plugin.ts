import { mkdirSync } from 'fs'
import { collectRoutes, type CollectedRoute, type RouterDeps } from './api/router'
import { coerceConfig, CONFIG_SCHEMA, CONFIG_UISCHEMA, type PluginConfig } from './config'
import { startMcpEndpoint, type RunningMcpEndpoint } from './mcp/endpoint'
import { MetricsProvider } from './metrics/metricsProvider'
import { NotificationEvaluator } from './notifications/evaluator'
import { PhotoStore } from './photos/PhotoStore'
import { loadOpenApi } from './openapi'
import { GitStore } from './store/git'
import { Store } from './store/Store'
import { SchemaValidator } from './store/validation'
import type { McpState, Plugin, PluginApp, PluginRouter, PluginStatus } from './types'

const PLUGIN_ID = 'signalk-maintenance-tracker-mcp'

function pluginVersion(): string {
  try {
    return (require('../package.json') as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createPlugin(app: PluginApp): Plugin {
  let metrics: MetricsProvider | undefined
  let evaluator: NotificationEvaluator | undefined
  let git: GitStore | undefined
  let mcpEndpoint: RunningMcpEndpoint | undefined
  /** The REST handlers of the current start(); undefined while stopped. */
  let liveRoutes: CollectedRoute[] | undefined
  /** The config of the current start(); undefined while stopped. */
  let liveConfig: PluginConfig | undefined

  /** The plugin's health for the web app. Booleans only where the config holds secrets. */
  const statusSnapshot = (): PluginStatus => {
    const config = liveConfig
    if (!config) return { version: pluginVersion(), running: false }
    const runtime = mcpEndpoint?.status()
    const tokenSet = !!config.mcp.inboundToken
    const mcpState: McpState = !config.mcp.enabled
      ? 'off'
      : !tokenSet
        ? 'needsToken'
        : runtime?.listening
          ? 'running'
          : runtime?.lastError
            ? 'error'
            : 'starting'
    return {
      version: pluginVersion(),
      running: true,
      git: git?.status(),
      notifications: { enabled: config.notifications.enabled },
      metrics: {
        engineHoursPath: config.engineHoursPath,
        tripCountPath: config.tripCountPath || undefined,
        ...metrics?.snapshot()
      },
      mcp: {
        state: mcpState,
        enabled: config.mcp.enabled,
        port: config.mcp.port,
        tokenSet,
        urlSecretSet: !!config.mcp.urlSecret,
        publicUrl: config.mcp.publicUrl || undefined,
        allowedHosts: config.mcp.allowedHosts
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        runtime
      }
    }
  }

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: 'Maintenance Tracker MCP',
    description:
      'Boat maintenance tracking: service intervals, a defect register and checklists, stored as git-backed YAML, with a built-in MCP server for Claude.',
    schema: () => CONFIG_SCHEMA,
    uiSchema: () => CONFIG_UISCHEMA,

    start: (settings: unknown) => {
      try {
        const config = coerceConfig(settings)
        const log = {
          debug: (m: string) => {
            if (config.logging.debug) app.debug(m)
          },
          error: (m: string) => app.error(m)
        }

        const dataDir = app.getDataDirPath()
        // simple-git refuses a directory that doesn't exist yet.
        mkdirSync(dataDir, { recursive: true })

        git = new GitStore(
          {
            dir: dataDir,
            remoteUrl: config.git.remoteUrl,
            pushEnabled: config.git.pushEnabled,
            pushDebounceMs: config.git.pushDebounceSeconds * 1000,
            authorName: config.git.authorName,
            authorEmail: config.git.authorEmail
          },
          log
        )

        const store = new Store(dataDir, new SchemaValidator(), git)
        metrics = new MetricsProvider(app, config, log)
        evaluator = new NotificationEvaluator(app, plugin.id, store, metrics, config, log)
        const photos = new PhotoStore(dataDir)
        const deps: RouterDeps = { store, metrics, evaluator, config, photos, log }
        liveRoutes = collectRoutes(deps)
        liveConfig = config

        // Git init is async; reads work immediately, and the first user write
        // happens well after this resolves.
        git
          .init()
          .then(() => log.debug(`datastore ready at ${dataDir}`))
          .catch((e) => app.setPluginError?.(`git init failed: ${errorMessage(e)}`))

        metrics.start()
        evaluator.start()

        // Built-in MCP server: an HTTP listener in this process (see mcp/endpoint.ts).
        // It starts only when enabled AND an access token is set, so the plugin never
        // opens an unauthenticated port.
        if (config.mcp.enabled && config.mcp.inboundToken) {
          const allowedHosts = config.mcp.allowedHosts
            ? config.mcp.allowedHosts.split(',').map((h) => h.trim()).filter(Boolean)
            : undefined
          app.setPluginStatus?.(`Started (MCP starting on :${config.mcp.port})`)
          mcpEndpoint = startMcpEndpoint({
            port: config.mcp.port,
            inboundToken: config.mcp.inboundToken,
            urlSecret: config.mcp.urlSecret || undefined,
            allowedHosts,
            version: pluginVersion(),
            deps,
            log,
            onListening: () => app.setPluginStatus?.(`Started (MCP on :${config.mcp.port})`),
            onError: (m) => app.setPluginError?.(`MCP server on port ${config.mcp.port}: ${m}`)
          })
        } else {
          app.setPluginStatus?.(
            `Started (${config.mcp.enabled ? 'MCP waiting for an access token' : 'MCP off'})`
          )
        }

        log.debug(`[${plugin.id}] started (engineHoursPath=${config.engineHoursPath})`)
      } catch (e) {
        const msg = errorMessage(e)
        app.setPluginError?.(msg)
        app.error(msg)
      }
    },

    // The server awaits this before the next start(), so the MCP port is free again
    // and any pending backup push has run.
    stop: async () => {
      liveRoutes = undefined
      liveConfig = undefined
      evaluator?.stop()
      metrics?.stop()
      const endpoint = mcpEndpoint
      const g = git
      evaluator = undefined
      metrics = undefined
      mcpEndpoint = undefined
      git = undefined
      await Promise.all([
        endpoint?.close().catch(() => undefined),
        g
          ?.flush()
          .catch(() => undefined)
          .finally(() => g.stop())
      ])
      app.setPluginStatus?.('Stopped')
    },

    // The server calls this once, when it loads the plugin: before start() if the
    // plugin is enabled at boot, and never again when it's enabled later or restarted
    // with a new config. So the paths are registered here once, and every request runs
    // the handler from the current start().
    // The server calls this once, when it loads the plugin: before start() if the
    // plugin is enabled at boot, and never again when it's enabled later or restarted
    // with a new config. So the paths are registered here once, and every request runs
    // the handler from the current start().
    //
    // Reads are open to read-only users and writes to read-write users, where the
    // server supports access levels (Signal K 2.x); /status stays admin-only because it
    // describes the MCP server's setup.
    registerWithRouter: (router: PluginRouter) => {
      const readonly = router.access?.('readonly') ?? router
      const readwrite = router.access?.('readwrite') ?? router
      collectRoutes({} as RouterDeps).forEach((route, i) => {
        const scoped = route.method === 'get' ? readonly : readwrite
        scoped[route.method](route.path, (req, res) => {
          const live = liveRoutes?.[i]
          if (!live) {
            res.status(503).json({ message: 'The maintenance tracker is stopped. Enable it in Plugin Config.' })
            return
          }
          return live.handler(req, res)
        })
      })
      router.get('/status', (_req, res) => {
        res.json(statusSnapshot())
      })
    },

    getOpenApi: () => loadOpenApi()
  }

  return plugin
}
