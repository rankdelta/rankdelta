/**
 * gsc-connect — persist a user's Google Search Console connection and cache analytics.
 *
 * Browser gets an OAuth *authorization code* via GIS popup (no secret in the bundle). This
 * function exchanges it for a refresh token, stores that token off the Data API, then pulls
 * Search Analytics so the UI / MCP / campaigns can read the same cache after the tab closes.
 *
 * The listing / picking / fetching / upserting all live in `_shared/gscSync.ts`, which
 * report-schedule-runner reuses to refresh the same cache unattended on the daily cron — this
 * function authenticates a *user JWT*, which a cron does not have.
 *
 * Auth: verified user JWT inside the function (gateway JWT off — same as seo-proxy).
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL, plus the Supabase API keys
 * resolved by _shared/supabaseKeys.ts (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, falling
 * back to the legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { storeGoogleRefreshToken, readGoogleRefreshToken, purgeGoogleRefreshToken } from '../_shared/googleOAuthTokens.ts'
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'
import { GSC_SCOPE, clearGscGrantRevoked, refreshAccess, syncGscProperty } from '../_shared/gscSync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

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

  let payload: { action?: string; projectId?: string; code?: string; siteUrl?: string; periodDays?: number }
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
      // Best-effort: revoke the refresh token at Google so the grant does not outlive our copy.
      // Failures (already revoked, network) are ignored — the rows are deleted regardless.
      const revokeToken = await purgeGoogleRefreshToken(admin, 'gsc_oauth_tokens', projectId)
      if (revokeToken) {
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(String(revokeToken))}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          })
        } catch (e) {
          console.error('[gsc-connect] token revoke skipped', e instanceof Error ? e.message : String(e))
        }
      }
      await admin.from('gsc_oauth_tokens').delete().eq('project_id', projectId)
      await admin.from('gsc_properties').delete().eq('project_id', projectId)
      await admin.from('gsc_analytics_cache').delete().eq('project_id', projectId)
      return json({ ok: true })
    }

    let accessToken: string | null = null
    if (action === 'connect') {
      if (!payload.code) return json({ error: 'missing_code' }, 400)
      const tokens = await exchangeCode(payload.code)
      if (!tokens.refresh_token) {
        return json({
          error: 'no_refresh_token',
          detail: 'Google did not return a refresh token. Reconnect and grant Search Console access.',
        }, 400)
      }
      accessToken = tokens.access_token ?? null
      if (!accessToken) accessToken = await refreshAccess(tokens.refresh_token)
      await storeGoogleRefreshToken(admin, 'gsc_oauth_tokens', projectId, tokens.refresh_token, {
        google_email: user.email ?? null,
        updated_by: user.id,
      })
    } else if (action === 'sync') {
      const refreshToken = await readGoogleRefreshToken(admin, 'gsc_oauth_tokens', projectId)
      if (!refreshToken) return json({ error: 'not_connected' }, 404)
      accessToken = await refreshAccess(refreshToken)
    } else {
      return json({ error: 'unknown_action' }, 400)
    }

    if (!accessToken) return json({ error: 'no_access_token' }, 500)

    const result = await syncGscProperty(admin, {
      projectId,
      accessToken,
      websiteUrl: project.website_url,
      requestedSiteUrl: payload.siteUrl ?? null,
      periodDays: payload.periodDays,
      actorId: user.id,
    })

    if (!result.ok) {
      const status = result.error === 'no_properties' ? 400 : 403
      return json({ error: result.error, properties: result.properties }, status)
    }

    // A working sync proves the grant is alive: drop any "reconnect" mark the scheduled refresh
    // left behind. Best-effort — it must never turn a good sync into an error.
    await clearGscGrantRevoked(admin, projectId)

    return json({
      ok: true,
      scope: GSC_SCOPE,
      property: result.property,
      properties: result.properties,
      overview: result.overview,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[gsc-connect]', action, message)
    // Google/DB error text can carry token fragments or schema details — keep it server-side.
    if (message === 'google_oauth_not_configured') return json({ error: 'not_configured' }, 503)
    return json({ error: 'gsc_request_failed' }, 500)
  }
})
