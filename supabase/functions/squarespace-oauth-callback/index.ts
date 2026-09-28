/**
 * Squarespace OAuth Callback
 *
 * Branded public URL: https://rankdelta.ai/oauth/squarespace/callback
 * (Vercel rewrites that path here. Never register supabase.co as the Redirect URI.)
 *
 * App Store 2.3.1 / 1.2: do not store a Shopify storefront as a Squarespace
 * connection. Migration 027 only blocks *.myshopify.com; custom hosts need
 * an in-process fingerprint.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { classifyShopifyStorefrontUrl } from '../_shared/shopifyStorefrontFingerprint.ts'
import { secretKey } from '../_shared/supabaseKeys.ts'

const TOKEN_URL = 'https://login.squarespace.com/api/1/login/oauth/provider/tokens'
/** Must match squarespace-oauth-start's nonce TTL (expires_at = now + 15 min). */
const NONCE_MAX_AGE_MS = 15 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SquarespaceTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
  website_id: string
}

interface SquarespaceWebsite {
  id: string
  title: string
  siteUrl: string
}

function appUrl(): string {
  return Deno.env.get('ASTROSEO_APP_URL') || 'https://rankdelta.ai'
}

function brandedCallbackUrl(): string {
  return Deno.env.get('SQUARESPACE_REDIRECT_URI') || 'https://rankdelta.ai/oauth/squarespace/callback'
}

function redirectToSettings(query: Record<string, string>) {
  const params = new URLSearchParams(query)
  return new Response(null, {
    status: 302,
    headers: { Location: `${appUrl()}/settings?${params.toString()}` },
  })
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    const errorDescription = url.searchParams.get('error_description')

    if (error) {
      console.error('OAuth error:', error, errorDescription)
      return redirectToSettings({ squarespace: 'error', reason: error })
    }

    if (!code) throw new Error('Missing authorization code')
    if (!state) throw new Error('Missing state parameter')

    let stateData: { user_id?: string; nonce?: string }
    try {
      stateData = JSON.parse(atob(state))
    } catch {
      throw new Error('Invalid state parameter')
    }

    const userId = stateData.user_id
    const nonce = stateData.nonce
    if (!userId || !nonce) throw new Error('Invalid state parameter')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      secretKey(),
    )

    // Consume the nonce ATOMICALLY: the conditional update wins for exactly one caller, so two
    // concurrent callbacks replaying the same state cannot both pass (the old select-then-update
    // had a race window). Requiring a returned row is what makes it single-use.
    const { data: consumed, error: markUsedError } = await supabase
      .from('oauth_nonces')
      .update({ used_at: new Date().toISOString() })
      .eq('nonce', nonce)
      .eq('user_id', userId)
      .is('used_at', null)
      .select('id, expires_at')

    if (markUsedError) throw new Error('Failed to consume OAuth state')
    const existingNonce = Array.isArray(consumed) ? consumed[0] : null
    if (!existingNonce) throw new Error('Unknown, used or expired OAuth state')
    // squarespace-oauth-start sets expires_at = now + 15 min, so a nonce must expire within the
    // next 15 min to be < 15 min old. Anything without a sane expiry, past it, or further out than
    // the start TTL (tampered/forged row) is rejected.
    const expiresAtMs = existingNonce.expires_at ? new Date(existingNonce.expires_at).getTime() : NaN
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now() || expiresAtMs - Date.now() > NONCE_MAX_AGE_MS) {
      throw new Error('OAuth state expired')
    }
    // Residual risk (documented): the state is not additionally bound to the browser via a cookie.
    // squarespace-oauth-start returns { authorizeUrl } as JSON to a cross-origin fetch (CORS '*',
    // no credentials) rather than issuing the redirect itself, so it cannot set an HttpOnly
    // SameSite=Lax cookie the callback (reached via the rankdelta.ai → Supabase rewrite) would see.
    // Binding would need the start endpoint to become a same-site redirect. Until then the
    // protection is: nonce is single-use (atomic consume), user-bound, and < 15 min old.

    const clientId = Deno.env.get('SQUARESPACE_CLIENT_ID')!
    const clientSecret = Deno.env.get('SQUARESPACE_CLIENT_SECRET')!
    const redirectUri = brandedCallbackUrl()

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(clientId, clientSecret),
        'User-Agent': 'Rankdelta/1.0',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${await tokenResponse.text()}`)
    }

    const tokens: SquarespaceTokenResponse = await tokenResponse.json()
    if (!tokens.access_token || !tokens.refresh_token || !tokens.website_id) {
      throw new Error('Invalid token response from Squarespace')
    }

    let website: SquarespaceWebsite = {
      id: tokens.website_id,
      title: 'Squarespace store',
      siteUrl: '',
    }

    const identityResponse = await fetch(
      'https://api.squarespace.com/1.0/authorization/website',
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'User-Agent': 'Rankdelta/1.0',
        },
      },
    )

    if (identityResponse.ok) {
      const identity = await identityResponse.json()
      website = {
        id: identity.id || tokens.website_id,
        title: identity.title || identity.siteTitle || website.title,
        siteUrl: identity.url || identity.siteUrl || '',
      }
    }

    // App Store 2.3.1: an empty or unverified site URL must not be stored as Squarespace.
    if (!website.siteUrl) {
      return redirectToSettings({ squarespace: 'error', reason: 'verify_site' })
    }
    const verdict = await classifyShopifyStorefrontUrl(website.siteUrl)
    if (verdict === 'shopify') {
      return redirectToSettings({ squarespace: 'error', reason: 'shopify_use_app' })
    }
    if (verdict === 'unknown') {
      return redirectToSettings({ squarespace: 'error', reason: 'verify_site' })
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

    const { error: dbError } = await supabase.from('squarespace_connections').upsert({
      user_id: userId,
      website_id: tokens.website_id,
      website_title: website.title,
      website_url: website.siteUrl,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,website_id' })

    if (dbError) throw new Error('Failed to store connection')

    await supabase.from('integration_events').insert({
      user_id: userId,
      event_type: 'squarespace_connected',
      website_id: tokens.website_id,
      metadata: {
        website_title: website.title,
        website_url: website.siteUrl,
        branded_callback: redirectUri,
      },
    })

    return redirectToSettings({ squarespace: 'connected', site: website.title })
  } catch (error) {
    console.error('OAuth callback error:', error)
    return redirectToSettings({ squarespace: 'error', reason: 'oauth_failed' })
  }
})
