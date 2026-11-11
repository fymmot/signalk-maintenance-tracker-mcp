import { describe, expect, it } from 'vitest'
import { SchemaValidator, ValidationError } from '../src/store/validation'
import type { MaintenanceNode } from '../src/types'

const validator = new SchemaValidator()

function validNode(): MaintenanceNode {
  return {
    id: 'yanmar-3ym20',
    type: 'component',
    name: 'Yanmar 3YM20',
    triggers: [
      {
        id: 'anode',
        name: 'Pencil anode',
        metric: 'engineHours',
        interval: 500,
        lastServiceValue: 0,
        lastServiceDate: '2026-01-01T00:00:00.000Z',
        enabled: true
      }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('SchemaValidator', () => {
  it('accepts a valid node', () => {
    expect(() => validator.validate('MaintenanceNode', validNode())).not.toThrow()
  })

  it('rejects an invalid node type', () => {
    const node = { ...validNode(), type: 'engine' }
    expect(() => validator.validate('MaintenanceNode', node)).toThrow(ValidationError)
  })

  it('rejects a node missing required fields', () => {
    const node = validNode() as Partial<MaintenanceNode>
    delete node.name
    expect(() => validator.validate('MaintenanceNode', node)).toThrow(ValidationError)
  })

  it('rejects an invalid trigger metric', () => {
    const node = validNode()
    node.triggers[0].metric = 'mileage' as never
    expect(() => validator.validate('MaintenanceNode', node)).toThrow(ValidationError)
  })

  it('rejects an unknown id pattern (path traversal guard)', () => {
    const node = { ...validNode(), id: '../escape' }
    expect(() => validator.validate('MaintenanceNode', node)).toThrow(ValidationError)
  })

  it('accepts a seasonAnchor trigger with an anchor', () => {
    const node = validNode()
    node.triggers[0] = {
      id: 'antifoul',
      name: 'Antifoul before launch',
      metric: 'seasonAnchor',
      interval: 0,
      anchor: { milestone: 'launch', offsetDays: -14 },
      lastServiceValue: 0,
      lastServiceDate: '2026-01-01T00:00:00.000Z',
      enabled: true
    }
    expect(() => validator.validate('MaintenanceNode', node)).not.toThrow()
  })

  it('accepts a valid season', () => {
    const season = {
      id: '2026',
      label: '2026 season',
      launchDate: '2026-05-03',
      hauloutDate: '2026-10-18',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    expect(() => validator.validate('Season', season)).not.toThrow()
  })

  it('accepts a valid event', () => {
    const event = {
      id: '2026-07-15-round-gotland',
      datetime: '2026-07-15T08:00:00.000Z',
      category: 'regatta',
      title: 'Round Gotland race',
      createdAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T08:00:00.000Z'
    }
    expect(() => validator.validate('Event', event)).not.toThrow()
  })

  it('rejects an event missing its title', () => {
    const event = {
      id: 'ev1',
      datetime: '2026-07-15T08:00:00.000Z',
      category: 'regatta',
      createdAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T08:00:00.000Z'
    }
    expect(() => validator.validate('Event', event)).toThrow(ValidationError)
  })

  it('accepts an issue with a history trail', () => {
    const issue = {
      id: 'foot-pump-failed',
      nodeId: 'foot-pump',
      title: 'Foot pump failed',
      status: 'resolved',
      severity: 'medium',
      openedAt: '2026-06-10T12:00:00.000Z',
      resolvedAt: '2026-06-20T15:00:00.000Z',
      updatedAt: '2026-06-20T15:00:00.000Z',
      history: [
        { datetime: '2026-06-10T12:00:00.000Z', type: 'opened' },
        {
          datetime: '2026-06-20T15:00:00.000Z',
          type: 'resolved',
          status: 'resolved',
          comment: 'Fitted a one-for-one replacement pump.'
        }
      ]
    }
    expect(() => validator.validate('Issue', issue)).not.toThrow()
  })

  it('accepts a legacy issue without history (optional field)', () => {
    const issue = {
      id: 'legacy',
      nodeId: 'rig',
      title: 'Legacy issue',
      status: 'open',
      openedAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z'
    }
    expect(() => validator.validate('Issue', issue)).not.toThrow()
  })

  it('rejects an issue history entry with an unknown type', () => {
    const issue = {
      id: 'bad-history',
      nodeId: 'rig',
      title: 'Bad history',
      status: 'open',
      openedAt: '2026-06-10T12:00:00.000Z',
      updatedAt: '2026-06-10T12:00:00.000Z',
      history: [{ datetime: '2026-06-10T12:00:00.000Z', type: 'invented' }]
    }
    expect(() => validator.validate('Issue', issue)).toThrow(ValidationError)
  })

  it('throws for an unknown schema name', () => {
    expect(() => validator.validate('Nope', {})).toThrow()
  })
})
