import type { ChecklistRun, ChecklistTemplate } from '../types'
import { logId, slugify } from '../util/ids'

/** Instantiates a checklist template into a fresh run with all items pending. */
export function instantiateRun(
  template: ChecklistTemplate,
  author: string | undefined,
  now: Date
): ChecklistRun {
  return {
    id: logId(now, slugify(template.name)),
    templateId: template.id,
    name: template.name,
    startedAt: now.toISOString(),
    author,
    results: template.items.map((item) => ({
      itemId: item.id,
      text: item.text,
      status: 'pending'
    }))
  }
}
