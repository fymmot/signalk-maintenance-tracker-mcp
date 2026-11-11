import type { ChecklistItemTemplate, ChecklistRun, ChecklistTemplate } from '../../../src/types'

/*
 * Checklist helpers, ported from Skerry: a template's sections are its items' categories
 * in the order they first appear; a run is a copy of one section's steps (or all of them)
 * with an answer per step.
 */

export interface ChecklistSection {
  /** The item category; undefined for steps with none. */
  name?: string
  items: ChecklistItemTemplate[]
}

export function checklistSections(template: Pick<ChecklistTemplate, 'items'>): ChecklistSection[] {
  const sections: ChecklistSection[] = []
  for (const item of template.items) {
    const name = item.category || undefined
    let section = sections.find((s) => s.name === name)
    if (!section) {
      section = { name, items: [] }
      sections.push(section)
    }
    section.items.push(item)
  }
  return sections
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'run'
  )
}

/** A fresh run of one section (or the whole template), not yet saved. */
export function draftRun(template: ChecklistTemplate, section: string | undefined, now = new Date()): ChecklistRun {
  const items = section === undefined ? template.items : template.items.filter((i) => (i.category || undefined) === section)
  return {
    id: `${slug(`${template.name} ${section ?? ''}`)}-${now.getTime().toString(36)}`,
    templateId: template.id,
    name: template.name,
    section,
    startedAt: now.toISOString(),
    results: items.map((i) => ({ itemId: i.id || i.text, text: i.text, status: 'pending' }))
  }
}

export function runProgress(run: ChecklistRun): { done: number; total: number; problems: number; left: number } {
  const total = run.results.length
  const done = run.results.filter((r) => r.status !== 'pending').length
  return { done, total, problems: run.results.filter((r) => r.status === 'fail').length, left: total - done }
}

/** Every pending step skipped, and the run marked complete. */
export function finishedRun(run: ChecklistRun, now = new Date()): ChecklistRun {
  const stamp = now.toISOString()
  return {
    ...run,
    completedAt: stamp,
    results: run.results.map((r) => (r.status === 'pending' ? { ...r, status: 'skip', timestamp: stamp } : r))
  }
}
