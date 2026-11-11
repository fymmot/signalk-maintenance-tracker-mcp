import { signal } from '@preact/signals'

/*
 * The plugin's REST API and the bits of Signal K the app needs (sign-in, plugin config).
 *
 * Signal K serves this app at <prefix>/signalk-maintenance-tracker-mcp/, where <prefix>
 * is empty on a plain server and a subpath behind some reverse proxies. The API sits at
 * <prefix>/plugins/signalk-maintenance-tracker-mcp on the same origin, so the session
 * cookie Signal K sets at sign-in authorises every call.
 */

export const PLUGIN_ID = 'signalk-maintenance-tracker-mcp'

function serverPrefix(): string {
  const path = location.pathname
  const at = path.indexOf(`/${PLUGIN_ID}/`)
  return at >= 0 ? path.slice(0, at) : ''
}

export const SERVER = serverPrefix()
export const API = `${SERVER}/plugins/${PLUGIN_ID}`

export type ApiErrorKind = 'auth' | 'forbidden' | 'notFound' | 'conflict' | 'invalid' | 'stopped' | 'network' | 'server'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ApiErrorKind,
    message: string,
    readonly body?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 400) return 'invalid'
  if (status === 503) return 'stopped'
  return 'server'
}

/** Set when a call came back 401; the shell shows the sign-in dialog. */
export const signInNeeded = signal(false)

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
}

export async function request<T>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const qs = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  let res: Response
  try {
    res = await fetch(qs ? `${url}?${qs}` : url, {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network', (e as Error).message)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    if (res.status === 401) signInNeeded.value = true
    const message = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : res.statusText
    throw new ApiError(res.status, kindOf(res.status), message, data)
  }
  return data as T
}

/** A call to the plugin's own API: `api('GET', '/nodes')`. */
export function api<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
  return request<T>(method, `${API}${path}`, body, opts)
}

export function mediaUrl(id: string): string {
  return `${API}/media/${encodeURIComponent(id)}`
}

// ---- Signal K: who is signed in, sign-in, and this plugin's saved config ----

export type UserLevel = 'admin' | 'readwrite' | 'readonly'

export interface LoginStatus {
  status: 'loggedIn' | 'notLoggedIn'
  authenticationRequired?: boolean
  readOnlyAccess?: boolean
  username?: string
  userLevel?: UserLevel
}

export function loginStatus(): Promise<LoginStatus> {
  return request<LoginStatus>('GET', `${SERVER}/skServer/loginStatus`)
}

export async function signIn(username: string, password: string): Promise<void> {
  await request('POST', `${SERVER}/signalk/v1/auth/login`, { username, password })
  signInNeeded.value = false
}

/** What Signal K stores for a plugin (`GET /plugins/<id>/config`, admin only). */
export interface PluginOptions {
  enabled: boolean
  enableLogging?: boolean
  enableDebug?: boolean
  configuration: Record<string, unknown>
}

export function readPluginOptions(): Promise<PluginOptions> {
  return request<PluginOptions>('GET', `${SERVER}/plugins/${PLUGIN_ID}/config`)
}

/** Saves the plugin's options; Signal K then restarts the plugin with them. */
export function savePluginOptions(options: PluginOptions): Promise<unknown> {
  return request('POST', `${SERVER}/plugins/${PLUGIN_ID}/config`, options)
}

export function pluginConfigUrl(): string {
  return `${SERVER}/admin/#/serverConfiguration/plugins/${PLUGIN_ID}`
}

/** User-facing text for an error, never the raw exception (see the copy guide). */
export function errorKey(e: unknown): 'error.network' | 'error.readOnly' | 'error.stopped' | 'error.conflict' | 'error.save' {
  if (!(e instanceof ApiError)) return 'error.save'
  switch (e.kind) {
    case 'network':
      return 'error.network'
    case 'forbidden':
      return 'error.readOnly'
    case 'stopped':
      return 'error.stopped'
    case 'conflict':
      return 'error.conflict'
    default:
      return 'error.save'
  }
}
