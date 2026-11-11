#!/usr/bin/env node
// Fills a development datastore with a believable boat, two weeks after haulout:
// jobs due this week, overdue and snoozed, season deadlines before launch, issues,
// checklists with a run in progress and one left unfinished, history and events.
// Dates are relative to today, so the Work list always has something on it.
//
//   npm run dev:web                                      # in one terminal
//   SK_URL=http://localhost:3778 node tools/dev-fixtures.mjs
//
// For the web app's development and screenshots only. Use scripts/seed.mjs for a real boat.

const SK_URL = (process.env.SK_URL || 'http://localhost:3778').replace(/\/+$/, '')
const BASE = `${SK_URL}/plugins/signalk-maintenance-tracker-mcp`
const DAY = 86_400_000
const today = Math.floor(Date.now() / DAY)
const iso = (day) => new Date(day * DAY).toISOString().slice(0, 10)
const at = (day, hour = 10) => new Date(day * DAY + hour * 3_600_000).toISOString()

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? undefined : res.json().catch(() => undefined)
}

const cal = (id, name, interval, lastDay) => ({ id, name, metric: 'calendarTime', interval, lastServiceValue: lastDay, lastServiceDate: at(lastDay) })
const hours = (id, name, interval, lastHours) => ({ id, name, metric: 'engineHours', interval, lastServiceValue: lastHours, lastServiceDate: at(today - 200) })
const season = (id, name, milestone, offsetDays) => ({ id, name, metric: 'seasonAnchor', anchor: { milestone, offsetDays } })
const expiry = (id, name, expiresOn) => ({ id, name, metric: 'expiry', expiresOn })

const nodes = [
  { id: 'propulsion', type: 'system', name: 'Propulsion' },
  { id: 'engine', type: 'component', parentId: 'propulsion', name: 'Main engine', manufacturer: 'Yanmar', model: '3YM20', serial: 'E37421', notes: 'Saildrive SD20. Oil 2.7 l 10W-40, coolant 50/50.' },
  { id: 'impeller', type: 'part', parentId: 'engine', name: 'Raw-water impeller', manufacturer: 'Yanmar', model: '128990-42200', triggers: [cal('impeller-2y', 'Replace', 730, today - 760), hours('impeller-500h', 'Replace (hours)', 500, 1000)] },
  { id: 'oil', type: 'part', parentId: 'engine', name: 'Engine oil and filter', triggers: [hours('oil-100h', 'Oil change', 100, 1140), cal('oil-1y', 'Oil change (yearly)', 365, today - 300)] },
  { id: 'fuel-filter', type: 'part', parentId: 'engine', name: 'Fuel pre-filter', triggers: [hours('drain', 'Drain water', 50, 1190)] },
  { id: 'cooling', type: 'component', parentId: 'engine', name: 'Cooling system', triggers: [season('winterize', 'Winterize', 'haulout', 21)] },
  { id: 'coolant', type: 'part', parentId: 'cooling', name: 'Coolant', triggers: [cal('coolant-2y', 'Replace', 730, today - 500)] },

  { id: 'rig', type: 'system', name: 'Rig & sails' },
  { id: 'standing', type: 'component', parentId: 'rig', name: 'Standing rigging', notes: '1x19 stainless, 5 mm. Swaged terminals at the masthead.', triggers: [cal('inspect', 'Inspect', 365, today - 250)] },
  { id: 'halyard-winches', type: 'part', parentId: 'rig', name: 'Halyard winches', manufacturer: 'Lewmar', model: '16', triggers: [cal('service-5y', 'Service', 1826, today - 1950)] },
  { id: 'mainsail', type: 'part', parentId: 'rig', name: 'Mainsail', triggers: [season('mainsail-off', 'Take off and dry', 'haulout', 0)] },

  { id: 'hull', type: 'system', name: 'Hull & deck' },
  { id: 'antifouling', type: 'part', parentId: 'hull', name: 'Antifouling', triggers: [season('antifouling', 'Paint', 'launch', -21)] },
  { id: 'teak', type: 'component', parentId: 'hull', name: 'Cockpit teak', triggers: [season('boracol', 'Boracol treatment', 'launch', -14)] },
  { id: 'anodes', type: 'part', parentId: 'hull', name: 'Sacrificial anodes', triggers: [season('anodes', 'Check and replace', 'launch', -7)] },

  { id: 'electrical', type: 'system', name: 'Electrical' },
  { id: 'house-bank', type: 'component', parentId: 'electrical', name: 'House battery', manufacturer: 'Victron', model: 'LiFePO4 12.8 V 200 Ah', serial: 'HQ2140ABCDE' },
  { id: 'solar', type: 'part', parentId: 'electrical', name: 'Solar panel connectors', triggers: [cal('solar-1y', 'Clean and check', 365, today - 340)] },

  { id: 'safety', type: 'system', name: 'Safety' },
  { id: 'flares', type: 'part', parentId: 'safety', name: 'Hand flares', triggers: [expiry('flares', 'Replace', iso(today + 5))] },
  { id: 'extinguisher', type: 'part', parentId: 'safety', name: 'Fire extinguisher', manufacturer: 'Gloria', model: 'PD2GA', triggers: [expiry('extinguisher', 'Replace', '2029-04'), cal('ext-check', 'Yearly check', 365, today - 200)] },
  { id: 'lifejackets', type: 'part', parentId: 'safety', name: 'Life jackets', notes: 'Four adult, two child. Check cartridges and bobbins.', triggers: [cal('lj-check', 'Check cartridges', 365, today - 380)] },

  { id: 'steering', type: 'system', name: 'Steering' },
  { id: 'tiller', type: 'part', parentId: 'steering', name: 'Tiller' },
  { id: 'galley', type: 'system', name: 'Galley' }
]

const issues = [
  { id: 'turnbuckles', nodeId: 'standing', title: 'Two starboard lower turnbuckles damaged — replace before stepping', severity: 'high', fixBy: 'launch', openedAt: at(today - 16), description: 'Threads galled on both. Spares ordered.' },
  { id: 'tiller-loose', nodeId: 'tiller', title: 'Tiller loose on rudder shaft', severity: 'high', openedAt: at(today - 150), description: 'About 5 mm play at the head fitting.' },
  { id: 'vhf', nodeId: 'rig', title: 'VHF antenna damaged', severity: 'medium', status: 'monitoring', openedAt: at(today - 148) },
  { id: 'windex', nodeId: 'rig', title: 'Windex missing one tack angle indicator', severity: 'low', openedAt: at(today - 30) },
  { id: 'bilge', nodeId: 'hull', title: 'Bilge needs degreasing', severity: 'medium', openedAt: at(today - 120) }
]

const templates = [
  {
    id: 'winter-storage',
    name: 'Winter storage',
    description: 'What to do when the boat comes out, and what to put back at launch.',
    items: [
      { id: 'pi', text: 'Bring the Pi and screens home', category: 'After haulout' },
      { id: 'batteries', text: 'Charge batteries to storage level', category: 'After haulout', nodeId: 'house-bank' },
      { id: 'fridge', text: 'Empty and air the fridge', category: 'After haulout' },
      { id: 'fuses', text: 'Refit the solar fuses', category: 'At launch', nodeId: 'solar' },
      { id: 'seacocks', text: 'Check every seacock opens and closes', category: 'At launch' }
    ],
    schedule: [
      { section: 'After haulout', milestone: 'haulout', withinDays: 21 },
      { section: 'At launch', milestone: 'launch' }
    ]
  },
  {
    id: 'engine-start',
    name: 'Pre-launch engine start',
    items: [
      { id: 'raw-water', text: 'Raw-water flow at the exhaust', nodeId: 'cooling' },
      { id: 'oil-level', text: 'Oil level between the marks', nodeId: 'oil' }
    ]
  },
  {
    id: 'departure',
    name: 'Before leaving the berth',
    items: [
      { id: 'weather', text: 'Check the forecast' },
      { id: 'crew', text: 'Life jackets on for the crew' },
      { id: 'lines', text: 'Fenders and lines ready' }
    ]
  }
]

async function main() {
  console.log(`Writing development data to ${BASE}`)
  await call('POST', '/seasons', { id: 'last', label: `${new Date((today - 560) * DAY).getUTCFullYear()} season`, launchDate: iso(today - 560), hauloutDate: iso(today - 380) })
  await call('POST', '/seasons', { id: 'this', label: `${new Date((today - 200) * DAY).getUTCFullYear()} season`, launchDate: iso(today - 200), hauloutDate: iso(today - 14) })
  await call('POST', '/seasons', { id: 'next', label: 'Next season', launchDate: iso(today + 160) })

  for (const n of nodes) await call('POST', '/nodes', { triggers: [], ...n })

  // Snooze the overdue impeller job, as if it waits for spring.
  await call('POST', '/nodes/impeller/triggers/impeller-2y/snooze', { until: at(today + 150) })

  for (const i of issues) {
    await call('POST', '/issues', { status: 'open', ...i })
  }
  await call('PUT', '/issues/bilge', { status: 'resolved', comment: 'Degreased and rinsed.' })
  await call('PUT', '/issues/tiller-loose', { comment: 'Ordered a new bushing from the yard.' })

  for (const tpl of templates) await call('POST', '/checklists/templates', tpl)
  await call('POST', '/checklists/runs', {
    id: 'winter-run',
    templateId: 'winter-storage',
    name: 'Winter storage',
    section: 'After haulout',
    startedAt: at(today - 3),
    results: [
      { itemId: 'pi', text: 'Bring the Pi and screens home', status: 'pass', timestamp: at(today - 3, 11) },
      { itemId: 'batteries', text: 'Charge batteries to storage level', status: 'pass', timestamp: at(today - 2, 9) },
      { itemId: 'fridge', text: 'Empty and air the fridge', status: 'pending' }
    ]
  })
  await call('POST', '/checklists/runs', {
    id: 'engine-run-old',
    templateId: 'engine-start',
    name: 'Pre-launch engine start',
    startedAt: at(today - 190),
    results: [
      { itemId: 'raw-water', text: 'Raw-water flow at the exhaust', status: 'pending' },
      { itemId: 'oil-level', text: 'Oil level between the marks', status: 'pending' }
    ]
  })
  await call('POST', '/checklists/runs', {
    id: 'departure-done',
    templateId: 'departure',
    name: 'Before leaving the berth',
    startedAt: at(today - 40, 8),
    completedAt: at(today - 40, 9),
    results: [
      { itemId: 'weather', text: 'Check the forecast', status: 'pass', timestamp: at(today - 40, 8) },
      { itemId: 'crew', text: 'Life jackets on for the crew', status: 'pass', timestamp: at(today - 40, 8) },
      { itemId: 'lines', text: 'Fenders and lines ready', status: 'fail', note: 'Bow line chafed', timestamp: at(today - 40, 9) }
    ]
  })

  // History. triggerIds: [] logs the work without resetting the intervals above.
  const logs = [
    ['oil', today - 30, 'Oil and filter changed', { partsReplaced: ['Oil filter 119305-35151', '2.7 l 10W-40'], cost: 640 }],
    ['standing', today - 16, 'Rig inspected at haulout', { comment: 'Found the turnbuckle damage.' }],
    ['antifouling', today - 12, 'Hull washed at the yard', {}],
    ['mainsail', today - 13, 'Mainsail off and dried', {}]
  ]
  for (const [nodeId, day, description, extra] of logs) {
    await call('POST', `/nodes/${nodeId}/service`, { description, datetime: at(day), triggerIds: [], ...extra })
  }

  await call('POST', '/events', { id: 'regatta', title: 'Midsummer regatta', category: 'regatta', datetime: at(today - 140), location: 'Sandhamn' })
  await call('POST', '/events', { id: 'bought', title: 'Bought the boat', category: 'acquisition', datetime: at(today - 900) })

  console.log('Done.')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
