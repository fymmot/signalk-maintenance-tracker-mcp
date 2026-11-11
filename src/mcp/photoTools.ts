import { createHash } from 'crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { PHOTO_TTL_MS, type PendingPhoto } from '../photos/PhotoStore'
import { PHOTO_PANEL_HTML } from '../photos/panel'
import type { Dispatcher } from './dispatcher'

/**
 * Versioned by content: Claude caches a panel by its URI, so an unchanged URI kept serving the
 * old panel after a deploy. A new hash for every change makes the host fetch the new one.
 */
export const PHOTO_PANEL_URI = `ui://signalk-maintenance/photos-${createHash('sha256')
  .update(PHOTO_PANEL_HTML)
  .digest('hex')
  .slice(0, 12)}.html`
const APP_MIME = 'text/html;profile=mcp-app'
/** How many images one list call returns; each is a few hundred KB of context. */
const MAX_IMAGES = 6

// Only the tool meant to open the panel carries a resourceUri for the model:
// each call of a tool that has one renders a new panel in the conversation.
const OPENS_PANEL = { ui: { resourceUri: PHOTO_PANEL_URI, visibility: ['model', 'app'] } }
// App-only: the panel calls these; the model never sees them or the base64.
const APP_ONLY = { ui: { resourceUri: PHOTO_PANEL_URI, visibility: ['app'] } }

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] })
const fail = (t: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: t }] })

function messageOf(body: unknown, fallback: string): string {
  const m = (body as { message?: unknown } | undefined)?.message
  return typeof m === 'string' ? m : fallback
}

function describe(p: PendingPhoto): string {
  const kb = Math.round(p.bytes / 1024)
  const taken = p.takenAt ? `, taken ${p.takenAt.slice(0, 16).replace('T', ' ')}` : ''
  const linked = p.linkedTo?.length ? `, linked to ${p.linkedTo.join(', ')}` : ''
  const note = p.note ? ` — "${p.note}"` : ''
  return `${p.handle}: ${p.width}×${p.height}, ${kb} KB${taken}${linked}${note}`
}

/**
 * Registers the photo panel (an MCP Apps resource) and the tools around it.
 * Every tool goes through the REST routes via `dispatcher`, like the rest.
 */
export function registerPhotoTools(server: McpServer, dispatcher: Dispatcher): void {
  server.registerResource(
    'photo-panel',
    PHOTO_PANEL_URI,
    { mimeType: APP_MIME, description: 'Panel for adding photos to maintenance records' },
    async () => ({ contents: [{ uri: PHOTO_PANEL_URI, mimeType: APP_MIME, text: PHOTO_PANEL_HTML }] })
  )

  server.registerTool(
    'maintenance_attach_photos',
    {
      description:
        'Open a panel in this conversation where the user takes or chooses photos (camera, gallery, ' +
        'paste or drop). Call it whenever the user wants to add a photo or mentions one: a photo ' +
        'pasted into the chat cannot reach this server. The panel shrinks each photo, strips its ' +
        'location data, stores it, and on Done puts the photos into your context with a handle for ' +
        'each (ph_…). Then pass photos: [{handle, caption}] to the write tool (open_issue, ' +
        'update_issue, mark_serviced, log_event, create_node / update_node, update_checklist_run) ' +
        'or to maintenance_link_photos for an existing record. `for` names what the photos are ' +
        "for, in a few words (e.g. 'impeller job', 'crack in the stem'). Tell the user to add the " +
        'photos in the panel, not the chat.',
      inputSchema: {
        for: z.string().optional(),
        note: z.string().optional()
      },
      _meta: OPENS_PANEL
    },
    async (args) => {
      // Sweep here rather than on a timer: uploads only pile up while someone is uploading.
      await dispatcher.call('POST', '/photos/sweep').catch(() => undefined)
      const days = PHOTO_TTL_MS / 86_400_000
      return {
        content: [
          {
            type: 'text',
            text:
              `Photo panel requested${args.for ? ` for ${args.for}` : ''}. This tool cannot tell whether ` +
              'the panel rendered; only the photos arriving proves it. If the user cannot see it, say so ' +
              'plainly rather than asking them to add photos to it. When they press Done, the photos and ' +
              `their handles arrive in your context; wait for that. Unlinked photos are deleted after ${days} days.`
          }
        ],
        structuredContent: { for: args.for ?? null, note: args.note ?? null, ttlDays: days }
      }
    }
  )

  server.registerTool(
    'maintenance_photo_upload',
    {
      description:
        'Internal to the photo panel: stores one photo and returns its handle. The panel calls this; nothing else should.',
      inputSchema: {
        content_base64: z.string(),
        taken_at: z.string().optional(),
        note: z.string().optional()
      },
      _meta: APP_ONLY
    },
    async (a) => {
      const r = await dispatcher.call('POST', '/photos/pending', {
        body: { contentBase64: a.content_base64, takenAt: a.taken_at, note: a.note }
      })
      if (r.status >= 400) return fail(messageOf(r.body, `Could not store that photo (${r.status}).`))
      const p = r.body as PendingPhoto
      return {
        content: [{ type: 'text', text: `Stored ${p.handle} (${p.bytes} bytes).` }],
        structuredContent: {
          handle: p.handle,
          bytes: p.bytes,
          width: p.width,
          height: p.height,
          expires_at: p.expiresAt
        }
      }
    }
  )

  const discard = async (handles: string[]): Promise<CallToolResult> => {
    const discarded: string[] = []
    const notFound: string[] = []
    for (const h of handles) {
      const r = await dispatcher.call('DELETE', `/photos/pending/${encodeURIComponent(h)}`)
      ;(r.status < 400 ? discarded : notFound).push(h)
    }
    const lines = [`Discarded ${discarded.length} photo(s).`]
    if (notFound.length) lines.push(`Not found (already gone): ${notFound.join(', ')}.`)
    return text(lines.join(' '))
  }

  server.registerTool(
    'maintenance_photo_discard',
    {
      description:
        'Internal to the photo panel: removes photos the user took back. The panel calls this; nothing else should.',
      inputSchema: { handles: z.array(z.string()) },
      _meta: APP_ONLY
    },
    async ({ handles }) => discard(handles)
  )

  server.registerTool(
    'maintenance_discard_photos',
    {
      description:
        'Delete uploaded photos that will not be attached (a wrong photo, an abandoned entry). ' +
        'Photos already linked to a record stay there; this only drops the upload. ' +
        '`all_pending` clears every unlinked upload — ask the user first.',
      inputSchema: {
        handles: z.array(z.string()).optional(),
        all_pending: z.boolean().optional()
      }
    },
    async ({ handles, all_pending }) => {
      let list = handles ?? []
      if (all_pending) {
        const r = await dispatcher.call('GET', '/photos/pending')
        list = [...new Set([...list, ...((r.body as PendingPhoto[]) ?? []).map((p) => p.handle)])]
      }
      if (!list.length) return fail('Nothing to discard: pass handles, or all_pending.')
      return discard(list)
    }
  )

  server.registerTool(
    'maintenance_list_photos',
    {
      description:
        'Show photos. With no `ids`: uploads waiting to be attached, newest first, with the images ' +
        '— to recover handles after a long conversation or see what would expire. With `ids`: ' +
        'those photos, by handle (ph_…) or by attachment id (from a record’s `attachments`), so ' +
        `you can look at a photo already on a record. At most ${MAX_IMAGES} images per call; ` +
        '`include_images: false` lists without them.',
      inputSchema: {
        ids: z.array(z.string()).optional(),
        include_images: z.boolean().optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ ids, include_images }) => {
      const withImages = include_images !== false
      const content: CallToolResult['content'] = []
      if (ids?.length) {
        content.push({ type: 'text', text: `${ids.length} photo(s): ${ids.join(', ')}` })
        for (const id of ids.slice(0, withImages ? MAX_IMAGES : 0)) {
          const path = id.startsWith('ph_')
            ? `/photos/pending/${encodeURIComponent(id)}`
            : `/media/${encodeURIComponent(id)}`
          const r = await dispatcher.call('GET', path)
          if (r.status === 200 && Buffer.isBuffer(r.body)) {
            content.push({ type: 'image', data: r.body.toString('base64'), mimeType: 'image/jpeg' })
          } else {
            content.push({ type: 'text', text: `(${id}: not found)` })
          }
        }
        return { content }
      }
      const r = await dispatcher.call('GET', '/photos/pending')
      const rows = (r.body as PendingPhoto[]) ?? []
      if (!rows.length) {
        return text('No photos waiting. To add one, call maintenance_attach_photos to open the panel.')
      }
      content.push({
        type: 'text',
        text:
          `${rows.length} photo(s) waiting to be attached:\n${rows.map(describe).join('\n')}\n\n` +
          `Unlinked photos are deleted ${PHOTO_TTL_MS / 86_400_000} days after upload.`
      })
      if (withImages) {
        for (const p of rows.slice(0, MAX_IMAGES)) {
          const img = await dispatcher.call('GET', `/photos/pending/${p.handle}`)
          if (img.status === 200 && Buffer.isBuffer(img.body)) {
            content.push({ type: 'image', data: img.body.toString('base64'), mimeType: 'image/jpeg' })
          }
        }
      }
      return { content }
    }
  )
}
