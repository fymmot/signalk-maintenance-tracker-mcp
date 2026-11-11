#!/usr/bin/env node
// Data "doctor": scans a maintenance datastore for integrity and data-quality
// problems before they reach the app. Safe, read-only. Intended for CI and a
// pre-commit hook on the git-backed data repo.
//
// Usage:
//   node scripts/doctor.mjs [DATA_DIR]
//   MAINT_DATA_DIR=/path/to/store node scripts/doctor.mjs
//
// DATA_DIR defaults to $MAINT_DATA_DIR, then ./data. It must contain the
// per-collection subdirectories (nodes/, logs/, issues/, events/, seasons/,
// checklists/templates, checklists/runs).
//
// Exit code: 0 when there are no ERRORs (WARNs are advisory), 1 otherwise.

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'

const DATA_DIR = process.argv[2] || process.env.MAINT_DATA_DIR || join(process.cwd(), 'data')

const errors = []
const warns = []
const err = (m) => errors.push(m)
const warn = (m) => warns.push(m)

/** Load every *.yml in a subdir as parsed objects, tagged with their filename. */
function load(subdir) {
  const dir = join(DATA_DIR, subdir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      try {
        return { __file: join(subdir, f), ...(parse(readFileSync(join(dir, f), 'utf8')) ?? {}) }
      } catch (e) {
        err(`${join(subdir, f)}: YAML parse failed — ${e.message}`)
        return { __file: join(subdir, f), __broken: true }
      }
    })
    .filter((r) => !r.__broken)
}

const nodes = load('nodes')
const logs = load('logs')
const issues = load('issues')
const events = load('events')
const seasons = load('seasons')
const templates = load(join('checklists', 'templates'))
const runs = load(join('checklists', 'runs'))

const nodeIds = new Set(nodes.map((n) => n.id))
const templateIds = new Set(templates.map((t) => t.id))
const triggerIdsByNode = new Map(
  nodes.map((n) => [n.id, new Set((n.triggers ?? []).map((t) => t.id))])
)

const NOW = Date.now()
const isFuture = (iso) => {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t > NOW
}

// 1. Referential integrity (ERROR) ------------------------------------------
for (const n of nodes) {
  if (n.parentId && !nodeIds.has(n.parentId)) {
    err(`${n.__file}: parentId '${n.parentId}' does not match any node`)
  }
  if (n.parentId && n.parentId === n.id) {
    err(`${n.__file}: parentId points at itself`)
  }
}
for (const l of logs) {
  if (!l.nodeId || !nodeIds.has(l.nodeId)) {
    err(`${l.__file}: nodeId '${l.nodeId ?? ''}' does not match any node`)
  } else {
    const known = triggerIdsByNode.get(l.nodeId)
    for (const tid of l.triggerIds ?? []) {
      if (!known.has(tid)) warn(`${l.__file}: triggerId '${tid}' not found on node '${l.nodeId}'`)
    }
  }
}
for (const i of issues) {
  if (!i.nodeId || !nodeIds.has(i.nodeId)) {
    err(`${i.__file}: nodeId '${i.nodeId ?? ''}' does not match any node`)
  }
}
for (const e of events) {
  if (e.nodeId && !nodeIds.has(e.nodeId)) {
    err(`${e.__file}: nodeId '${e.nodeId}' does not match any node`)
  }
}
for (const r of runs) {
  if (r.templateId && !templateIds.has(r.templateId)) {
    err(`${r.__file}: templateId '${r.templateId}' does not match any template`)
  }
}

// 2. Future-dated records (WARN) --------------------------------------------
for (const l of logs) if (isFuture(l.datetime)) warn(`${l.__file}: datetime is in the future (${l.datetime})`)
for (const e of events) if (isFuture(e.datetime)) warn(`${e.__file}: datetime is in the future (${e.datetime})`)
for (const i of issues) {
  if (isFuture(i.openedAt)) warn(`${i.__file}: openedAt is in the future (${i.openedAt})`)
  if (isFuture(i.resolvedAt)) warn(`${i.__file}: resolvedAt is in the future (${i.resolvedAt})`)
}

// 3. engineHours unit anomaly (WARN) — hours expected, not raw seconds -------
for (const l of logs) {
  const eh = l.metrics?.engineHours
  if (typeof eh === 'number' && eh > 100_000) {
    warn(
      `${l.__file}: metrics.engineHours ${eh} looks like raw seconds; expected hours ` +
        `(~${(eh / 3600).toFixed(1)} h)`
    )
  }
}

// 4. Stamped placeholder metrics (WARN) — same value across many logs --------
for (const key of ['engineHours', 'tripCount']) {
  const counts = new Map()
  for (const l of logs) {
    const v = l.metrics?.[key]
    if (typeof v === 'number') counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  for (const [value, count] of counts) {
    if (count >= 3) {
      warn(
        `metrics.${key} = ${value} appears in ${count} logs — likely a stamped ` +
          `placeholder rather than per-service readings`
      )
    }
  }
}

// ---- Report ----------------------------------------------------------------
console.log(
  `Scanned ${DATA_DIR}: ${nodes.length} nodes, ${logs.length} logs, ${issues.length} issues, ` +
    `${events.length} events, ${seasons.length} seasons, ${templates.length} templates, ${runs.length} runs`
)
for (const w of warns) console.log(`WARN  ${w}`)
for (const e of errors) console.log(`ERROR ${e}`)
console.log(`\n${errors.length} error(s), ${warns.length} warning(s).`)
process.exit(errors.length > 0 ? 1 : 0)
