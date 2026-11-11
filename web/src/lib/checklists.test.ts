import { describe, expect, it } from 'vitest'
import type { ChecklistTemplate } from '../../../src/types'
import { checklistSections, draftRun, finishedRun, runProgress } from './checklists'

const template: ChecklistTemplate = {
  id: 'winter',
  name: 'Winter storage',
  items: [
    { id: 'pi', text: 'Bring the Pi home', category: 'After haulout' },
    { id: 'fuses', text: 'Refit the solar fuses', category: 'At launch' },
    { id: 'fridge', text: 'Empty the fridge', category: 'After haulout' }
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

describe('checklists', () => {
  it('groups steps into sections in the order they first appear', () => {
    expect(checklistSections(template).map((s) => [s.name, s.items.map((i) => i.id)])).toEqual([
      ['After haulout', ['pi', 'fridge']],
      ['At launch', ['fuses']]
    ])
  })

  it('starts a run of one section with every step pending', () => {
    const run = draftRun(template, 'After haulout', new Date('2026-11-01T10:00:00Z'))
    expect(run).toMatchObject({ templateId: 'winter', section: 'After haulout', startedAt: '2026-11-01T10:00:00.000Z' })
    expect(run.id).toMatch(/^winter-storage-after-haulout-/)
    expect(run.results.map((r) => [r.itemId, r.status])).toEqual([
      ['pi', 'pending'],
      ['fridge', 'pending']
    ])
  })

  it('finishes a run by skipping what is left', () => {
    const run = draftRun(template, undefined)
    run.results[0].status = 'fail'
    const done = finishedRun(run, new Date('2026-11-02T00:00:00Z'))
    expect(done.completedAt).toBe('2026-11-02T00:00:00.000Z')
    expect(done.results.map((r) => r.status)).toEqual(['fail', 'skip', 'skip'])
    expect(runProgress(done)).toEqual({ done: 3, total: 3, problems: 1, left: 0 })
  })
})
