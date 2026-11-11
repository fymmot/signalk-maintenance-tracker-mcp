import type { ApiHandler, ApiRequest, ApiResponse, PluginRouter } from '../types'

/**
 * An in-process router that captures the plugin's REST route handlers and lets the
 * MCP layer invoke them directly — no HTTP, no self-loopback, no duplicated logic.
 *
 * We register the exact same routes into this dispatcher that `registerRoutes`
 * registers on the Signal K Express router, so an MCP tool call runs the identical
 * handler the REST API would, against the same store. The REST API stays the single
 * source of truth.
 */
export interface DispatchResult {
  status: number
  /** The value passed to res.json()/res.send(); undefined for sendStatus()/no body. */
  body: unknown
}

export interface Dispatcher {
  /** Pass to `registerRoutes(dispatcher.router, deps)` to capture the routes. */
  router: PluginRouter
  call(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined> }
  ): Promise<DispatchResult>
}

interface Route {
  method: string
  segments: string[]
  handler: ApiHandler
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/** Match a request's segments against a route pattern, extracting `:param` values. */
function matchSegments(
  pattern: string[],
  actual: string[]
): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(actual[i])
    } else if (p !== actual[i]) {
      return undefined
    }
  }
  return params
}

export function createDispatcher(): Dispatcher {
  const routes: Route[] = []

  const add =
    (method: string) =>
    (path: string, handler: ApiHandler): void => {
      routes.push({ method, segments: splitPath(path), handler })
    }

  const router: PluginRouter = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    delete: add('DELETE')
  }

  async function call(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined> } = {}
  ): Promise<DispatchResult> {
    const wantMethod = method.toUpperCase()
    const actual = splitPath(path)

    // First registered match wins, mirroring Express (literal routes are registered
    // before their `:param` siblings, e.g. /seasons/current before /seasons/:id).
    for (const route of routes) {
      if (route.method !== wantMethod) continue
      const params = matchSegments(route.segments, actual)
      if (!params) continue

      let status = 200
      let body: unknown
      const res: ApiResponse = {
        status(code) {
          status = code
          return res
        },
        json(b) {
          body = b
          return res
        },
        send(b) {
          body = b
          return res
        },
        sendStatus(code) {
          status = code
          body = undefined
          return res
        },
        contentType() {
          return res
        },
        set() {
          return res
        }
      }

      const req: ApiRequest = {
        params,
        query: opts.query ?? {},
        body: opts.body
      }

      await route.handler(req, res)
      return { status, body }
    }

    return { status: 404, body: { message: `no route for ${wantMethod} ${path}` } }
  }

  return { router, call }
}

/** Serialize a dispatch result to the text an MCP tool returns (mirrors the old bridge). */
export function resultToText(result: DispatchResult): string {
  if (result.body !== undefined) {
    return typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
  }
  return JSON.stringify({ ok: result.status < 400, status: result.status })
}
