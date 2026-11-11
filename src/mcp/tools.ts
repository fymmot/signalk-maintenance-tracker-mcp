import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type Dispatcher, resultToText } from './dispatcher'

/** Guidance the MCP server advertises to the model (server `instructions`). */
export const MCP_INSTRUCTIONS =
  'Tools for boat maintenance via the signalk-maintenance-tracker-mcp plugin. The hierarchy ' +
  'is System -> Component -> Part; parts (or any node) carry service triggers that fire on ' +
  'whichever comes first (calendar time, engine hours, trips, a season anchor relative to ' +
  'launch/haulout, or a fixed expiry date printed on the item — flares, fire extinguishers, ' +
  "life-jacket cartridges, first-aid kits, EPIRB batteries). Use 'maintenance_due' to see what is due/overdue, and " +
  "'maintenance_mark_serviced' when a job is done (e.g. 'I finished polishing the freeboards'). " +
  "Track defects with 'maintenance_open_issue', and log progress or the fix on an existing " +
  "defect with 'maintenance_update_issue' (its `comment` becomes part of the issue's history " +
  'and, on resolve, shows on the timeline). Set launch/haulout with ' +
  "'maintenance_set_season' and read the combined history with 'maintenance_timeline'. " +
  "ROUTING RULES (avoid duplicate 'event slop'): completed work -> 'maintenance_mark_serviced'; " +
  "a fault/defect -> 'maintenance_open_issue' then 'maintenance_update_issue' with a `comment` " +
  "to record progress/resolution; reserve 'maintenance_log_event' ONLY for boat " +
  'lifecycle/milestones that are not maintenance (acquisition, mooring/home-port change, ' +
  'regatta, milestone). Never narrate a repair, service, or issue resolution as an event. ' +
  'STYLE: keep everything you write SHORT — these are logbook entries, not essays. Titles ' +
  'are a few words (e.g. "Impeller replaced", not a sentence); descriptions and comments ' +
  'are one terse line. Record what was done, not a narrative; omit filler. ' +
  "PHOTOS: a photo pasted into the chat never reaches this server. When the user wants to add one, call " +
  "'maintenance_attach_photos' to open the photo panel, wait for the photos and their ph_ handles to arrive, " +
  'then pass photos: [{handle, caption}] to the write (captions a few words). Photos go on components (nameplate, ' +
  "fitting), issues, issue updates, service jobs, events and checklist results; 'maintenance_link_photos' adds them " +
  "to a record that already exists. 'maintenance_list_photos' shows a record's photos by attachment id."

const RO = { readOnlyHint: true } as const

/** `photos` on a write: handles from the photo panel, each with a short caption. */
const PHOTOS = z
  .array(z.object({ handle: z.string(), caption: z.string().optional() }))
  .optional()
  .describe(
    'Photos from the photo panel (maintenance_attach_photos): [{handle: "ph_…", caption: "a few words"}].'
  )

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] }
}

/** Drop keys that are undefined or empty-string (0 and false are kept), like the old bridge. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')
  )
}

/**
 * Registers all maintenance MCP tools on `server`, each dispatching to the plugin's
 * REST handlers via `dispatcher`. Read tools carry `readOnlyHint`.
 */
export function registerMaintenanceTools(server: McpServer, dispatcher: Dispatcher): void {
  const run = async (
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | undefined> }
  ) => text(resultToText(await dispatcher.call(method, path, opts)))

  // ---- Read tools ----

  server.registerTool(
    'maintenance_due',
    {
      description:
        'Upcoming and overdue maintenance for every node. Each item has `status` (own ' +
        'triggers, made overdue by an open medium/high issue on the node), `rollupStatus` ' +
        '(worst of it and everything beneath it) and per-trigger `triggers` with `remaining`.',
      annotations: RO
    },
    async () => run('GET', '/due')
  )

  server.registerTool(
    'maintenance_list_nodes',
    {
      description:
        'List all maintenance nodes (systems, components, parts) flat, with their embedded ' +
        'service triggers.',
      annotations: RO
    },
    async () => run('GET', '/nodes')
  )

  server.registerTool(
    'maintenance_get_node',
    {
      description: 'Read one node by id, including its triggers.',
      inputSchema: { node_id: z.string() },
      annotations: RO
    },
    async ({ node_id }) => run('GET', `/nodes/${node_id}`)
  )

  server.registerTool(
    'maintenance_node_logs',
    {
      description: 'Service history for one node, newest first.',
      inputSchema: { node_id: z.string() },
      annotations: RO
    },
    async ({ node_id }) => run('GET', `/nodes/${node_id}/logs`)
  )

  server.registerTool(
    'maintenance_list_logs',
    {
      description: 'All service logs, newest first. Optional `since` ISO timestamp filter.',
      inputSchema: { since: z.string().optional() },
      annotations: RO
    },
    async ({ since }) => run('GET', '/logs', { query: { since } })
  )

  server.registerTool(
    'maintenance_list_issues',
    {
      description: 'List known issues / defects (open, monitoring, resolved).',
      annotations: RO
    },
    async () => run('GET', '/issues')
  )

  server.registerTool(
    'maintenance_list_seasons',
    {
      description: 'List boat seasons (launch/haulout date pairs), newest launch first.',
      annotations: RO
    },
    async () => run('GET', '/seasons')
  )

  server.registerTool(
    'maintenance_current_season',
    {
      description: 'The season in progress right now and whether the boat is afloat.',
      annotations: RO
    },
    async () => run('GET', '/seasons/current')
  )

  server.registerTool(
    'maintenance_list_events',
    {
      description:
        'List boat events (regattas, acquisition, mooring changes, ...), newest first. ' +
        'Optional `since` ISO timestamp and `category` filters.',
      inputSchema: { since: z.string().optional(), category: z.string().optional() },
      annotations: RO
    },
    async ({ since, category }) => run('GET', '/events', { query: { since, category } })
  )

  server.registerTool(
    'maintenance_timeline',
    {
      description:
        'Merged chronological feed of service logs, events, and launch/haulout milestones, ' +
        'newest first. Optional `since` ISO timestamp filter.',
      inputSchema: { since: z.string().optional() },
      annotations: RO
    },
    async ({ since }) => run('GET', '/timeline', { query: { since } })
  )

  server.registerTool(
    'maintenance_list_checklist_templates',
    { description: 'List checklist templates.', annotations: RO },
    async () => run('GET', '/checklists/templates')
  )

  server.registerTool(
    'maintenance_list_checklist_runs',
    {
      description: 'List checklist runs (filled-in instances of templates).',
      annotations: RO
    },
    async () => run('GET', '/checklists/runs')
  )

  // ---- Write tools ----

  server.registerTool(
    'maintenance_create_node',
    {
      description:
        "Create a node. `type` is 'system' | 'component' | 'part'. Link to a parent via " +
        '`parent_id`. `triggers` is an optional list of {name, metric, interval, warnLead?, ' +
        "lastServiceValue?, enabled?} where metric is 'calendarTime' (days), 'engineHours' " +
        "(hours), 'tripCount' (trips), or 'seasonAnchor' (a deadline relative to launch/haulout: " +
        "include anchor={milestone:'launch'|'haulout', offsetDays:<negative=before>} instead of " +
        "an interval), or 'expiry' (a date printed on the item: include expiresOn='YYYY-MM-DD', " +
        "or 'YYYY-MM' when the label shows only a month, instead of an interval; warnLead in days " +
        'defaults to 30 so there is time to buy a replacement).',
      inputSchema: {
        type: z.string(),
        name: z.string(),
        parent_id: z.string().optional(),
        manufacturer: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
        notes: z.string().optional(),
        triggers: z.array(z.record(z.string(), z.unknown())).optional(),
        photos: PHOTOS
      }
    },
    async (a) =>
      run('POST', '/nodes', {
        body: clean({
          type: a.type,
          name: a.name,
          parentId: a.parent_id,
          manufacturer: a.manufacturer,
          model: a.model,
          serial: a.serial,
          notes: a.notes,
          triggers: a.triggers,
          photos: a.photos
        })
      })
  )

  server.registerTool(
    'maintenance_update_node',
    {
      description:
        'Update a node by id. `patch` contains the fields to change (omitted fields keep their ' +
        'current values). To edit triggers, include the full `triggers` array. `patch.photos` ' +
        '([{handle, caption}]) adds photos of the thing itself — nameplate, how it is fitted.',
      inputSchema: { node_id: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    async ({ node_id, patch }) => run('PUT', `/nodes/${node_id}`, { body: patch })
  )

  server.registerTool(
    'maintenance_delete_node',
    { description: 'Delete a node by id.', inputSchema: { node_id: z.string() } },
    async ({ node_id }) => run('DELETE', `/nodes/${node_id}`)
  )

  server.registerTool(
    'maintenance_delete_log',
    { description: 'Delete a service log by id.', inputSchema: { log_id: z.string() } },
    async ({ log_id }) => run('DELETE', `/logs/${log_id}`)
  )

  server.registerTool(
    'maintenance_delete_issue',
    { description: 'Delete an issue by id.', inputSchema: { issue_id: z.string() } },
    async ({ issue_id }) => run('DELETE', `/issues/${issue_id}`)
  )

  server.registerTool(
    'maintenance_delete_season',
    { description: 'Delete a season by id.', inputSchema: { season_id: z.string() } },
    async ({ season_id }) => run('DELETE', `/seasons/${season_id}`)
  )

  server.registerTool(
    'maintenance_delete_event',
    { description: 'Delete a boat event by id.', inputSchema: { event_id: z.string() } },
    async ({ event_id }) => run('DELETE', `/events/${event_id}`)
  )

  server.registerTool(
    'maintenance_delete_checklist_template',
    {
      description: 'Delete a checklist template by id.',
      inputSchema: { template_id: z.string() }
    },
    async ({ template_id }) => run('DELETE', `/checklists/templates/${template_id}`)
  )

  server.registerTool(
    'maintenance_delete_checklist_run',
    { description: 'Delete a checklist run by id.', inputSchema: { run_id: z.string() } },
    async ({ run_id }) => run('DELETE', `/checklists/runs/${run_id}`)
  )

  server.registerTool(
    'maintenance_mark_serviced',
    {
      description:
        'Mark a node serviced ("I finished X, mark it done"). Writes a permanent service log ' +
        'and resets the named triggers (or all enabled triggers if `trigger_ids` is omitted) to ' +
        'the current metric values. `comment` is an optional short note. `cost` is what the ' +
        'work cost, with `currency` as an ISO 4217 code (EUR, SEK, USD); if the user did not ' +
        'say, use the currency of earlier costs in the history or ask. `datetime` defaults to now. Expiry triggers renew only when ' +
        '`expires_on` is given — the date printed on the replacement (YYYY-MM-DD or YYYY-MM); ' +
        'ask for it when the user replaced an expiring item and did not say. Without it, a ' +
        'service leaves expiry dates alone (e.g. a yearly extinguisher check).',
      inputSchema: {
        node_id: z.string(),
        description: z.string(),
        comment: z.string().optional(),
        trigger_ids: z.array(z.string()).optional(),
        datetime: z.string().optional(),
        parts_replaced: z.array(z.string()).optional(),
        expires_on: z.string().optional(),
        cost: z.number().optional(),
        currency: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .optional()
          .describe('ISO 4217 code for cost, e.g. "EUR".'),
        author: z.string().optional(),
        photos: PHOTOS
      }
    },
    async (a) =>
      run('POST', `/nodes/${a.node_id}/service`, {
        body: clean({
          description: a.description,
          comment: a.comment,
          triggerIds: a.trigger_ids,
          datetime: a.datetime,
          partsReplaced: a.parts_replaced,
          expiresOn: a.expires_on,
          cost: a.cost,
          costCurrency: a.currency,
          author: a.author,
          photos: a.photos
        })
      })
  )

  server.registerTool(
    'maintenance_open_issue',
    {
      description:
        'Open a known issue / defect against a node. Use this (not maintenance_log_event) for ' +
        "anything broken, worn, or needing attention. `severity` is 'low' | 'medium' | 'high'. " +
        '`description` is the standing problem statement; `comment` is an optional opening note ' +
        "recorded on the issue's opened-history entry. Set `fix_by` ('launch' | 'haulout') when " +
        "it must be done before that milestone (e.g. 'replace before launch').",
      inputSchema: {
        node_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        severity: z.enum(['low', 'medium', 'high']).optional(),
        fix_by: z.enum(['launch', 'haulout']).optional(),
        comment: z.string().optional(),
        author: z.string().optional(),
        photos: PHOTOS
      }
    },
    async (a) =>
      run('POST', '/issues', {
        body: clean({
          nodeId: a.node_id,
          title: a.title,
          status: 'open',
          description: a.description,
          severity: a.severity,
          fixBy: a.fix_by,
          comment: a.comment,
          author: a.author,
          photos: a.photos
        })
      })
  )

  server.registerTool(
    'maintenance_update_issue',
    {
      description:
        'Update an issue by id and/or log progress on it. `patch` may set fields (e.g. ' +
        '{"status": "monitoring"} or {"status": "resolved"}) and may include a `comment` string ' +
        'that is appended to the history. PREFER this over maintenance_log_event for narrating ' +
        'how a defect was investigated or fixed: resolve with {"status": "resolved", "comment": ' +
        '"<what you did>"} and the comment appears on the timeline. Resolving stamps the resolved ' +
        'time automatically. {"fixBy": "launch"} / "haulout" sets a deadline milestone; ' +
        '{"fixBy": null} clears it. `patch.photos` ([{handle, caption}]) attaches photos to this ' +
        'update, alongside its comment ("the crack has grown").',
      inputSchema: { issue_id: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    async ({ issue_id, patch }) => run('PUT', `/issues/${issue_id}`, { body: patch })
  )

  server.registerTool(
    'maintenance_set_season',
    {
      description:
        "Create or update a boat season by id (e.g. '2026'). Set `launch_date` at splash and " +
        "`haulout_date` at lift-out (ISO dates, e.g. '2026-05-03'). Seasons anchor 'seasonAnchor' " +
        'deadlines. Creates if new, otherwise updates.',
      inputSchema: {
        season_id: z.string(),
        label: z.string().optional(),
        launch_date: z.string().optional(),
        haulout_date: z.string().optional(),
        notes: z.string().optional()
      }
    },
    async (a) => {
      const body = clean({
        id: a.season_id,
        label: a.label,
        launchDate: a.launch_date,
        hauloutDate: a.haulout_date,
        notes: a.notes
      })
      const existing = await dispatcher.call('GET', `/seasons/${a.season_id}`)
      if (existing.status === 200) {
        return run('PUT', `/seasons/${a.season_id}`, { body })
      }
      return run('POST', '/seasons', { body })
    }
  )

  server.registerTool(
    'maintenance_log_event',
    {
      description:
        'Record a boat lifecycle/milestone event for the timeline -- things that are NOT ' +
        'maintenance: "bought the boat", "moved home port", "did a regatta". `category` is a free ' +
        'string (common: acquisition, mooring, regatta, upgrade, milestone). `datetime` defaults ' +
        'to now; optional `node_id` links it to a maintenance node. Do NOT use this to describe ' +
        'repairs, servicing, or fixing a defect -- use maintenance_mark_serviced for completed ' +
        'work and maintenance_open_issue / maintenance_update_issue for defects.',
      inputSchema: {
        title: z.string(),
        category: z.string().optional(),
        datetime: z.string().optional(),
        description: z.string().optional(),
        node_id: z.string().optional(),
        location: z.string().optional(),
        photos: PHOTOS
      }
    },
    async (a) =>
      run('POST', '/events', {
        body: clean({
          title: a.title,
          category: a.category,
          datetime: a.datetime,
          description: a.description,
          nodeId: a.node_id,
          location: a.location,
          photos: a.photos
        })
      })
  )

  server.registerTool(
    'maintenance_create_checklist_template',
    {
      description:
        "Create a reusable checklist template (e.g. 'Spring fit-out'). `items` is a list of " +
        '{text, category?, nodeId?}; `category` groups items into sections. `schedule` says when ' +
        "the app should suggest running it: [{section?, milestone: 'launch'|'haulout', " +
        'withinDays?}], e.g. the "After haulout" section within 14 days of haulout.',
      inputSchema: {
        name: z.string(),
        items: z.array(z.record(z.string(), z.unknown())),
        description: z.string().optional(),
        schedule: z
          .array(
            z.object({
              section: z.string().optional(),
              milestone: z.enum(['launch', 'haulout']),
              withinDays: z.number().min(0).optional()
            })
          )
          .optional()
      }
    },
    async (a) =>
      run('POST', '/checklists/templates', {
        body: clean({
          name: a.name,
          items: a.items,
          description: a.description,
          schedule: a.schedule
        })
      })
  )

  server.registerTool(
    'maintenance_start_checklist_run',
    {
      description:
        'Start a checklist run from a template (instantiates all items as pending).',
      inputSchema: { template_id: z.string(), author: z.string().optional() }
    },
    async (a) =>
      run('POST', '/checklists/runs', {
        body: clean({ templateId: a.template_id, author: a.author })
      })
  )

  server.registerTool(
    'maintenance_update_checklist_run',
    {
      description:
        'Update a checklist run (record results / completedAt). `patch` may include the full ' +
        "`results` array with each item's status ('pending'|'pass'|'fail'|'skip'). A result may " +
        'carry `photos` ([{handle, caption}]) next to its `note`, e.g. a failed check.',
      inputSchema: { run_id: z.string(), patch: z.record(z.string(), z.unknown()) }
    },
    async ({ run_id, patch }) => run('PUT', `/checklists/runs/${run_id}`, { body: patch })
  )

  server.registerTool(
    'maintenance_link_photos',
    {
      description:
        'Add photos to a record that already exists, or take them off. Name exactly one record: ' +
        '`node_id`, `log_id` (a service job — the only way to add photos to one after the fact), ' +
        '`issue_id` (the issue itself; photos of an update go through maintenance_update_issue), ' +
        '`event_id`, or `run_id` with `item_id` (one checklist result). `photos` are handles from ' +
        'maintenance_attach_photos; linking a photo already there updates its caption. `remove` ' +
        "takes attachment ids off the record (the image stays in the repo's history).",
      inputSchema: {
        node_id: z.string().optional(),
        log_id: z.string().optional(),
        issue_id: z.string().optional(),
        event_id: z.string().optional(),
        run_id: z.string().optional(),
        item_id: z.string().optional(),
        photos: PHOTOS,
        remove: z.array(z.string()).optional()
      }
    },
    async (a) => {
      const targets = (
        [
          ['node', a.node_id],
          ['log', a.log_id],
          ['issue', a.issue_id],
          ['event', a.event_id],
          ['run', a.run_id]
        ] as const
      ).filter(([, id]) => !!id)
      if (targets.length !== 1) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Name exactly one of node_id, log_id, issue_id, event_id or run_id.' }
          ]
        }
      }
      const [kind, id] = targets[0]
      return run('POST', '/attachments', {
        body: clean({ kind, id, itemId: a.item_id, photos: a.photos, remove: a.remove })
      })
    }
  )
}
