import type { ChecklistTemplate } from '../../../src/types'
import { t } from '../i18n'
import { nodesById } from '../state/store'
import { ancestors } from './maint'
import type { Route } from './router'

/*
 * Breadcrumb trails: where a page lives, not how the user got there (Back does that).
 * Every page below a destination starts its trail with that destination, then the
 * records it sits under. The page itself is the app bar title, so it is not repeated.
 */

export interface Crumb {
  label: string
  route: Route
}

export const boatCrumb = (): Crumb => ({ label: t('nav.boat'), route: { name: 'boat' } })
export const checklistsCrumb = (): Crumb => ({ label: t('nav.checklists'), route: { name: 'checklists' } })

/** Boat, then every node above this one; with `self`, the node too (for records on it). */
export function nodeTrail(nodeId: string | undefined, self = false): Crumb[] {
  const node = nodeId ? nodesById.value.get(nodeId) : undefined
  if (!node) return [boatCrumb()]
  const chain = [...ancestors(nodesById.value, node), ...(self ? [node] : [])]
  return [boatCrumb(), ...chain.map((n) => ({ label: n.name, route: { name: 'node', id: n.id } as Route }))]
}

export function templateTrail(template: ChecklistTemplate | undefined): Crumb[] {
  return template ? [checklistsCrumb(), { label: template.name, route: { name: 'checklist', id: template.id } }] : [checklistsCrumb()]
}
