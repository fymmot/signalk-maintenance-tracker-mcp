import type {
  BoatEvent,
  ChecklistRun,
  ChecklistTemplate,
  Issue,
  MaintenanceNode,
  PendingPhoto,
  Season,
  ServiceLog,
  Trigger
} from '../../../src/types'
import { api } from './client'

/*
 * Writes to the plugin, one function per route. The server fills ids, timestamps and
 * defaults, so creates send only what the user chose. A node PUT replaces its whole
 * trigger list, so callers always send every trigger.
 */

const e = encodeURIComponent

export interface PhotoRef {
  handle: string
  caption?: string
}

export type NodeWrite = Partial<Omit<MaintenanceNode, 'triggers'>> & {
  triggers?: Array<Partial<Trigger>>
  photos?: PhotoRef[]
}

export const createNode = (body: NodeWrite) => api<MaintenanceNode>('POST', '/nodes', body)
export const updateNode = (id: string, body: NodeWrite) => api<MaintenanceNode>('PUT', `/nodes/${e(id)}`, body)
export const deleteNode = (id: string, recursive = false) =>
  api<void>('DELETE', `/nodes/${e(id)}`, undefined, { query: { recursive: recursive || undefined } })
export const nodeLogs = (id: string) => api<ServiceLog[]>('GET', `/nodes/${e(id)}/logs`)

export interface ServiceWrite {
  triggerIds: string[]
  datetime: string
  description: string
  comment?: string
  partsReplaced?: string[]
  expiresOn?: string
  cost?: number
  costCurrency?: string
  photos?: PhotoRef[]
}
export const markServiced = (nodeId: string, body: ServiceWrite) =>
  api<ServiceLog>('POST', `/nodes/${e(nodeId)}/service`, body)
export const deleteLog = (id: string) => api<void>('DELETE', `/logs/${e(id)}`)

export const snooze = (nodeId: string, triggerId: string, until: string) =>
  api<Trigger>('POST', `/nodes/${e(nodeId)}/triggers/${e(triggerId)}/snooze`, { until })
export const unsnooze = (nodeId: string, triggerId: string) =>
  api<Trigger>('DELETE', `/nodes/${e(nodeId)}/triggers/${e(triggerId)}/snooze`)

export interface IssueWrite {
  nodeId?: string
  title?: string
  description?: string
  status?: Issue['status']
  severity?: Issue['severity']
  /** '' clears it. */
  fixBy?: Issue['fixBy'] | ''
  comment?: string
  resolutionLogId?: string
  photos?: PhotoRef[]
}
export const createIssue = (body: IssueWrite) => api<Issue>('POST', '/issues', body)
export const updateIssue = (id: string, body: IssueWrite) => api<Issue>('PUT', `/issues/${e(id)}`, body)
export const deleteIssue = (id: string) => api<void>('DELETE', `/issues/${e(id)}`)

export type SeasonWrite = Partial<Pick<Season, 'label' | 'launchDate' | 'hauloutDate' | 'notes'>>
export const createSeason = (body: SeasonWrite) => api<Season>('POST', '/seasons', body)
export const updateSeason = (id: string, body: SeasonWrite) => api<Season>('PUT', `/seasons/${e(id)}`, body)
export const deleteSeason = (id: string) => api<void>('DELETE', `/seasons/${e(id)}`)

export type EventWrite = Partial<Pick<BoatEvent, 'datetime' | 'category' | 'title' | 'description' | 'nodeId' | 'location'>> & {
  photos?: PhotoRef[]
}
export const createEvent = (body: EventWrite) => api<BoatEvent>('POST', '/events', body)
export const updateEvent = (id: string, body: EventWrite) => api<BoatEvent>('PUT', `/events/${e(id)}`, body)
export const deleteEvent = (id: string) => api<void>('DELETE', `/events/${e(id)}`)

export type TemplateWrite = Partial<Pick<ChecklistTemplate, 'name' | 'description' | 'items' | 'schedule'>>
export const createTemplate = (body: TemplateWrite) => api<ChecklistTemplate>('POST', '/checklists/templates', body)
export const updateTemplate = (id: string, body: TemplateWrite) =>
  api<ChecklistTemplate>('PUT', `/checklists/templates/${e(id)}`, body)
export const deleteTemplate = (id: string) => api<void>('DELETE', `/checklists/templates/${e(id)}`)

export const createRun = (body: Partial<ChecklistRun>) => api<ChecklistRun>('POST', '/checklists/runs', body)
export const updateRun = (id: string, body: Partial<ChecklistRun>) => api<ChecklistRun>('PUT', `/checklists/runs/${e(id)}`, body)
export const deleteRun = (id: string) => api<void>('DELETE', `/checklists/runs/${e(id)}`)

export const uploadPhoto = (contentBase64: string, takenAt?: string) =>
  api<PendingPhoto>('POST', '/photos/pending', { contentBase64, takenAt })

export interface AttachmentsWrite {
  kind: 'node' | 'log' | 'issue' | 'event' | 'run'
  id: string
  itemId?: string
  photos?: PhotoRef[]
  remove?: string[]
  /** New captions by photo id; '' removes one. */
  captions?: Record<string, string>
}
export const updateAttachments = (body: AttachmentsWrite) => api<unknown>('POST', '/attachments', body)

/** Creates the starter boat: every node of it not already there. */
export const createStarterBoat = (lang: 'en' | 'sv') =>
  api<{ created: number; skipped: number; ids: string[] }>('POST', '/starter-boat', { lang })
