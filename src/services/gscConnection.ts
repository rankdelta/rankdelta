/**
 * Persistent Google Search Console connection (server-side).
 *
 * Why this exists alongside `googleSearchConsole.ts`:
 *
 * The older client-side path keeps the Google access token in a module-level
 * variable (`googleSearchConsole.ts:33`) and never persists it. A reload, a new
 * tab, or the token's own 1-hour expiry wipes it, so the UI flips back to
 * "not connected" moments after the user connected — while the *selected
 * property* survives in localStorage, which makes it look like an intermittent
 * bug rather than by-design behaviour. Worse, that path never writes to
 * `gsc_properties` / `gsc_analytics_cache`, so reports stay empty even though
 * the user watched their own data render on screen.
 *
 * This module uses Google's **authorization code** flow instead of the token
 * flow: the browser only ever handles a short-lived one-time code, which is
 * exchanged server-side by the `gsc-connect` edge function. The refresh token
 * is stored encrypted, server-side, bound to the project — so the connection
 * survives reloads and feeds the report builder.
 *
 * The browser never sees a refresh token.
 */

import { supabase } from '../lib/supabaseClient'

export type GscProperty = {
  siteUrl: string
  permissionLevel?: string | null
}

export type GscOverviewTotals = {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

/**
 * One Search Console row. Structurally identical to `GscRow` in the legacy
 * `googleSearchConsole.ts` on purpose: the rankings UI renders rows from either
 * source through the same component.
 */
export type GscRow = {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type GscDailyPoint = {
  date: string
  clicks: number
  impressions: number
}

export type GscOverview = {
  totals: GscOverviewTotals
  topQueries: Array<GscRow>
  topPages: Array<GscRow>
  byDate: Array<GscDailyPoint>
}

export type GscConnectResult = {
  property: string
  properties: GscProperty[]
  overview: GscOverview | null
}

export type GscConnectionStatus = {
  connected: boolean
  property: string | null
  permissionLevel: string | null
  connectedAt: string | null
  /** When the cached analytics were last fetched — null when never. */
  dataAsOf: string | null
  /** Set when Google rejected the stored grant (daily refresh): the owner must reconnect. */
  revokedAt: string | null
}

/** Scope needed to read Search Console data. Read-only on purpose. */
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/**
 * Error codes the edge function can return, mapped to messages a user can act
 * on. Anything unmapped falls back to a generic message rather than leaking
 * raw server text.
 */
const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Google did not return an authorization code. Try connecting again.',
  // Google returns a refresh token only on the FIRST authorization of a given
  // client + user + scope ("The refresh_token is only returned on the first
  // authorization", developers.google.com/identity/protocols/oauth2/web-server).
  // Anyone who already granted webmasters.readonly to this client — including
  // every user of the old in-browser token flow — gets a code that exchanges
  // into an access token with no refresh token, and gsc-connect answers 400
  // no_refresh_token. "Try again" would loop forever: the grant has to be
  // removed at Google first, which the user does at the URL below.
  no_refresh_token:
    'Google did not return the long-lived token this needs, because it has already granted access to this app. Remove access at https://myaccount.google.com/permissions and then connect again.',
  not_configured: 'Google Search Console is not configured on this deployment.',
  not_connected: 'This project is not connected to Search Console.',
  no_properties: 'This Google account has no Search Console properties.',
  property_not_accessible:
    'That property is not readable by the connected Google account. Pick one from the list.',
  no_access_token: 'Could not obtain access from Google. Try connecting again.',
  gsc_request_failed: 'Search Console request failed. Try again in a moment.',
  forbidden: 'You do not have access to this project.',
  // Client-side failures of the consent popup. Without these the user would get
  // the generic message for something they did on purpose (closing the window).
  popup_closed: 'The Google window was closed before the connection finished.',
  authorization_denied: 'Access to Search Console was not granted.',
  authorization_failed: 'Google could not complete the authorization. Try again.',
  gis_load_failed: 'Could not load Google sign-in. Check your connection and try again.',
  missing_project: 'No project selected.',
}

export function gscErrorMessage(code: string | null | undefined): string {
  if (!code) return 'Search Console request failed.'
  return ERROR_MESSAGES[code] ?? 'Search Console request failed.'
}

function getGoogleClientId(): string {
  return String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
}

export function isGscConfigured(): boolean {
  return getGoogleClientId().length > 0
}

// ── Google Identity Services loader ────────────────────────────────────────

type CodeClient = { requestCode: () => void }
type GoogleAccountsOauth2 = {
  initCodeClient: (config: {
    client_id: string
    scope: string
    ux_mode: 'popup'
    /** Show the account chooser instead of silently reusing the signed-in account. */
    select_account?: boolean
    callback: (resp: { code?: string; error?: string }) => void
    error_callback?: (err: { type?: string }) => void
  }) => CodeClient
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOauth2 } }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let gisLoading: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no_window'))
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading

  gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('gis_load_failed')))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      gisLoading = null
      reject(new Error('gis_load_failed'))
    }
    document.head.appendChild(script)
  })
  return gisLoading
}

/**
 * Open Google's consent popup and resolve with a one-time authorization code.
 *
 * Uses `initCodeClient` (code flow), NOT `initTokenClient` (implicit flow): only
 * the code flow yields a refresh token, and only a refresh token can keep the
 * connection alive after the tab closes. The code is single-use and useless
 * without the client secret, which lives server-side.
 *
 * What this flow CANNOT do: force re-consent. `CodeClientConfig` (GIS reference,
 * developers.google.com/identity/oauth2/web/reference/js-reference) accepts
 * client_id, scope, include_granted_scopes, redirect_uri, callback, state,
 * login_hint, hd, ux_mode, select_account and error_callback — there is no
 * `prompt` and no `access_type`. So when Google withholds the refresh token
 * (already-granted scope) the only way out is for the user to remove the app's
 * access; `no_refresh_token` says exactly that. `select_account` at least lets
 * them pick a different Google account, which counts as a first authorization.
 */
async function requestAuthCode(): Promise<string> {
  const clientId = getGoogleClientId()
  if (!clientId) throw new Error('not_configured')

  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('gis_load_failed')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: GSC_SCOPE,
      ux_mode: 'popup',
      select_account: true,
      callback: (resp) => {
        if (resp.error || !resp.code) {
          reject(new Error(resp.error || 'authorization_denied'))
          return
        }
        resolve(resp.code)
      },
      error_callback: (err) => {
        reject(new Error(err?.type === 'popup_closed' ? 'popup_closed' : 'authorization_failed'))
      },
    })
    client.requestCode()
  })
}

// ── Edge function calls ────────────────────────────────────────────────────

type ConnectResponse = {
  ok?: boolean
  property?: string
  properties?: GscProperty[]
  overview?: GscOverview
  error?: string
}

async function invokeGscConnect(body: Record<string, unknown>): Promise<GscConnectResult> {
  const { data, error } = await supabase.functions.invoke<ConnectResponse>('gsc-connect', { body })

  // A non-2xx edge response surfaces as `error` with the payload in `data`.
  const code = data?.error ?? (error ? 'gsc_request_failed' : null)
  if (code) throw new Error(code)
  if (error) throw new Error('gsc_request_failed')
  if (!data?.property) throw new Error('gsc_request_failed')

  return {
    property: data.property,
    properties: data.properties ?? [],
    overview: data.overview ?? null,
  }
}

/**
 * Connect a project to Search Console.
 *
 * The refresh token is exchanged and stored server-side; nothing sensitive
 * stays in the browser. After this resolves the connection is durable — it
 * survives reloads, new devices, and feeds the report builder.
 */
export async function connectGscProject(
  projectId: string,
  options?: { siteUrl?: string; periodDays?: number },
): Promise<GscConnectResult> {
  if (!projectId) throw new Error('missing_project')
  const code = await requestAuthCode()
  return invokeGscConnect({
    action: 'connect',
    projectId,
    code,
    ...(options?.siteUrl ? { siteUrl: options.siteUrl } : {}),
    ...(options?.periodDays ? { periodDays: options.periodDays } : {}),
  })
}

/**
 * Refresh cached Search Console data using the stored refresh token.
 * No user interaction and no popup — this is the same call a scheduled job
 * would make.
 */
export async function syncGscProject(
  projectId: string,
  options?: { siteUrl?: string; periodDays?: number },
): Promise<GscConnectResult> {
  if (!projectId) throw new Error('missing_project')
  return invokeGscConnect({
    action: 'sync',
    projectId,
    ...(options?.siteUrl ? { siteUrl: options.siteUrl } : {}),
    ...(options?.periodDays ? { periodDays: options.periodDays } : {}),
  })
}

/**
 * Drop the connection for a project.
 *
 * Deletes the stored refresh token, the property row and the cached analytics
 * server-side (and revokes the grant at Google), so the next status read really
 * does say "not connected" — unlike the legacy path, which only forgot an
 * in-memory token the server never knew about.
 */
export async function disconnectGscProject(projectId: string): Promise<void> {
  if (!projectId) throw new Error('missing_project')
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'gsc-connect',
    { body: { action: 'disconnect', projectId } },
  )
  const code = data?.error ?? (error ? 'gsc_request_failed' : null)
  if (code) throw new Error(code)
}

/**
 * Read the stored connection for a project.
 *
 * Reads the database rather than any in-memory state, so the answer is the same
 * after a reload, in another tab, or on another device — which is precisely the
 * bug in the legacy client-side path.
 */
export async function getGscConnectionStatus(projectId: string): Promise<GscConnectionStatus> {
  const empty: GscConnectionStatus = {
    connected: false,
    property: null,
    permissionLevel: null,
    connectedAt: null,
    dataAsOf: null,
    revokedAt: null,
  }
  if (!projectId) return empty

  const readProperty = (columns: string) =>
    supabase
      .from('gsc_properties')
      .select(columns)
      .eq('project_id', projectId)
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  // sync_revoked_at arrives with migration 20260922120000; older self-hosted databases lack it.
  let { data: prop, error } = await readProperty('site_url, permission_level, connected_at, sync_revoked_at')
  if (error) ({ data: prop, error } = await readProperty('site_url, permission_level, connected_at'))

  if (error || !prop) return empty
  const row = prop as unknown as Record<string, unknown>

  const { data: cache } = await supabase
    .from('gsc_analytics_cache')
    .select('fetched_at')
    .eq('project_id', projectId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    connected: true,
    property: (row['site_url'] as string) ?? null,
    permissionLevel: (row['permission_level'] as string) ?? null,
    connectedAt: (row['connected_at'] as string) ?? null,
    dataAsOf: (cache?.fetched_at as string) ?? null,
    revokedAt: (row['sync_revoked_at'] as string | null | undefined) ?? null,
  }
}

// ── Cached analytics ───────────────────────────────────────────────────────

/** Windows `gsc_analytics_cache` is allowed to hold (CHECK constraint, migration 041). */
const ALLOWED_PERIOD_DAYS = [7, 28, 90] as const

/** The window the rankings UI shows, and the one the cache is keyed on. */
export const DEFAULT_PERIOD_DAYS = 28

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** jsonb columns are `unknown` until proven otherwise — read them defensively. */
type RawRow = Partial<Record<'key' | 'clicks' | 'impressions' | 'ctr' | 'position', unknown>>
type RawDaily = Partial<Record<'date' | 'clicks' | 'impressions', unknown>>

function toRows(value: unknown): Array<GscRow> {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const r = (raw ?? {}) as RawRow
    return {
      key: typeof r.key === 'string' ? r.key : '',
      clicks: toNumber(r.clicks),
      impressions: toNumber(r.impressions),
      ctr: toNumber(r.ctr),
      position: toNumber(r.position),
    }
  })
}

function toDaily(value: unknown): Array<GscDailyPoint> {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const r = (raw ?? {}) as RawDaily
    return {
      date: typeof r.date === 'string' ? r.date : '',
      clicks: toNumber(r.clicks),
      impressions: toNumber(r.impressions),
    }
  })
}

/**
 * Read the analytics the last connect/sync stored for this project.
 *
 * This is what makes a reload instant *and* honest: the numbers on screen are
 * the same ones the report builder reads, and showing them costs no Google
 * call. The legacy path instead re-queried Google on every mount, which needed
 * a live access token — the very thing that does not survive a reload.
 *
 * Returns null when nothing has been cached yet; the caller then syncs.
 */
export async function getCachedGscOverview(
  projectId: string,
  periodDays: number = DEFAULT_PERIOD_DAYS,
): Promise<GscOverview | null> {
  if (!projectId) return null
  const days = (ALLOWED_PERIOD_DAYS as ReadonlyArray<number>).includes(periodDays)
    ? periodDays
    : DEFAULT_PERIOD_DAYS

  const { data, error } = await supabase
    .from('gsc_analytics_cache')
    .select('clicks, impressions, ctr, avg_position, top_queries, top_pages, daily_data')
    .eq('project_id', projectId)
    .eq('period_days', days)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  return {
    totals: {
      clicks: toNumber(data.clicks),
      impressions: toNumber(data.impressions),
      ctr: toNumber(data.ctr),
      position: toNumber(data.avg_position),
    },
    topQueries: toRows(data.top_queries),
    topPages: toRows(data.top_pages),
    byDate: toDaily(data.daily_data),
  }
}

/** Age of the cached data in whole days, or null when never fetched. */
export function dataAgeInDays(dataAsOf: string | null, now: Date = new Date()): number | null {
  if (!dataAsOf) return null
  const fetched = new Date(dataAsOf).getTime()
  if (!Number.isFinite(fetched)) return null
  const diff = now.getTime() - fetched
  if (diff < 0) return 0
  return Math.floor(diff / 86_400_000)
}

/**
 * Whether cached data is old enough to warn about.
 *
 * Nothing refreshes GSC automatically today, so a connected project can serve
 * month-old numbers inside a report that carries an explicit period. Seven days
 * is a deliberate threshold: GSC itself lags ~2 days, so anything under a week
 * is normal rather than stale.
 */
export function isDataStale(dataAsOf: string | null, now: Date = new Date()): boolean {
  const age = dataAgeInDays(dataAsOf, now)
  return age !== null && age > 7
}
