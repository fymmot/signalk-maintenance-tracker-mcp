---
name: boat-maintenance
description: Keeps a boat's maintenance plan through the Signal K maintenance tracker's MCP tools (maintenance_*). Use whenever the user mentions work done on the boat, something broken or worn, what is due, launch or haulout, a checklist, adding a part or an interval, or photos of the boat.
---

# Boat maintenance

The boat's maintenance plan lives in a Signal K plugin, reached through the
`maintenance_*` tools. You keep it current so the owner can just talk: "changed the
impeller", "the windex is bent", "what's due before launch?".

## The model

- **Nodes** form a tree: **system → component → part** (Propulsion → Engine → Cooling
  system → Raw-water impeller). Parts are what gets serviced; components group them.
- **Triggers** on a node say when a job is due. Each has a `name`, which is the job
  ("Replace", "Drain water"), and one `metric`:
  - `calendarTime`: every `interval` days.
  - `engineHours`: every `interval` engine hours, read from the boat.
  - `tripCount`: every `interval` trips.
  - `seasonAnchor`: `anchor: {milestone: 'launch' | 'haulout', offsetDays}`, negative for
    before. Winterize is `{haulout, 14}`; check seacocks is `{launch, -14}`.
  - `expiry`: `expiresOn: 'YYYY-MM-DD'` (or `'YYYY-MM'`), the date printed on flares,
    extinguishers, re-arm kits, first-aid kits, EPIRB batteries, or an insurance policy.
  A node with several triggers is due on whichever comes first.
- **Seasons** hold launch and haulout dates (`maintenance_set_season`). Season jobs
  wait for them.
- **Service logs** record work done; **issues** track defects; **events** are boat
  milestones that are not maintenance.

## Find the node first

Before any write, find the node: `maintenance_list_nodes`, then `maintenance_get_node` for
its triggers. Match on name, manufacturer, model and parent. Never guess an id. If two
nodes fit ("the impeller" on a boat with two engines), ask which. If none fits, offer to
create it in the right place instead of logging against the parent.

## What the user says → what you do

| The user | Do |
|---|---|
| Did a job ("changed the oil", "antifouled") | `maintenance_mark_serviced` with the node and `trigger_ids` of the job(s) it covers. Ask when it's unclear which. |
| Replaced something with a printed date | `maintenance_mark_serviced` with `expires_on`, the date on the new one. Ask for it if not given. |
| Something is broken, worn or leaking | `maintenance_open_issue`, `severity` low/medium/high, `fix_by` launch/haulout if it must be fixed by then. |
| Progress on, or the fix of, a known problem | `maintenance_update_issue` with a `comment`; to close it, `{status: 'resolved', comment: '<what was done>'}`. If the fix was also a scheduled job, mark that serviced too. |
| "What's due?", "what's left before launch?" | `maintenance_due` (and `maintenance_list_issues`). Answer with the few items that matter, most urgent first. |
| Launched, hauled out, or set the dates | `maintenance_set_season` with `launch_date` / `haulout_date`. |
| Bought the boat, moved berth, a regatta | `maintenance_log_event`. Only for these, never for work or repairs. |
| "Add the windlass", "service it every 2 years" | `maintenance_create_node`, or `maintenance_update_node` to add a trigger. |
| Going through a checklist | `maintenance_list_checklist_templates`, `maintenance_start_checklist_run`, then `maintenance_update_checklist_run` as items are answered. |

`maintenance_update_node` replaces the whole `triggers` array: read the node, change the
one trigger, and send them all back, keeping each trigger's `id`.

## Building the tree well

- Put things where an owner would look: under the system they belong to, with a
  component in between only when it groups several parts.
- Name jobs for what you do ("Change", "Inspect & grease", "Put on"), not how often.
  The name is what the owner sees in the Work list.
- Give engine parts both an hours and a calendar trigger, so a little-used engine still
  gets its yearly oil change.
- Tie seasonal work to launch or haulout, not to calendar dates.
- Use `expiry` for anything with a printed date. Ask for the date; don't invent one.
- Use `notes` for the why ("Carry a spare aboard", the oil grade, the manual's interval).
- Add manufacturer, model and serial when the user knows them; they make parts easy to
  find and to order.
- Look before creating: don't make a second node for something that exists.

## How to write

Records are logbook entries, not prose.

- Titles and descriptions: a few words. "Impeller replaced", not a sentence.
- Comments: one short line of what was done or found.
- Don't restate the node's name in its own records.
- Reply in the user's language, and write records in the language of the boat's names.

## Photos

A photo pasted into the chat never reaches the plugin. When the user wants one on a
record, call `maintenance_attach_photos` to open the photo panel, wait for the photos and
their `ph_…` handles, then pass `photos: [{handle, caption}]` to the write. Captions are
a few words. Use `maintenance_link_photos` to add photos to a record that already exists.

## Take care

- Confirm before deleting anything, and say what goes with it.
- Don't invent dates, engine hours, costs or expiry dates. Leave them out or ask.
- A cost goes with its `currency` (EUR, SEK, USD). If the user didn't say, use the one
  in earlier costs, or ask.
- A job done on another day: pass `datetime`. Without it, it is recorded as now.
- After a write, confirm in one line what was recorded and what is due next, if anything.
