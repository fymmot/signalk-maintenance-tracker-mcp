import type { MetricType, NodeType, SeasonMilestone } from '../types'

/*
 * The starter boat: the systems most sailing boats with an inboard engine have, laid out
 * the way a well-kept tree ends up after a few seasons. The web app creates it with one
 * click (POST /starter-boat) and scripts/seed.mjs uses the same route, so there is one
 * list to keep current.
 *
 * What it shows by example:
 *  - Three levels where they help: System → Component → Part (Propulsion → Engine →
 *    Cooling → Raw-water impeller). Parts are what you service; components group them.
 *  - Jobs named for what you do ("Change", "Drain water", "Put on"), not how often:
 *    the name is what the Work list shows.
 *  - Whichever comes first: engine parts carry both an hours and a calendar interval.
 *  - Season jobs tied to launch and haulout instead of a calendar date, so they move
 *    with the season (winterize two weeks after haulout, check seacocks before launch).
 *  - Expiry dates for things with a date printed on them (flares, extinguishers,
 *    life-jacket re-arm kits, first-aid kit). They ask for the date until it is set.
 *
 * Intervals are common manufacturer and insurer guidance; the owner tunes them to the
 * boat. Names come in English and Swedish; the language is chosen when the boat is
 * created, and from then on the names are the owner's to change.
 */

export type StarterLang = 'en' | 'sv'

interface Named {
  en: string
  sv: string
}

export interface StarterTrigger {
  name: Named
  metric: Extract<MetricType, 'calendarTime' | 'engineHours' | 'seasonAnchor' | 'expiry'>
  interval: number
  anchor?: { milestone: SeasonMilestone; offsetDays: number }
}

export interface StarterNode {
  id: string
  type: NodeType
  parentId?: string
  name: Named
  notes?: Named
  triggers?: StarterTrigger[]
}

const n = (en: string, sv: string): Named => ({ en, sv })

/** A calendar interval in years. */
const years = (count: number, name: Named): StarterTrigger => ({ name, metric: 'calendarTime', interval: Math.round(count * 365) })
/** An engine-hours interval. */
const hours = (count: number, name: Named): StarterTrigger => ({ name, metric: 'engineHours', interval: count })
/** Days after (positive) or before (negative) launch or haulout, every season. */
const season = (milestone: SeasonMilestone, offsetDays: number, name: Named): StarterTrigger => ({
  name,
  metric: 'seasonAnchor',
  interval: 0,
  anchor: { milestone, offsetDays }
})
/** Due on the date printed on the item; asks for that date until it is set. */
const expiry = (name: Named): StarterTrigger => ({ name, metric: 'expiry', interval: 0 })

const CHANGE = n('Change', 'Byt')
const REPLACE = n('Replace', 'Byt ut')
const INSPECT = n('Inspect', 'Inspektera')

/** Parents before children, so every parentId already exists when its child is made. */
export const STARTER_BOAT: StarterNode[] = [
  // ---- Propulsion -----------------------------------------------------------------
  { id: 'propulsion', type: 'system', name: n('Propulsion', 'Framdrivning') },
  { id: 'engine', type: 'component', parentId: 'propulsion', name: n('Engine', 'Motor') },
  {
    id: 'engine-oil',
    type: 'part',
    parentId: 'engine',
    name: n('Engine oil & filter', 'Motorolja och filter'),
    notes: n('Change before winter, so the engine stands with clean oil.', 'Byt inför vintern, så att motorn står med ren olja.'),
    triggers: [hours(200, CHANGE), years(1, CHANGE)]
  },
  {
    id: 'drive-belt',
    type: 'part',
    parentId: 'engine',
    name: n('Drive belt', 'Drivrem'),
    triggers: [hours(500, REPLACE), years(2, REPLACE)]
  },
  {
    id: 'cooling',
    type: 'component',
    parentId: 'engine',
    name: n('Cooling system', 'Kylsystem'),
    triggers: [season('haulout', 14, n('Winterize', 'Vinterförvara'))]
  },
  {
    id: 'raw-water-impeller',
    type: 'part',
    parentId: 'cooling',
    name: n('Raw-water impeller', 'Impeller'),
    notes: n('Carry a spare aboard.', 'Ha en reserv ombord.'),
    triggers: [hours(500, REPLACE), years(2, REPLACE)]
  },
  {
    id: 'coolant',
    type: 'part',
    parentId: 'cooling',
    name: n('Coolant', 'Kylvätska'),
    notes: n('Two years for long-life coolant; check the engine manual.', 'Två år för långtidsglykol; se motorns manual.'),
    triggers: [years(2, CHANGE)]
  },
  { id: 'drive', type: 'component', parentId: 'propulsion', name: n('Saildrive or shaft', 'Saildrive eller axel') },
  {
    id: 'gear-oil',
    type: 'part',
    parentId: 'drive',
    name: n('Gear oil', 'Växellådsolja'),
    triggers: [years(1, CHANGE)]
  },
  {
    id: 'drive-anode',
    type: 'part',
    parentId: 'drive',
    name: n('Drive anode', 'Anod på drev eller axel'),
    notes: n('Replace when half worn.', 'Byt när den är halvt förbrukad.'),
    triggers: [season('launch', -14, n('Check before launch', 'Kontrollera före sjösättning'))]
  },
  {
    id: 'drive-seal',
    type: 'part',
    parentId: 'drive',
    name: n('Drive seal', 'Tätning på drev eller axel'),
    notes: n(
      'The saildrive diaphragm or the shaft seal. Use the interval in its manual; seven years is common.',
      'Saildrivens gummibälg eller axeltätningen. Följ intervallet i manualen; sju år är vanligt.'
    ),
    triggers: [years(7, REPLACE)]
  },
  {
    id: 'propeller',
    type: 'part',
    parentId: 'drive',
    name: n('Propeller', 'Propeller'),
    triggers: [season('launch', -14, n('Clean & inspect', 'Rengör och inspektera'))]
  },

  // ---- Fuel -----------------------------------------------------------------------
  { id: 'fuel', type: 'system', name: n('Fuel', 'Bränsle') },
  {
    id: 'water-separator',
    type: 'part',
    parentId: 'fuel',
    name: n('Pre-filter & water separator', 'Förfilter med vattenavskiljare'),
    triggers: [hours(50, n('Drain water', 'Tappa ur vatten')), years(1, n('Change element', 'Byt filterinsats'))]
  },
  {
    id: 'fuel-filter',
    type: 'part',
    parentId: 'fuel',
    name: n('Engine fuel filter', 'Bränslefilter på motorn'),
    triggers: [years(1, CHANGE)]
  },
  {
    id: 'fuel-tank',
    type: 'part',
    parentId: 'fuel',
    name: n('Fuel tank', 'Bränsletank'),
    notes: n('Leave it full over winter to keep condensation out.', 'Lämna den full över vintern så att kondens inte bildas.'),
    triggers: [season('haulout', 0, n('Fill for winter', 'Fyll inför vintern'))]
  },

  // ---- Electrical -----------------------------------------------------------------
  {
    id: 'electrical',
    type: 'system',
    name: n('Electrical', 'El'),
    triggers: [season('launch', -14, n('Check connections', 'Kontrollera anslutningar'))]
  },
  {
    id: 'batteries',
    type: 'component',
    parentId: 'electrical',
    name: n('Batteries', 'Batterier'),
    triggers: [season('haulout', 14, n('Charge & isolate for winter', 'Ladda och koppla ur inför vintern'))]
  },

  // ---- Hull & deck ----------------------------------------------------------------
  { id: 'hull', type: 'system', name: n('Hull & deck', 'Skrov och däck') },
  {
    id: 'antifouling',
    type: 'part',
    parentId: 'hull',
    name: n('Antifouling', 'Bottenfärg'),
    triggers: [
      season('haulout', 3, n('Wash & inspect', 'Tvätta och inspektera')),
      season('launch', -21, n('Paint or touch up', 'Måla eller bättra'))
    ]
  },
  {
    id: 'bilge-pumps',
    type: 'part',
    parentId: 'hull',
    name: n('Bilge pumps', 'Länspumpar'),
    triggers: [season('launch', 0, n('Test', 'Testa'))]
  },
  {
    id: 'deck-fittings',
    type: 'part',
    parentId: 'hull',
    name: n('Hatches & deck fittings', 'Luckor och däcksbeslag'),
    triggers: [years(1, n('Check for leaks', 'Kontrollera läckage'))]
  },
  {
    id: 'winter-cover',
    type: 'part',
    parentId: 'hull',
    name: n('Winter cover', 'Vintertäckning'),
    triggers: [season('haulout', 14, n('Put on', 'Täck')), season('launch', -21, n('Take off', 'Ta av'))]
  },

  // ---- Through-hulls & seacocks ---------------------------------------------------
  { id: 'throughhulls', type: 'system', name: n('Through-hulls & seacocks', 'Genomföringar och bottenventiler') },
  {
    id: 'seacocks',
    type: 'part',
    parentId: 'throughhulls',
    name: n('Seacocks & hoses', 'Bottenventiler och slangar'),
    notes: n('Open and close each one, grease it, and check hose clamps.', 'Öppna och stäng varje ventil, smörj den och kontrollera slangklämmorna.'),
    triggers: [season('launch', -14, n('Exercise & check', 'Motionera och kontrollera'))]
  },

  // ---- Rig & sails ----------------------------------------------------------------
  { id: 'rig', type: 'system', name: n('Rig & sails', 'Rigg och segel') },
  {
    id: 'standing-rigging',
    type: 'component',
    parentId: 'rig',
    name: n('Standing rigging', 'Stående rigg'),
    notes: n('Many insurers expect wire rigging to be replaced after 10 years.', 'Många försäkringsbolag räknar med att vajerriggen byts efter 10 år.'),
    triggers: [season('launch', -14, n('Inspect before stepping', 'Inspektera före mastresning')), years(10, REPLACE)]
  },
  {
    id: 'running-rigging',
    type: 'component',
    parentId: 'rig',
    name: n('Running rigging', 'Löpande rigg'),
    triggers: [years(1, n('Check for chafe', 'Kontrollera nötning'))]
  },
  {
    id: 'winches',
    type: 'component',
    parentId: 'rig',
    name: n('Winches', 'Vinschar'),
    notes: n('Yearly if the boat is sailed hard.', 'Varje år om båten seglas hårt.'),
    triggers: [years(2, n('Strip & grease', 'Ta isär och smörj'))]
  },
  {
    id: 'sails',
    type: 'component',
    parentId: 'rig',
    name: n('Sails', 'Segel'),
    triggers: [season('haulout', 14, n('Inspect & store dry', 'Inspektera och förvara torrt'))]
  },

  // ---- Steering -------------------------------------------------------------------
  { id: 'steering', type: 'system', name: n('Steering', 'Styrning') },
  {
    id: 'rudder',
    type: 'part',
    parentId: 'steering',
    name: n('Rudder & steering', 'Roder och styrning'),
    triggers: [season('launch', -14, n('Check play & fastenings', 'Kontrollera glapp och infästningar'))]
  },

  // ---- Safety ---------------------------------------------------------------------
  { id: 'safety', type: 'system', name: n('Safety', 'Säkerhet') },
  {
    id: 'fire-extinguishers',
    type: 'part',
    parentId: 'safety',
    name: n('Fire extinguishers', 'Brandsläckare'),
    triggers: [years(1, n('Check pressure', 'Kontrollera trycket')), expiry(n('Service or replace', 'Service eller byte'))]
  },
  {
    id: 'flares',
    type: 'part',
    parentId: 'safety',
    name: n('Flares', 'Nödraketer och handbloss'),
    triggers: [expiry(REPLACE)]
  },
  {
    id: 'lifejackets',
    type: 'part',
    parentId: 'safety',
    name: n('Life jackets', 'Flytvästar'),
    triggers: [years(1, INSPECT), expiry(n('Replace re-arm kit', 'Byt utlösningsmekanism'))]
  },
  {
    id: 'first-aid',
    type: 'part',
    parentId: 'safety',
    name: n('First-aid kit', 'Förbandslåda'),
    triggers: [expiry(n('Restock', 'Fyll på'))]
  },

  // ---- Gas ------------------------------------------------------------------------
  {
    id: 'gas',
    type: 'system',
    name: n('Gas', 'Gasol'),
    triggers: [season('launch', 7, n('Leak test', 'Täthetsprova'))]
  },
  { id: 'gas-hose', type: 'part', parentId: 'gas', name: n('Gas hose', 'Gasolslang'), triggers: [years(5, REPLACE)] },
  { id: 'gas-regulator', type: 'part', parentId: 'gas', name: n('Regulator', 'Regulator'), triggers: [years(10, REPLACE)] },

  // ---- Water & sanitation ---------------------------------------------------------
  { id: 'sanitation', type: 'system', name: n('Water & sanitation', 'Vatten och sanitet') },
  {
    id: 'toilet',
    type: 'part',
    parentId: 'sanitation',
    name: n('Toilet', 'Toalett'),
    triggers: [season('haulout', 3, n('Empty & winterize', 'Töm och vinterförvara')), season('launch', 0, n('Check seals & pump', 'Kontrollera packningar och pump'))]
  },
  {
    id: 'fresh-water',
    type: 'part',
    parentId: 'sanitation',
    name: n('Fresh water', 'Färskvatten'),
    triggers: [season('haulout', 14, n('Drain for winter', 'Töm inför vintern')), season('launch', 0, n('Flush & fill', 'Spola och fyll'))]
  },

  // ---- Fees & insurance -------------------------------------------------------------
  // Not maintenance, but the same kind of reminder: it shows the tree holds anything
  // that comes round on a date.
  { id: 'fees', type: 'system', name: n('Fees & insurance', 'Avgifter och försäkring') },
  {
    id: 'insurance',
    type: 'part',
    parentId: 'fees',
    name: n('Boat insurance', 'Båtförsäkring'),
    notes: n('Set the renewal date from the policy.', 'Ange förnyelsedatumet från försäkringsbrevet.'),
    triggers: [expiry(n('Renew', 'Förnya'))]
  },
  {
    id: 'berth-fee',
    type: 'part',
    parentId: 'fees',
    name: n('Berth fee', 'Båtplatsavgift'),
    triggers: [years(1, n('Pay', 'Betala'))]
  }
]

/** The tree in one language, as node bodies POST /nodes would take. */
export function starterNodes(lang: StarterLang = 'en') {
  return STARTER_BOAT.map((s) => ({
    id: s.id,
    type: s.type,
    parentId: s.parentId,
    name: s.name[lang],
    notes: s.notes?.[lang],
    triggers: (s.triggers ?? []).map((t) => ({ name: t.name[lang], metric: t.metric, interval: t.interval, anchor: t.anchor }))
  }))
}
