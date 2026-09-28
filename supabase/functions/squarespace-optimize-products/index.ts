/**
 * Squarespace product SEO — SAFE by default.
 * Connect does NOT write. Writes require confirm_writes=true AND explicit product_ids.
 * Never change urlSlug, images, or existing seoOptions. POST /v2 partial update only.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { publishableKey } from '../_shared/supabaseKeys.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MAX_WRITES_PER_REQUEST = 25
const TOKEN_URL = 'https://login.squarespace.com/api/1/login/oauth/provider/tokens'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json()
    const website_id = body.website_id
    const confirmWrites = body.confirm_writes === true
    const productIds = Array.isArray(body.product_ids) ? body.product_ids.filter((id) => typeof id === 'string' && id.length > 0) : []
    if (!website_id) return json({ error: 'Missing website_id' }, 400)
    const { data: connection, error: connectionError } = await supabase.from('squarespace_connections').select('*').eq('user_id', user.id).eq('website_id', website_id).single()
    if (connectionError || !connection) return json({ error: 'Squarespace connection not found' }, 404)
    const accessToken = await getAccessToken(supabase, connection, user.id, website_id)
    const products = await fetchProducts(accessToken, productIds.length ? productIds : undefined)
    const preview = products.map((product) => ({
      productId: product.id, url: product.url, urlSlug: product.urlSlug,
      current: snapshot(product), proposed: proposeSafePatch(product),
      blocked: { urlSlug: true, images: true, tags: true },
    }))
    if (!confirmWrites) {
      return json({ mode: 'preview', wrote: false, product_count: products.length, preview, safety: { connect_does_not_write: true, slug_changes_blocked: true, image_writes_blocked: true, catalog_wide_writes_blocked: true } })
    }
    if (productIds.length === 0) return json({ error: 'Refusing catalog-wide write. Pass explicit product_ids and confirm_writes=true.', mode: 'blocked', wrote: false }, 400)
    if (productIds.length > MAX_WRITES_PER_REQUEST) return json({ error: `Refusing more than ${MAX_WRITES_PER_REQUEST} product writes per request.`, mode: 'blocked', wrote: false }, 400)
    const selected = products.filter((p) => productIds.includes(p.id))
    const results = []
    for (const product of selected) {
      const patch = proposeSafePatch(product)
      if (Object.keys(patch).length === 0) { results.push({ productId: product.id, success: true, skipped: true, reason: 'no_safe_change' }); continue }
      const write = await postPartialUpdate(accessToken, product.id, patch)
      results.push({ productId: product.id, success: write.ok, error: write.error, before: snapshot(product), patch })
      await sleep(150)
    }
    await supabase.from('optimization_log').insert({ user_id: user.id, website_id, optimization_type: body.optimization_type || 'meta', product_count: selected.length, success_count: results.filter((r) => r.success).length, failed_count: results.filter((r) => !r.success).length })
    return json({ mode: 'write', wrote: true, results, safety: { slug_changes_blocked: true, image_writes_blocked: true } })
  } catch (error) {
    console.error('Optimization error:', error)
    return json({ error: error.message }, 500)
  }
})

function snapshot(product) { return { name: product.name, urlSlug: product.urlSlug, seoTitle: product.seoOptions?.title ?? null, seoDescription: product.seoOptions?.description ?? null } }
function proposeSafePatch(product) {
  const patch = {}
  const seoTitle = stripHtml(product.seoOptions?.title || '')
  const seoDescription = stripHtml(product.seoOptions?.description || '')
  const name = stripHtml(product.name || '')
  const plainDescription = stripHtml(product.description || '')
  if (!seoTitle && name) patch.seoOptions = { ...(patch.seoOptions || {}), title: name.slice(0, 60) }
  if (!seoDescription && plainDescription) patch.seoOptions = { ...(patch.seoOptions || {}), description: plainDescription.slice(0, 160) }
  return patch
}
function stripHtml(value) { return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
async function postPartialUpdate(accessToken, productId, patch) {
  const response = await fetch(`https://api.squarespace.com/v2/commerce/products/${productId}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'Rankdelta/1.0' }, body: JSON.stringify(patch) })
  if (!response.ok) return { ok: false, error: await response.text() }
  return { ok: true }
}
async function getAccessToken(supabase, connection, userId, websiteId) {
  const expiresAt = new Date(connection.expires_at).getTime()
  const now = Date.now()
  if (now < expiresAt - 5 * 60 * 1000) return connection.access_token
  const tokenResponse = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${Deno.env.get('SQUARESPACE_CLIENT_ID')}:${Deno.env.get('SQUARESPACE_CLIENT_SECRET')}`)}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: connection.refresh_token }).toString() })
  if (!tokenResponse.ok) return connection.access_token
  const tokens = await tokenResponse.json()
  await supabase.from('squarespace_connections').update({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: new Date(now + tokens.expires_in * 1000).toISOString() }).eq('user_id', userId).eq('website_id', websiteId)
  return tokens.access_token
}
async function fetchProducts(accessToken, productIds) {
  const products = []
  let cursor
  do {
    const params = new URLSearchParams()
    if (cursor) params.append('cursor', cursor)
    const response = await fetch(`https://api.squarespace.com/1.0/commerce/products?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Rankdelta/1.0' } })
    if (!response.ok) throw new Error(`Failed to fetch products: ${response.statusText}`)
    const data = await response.json()
    products.push(...(data.products || []))
    cursor = data.pagination?.nextPageCursor
  } while (cursor)
  if (productIds?.length) return products.filter((p) => productIds.includes(p.id))
  return products
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
