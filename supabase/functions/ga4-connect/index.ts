/**
 * ga4-connect — persist a user's Google Analytics 4 connection and cache analytics.
 *
 * Browser gets an OAuth *authorization code* via GIS popup (no secret in the bundle). This
 * function exchanges it for a refresh token, stores that token off the Data API, then pulls
 * Analytics Data so the UI / MCP / campaigns can read the same cache after the tab closes.
 *
 * Auth: verified user JWT inside the function (gateway JWT off — same as gsc-connect).
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL, plus the Supabase API keys
 * resolved by _shared/supabaseKeys.ts (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, falling
 * back to the legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { storeGoogleRefreshToken, readGoogleRefreshToken, purgeGoogleRefreshToken } from '../_shared/googleOAuthTokens.ts'
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta'

type Ga4Property = { propertyId: string; displayName: string; defaultUri?: string }
type Ga4Row = { key: string; sessions: number; users: number; pageviews: number }

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const PERIOD_DAYS_OPTIONS = [7, 28, 90] as const

function clampPeriodDays(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 28
  let best: number = PERIOD_DAYS_OPTIONS[0]
  for (const opt of PERIOD_DAYS_OPTIONS) {
    if (Math.abs(opt - n) < Math.abs(best - n)) best = opt
  }
  return best
}

function matchProperty(properties: Ga4Property[], websiteUrl: string | null | undefined): string | null {
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

async function ga4Fetch<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Analytics ${res.status} ${body.slice(0, 180)}`)
  }
  return res.json() as Promise<T>
}

type ReportRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }

function num(v?: string): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function runReport(
  token: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  metrics: string[],
  rowLimit = 10,
) {
  const data = await ga4Fetch<{ rows?: ReportRow[] }>(token, `${DATA_API}/${propertyId}:runReport`, {
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

async function fetchOverview(token: string, propertyId: string, days = 28) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  const startDate = ymd(start)
  const endDate = ymd(end)
  const metrics = ['sessions', 'totalUsers', 'screenPageViews']

  const [totalsRows, pages, sources, dates] = await Promise.all([
    runReport(token, propertyId, startDate, endDate, [], [...metrics, 'bounceRate'], 1),
    runReport(token, propertyId, startDate, endDate, ['pagePath'], metrics, 10),
    runReport(token, propertyId, startDate, endDate, ['sessionSource'], metrics, 10),
    runReport(token, propertyId, startDate, endDate, ['date'], ['sessions', 'totalUsers'], days + 1),
  ])

  const t = totalsRows[0]?.metricValues ?? []
  const displayName =
    (await ga4Fetch<{ displayName?: string }>(token, `${ADMIN_API}/${propertyId}`).catch(() => ({} as { displayName?: string }))).displayName ??
    propertyId

  return {
    totals: {
      sessions: num(t[0]?.value),
      users: num(t[1]?.value),
      pageviews: num(t[2]?.value),
      bounceRate: num(t[3]?.value),
    },
    topPages: pages.map(rowToGa4Row),
    topSources: sources.map(rowToGa4Row),
    byDate: dates
      .map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? '',
        sessions: num(r.metricValues?.[0]?.value),
        users: num(r.metricValues?.[1]?.value),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    periodDays: days,
    propertyId,
    displayName,
  }
}

async function fetchPropertyDefaultUri(token: string, propertyId: string): Promise<string | undefined> {
  try {
    const streams = await ga4Fetch<{ dataStreams?: Array<{ webStreamData?: { defaultUri?: string } }> }>(
      token,
      `${ADMIN_API}/${propertyId}/dataStreams?pageSize=10`,
    )
    return streams.dataStreams?.find((s) => s.webStreamData?.defaultUri)?.webStreamData?.defaultUri
  } catch {
    return undefined
  }
}

async function listProperties(token: string): Promise<Ga4Property[]> {
  const data = await ga4Fetch<{ accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }> }>(
    token,
    `${ADMIN_API}/accountSummaries?pageSize=200`,
  )
  const props: Ga4Property[] = []
  for (const account of data.accountSummaries ?? []) {
    for (const p of account.propertySummaries ?? []) {
      if (!p.property) continue
      const defaultUri = await fetchPropertyDefaultUri(token, p.property)
      props.push({
        propertyId: p.property,
        displayName: p.displayName ?? p.property,
        defaultUri,
      })
    }
  }
  return props
}

async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token?: string }> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? Deno.env.get('VITE_GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  if (!clientId || !clientSecret) throw new Error('google_oauth_not_configured')
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const jsonBody = await res.json()
  if (!res.ok) throw new Error(`google_token_exchange ${res.status} ${JSON.stringify(jsonBody).slice(0, 180)}`)
  return jsonBody
}

async function refreshAccess(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? Deno.env.get('VITE_GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const jsonBody = await res.json()
  if (!res.ok || !jsonBody.access_token) {
    throw new Error(`google_refresh ${res.status} ${JSON.stringify(jsonBody).slice(0, 180)}`)
  }
  return jsonBody.access_token as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = publishableKey()
  const serviceKey = secretKey()
  const authHeader = req.headers.get('Authorization') ?? ''

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  let payload: { action?: string; projectId?: string; code?: string; propertyId?: string; periodDays?: number }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const projectId = payload.projectId
  if (!projectId) return json({ error: 'missing_project' }, 400)

  const { data: project, error: projErr } = await admin
    .from('projects')
    .select('id, user_id, website_url')
    .eq('id', projectId)
    .single()
  if (projErr || !project || project.user_id !== user.id) return json({ error: 'forbidden' }, 403)

  const action = payload.action ?? 'connect'

  try {
    if (action === 'disconnect') {
      const revokeToken = await purgeGoogleRefreshToken(admin, 'ga4_oauth_tokens', projectId)
      if (revokeToken) {
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(String(revokeToken))}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          })
        } catch (e) {
          console.error('[ga4-connect] token revoke skipped', e instanceof Error ? e.message : String(e))
        }
      }
      await admin.from('ga4_oauth_tokens').delete().eq('project_id', projectId)
      await admin.from('ga4_properties').delete().eq('project_id', projectId)
      await admin.from('ga4_analytics_cache').delete().eq('project_id', projectId)
      return json({ ok: true })
    }

    let accessToken: string | null = null
    if (action === 'connect') {
      if (!payload.code) return json({ error: 'missing_code' }, 400)
      const tokens = await exchangeCode(payload.code)
      if (!tokens.refresh_token) {
        return json({
          error: 'no_refresh_token',
          detail: 'Google did not return a refresh token. Reconnect and grant Analytics access.',
        }, 400)
      }
      accessToken = tokens.access_token ?? null
      if (!accessToken) accessToken = await refreshAccess(tokens.refresh_token)
      await storeGoogleRefreshToken(admin, 'ga4_oauth_tokens', projectId, tokens.refresh_token, {
        google_email: user.email ?? null,
        updated_by: user.id,
      })
    } else if (action === 'sync') {
      const refreshToken = await readGoogleRefreshToken(admin, 'ga4_oauth_tokens', projectId)
      if (!refreshToken) return json({ error: 'not_connected' }, 404)
      accessToken = await refreshAccess(refreshToken)
    } else {
      return json({ error: 'unknown_action' }, 400)
    }

    if (!accessToken) return json({ error: 'no_access_token' }, 500)

    const properties = await listProperties(accessToken)
    const picked =
      payload.propertyId ||
      (await admin.from('ga4_properties').select('property_id').eq('project_id', projectId).maybeSingle()).data?.property_id ||
      matchProperty(properties, project.website_url)

    if (!picked) return json({ error: 'no_properties', properties: [] }, 400)

    const pickedEntry = properties.find((p) => p.propertyId === picked)
    if (!pickedEntry) return json({ error: 'property_not_accessible', properties }, 403)

    const days = clampPeriodDays(payload.periodDays)
    const overview = await fetchOverview(accessToken, picked, days)

    await admin.from('ga4_properties').upsert({
      project_id: projectId,
      property_id: picked,
      display_name: pickedEntry.displayName,
      permission_level: 'READ',
      connected_at: new Date().toISOString(),
      connected_by: user.id,
      verified: true,
    }, { onConflict: 'project_id' })

    await admin.from('ga4_analytics_cache').upsert({
      project_id: projectId,
      property_id: picked,
      period_days: days,
      sessions: overview.totals.sessions,
      users: overview.totals.users,
      pageviews: overview.totals.pageviews,
      bounce_rate: overview.totals.bounceRate,
      top_pages: overview.topPages,
      top_sources: overview.topSources,
      daily_data: overview.byDate,
      fetched_at: new Date().toISOString(),
      fetched_by: user.id,
    }, { onConflict: 'project_id,period_days' })

    return json({
      ok: true,
      scope: GA4_SCOPE,
      property: picked,
      properties,
      overview,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[ga4-connect]', action, message)
    if (message === 'google_oauth_not_configured') return json({ error: 'not_configured' }, 503)
    return json({ error: 'ga4_request_failed' }, 500)
  }
})
