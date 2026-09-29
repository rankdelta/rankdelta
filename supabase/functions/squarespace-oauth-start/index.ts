/**
 * Branded OAuth start — called from https://rankdelta.ai/oauth/squarespace
 *
 * Authenticated user → nonce in DB → Squarespace /provider/authorize
 * Redirect URI is always the branded rankdelta.ai callback, never supabase.co.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AUTHORIZE_URL = 'https://login.squarespace.com/api/1/login/oauth/provider/authorize'
const SCOPE = 'website.products.read,website.products.write'

function brandedCallbackUrl(): string {
  return Deno.env.get('SQUARESPACE_REDIRECT_URI') || 'https://rankdelta.ai/oauth/squarespace/callback'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      publishableKey(),
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const clientId = Deno.env.get('SQUARESPACE_CLIENT_ID')
    if (!clientId) {
      return json({ error: 'Squarespace OAuth is not configured yet' }, 503)
    }

    const nonce = crypto.randomUUID()
    const state = btoa(JSON.stringify({
      user_id: user.id,
      nonce,
      timestamp: Date.now(),
    }))

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      secretKey()
    )

    const { error: nonceError } = await admin.from('oauth_nonces').insert({
      nonce,
      user_id: user.id,
      used_at: null,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })

    if (nonceError) {
      console.error('Failed to store OAuth nonce:', nonceError)
      return json({ error: 'Failed to start OAuth' }, 500)
    }

    const redirectUri = brandedCallbackUrl()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPE,
      state,
      access_type: 'offline',
    })

    const authorizeUrl = `${AUTHORIZE_URL}?${params.toString()}`
    return json({ authorizeUrl, redirectUri, clientName: 'Rankdelta' })
  } catch (error) {
    console.error('OAuth start error:', error)
    return json({ error: 'OAuth start failed' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
