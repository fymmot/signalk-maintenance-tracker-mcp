import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import type { Plugin as VitePlugin } from 'vite'
import { createPlugin } from '../src/plugin'
import type { ApiHandler, ApiRequest, ApiResponse, PluginRouter } from '../src/types'

/*
 * Runs the plugin inside the Vite dev server, so the web app can be worked on with no
 * Signal K server: `npm run dev:web`. It stands in for the parts of Signal K the app
 * uses: the plugin's routes under /plugins/<id>, the plugin config endpoints (saving
 * restarts the plugin, as Signal K does) and /skServer/loginStatus (an admin, no auth).
 *
 * Data lives in .dev-data/ (gitignored). DEV_LOG_WRITES=1 logs every write it receives.
 * Seed it with
 *   SK_URL=http://localhost:3778 node scripts/seed.mjs
 * Set SK_URL when starting Vite to use a real server instead.
 */

const ID = 'signalk-maintenance-tracker-mcp'

interface RouteEntry {
  method: string
  segments: string[]
  handler: ApiHandler
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolveBody(text ? JSON.parse(text) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

export function devHost(): VitePlugin {
  const root = resolve('.dev-data')
  const dataDir = join(root, 'plugin-data')
  const configFile = join(root, 'plugin-config.json')
  mkdirSync(dataDir, { recursive: true })

  const readOptions = () =>
    existsSync(configFile)
      ? JSON.parse(readFileSync(configFile, 'utf8'))
      : { enabled: true, enableLogging: false, enableDebug: false, configuration: {} }

  const app = {
    debug: () => undefined,
    error: (...a: unknown[]) => console.error('[plugin]', ...a),
    getDataDirPath: () => dataDir,
    handleMessage: () => undefined,
    setPluginStatus: (m: string) => console.log('[plugin] status:', m),
    setPluginError: (m: string) => console.error('[plugin] error:', m),
    // A steady engine-hours reading (DEV_ENGINE_HOURS, default 1234 h), sent as Signal K
    // runTime seconds, so hours-based intervals have something to count against.
    subscriptionmanager: {
      subscribe: (
        sub: unknown,
        _unsubscribes: Array<() => void>,
        _onError: (e: unknown) => void,
        onDelta: (d: { updates: Array<{ values: Array<{ path: string; value: number }> }> }) => void
      ) => {
        const path = (sub as { subscribe: Array<{ path: string }> }).subscribe[0]?.path
        const hours = Number(process.env.DEV_ENGINE_HOURS ?? 1234)
        setTimeout(() => onDelta({ updates: [{ values: [{ path, value: hours * 3600 }] }] }), 10)
      }
    }
  }
  const plugin = createPlugin(app)

  const routes: RouteEntry[] = []
  const add = (method: string) => (path: string, handler: ApiHandler) => {
    routes.push({ method, segments: path.split('/').filter(Boolean), handler })
  }
  const router: PluginRouter = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }
  plugin.registerWithRouter?.(router)

  const start = () => {
    const options = readOptions()
    if (options.enabled) plugin.start(options.configuration ?? {})
  }
  start()

  const match = (method: string, path: string): { handler: ApiHandler; params: Record<string, string> } | undefined => {
    const actual = path.split('/').filter(Boolean)
    for (const r of routes) {
      if (r.method !== method || r.segments.length !== actual.length) continue
      const params: Record<string, string> = {}
      if (
        r.segments.every((s, i) => {
          if (s.startsWith(':')) {
            params[s.slice(1)] = decodeURIComponent(actual[i])
            return true
          }
          return s === actual[i]
        })
      ) {
        return { handler: r.handler, params }
      }
    }
    return undefined
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'maintenance-dev-host',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const method = req.method ?? 'GET'
        try {
          if (url.pathname === '/skServer/loginStatus') {
            return json(res, 200, { status: 'loggedIn', authenticationRequired: true, username: 'dev', userLevel: 'admin' })
          }
          if (url.pathname === `/plugins/${ID}/config`) {
            if (method === 'GET') return json(res, 200, readOptions())
            if (method === 'POST') {
              writeFileSync(configFile, JSON.stringify(await readBody(req), null, 2))
              json(res, 200, `Saved configuration for plugin ${ID}`)
              await plugin.stop()
              start()
              return
            }
          }
          const prefix = `/plugins/${ID}`
          if (!url.pathname.startsWith(`${prefix}/`)) return next()
          const found = match(method, url.pathname.slice(prefix.length))
          if (!found) return json(res, 404, { message: 'Not found' })

          const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req)
          if (process.env.DEV_LOG_WRITES && method !== 'GET') console.log('[dev-host]', method, url.pathname, JSON.stringify(body)?.slice(0, 300))
          const apiReq: ApiRequest = { params: found.params, query: Object.fromEntries(url.searchParams), body }
          let status = 200
          const apiRes: ApiResponse = {
            status(code) {
              status = code
              return apiRes
            },
            set(field, value) {
              res.setHeader(field, value)
              return apiRes
            },
            json(b) {
              json(res, status, b)
              return apiRes
            },
            send(b) {
              res.statusCode = status
              res.end(b as Buffer | string)
              return apiRes
            },
            sendStatus(code) {
              res.statusCode = code
              res.end()
              return apiRes
            },
            contentType(type) {
              res.setHeader('Content-Type', type)
              return apiRes
            }
          }
          await found.handler(apiReq, apiRes)
        } catch (e) {
          json(res, 500, { message: (e as Error).message })
        }
      })
    }
  }
}
