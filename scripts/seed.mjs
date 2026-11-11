#!/usr/bin/env node
// Creates the starter boat on a Signal K server running this plugin: the same small
// tree the web app's "Start with a typical boat" button makes (src/domain/starterBoat.ts),
// so the two never drift apart.
//
// Usage:
//   SK_URL=http://localhost:3000 node scripts/seed.mjs              # create, skipping what exists
//   SK_URL=... node scripts/seed.mjs --lang sv                      # Swedish names
//   SK_URL=... SK_TOKEN=<jwt> node scripts/seed.mjs                 # if Signal K requires login
//   SK_URL=... node scripts/seed.mjs --dry-run                      # list what it would create
//
// Nodes have fixed ids, so running it again adds only what is missing. The intervals
// are suggestions: afterwards, set each one's last service to the real date or reading.

const SK_URL = (process.env.SK_URL || 'http://localhost:3000').replace(/\/+$/, '')
const SK_TOKEN = process.env.SK_TOKEN || ''
const DRY_RUN = process.argv.includes('--dry-run')
const langAt = process.argv.indexOf('--lang')
const LANG = langAt > 0 && process.argv[langAt + 1] === 'sv' ? 'sv' : 'en'
const BASE = `${SK_URL}/plugins/signalk-maintenance-tracker-mcp`

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (SK_TOKEN) h.Authorization = `Bearer ${SK_TOKEN}`
  return h
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(), body: body && JSON.stringify(body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} -> ${res.status} ${text}`)
  }
  return res.json()
}

async function main() {
  if (DRY_RUN) {
    const nodes = await call('GET', `/starter-boat?lang=${LANG}`)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const depth = (n) => (n.parentId && byId.has(n.parentId) ? 1 + depth(byId.get(n.parentId)) : 0)
    console.log(`The starter boat (${nodes.length} nodes) for ${BASE}:`)
    for (const n of nodes) {
      const t = n.triggers.length ? ` [${n.triggers.map((x) => x.name).join(', ')}]` : ''
      console.log(`  ${'  '.repeat(depth(n))}${n.type}: ${n.name}${t}`)
    }
    return
  }
  const result = await call('POST', '/starter-boat', { lang: LANG })
  console.log(`Created ${result.created}, skipped ${result.skipped} that already existed.`)
  console.log('Next: set each interval’s last service to the real date or engine reading.')
}

main().catch((e) => {
  console.error(`Seed failed: ${e.message}`)
  process.exit(1)
})
