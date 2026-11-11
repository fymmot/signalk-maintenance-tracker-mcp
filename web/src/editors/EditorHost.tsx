import { closeEditor, editor } from '../state/editors'
import { IssueEditor, ResolveIssueEditor } from './IssueEditor'
import { NodeEditor } from './NodeEditor'
import { ServiceEditor } from './ServiceEditor'
import { TriggerEditor } from './TriggerEditor'

/** Renders the editor sheet that is open, if any. */
export function EditorHost() {
  const e = editor.value
  if (!e) return null
  switch (e.kind) {
    case 'node':
      return <NodeEditor key={`node-${e.id ?? 'new'}`} id={e.id} parentId={e.parentId} onClose={closeEditor} />
    case 'trigger':
      return <TriggerEditor key={`trigger-${e.nodeId}-${e.triggerId ?? 'new'}`} nodeId={e.nodeId} triggerId={e.triggerId} onClose={closeEditor} />
    case 'service':
      return <ServiceEditor key={`service-${e.nodeId ?? ''}`} nodeId={e.nodeId} triggerIds={e.triggerIds} onClose={closeEditor} />
    case 'issue':
      return <IssueEditor key={`issue-${e.id ?? 'new'}`} id={e.id} nodeId={e.nodeId} title={e.title} note={e.note} onClose={closeEditor} />
    case 'resolveIssue':
      return <ResolveIssueEditor key={`resolve-${e.id}`} id={e.id} onClose={closeEditor} />
  }
}
