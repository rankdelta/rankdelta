/**
 * googleSearchConsole.ts — Gate 5 "proof of results": real Google Search Console data
 * (clicks, impressions, CTR, average position) so the user can SEE the SEO/GEO loop working.
 *
 * Deliberately CLIENT-SIDE and SECRET-FREE: uses Google Identity Services (GIS) OAuth token flow
 * with a *public* OAuth Client ID (VITE_GOOGLE_CLIENT_ID). The browser gets a short-lived access
 * token (~1h, kept in memory only) and calls the Search Console REST API directly. No backend, no
 * client secret, no Edge Function — so this does NOT touch the server-side-API-keys launch blocker.
 *
 * Setup the USER must do once (their Google Cloud project, not ours):
 *   1. Create an OAuth 2.0 Client ID (type "Web application") in Google Cloud Console.
 *   2. Add the app origin to "Authorized JavaScript origins".
 *   3. Enable the "Google Search Console API".
 *   4. Put the Client ID in VITE_GOOGLE_CLIENT_ID.
 * We never see or store a secret; the Client ID is safe to ship in the bundle.
 */

import { getEnvVar } from '../utils/env'

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

export function getGoogleClientId(): string {
  return getEnvVar('VITE_GOOGLE_CLIENT_ID', false)
}

/** True when the app is configured for GSC (the user added their OAuth Client ID). */
export function isGscConfigured(): boolean {
  return !!getGoogleClientId()
}

// ── In-memory token (never persisted — access tokens are short-lived bearer creds) ──
//
// DEPRECATED for connecting a project. This module is a *live-view* helper only.
//
// Because the token lives here and nowhere else, `hasValidToken()` is false after
// any page reload, in any new tab, and once the token expires (1 hour). A user who
// "connects" through this path sees their data render and then finds the UI back to
// "not connected" — a customer-reported symptom, not a transient glitch. This path
// also never writes `gsc_properties` / `gsc_analytics_cache`, so reports stay empty.
//
// For a durable connection use `src/services/gscConnection.ts`, which runs Google's
// authorization-code flow and has the `gsc-connect` edge function store an encrypted
// refresh token server-side.
let accessToken: string | null = null
let tokenExpiresAt = 0

export function hasValidToken(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 30_000
}

export function clearGscToken(): void {
  accessToken = null
  tokenExpiresAt = 0
}

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Impossibile caricare Google Identity Services')))
      return
    }
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Impossibile caricare Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoading
}

/**
 * Request an access token via the GIS popup (consent on first use). Resolves with the token and
 * caches it in memory until expiry. Rejects if the user closes the popup or denies access.
 */
export async function connectGsc(): Promise<string> {
  const clientId = getGoogleClientId()
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configurato')
  await loadGis()

  return new Promise<string>((resolve, reject) => {
    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GSC_SCOPE,
        callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error || 'Autorizzazione negata'))
            return
          }
          accessToken = resp.access_token
          tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000
          resolve(accessToken)
        },
        error_callback: (err: { type?: string }) => {
          reject(new Error(err?.type === 'popup_closed' ? 'Finestra di Google chiusa' : 'Autorizzazione non riuscita'))
        },
      })
      client.requestAccessToken()
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Connessione a Google non riuscita'))
    }
  })
}

async function ensureToken(): Promise<string> {
  if (hasValidToken() && accessToken) return accessToken
  return connectGsc()
}

async function gscFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await ensureToken()
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (res.status === 401) {
    clearGscToken()
    throw new Error('Sessione Google scaduta — riconnetti')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Errore Search Console (${res.status}) ${body.slice(0, 160)}`)
  }
  return res.json() as Promise<T>
}

export interface GscProperty {
  siteUrl: string
  permissionLevel: string
}

/** List the verified properties the connected Google account can read. */
export async function listGscProperties(): Promise<GscProperty[]> {
  const data = await gscFetch<{ siteEntry?: GscProperty[] }>('/sites')
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
}

/** Pick the property that best matches a project's website (handles sc-domain: and trailing slash). */
export function matchProperty(properties: GscProperty[], websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl || properties.length === 0) return properties[0]?.siteUrl ?? null
  let host = websiteUrl
  try {
    host = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '')
  } catch {
    /* use raw */
  }
  const exact = properties.find((p) => {
    const ps = p.siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    return ps === host
  })
  return (exact ?? properties[0])?.siteUrl ?? null
}

export interface GscTotals {
  clicks: number
  impressions: number
  ctr: number // 0–1
  position: number
}

export interface GscRow {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscOverview {
  totals: GscTotals
  topQueries: GscRow[]
  topPages: GscRow[]
  /** Daily clicks for the trend sparkline, oldest → newest. */
  byDate: Array<{ date: string; clicks: number; impressions: number }>
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function queryAnalytics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 10,
): Promise<Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }>> {
  const enc = encodeURIComponent(siteUrl)
  const data = await gscFetch<{ rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }> }>(
    `/sites/${enc}/searchAnalytics/query`,
    { method: 'POST', body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }) },
  )
  return data.rows ?? []
}

/** Fetch query-level analytics (up to rowLimit rows, sorted by impressions desc from API). */
export async function getGscQueryRows(siteUrl: string, days = 28, rowLimit = 500): Promise<GscRow[]> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  const startDate = ymd(start)
  const endDate = ymd(end)
  const rows = await queryAnalytics(siteUrl, startDate, endDate, ['query'], rowLimit)
  return rows.map((r) => ({
    key: r.keys?.[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }))
}

/** Fetch a full GSC overview for a property over the last `days` days. */
export async function getGscOverview(siteUrl: string, days = 28): Promise<GscOverview> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  const startDate = ymd(start)
  const endDate = ymd(end)

  const [totalsRows, queries, pages, dates] = await Promise.all([
    queryAnalytics(siteUrl, startDate, endDate, [], 1),
    queryAnalytics(siteUrl, startDate, endDate, ['query'], 10),
    queryAnalytics(siteUrl, startDate, endDate, ['page'], 10),
    queryAnalytics(siteUrl, startDate, endDate, ['date'], days + 1),
  ])

  const t = totalsRows[0]
  const totals: GscTotals = {
    clicks: t?.clicks ?? 0,
    impressions: t?.impressions ?? 0,
    ctr: t?.ctr ?? 0,
    position: t?.position ?? 0,
  }
  const toRow = (r: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }): GscRow => ({
    key: r.keys?.[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  })

  return {
    totals,
    topQueries: queries.map(toRow),
    topPages: pages.map(toRow),
    byDate: dates
      .map((r) => ({ date: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  }
}
