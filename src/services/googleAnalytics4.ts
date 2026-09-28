/**
 * googleAnalytics4.ts — Gate 5 "proof of results": real Google Analytics 4 data
 * (sessions, users, pageviews, bounce rate) so the user can SEE traffic alongside GSC.
 *
 * Deliberately CLIENT-SIDE and SECRET-FREE: uses Google Identity Services (GIS) OAuth token flow
 * with a *public* OAuth Client ID (VITE_GOOGLE_CLIENT_ID). The browser gets a short-lived access
 * token (~1h, kept in memory only) and calls the Analytics Data + Admin REST APIs directly.
 *
 * Setup the USER must do once (their Google Cloud project, not ours):
 *   1. Create an OAuth 2.0 Client ID (type "Web application") in Google Cloud Console.
 *   2. Add the app origin to "Authorized JavaScript origins".
 *   3. Enable "Google Analytics Data API" and "Google Analytics Admin API".
 *   4. Put the Client ID in VITE_GOOGLE_CLIENT_ID.
 */

import { getEnvVar } from '../utils/env'

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta'

export function getGoogleClientId(): string {
  return getEnvVar('VITE_GOOGLE_CLIENT_ID', false)
}

export function isGa4Configured(): boolean {
  return !!getGoogleClientId()
}

let accessToken: string | null = null
let tokenExpiresAt = 0

export function hasValidGa4Token(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt - 30_000
}

export function clearGa4Token(): void {
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

export async function connectGa4(): Promise<string> {
  const clientId = getGoogleClientId()
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configurato')
  await loadGis()

  return new Promise<string>((resolve, reject) => {
    try {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GA4_SCOPE,
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
  if (hasValidGa4Token() && accessToken) return accessToken
  return connectGa4()
}

async function ga4Fetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await ensureToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (res.status === 401) {
    clearGa4Token()
    throw new Error('Sessione Google scaduta — riconnetti')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Errore Google Analytics (${res.status}) ${body.slice(0, 160)}`)
  }
  return res.json() as Promise<T>
}

export interface Ga4Property {
  propertyId: string
  displayName: string
  defaultUri?: string
}

type AccountSummary = {
  propertySummaries?: Array<{ property?: string; displayName?: string }>
}

async function fetchPropertyDefaultUri(propertyId: string): Promise<string | undefined> {
  try {
    const streams = await ga4Fetch<{ dataStreams?: Array<{ webStreamData?: { defaultUri?: string } }> }>(
      `${ADMIN_API}/${propertyId}/dataStreams?pageSize=10`,
    )
    return streams.dataStreams?.find((s) => s.webStreamData?.defaultUri)?.webStreamData?.defaultUri
  } catch {
    return undefined
  }
}

/** List GA4 properties the connected Google account can read. */
export async function listGa4Properties(): Promise<Ga4Property[]> {
  const data = await ga4Fetch<{ accountSummaries?: AccountSummary[] }>(`${ADMIN_API}/accountSummaries?pageSize=200`)
  const summaries = data.accountSummaries ?? []
  const props: Ga4Property[] = []
  for (const account of summaries) {
    for (const p of account.propertySummaries ?? []) {
      if (!p.property) continue
      const defaultUri = await fetchPropertyDefaultUri(p.property)
      props.push({
        propertyId: p.property,
        displayName: p.displayName ?? p.property,
        defaultUri,
      })
    }
  }
  return props
}

/** Pick the property that best matches a project's website URL. */
export function matchGa4Property(properties: Ga4Property[], websiteUrl: string | null | undefined): string | null {
  if (properties.length === 0) return null
  if (!websiteUrl) return properties[0]?.propertyId ?? null
  let host = websiteUrl
  try {
    host = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '')
  } catch {
    /* use raw */
  }
  const exact = properties.find((p) => {
    const uri = p.defaultUri ?? ''
    try {
      const h = uri ? new URL(uri.includes('://') ? uri : `https://${uri}`).hostname.replace(/^www\./, '') : ''
      return h === host
    } catch {
      return false
    }
  })
  const byName = properties.find((p) => p.displayName.toLowerCase().includes(host.toLowerCase()))
  return (exact ?? byName ?? properties[0])?.propertyId ?? null
}

export interface Ga4Totals {
  sessions: number
  users: number
  pageviews: number
  bounceRate: number
}

export interface Ga4Row {
  key: string
  sessions: number
  users: number
  pageviews: number
}

export interface Ga4Overview {
  totals: Ga4Totals
  topPages: Ga4Row[]
  topSources: Ga4Row[]
  byDate: Array<{ date: string; sessions: number; users: number }>
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type ReportRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }

async function runReport(
  propertyId: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  metrics: string[],
  rowLimit = 10,
): Promise<ReportRow[]> {
  const data = await ga4Fetch<{ rows?: ReportRow[] }>(`${DATA_API}/${propertyId}:runReport`, {
    method: 'POST',
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map((d) => ({ name: d })),
      metrics: metrics.map((m) => ({ name: m })),
      limit: String(rowLimit),
      orderBys: [{ metric: { metricName: metrics[0] }, desc: true }],
    }),
  })
  return data.rows ?? []
}

function num(v?: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rowToGa4Row(r: ReportRow): Ga4Row {
  const dims = r.dimensionValues ?? []
  const mets = r.metricValues ?? []
  return {
    key: dims[0]?.value ?? '',
    sessions: num(mets[0]?.value),
    users: num(mets[1]?.value),
    pageviews: num(mets[2]?.value),
  }
}

/** Fetch a full GA4 overview for a property over the last `days` days. */
export async function getGa4Overview(propertyId: string, days = 28): Promise<Ga4Overview> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  const startDate = ymd(start)
  const endDate = ymd(end)
  const metrics = ['sessions', 'totalUsers', 'screenPageViews']

  const [totalsRows, pages, sources, dates] = await Promise.all([
    runReport(propertyId, startDate, endDate, [], [...metrics, 'bounceRate'], 1),
    runReport(propertyId, startDate, endDate, ['pagePath'], metrics, 10),
    runReport(propertyId, startDate, endDate, ['sessionSource'], metrics, 10),
    runReport(propertyId, startDate, endDate, ['date'], ['sessions', 'totalUsers'], days + 1),
  ])

  const t = totalsRows[0]?.metricValues ?? []
  const totals: Ga4Totals = {
    sessions: num(t[0]?.value),
    users: num(t[1]?.value),
    pageviews: num(t[2]?.value),
    bounceRate: num(t[3]?.value),
  }

  return {
    totals,
    topPages: pages.map(rowToGa4Row),
    topSources: sources.map(rowToGa4Row),
    byDate: dates
      .map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? '',
        sessions: num(r.metricValues?.[0]?.value),
        users: num(r.metricValues?.[1]?.value),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  }
}
