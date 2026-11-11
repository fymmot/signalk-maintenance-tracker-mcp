import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerRoutes, type RouterDeps } from '../src/api/router'
import { coerceConfig } from '../src/config'
import { createDispatcher } from '../src/mcp/dispatcher'
import { startMcpEndpoint, type RunningMcpEndpoint } from '../src/mcp/endpoint'
import { PHOTO_PANEL_URI } from '../src/mcp/photoTools'
import type { MetricsProvider } from '../src/metrics/metricsProvider'
import type { NotificationEvaluator } from '../src/notifications/evaluator'
import { sanitizeJpeg } from '../src/photos/jpeg'
import { PHOTO_TTL_MS, PhotoStore, type PendingPhoto } from '../src/photos/PhotoStore'
import { Store } from '../src/store/Store'
import { SchemaValidator } from '../src/store/validation'
import { fakeJpeg } from './photoFixtures'

function makeDeps(dir = mkdtempSync(join(tmpdir(), 'maint-photos-')), now?: () => Date) {
  const commits: Array<{ paths: string[]; message: string }> = []
  const store = new Store(dir, new SchemaValidator(), {
    commit: async (paths, message) => {
      commits.push({ paths, message })
    }
  })
  const deps: RouterDeps = {
    store,
    metrics: { snapshot: () => ({ calendarTime: 20000 }) } as unknown as MetricsProvider,
    evaluator: { evaluateAll: async () => undefined } as unknown as NotificationEvaluator,
    config: coerceConfig({}),
    photos: new PhotoStore(dir, now),
    log: { debug: () => undefined, error: () => undefined }
  }
  return { dir, deps, commits }
}

describe('sanitizeJpeg', () => {
  it('drops EXIF and comments, keeps JFIF and the scan, reads the size', () => {
    const input = fakeJpeg({ width: 2000, height: 1500 })
    expect(input.includes(Buffer.from('GPSLatitude'))).toBe(true)
    const out = sanitizeJpeg(input)
    expect(out.width).toBe(2000)
    expect(out.height).toBe(1500)
    expect(out.bytes.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(out.bytes.includes(Buffer.from('hello'))).toBe(false)
    expect(out.bytes.includes(Buffer.from('JFIF'))).toBe(true)
    expect(out.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
  })

  it('refuses something that is not a JPEG', () => {
    expect(() => sanitizeJpeg(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toThrow(/Not a JPEG/)
  })
})

describe('pending photos through the router', () => {
  let call: ReturnType<typeof createDispatcher>['call']
  let dir: string
  let clock: Date

  beforeEach(() => {
    clock = new Date('2026-11-08T10:00:00Z')
    const made = makeDeps(undefined, () => clock)
    dir = made.dir
    const d = createDispatcher()
    registerRoutes(d.router, made.deps)
    call = d.call
  })

  const upload = async (seed = 0) => {
    const r = await call('POST', '/photos/pending', {
      body: { contentBase64: fakeJpeg({ seed }).toString('base64'), takenAt: '2026-11-07T08:00:00Z' }
    })
    expect(r.status).toBe(201)
    return r.body as PendingPhoto
  }

  it('stores an upload without its metadata and hands back a handle', async () => {
    const p = await upload()
    expect(p.handle).toMatch(/^ph_[0-9a-f]{12}$/)
    expect(p.id).toMatch(/^[0-9a-f]{64}\.jpg$/)
    expect(p.width).toBe(640)
    expect(p.takenAt).toBe('2026-11-07T08:00:00.000Z')
    const bytes = await call('GET', `/photos/pending/${p.handle}`)
    expect(bytes.status).toBe(200)
    expect((bytes.body as Buffer).includes(Buffer.from('GPS'))).toBe(false)
    expect(existsSync(join(dir, '.pending-photos', p.id))).toBe(true)
  })

  it('refuses a PNG and empty data', async () => {
    const png = await call('POST', '/photos/pending', { body: { contentBase64: 'iVBORw0KGgo=' } })
    expect(png.status).toBe(400)
    expect((png.body as { message: string }).message).toMatch(/JPEG/)
    const empty = await call('POST', '/photos/pending', { body: {} })
    expect(empty.status).toBe(400)
  })

  it('stores the same photo once however many times it is uploaded', async () => {
    const a = await upload(7)
    const b = await upload(7)
    expect(a.handle).not.toBe(b.handle)
    expect(a.id).toBe(b.id)
    const jpgs = readdirSync(join(dir, '.pending-photos')).filter((n) => n.endsWith('.jpg'))
    expect(jpgs).toHaveLength(1)
    // Discarding one handle keeps the bytes the other still needs.
    expect((await call('DELETE', `/photos/pending/${a.handle}`)).status).toBe(204)
    expect(existsSync(join(dir, '.pending-photos', a.id))).toBe(true)
    expect((await call('DELETE', `/photos/pending/${b.handle}`)).status).toBe(204)
    expect(existsSync(join(dir, '.pending-photos', a.id))).toBe(false)
  })

  it('lists newest first and sweeps what has expired', async () => {
    const first = await upload(1)
    clock = new Date(clock.getTime() + 60_000)
    const second = await upload(2)
    const list = (await call('GET', '/photos/pending')).body as PendingPhoto[]
    expect(list.map((p) => p.handle)).toEqual([second.handle, first.handle])

    clock = new Date(clock.getTime() + PHOTO_TTL_MS)
    const swept = await call('POST', '/photos/sweep')
    expect(swept.body).toEqual({ expired: 1 })
    expect(((await call('GET', '/photos/pending')).body as PendingPhoto[]).map((p) => p.handle)).toEqual([
      second.handle
    ])
  })

  it('serves nothing for an id that is not a media id', async () => {
    expect((await call('GET', '/media/..%2Fnodes%2Fx.yml')).status).toBe(404)
    expect((await call('GET', `/media/${'a'.repeat(64)}.jpg`)).status).toBe(404)
  })
})

describe('photo panel over MCP', () => {
  const PORT = 8794
  const TOKEN = 'test-token-photos-abcdefghijklmnop'
  let endpoint: RunningMcpEndpoint
  let client: Client

  beforeAll(async () => {
    endpoint = startMcpEndpoint({
      port: PORT,
      inboundToken: TOKEN,
      version: '0.0.0-test',
      deps: makeDeps().deps,
      log: { debug: () => undefined, error: () => undefined }
    })
    client = new Client({ name: 'test', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } }
      })
    )
  })

  afterAll(async () => {
    await client.close()
    await endpoint.close()
  })

  it('opens the panel only from the panel tool', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((t) => [t.name, t]))
    const ui = (name: string) => (byName.get(name)?._meta as { ui?: { resourceUri?: string; visibility?: string[] } })?.ui
    expect(ui('maintenance_attach_photos')).toEqual({ resourceUri: PHOTO_PANEL_URI, visibility: ['model', 'app'] })
    expect(ui('maintenance_photo_upload')?.visibility).toEqual(['app'])
    expect(ui('maintenance_photo_discard')?.visibility).toEqual(['app'])
    expect(ui('maintenance_list_photos')).toBeUndefined()
    expect(ui('maintenance_discard_photos')).toBeUndefined()
  })

  it('serves the panel as an MCP App resource', async () => {
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toContain(PHOTO_PANEL_URI)
    // Hosts cache a panel by URI, so the URI carries a hash of the HTML.
    expect(PHOTO_PANEL_URI).toMatch(/^ui:\/\/signalk-maintenance\/photos-[0-9a-f]{12}\.html$/)
    const read = await client.readResource({ uri: PHOTO_PANEL_URI })
    const c = read.contents[0] as { mimeType: string; text: string }
    expect(c.mimeType).toBe('text/html;profile=mcp-app')
    expect(c.text).toContain('ui/initialize')
    expect(c.text).toContain('appInfo')
    expect(c.text).toContain('ui/notifications/size-changed')
    expect(c.text).toContain('accept="image/*"')
    // The Claude Android app reports a multi-select pick as cancelled, and some hosts fire only 'input'.
    expect(c.text).toContain("fileEl.addEventListener('input'")
    expect(c.text).toContain('fileEl.multiple = true')
    expect(c.text).not.toContain('accept="image/*" multiple')
  })

  it('takes a panel-sized upload through the bridge and lists it with the image', async () => {
    // ~600 KB of base64: over the old 1 MB body limit once JSON-wrapped with headroom.
    const big = Buffer.concat([fakeJpeg({ seed: 3 }).subarray(0, -2), Buffer.alloc(600_000, 0x11), Buffer.from([0xff, 0xd9])])
    const up = await client.callTool({
      name: 'maintenance_photo_upload',
      arguments: { content_base64: big.toString('base64') }
    })
    const handle = (up.structuredContent as { handle: string }).handle
    expect(handle).toMatch(/^ph_/)

    const list = await client.callTool({ name: 'maintenance_list_photos', arguments: {} })
    const content = list.content as Array<{ type: string; text?: string }>
    expect(content[0].text).toContain(handle)
    expect(content.some((c) => c.type === 'image')).toBe(true)

    const gone = await client.callTool({ name: 'maintenance_discard_photos', arguments: { handles: [handle] } })
    expect((gone.content as Array<{ text: string }>)[0].text).toContain('Discarded 1')
  })
})

describe('linking photos to records', () => {
  let call: ReturnType<typeof createDispatcher>['call']
  let dir: string
  let commits: Array<{ paths: string[]; message: string }>

  beforeEach(async () => {
    const made = makeDeps()
    dir = made.dir
    commits = made.commits
    const d = createDispatcher()
    registerRoutes(d.router, made.deps)
    call = d.call
    await call('POST', '/nodes', { body: { id: 'engine', type: 'component', name: 'Engine' } })
  })

  const upload = async (seed: number) =>
    ((await call('POST', '/photos/pending', { body: { contentBase64: fakeJpeg({ seed }).toString('base64') } }))
      .body as PendingPhoto)

  type WithPhotos = { attachments?: Array<{ id: string; caption?: string; width?: number }> }

  it('moves a photo into the repo with the record that names it, in one commit', async () => {
    const p = await upload(1)
    const r = await call('PUT', '/nodes/engine', { body: { photos: [{ handle: p.handle, caption: 'Nameplate' }] } })
    expect(r.status).toBe(200)
    const node = r.body as WithPhotos
    expect(node.attachments).toEqual([
      expect.objectContaining({ id: p.id, caption: 'Nameplate', width: 640, height: 480 })
    ])
    expect(commits.at(-1)?.paths).toEqual(['nodes/engine.yml', `media/${p.id}`])
    expect(existsSync(join(dir, 'media', p.id))).toBe(true)
    // The repo has it now; the pending copy is gone and the handle is no longer "waiting".
    expect(existsSync(join(dir, '.pending-photos', p.id))).toBe(false)
    expect(((await call('GET', '/photos/pending')).body as PendingPhoto[])).toEqual([])
    const media = await call('GET', `/media/${p.id}`)
    expect(media.status).toBe(200)
    expect(Buffer.isBuffer(media.body)).toBe(true)
  })

  it('keeps photos on an update that does not mention them, and replaces them when it does', async () => {
    const p = await upload(2)
    await call('PUT', '/nodes/engine', { body: { photos: [p.handle] } })
    const renamed = (await call('PUT', '/nodes/engine', { body: { name: 'Main engine' } })).body as WithPhotos
    expect(renamed.attachments?.map((a) => a.id)).toEqual([p.id])

    const recaptioned = (await call('PUT', '/nodes/engine', {
      body: { attachments: [{ id: p.id, caption: 'Fuel filter' }] }
    })).body as WithPhotos
    expect(recaptioned.attachments).toEqual([expect.objectContaining({ id: p.id, caption: 'Fuel filter', width: 640 })])

    const cleared = (await call('PUT', '/nodes/engine', { body: { attachments: [] } })).body as WithPhotos
    expect(cleared.attachments).toBeUndefined()
  })

  it('refuses an unknown handle, an id not in the repo, and writes nothing', async () => {
    const before = commits.length
    const bad = await call('PUT', '/nodes/engine', { body: { photos: [{ handle: 'ph_000000000000' }] } })
    expect(bad.status).toBe(400)
    expect((bad.body as { message: string }).message).toMatch(/No such photo/)
    const notHandle = await call('POST', '/events', { body: { title: 'x', photos: [{ handle: 'nope' }] } })
    expect(notHandle.status).toBe(400)
    const foreign = await call('PUT', '/nodes/engine', { body: { attachments: [{ id: `${'b'.repeat(64)}.jpg` }] } })
    expect(foreign.status).toBe(400)
    expect(commits.length).toBe(before)
  })

  it('puts photos on a service job, and adds more to it afterwards', async () => {
    const a = await upload(3)
    const log = (await call('POST', '/nodes/engine/service', {
      body: { description: 'Impeller replaced', photos: [{ handle: a.handle, caption: 'Old impeller' }] }
    })).body as WithPhotos & { id: string }
    expect(log.attachments?.[0]).toMatchObject({ id: a.id, caption: 'Old impeller' })

    const b = await upload(4)
    const linked = await call('POST', '/attachments', { body: { kind: 'log', id: log.id, photos: [b.handle] } })
    expect(linked.status).toBe(200)
    expect((linked.body as WithPhotos).attachments?.map((x) => x.id)).toEqual([a.id, b.id])

    // The same handle can go on a second record: the issue the job fixed, say.
    const issue = (await call('POST', '/issues', {
      body: { nodeId: 'engine', title: 'Overheating', photos: [{ handle: a.handle }] }
    })).body as WithPhotos
    expect(issue.attachments?.[0].id).toBe(a.id)
  })

  it('attaches photos sent with an issue update to that update', async () => {
    const opened = (await call('POST', '/issues', { body: { nodeId: 'engine', title: 'Crack in mount' } }))
      .body as { id: string }
    const a = await upload(5)
    type Hist = { history: Array<{ type: string; comment?: string } & WithPhotos> } & WithPhotos
    const commented = (await call('PUT', `/issues/${opened.id}`, {
      body: { comment: 'It has grown', photos: [{ handle: a.handle, caption: 'Mount, port side' }] }
    })).body as Hist
    expect(commented.attachments).toBeUndefined()
    expect(commented.history.at(-1)).toMatchObject({ type: 'comment', comment: 'It has grown' })
    expect(commented.history.at(-1)?.attachments?.[0]).toMatchObject({ id: a.id, caption: 'Mount, port side' })

    // Photos alone still make an entry, so they have somewhere to live.
    const b = await upload(6)
    const photoOnly = (await call('PUT', `/issues/${opened.id}`, { body: { photos: [b.handle] } })).body as Hist
    expect(photoOnly.history).toHaveLength(3)
    expect(photoOnly.history.at(-1)).toMatchObject({ type: 'comment' })
    expect(photoOnly.history.at(-1)?.comment).toBeUndefined()

    // Removing a photo from the issue takes it off its updates too.
    const removed = (await call('POST', '/attachments', {
      body: { kind: 'issue', id: opened.id, remove: [a.id] }
    })).body as Hist
    expect(removed.history.flatMap((h) => h.attachments ?? []).map((x) => x.id)).toEqual([b.id])
  })

  it('puts photos on an event', async () => {
    const a = await upload(7)
    const ev = (await call('POST', '/events', {
      body: { title: 'Bought the boat', photos: [{ handle: a.handle, caption: 'Day one' }] }
    })).body as WithPhotos & { id: string }
    expect(ev.attachments?.[0]).toMatchObject({ id: a.id, caption: 'Day one' })
    const edited = (await call('PUT', `/events/${ev.id}`, { body: { location: 'Stockholm' } })).body as WithPhotos
    expect(edited.attachments?.map((x) => x.id)).toEqual([a.id])
  })

  it('puts photos on a checklist result and keeps them when a client resends results without them', async () => {
    const tpl = (await call('POST', '/checklists/templates', {
      body: { name: 'Spring', items: [{ id: 'batt', text: 'Battery terminals' }, { id: 'seacock', text: 'Seacocks' }] }
    })).body as { id: string }
    const a = await upload(8)
    const saved = await call('POST', '/checklists/runs', {
      body: {
        templateId: tpl.id,
        results: [
          { itemId: 'batt', text: 'Battery terminals', status: 'fail', note: 'Corroded', photos: [{ handle: a.handle }] },
          { itemId: 'seacock', text: 'Seacocks', status: 'pass' }
        ]
      }
    })
    expect(saved.status).toBe(201)
    const run = saved.body as { id: string; results: Array<{ itemId: string } & WithPhotos> }
    expect(run.results[0].attachments?.[0].id).toBe(a.id)
    expect(run.results[1].attachments).toBeUndefined()

    const resent = (await call('PUT', `/checklists/runs/${run.id}`, {
      body: {
        results: [
          { itemId: 'batt', text: 'Battery terminals', status: 'pass', note: 'Cleaned' },
          { itemId: 'seacock', text: 'Seacocks', status: 'pass' }
        ]
      }
    })).body as typeof run
    expect(resent.results[0].attachments?.map((x) => x.id)).toEqual([a.id])

    const b = await upload(9)
    const linked = await call('POST', '/attachments', {
      body: { kind: 'run', id: run.id, itemId: 'seacock', photos: [{ handle: b.handle }] }
    })
    expect((linked.body as typeof run).results[1].attachments?.[0].id).toBe(b.id)
    const noItem = await call('POST', '/attachments', { body: { kind: 'run', id: run.id, photos: [b.handle] } })
    expect(noItem.status).toBe(400)
  })

  it('links through the MCP tool to exactly one record', async () => {
    const PORT = 8795
    const TOKEN = 'test-token-link-abcdefghijklmnopqrs'
    const made = makeDeps()
    const endpoint = startMcpEndpoint({
      port: PORT,
      inboundToken: TOKEN,
      version: '0',
      deps: made.deps,
      log: { debug: () => undefined, error: () => undefined }
    })
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } }
      })
    )
    try {
      await client.callTool({ name: 'maintenance_create_node', arguments: { type: 'part', name: 'Flares' } })
      const up = await client.callTool({
        name: 'maintenance_photo_upload',
        arguments: { content_base64: fakeJpeg({ seed: 10 }).toString('base64') }
      })
      const handle = (up.structuredContent as { handle: string }).handle
      const two = await client.callTool({
        name: 'maintenance_link_photos',
        arguments: { node_id: 'flares', event_id: 'x', photos: [{ handle }] }
      })
      expect(two.isError).toBe(true)
      const ok = await client.callTool({
        name: 'maintenance_link_photos',
        arguments: { node_id: 'flares', photos: [{ handle, caption: 'Expiry label' }] }
      })
      const node = JSON.parse((ok.content as Array<{ text: string }>)[0].text) as WithPhotos
      expect(node.attachments?.[0].caption).toBe('Expiry label')

      const seen = await client.callTool({ name: 'maintenance_list_photos', arguments: { ids: [node.attachments![0].id] } })
      expect((seen.content as Array<{ type: string }>).some((c) => c.type === 'image')).toBe(true)
    } finally {
      await client.close()
      await endpoint.close()
    }
  })
})

describe('captions on photos already linked', () => {
  it('sets and clears a caption through POST /attachments', async () => {
    const { recaption, parseCaptions } = await import('../src/domain/attachments')
    const id = 'a'.repeat(64) + '.jpg'
    const list = [{ id, addedAt: '2026-01-01T00:00:00Z', caption: 'Old' }]
    expect(recaption(list, parseCaptions({ [id]: ' Nameplate ' }))).toEqual([{ id, addedAt: '2026-01-01T00:00:00Z', caption: 'Nameplate' }])
    expect(recaption(list, parseCaptions({ [id]: '' }))).toEqual([{ id, addedAt: '2026-01-01T00:00:00Z' }])
    expect(parseCaptions({ 'not-a-photo': 'x', [id]: 3 }).size).toBe(0)
  })
})
