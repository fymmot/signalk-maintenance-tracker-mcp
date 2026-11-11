import type { MaintenanceNode } from '../types'

export interface NodeTreeItem extends MaintenanceNode {
  children: NodeTreeItem[]
}

/**
 * Builds the System -> Component -> Part tree from a flat node list. Nodes whose
 * `parentId` is missing or unresolved become roots, so orphans are never lost.
 */
export function buildTree(nodes: MaintenanceNode[]): NodeTreeItem[] {
  const items = new Map<string, NodeTreeItem>()
  for (const node of nodes) {
    items.set(node.id, { ...node, children: [] })
  }
  const roots: NodeTreeItem[] = []
  for (const item of items.values()) {
    const parent = item.parentId ? items.get(item.parentId) : undefined
    if (parent) {
      parent.children.push(item)
    } else {
      roots.push(item)
    }
  }
  return roots
}

/** Returns the ids of a node and all its descendants. */
export function descendantIds(nodes: MaintenanceNode[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node.id)
    childrenByParent.set(node.parentId, list)
  }
  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    result.push(id)
    const children = childrenByParent.get(id)
    if (children) stack.push(...children)
  }
  return result
}
