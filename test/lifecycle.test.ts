import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPlugin } from '../src/plugin'
import type { ApiHandler, ApiResponse, PluginApp, PluginRouter } from '../src/types'

/** A stub app like the one the plugin registry and plugin-ci start the plugin with. */
function fakeApp(): PluginApp & { setPluginError: ReturnType<typeof vi.fn> } {
  // A directory that doesn't exist yet: the plugin must create it.
  const dataDir = join(mkdtempSync(join(tmpdir(), 'maint-life-')), 'data')
  return {
    debug: vi.fn(),
    error: vi.fn(),
    getDataDirPath: () => dataDir,
    handleMessage: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn()
  }
}

/** Records routes the way Express would, so a test can call them by method and path. */
function fakeRouter(): {
  router: PluginRouter
  levels: Map<string, string>
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>
} {
  const routes = new Map<string, ApiHandler>()
  /** The access level each route was registered with, as Signal K 2.x records it. */
  const levels = new Map<string, string>()
  const registrar = (level: string) => {
    const add = (method: string) => (path: string, handler: ApiHandler) => {
      routes.set(`${method} ${path}`, handler)
      levels.set(`${method} ${path}`, level)
    }
    return { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }
  }
  const router: PluginRouter = { ...registrar('admin'), access: (level) => registrar(level) }
  const call = async (method: string, path: string, body?: unknown) => {
    const handler = routes.get(`${method} ${path}`)
    if (!handler) throw new Error(`no route ${method} ${path}`)
    let status = 200
    let sent: unknown
    const res: ApiResponse = {
      status(code) {
        status = code
        return res
      },
      json(b) {
        sent = b
        return res
      },
      send(b) {
        sent = b
        return res
      },
      sendStatus(code) {
        status = code
        return res
      },
      contentType: () => res,
      set: () => res
    }
    await handler({ params: {}, query: {}, body }, res)
    return { status, body: sent }
  }
  return { router, levels, call }
}

/**
 * Errors the plugin reported, except a missing `git` binary: the registry's sandbox
 * may not have one, and that is the one failure the plugin tolerates by design.
 */
function pluginErrors(app: ReturnType<typeof fakeApp>): string[] {
  return app.setPluginError.mock.calls.map(([m]) => String(m)).filter((m) => !m.startsWith('git init failed'))
}

describe('plugin lifecycle', () => {
  it('starts with an empty config, stops and starts again without errors', async () => {
    const app = fakeApp()
    const plugin = createPlugin(app)
    expect(typeof plugin.schema === 'function' ? plugin.schema() : plugin.schema).toHaveProperty('properties')

    expect(() => plugin.start({})).not.toThrow()
    await plugin.stop()
    expect(() => plugin.start({})).not.toThrow()
    await plugin.stop()

    expect(pluginErrors(app)).toEqual([])
  })

  it('serves REST routes registered before start, and follows a restart', async () => {
    const app = fakeApp()
    const plugin = createPlugin(app)
    const { router, call } = fakeRouter()

    // The server registers routes once, at load, possibly before start().
    plugin.registerWithRouter?.(router)
    expect((await call('GET', '/nodes')).status).toBe(503)

    plugin.start({})
    const created = await call('POST', '/nodes', { name: 'Engine', type: 'system' })
    expect(created.status).toBe(201)
    expect(await call('GET', '/nodes')).toMatchObject({ status: 200, body: [{ name: 'Engine' }] })

    // A config change is stop() + start(): the same routes must reach the new instance.
    await plugin.stop()
    expect((await call('GET', '/nodes')).status).toBe(503)
    plugin.start({ notifications: { enabled: false } })
    expect(await call('GET', '/nodes')).toMatchObject({ status: 200, body: [{ name: 'Engine' }] })
    await plugin.stop()
  })

  it('frees the MCP port on stop so a restart can listen again', async () => {
    const app = fakeApp()
    const plugin = createPlugin(app)
    const config = { mcp: { enabled: true, inboundToken: 'lifecycle-token-0123456789', port: 8799 } }

    plugin.start(config)
    await new Promise((r) => setTimeout(r, 50))
    await plugin.stop()
    plugin.start(config)
    await new Promise((r) => setTimeout(r, 50))
    await plugin.stop()

    expect(pluginErrors(app)).toEqual([])
  })

  it('opens reads to read-only users and writes to read-write users, and keeps /status for admins', () => {
    const plugin = createPlugin(fakeApp())
    const { router, levels } = fakeRouter()
    plugin.registerWithRouter?.(router)
    expect(levels.get('GET /nodes')).toBe('readonly')
    expect(levels.get('GET /work')).toBe('readonly')
    expect(levels.get('POST /nodes/:id/service')).toBe('readwrite')
    expect(levels.get('DELETE /nodes/:id')).toBe('readwrite')
    expect(levels.get('GET /status')).toBe('admin')
  })

  it('reports its state on /status without revealing secrets', async () => {
    const plugin = createPlugin(fakeApp())
    const { router, call } = fakeRouter()
    plugin.registerWithRouter?.(router)
    expect((await call('GET', '/status')).body).toMatchObject({ running: false })

    plugin.start({})
    expect((await call('GET', '/status')).body).toMatchObject({
      running: true,
      mcp: { state: 'needsToken', tokenSet: false, port: 8766 }
    })
    await plugin.stop()

    const token = 'status-token-0123456789abcdef'
    plugin.start({ mcp: { inboundToken: token, urlSecret: 'path-secret-xyz', port: 8798, publicUrl: 'https://boat.example.com/' } })
    await new Promise((r) => setTimeout(r, 50))
    const status = (await call('GET', '/status')).body
    expect(status).toMatchObject({
      mcp: {
        state: 'running',
        tokenSet: true,
        urlSecretSet: true,
        publicUrl: 'https://boat.example.com',
        runtime: { listening: true, requestCount: 0, unauthorizedCount: 0 }
      }
    })
    expect(JSON.stringify(status)).not.toContain(token)
    expect(JSON.stringify(status)).not.toContain('path-secret-xyz')

    // A request without the token is turned away and counted.
    const res = await fetch('http://127.0.0.1:8798/mcp', { method: 'POST' })
    expect(res.status).toBe(401)
    expect((await call('GET', '/status')).body).toMatchObject({ mcp: { runtime: { unauthorizedCount: 1 } } })
    await plugin.stop()
  })

  it('reports a port that is already taken', async () => {
    const blocker = createServer().listen(8797)
    await new Promise((r) => blocker.once('listening', r))
    const app = fakeApp()
    const plugin = createPlugin(app)
    const { router, call } = fakeRouter()
    plugin.registerWithRouter?.(router)
    plugin.start({ mcp: { inboundToken: 'busy-port-token-0123456789', port: 8797 } })
    await new Promise((r) => setTimeout(r, 50))
    expect((await call('GET', '/status')).body).toMatchObject({ mcp: { state: 'error', runtime: { listening: false } } })
    expect(app.setPluginError).toHaveBeenCalledWith(expect.stringContaining('8797'))
    await plugin.stop()
    await new Promise((r) => blocker.close(r))
  })
})
