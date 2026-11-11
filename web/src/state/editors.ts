import { signal } from '@preact/signals'

/*
 * The editor sheet open over the app, if any. Editors are sheets rather than routes,
 * like Skerry's: they open over whatever is on screen and close back to it.
 */
export type Editor =
  | { kind: 'node'; id?: string; parentId?: string }
  | { kind: 'trigger'; nodeId: string; triggerId?: string }
  | { kind: 'service'; nodeId?: string; triggerIds?: string[] }
  | { kind: 'issue'; id?: string; nodeId?: string; title?: string; note?: string }
  | { kind: 'resolveIssue'; id: string }

export const editor = signal<Editor | null>(null)

export function openEditor(e: Editor): void {
  editor.value = e
}

export function closeEditor(): void {
  editor.value = null
}

/** The node open in the detail pane, so "Job done" from the capture menu lands there. */
export const focusedNodeId = signal<string | undefined>(undefined)
