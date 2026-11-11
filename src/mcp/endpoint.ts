import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { registerRoutes, type RouterDeps } from '../api/router'
import type { McpRuntimeStatus } from '../types'

export type { McpRuntimeStatus }
import { createDispatcher } from './dispatcher'
import { registerPhotoTools } from './photoTools'
import { MCP_INSTRUCTIONS, registerMaintenanceTools } from './tools'

/**
 * The MCP bridge runs on its own HTTP port inside the plugin process. It can't live on
 * a `/plugins/...` route: Signal K's security rejects any bearer token it doesn't itself
 * recognise (401) before the handler runs, and Claude presents THIS server's token, not a
 * Signal K one. So we listen on a dedicated port and do our own auth. Point a public HTTPS
 * tunnel (e.g. Cloudflare) at this port; nothing else should be exposed.
 */
export interface McpEndpointOptions {
  port: number
  inboundToken: string
  urlSecret?: string
  allowedHosts?: string[]
  version: string
  deps: RouterDeps
  log: { debug: (m: string) => void; error: (m: string) => void }
  /** Called when the listener fails, e.g. the port is already in use. */
  onError?: (message: string) => void
  /** Called once the port is bound. */
  onListening?: () => void
}

export interface RunningMcpEndpoint {
  close: () => Promise<void>
  status: () => McpRuntimeStatus
}

/** Room for one photo from the panel as base64 (~450 KB) with plenty to spare, or a phone original. */
const MAX_BODY_BYTES = 8_000_000

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Starts the MCP HTTP listener. The plugin's REST routes are captured once into an
 * in-process dispatcher, so each MCP tool runs the identical handler the REST API uses.
 */
export function startMcpEndpoint(opts: McpEndpointOptions): RunningMcpEndpoint {
  const dispatcher = createDispatcher()
  registerRoutes(dispatcher.router, opts.deps)

  const useDnsProtection = !!opts.allowedHosts && opts.allowedHosts.length > 0
  const runtime: McpRuntimeStatus = {
    listening: false,
    port: opts.port,
    requestCount: 0,
    unauthorizedCount: 0,
    dnsRebindingProtection: useDnsProtection,
    allowedHosts: opts.allowedHosts ?? []
  }

  const buildServer = (): McpServer => {
    const server = new McpServer(
      { name: 'signalk-maintenance', version: opts.version },
      { instructions: MCP_INSTRUCTIONS }
    )
    registerMaintenanceTools(server, dispatcher)
    registerPhotoTools(server, dispatcher)
    return server
  }

  // Authorize: `Authorization: Bearer <token>`, or a `/mcp/<urlSecret>` path for Claude web
  // connectors that can't set a Bearer header. Returns true when the request may proceed.
  const authorize = (req: IncomingMessage): boolean => {
    const url = req.url ?? '/'
    const path = url.split('?')[0]
    if (opts.urlSecret) {
      const prefix = `/mcp/${opts.urlSecret}`
      if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) {
        return true
      }
    }
    const header = req.headers['authorization']
    const auth = Array.isArray(header) ? header[0] ?? '' : header ?? ''
    if (!auth.toLowerCase().startsWith('bearer ')) return false
    return timingSafeEqualStr(auth.slice(7).trim(), opts.inboundToken)
  }

  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      try {
        if (!authorize(req)) {
          runtime.unauthorizedCount++
          runtime.lastUnauthorizedAt = new Date().toISOString()
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        runtime.requestCount++
        runtime.lastRequestAt = new Date().toISOString()
        const body = req.method === 'POST' ? await readBody(req) : undefined

        // Stateless: a fresh server + transport per request (no session state to leak
        // between Claude requests). Matches the previous Python bridge's stateless mode.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
          enableDnsRebindingProtection: useDnsProtection,
          allowedHosts: opts.allowedHosts
        })
        const server = buildServer()
        res.on('close', () => {
          void transport.close()
          void server.close()
        })
        await server.connect(transport)
        await transport.handleRequest(req, res, body)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        opts.log.error(`[mcp] request failed: ${msg}`)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
        else res.end()
      }
    })()
  })

  httpServer.on('error', (e) => {
    const message = e instanceof Error ? e.message : String(e)
    opts.log.error(`[mcp] HTTP server error: ${message}`)
    runtime.listening = httpServer.listening
    runtime.lastError = message
    opts.onError?.(message)
  })
  httpServer.listen(opts.port, () => {
    runtime.listening = true
    runtime.startedAt = new Date().toISOString()
    runtime.lastError = undefined
    opts.log.debug(`[mcp] listening on :${opts.port}`)
    opts.onListening?.()
  })

  return {
    close: () =>
      new Promise<void>((resolve) => {
        if (!httpServer.listening) {
          resolve()
          return
        }
        httpServer.close(() => resolve())
        // An idle keep-alive connection would otherwise hold close() open.
        httpServer.closeAllConnections()
      }).then(() => {
        runtime.listening = false
      }),
    status: () => ({ ...runtime, allowedHosts: [...runtime.allowedHosts] })
  }
}
