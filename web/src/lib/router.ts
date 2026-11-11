import { signal } from '@preact/signals'

/*
 * A hash router: Signal K serves the app as static files with no rewrites, so every
 * screen lives after the #. Routes are matched in order; `:param` segments are decoded.
 */

export type Route =
  | { name: 'work' }
  | { name: 'boat' }
  | { name: 'checklists' }
  | { name: 'log' }
  | { name: 'mcp' }
  | { name: 'settings' }
  | { name: 'node'; id: string }
  | { name: 'issues' }
  | { name: 'issue'; id: string }
  | { name: 'seasons' }
  | { name: 'season'; id?: string }
  | { name: 'events' }
  | { name: 'event'; id?: string }
  | { name: 'checklist'; id: string }
  | { name: 'checklistEdit'; id?: string }
  | { name: 'run'; id: string }

/** The four destinations that own a list pane; the rest are full-width pages. */
export type Destination = 'work' | 'boat' | 'checklists' | 'log' | 'mcp' | 'settings'

const PATTERNS: Array<[RegExp, (m: string[]) => Route]> = [
  [/^\/work$/, () => ({ name: 'work' })],
  [/^\/boat$/, () => ({ name: 'boat' })],
  [/^\/checklists$/, () => ({ name: 'checklists' })],
  [/^\/log$/, () => ({ name: 'log' })],
  [/^\/mcp$/, () => ({ name: 'mcp' })],
  [/^\/settings$/, () => ({ name: 'settings' })],
  [/^\/node\/([^/]+)$/, (m) => ({ name: 'node', id: m[1] })],
  [/^\/issues$/, () => ({ name: 'issues' })],
  [/^\/issue\/([^/]+)$/, (m) => ({ name: 'issue', id: m[1] })],
  [/^\/seasons$/, () => ({ name: 'seasons' })],
  [/^\/season\/new$/, () => ({ name: 'season' })],
  [/^\/season\/([^/]+)$/, (m) => ({ name: 'season', id: m[1] })],
  [/^\/events$/, () => ({ name: 'events' })],
  [/^\/event\/new$/, () => ({ name: 'event' })],
  [/^\/event\/([^/]+)$/, (m) => ({ name: 'event', id: m[1] })],
  [/^\/checklist\/new$/, () => ({ name: 'checklistEdit' })],
  [/^\/checklist\/([^/]+)\/edit$/, (m) => ({ name: 'checklistEdit', id: m[1] })],
  [/^\/checklist\/([^/]+)$/, (m) => ({ name: 'checklist', id: m[1] })],
  [/^\/run\/([^/]+)$/, (m) => ({ name: 'run', id: m[1] })]
]

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] || '/work'
  for (const [re, make] of PATTERNS) {
    const m = path.match(re)
    if (m) return make([m[0], ...m.slice(1).map(decodeURIComponent)])
  }
  return { name: 'work' }
}

export function hrefFor(route: Route): string {
  const e = encodeURIComponent
  switch (route.name) {
    case 'node':
      return `#/node/${e(route.id)}`
    case 'issue':
      return `#/issue/${e(route.id)}`
    case 'season':
      return route.id ? `#/season/${e(route.id)}` : '#/season/new'
    case 'event':
      return route.id ? `#/event/${e(route.id)}` : '#/event/new'
    case 'checklist':
      return `#/checklist/${e(route.id)}`
    case 'checklistEdit':
      return route.id ? `#/checklist/${e(route.id)}/edit` : '#/checklist/new'
    case 'run':
      return `#/run/${e(route.id)}`
    default:
      return `#/${route.name}`
  }
}

export const route = signal<Route>(parseHash(location.hash))

/** The list destination shown beside a detail on wide screens, and highlighted in the nav. */
export const destination = signal<Destination>(destinationOf(route.value) ?? 'work')

function destinationOf(r: Route): Destination | undefined {
  switch (r.name) {
    case 'work':
    case 'boat':
    case 'checklists':
    case 'log':
    case 'mcp':
    case 'settings':
      return r.name
    case 'seasons':
    case 'events':
      return 'boat'
    case 'checklist':
    case 'checklistEdit':
    case 'run':
      return 'checklists'
    default:
      return undefined
  }
}

/** True when the route is a record or sub-list shown in the detail pane. */
export function isDetail(r: Route): boolean {
  return !['work', 'boat', 'checklists', 'log', 'mcp', 'settings'].includes(r.name)
}

/** How many screens the user has opened inside the app, so Back never leaves it. */
let depth = 0

function sync(): void {
  const next = parseHash(location.hash)
  route.value = next
  // A node or issue opened from the Work list stays beside the Work list.
  destination.value = destinationOf(next) ?? destination.value
}

window.addEventListener('hashchange', sync)
window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1)
})

export function navigate(to: Route, opts: { replace?: boolean } = {}): void {
  const href = hrefFor(to)
  if (href === location.hash) return
  if (opts.replace) {
    history.replaceState(null, '', href)
  } else {
    history.pushState(null, '', href)
    depth++
  }
  sync()
}

/** Back within the app when it has history, else up to the destination's list. */
export function goBack(): void {
  if (depth > 0) history.back()
  else navigate({ name: destination.value }, { replace: true })
}
