/**
 * Public App Store 2.3.1 / 1.2 fallback when ai-visibility-check is down.
 * In-process HTML / header / cart.js fingerprint (SSRF-blocked).
 * JWT off: the SaaS browser calls this with the anon key, same as the landing probe.
 */
import { classifyShopifyStorefrontUrl } from '../_shared/shopifyStorefrontFingerprint.ts'
import { getClientIp } from '../_shared/clientIp.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const hits = new Map()
const WINDOW_MS = 60 * 60 * 1000
const IP_MAX = 60

function rateLimited(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => WINDOW_MS > now - t)
  if (list.length >= IP_MAX) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const ip = getClientIp(req)
  if (rateLimited(ip)) return json({ error: 'rate_limited' }, 429)
  let body = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const raw = typeof body.url === 'string' ? body.url : typeof body.domain === 'string' ? body.domain : ''
  if (!raw.trim()) return json({ error: 'invalid_url' }, 400)
  const verdict = await classifyShopifyStorefrontUrl(raw)
  if (verdict === 'shopify') return json({ error: 'shopify_use_app' }, 400)
  if (verdict === 'unknown') return json({ error: 'unverified' }, 503)
  return json({ ok: true, shopify: false })
})
