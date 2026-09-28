/**
 * prestashop-connector — optional cloud API for the Addons module.
 *
 * Auth: X-Api-Key (hashed lookup on connector_api_keys). JWT is OFF at the gateway
 * because the module is not a logged-in browser session.
 *
 * Routes (path after /prestashop-connector):
 *   GET  /health
 *   POST /connect
 *   GET  /visibility
 *   GET  /recommendations
 *   POST /catalog
 *
 * App Store 2.3.1 / 1.2: /connect must not onboard a Shopify storefront.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyShopifyStorefrontUrl } from '../_shared/shopifyStorefrontFingerprint.ts'
import { assertProjectQuota } from '../_shared/projectQuota.ts'
import { secretKey } from '../_shared/supabaseKeys.ts'
import { inferSiteLocale } from '../_shared/siteLocale.ts'

/** Catalog entity types the module may sync; anything else is dropped before the write. */
const CATALOG_ENTITY_TYPES = new Set(['product', 'category', 'cms'])
const CATALOG_MAX_ITEMS = 200

function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text.slice(0, max) : null
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-shop-domain',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function admin() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = secretKey()
  return createClient(url, key, { auth: { persistSession: false } })
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type KeyRow = {
  id: string
  user_id: string
  project_id: string | null
  revoked_at: string | null
}

async function authKey(req: Request) {
  const apiKey = req.headers.get('x-api-key') || req.headers.get('X-Api-Key') || ''
  if (!apiKey || !(apiKey.length >= 16)) return json({ error: 'unauthorized' }, 401)
  const hash = await sha256(apiKey)
  const db = admin()
  const { data, error } = await db
    .from('connector_api_keys')
    .select('id, user_id, project_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle()
  if (error || !data) return json({ error: 'unauthorized' }, 401)
  if (data.revoked_at) return json({ error: 'revoked' }, 401)
  await db.from('connector_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
  const shopUrl = (req.headers.get('x-shop-domain') || req.headers.get('X-Shop-Domain') || '').replace(/\/+$/, '')
  return { key: data, shopUrl }
}

function restPath(url: URL): string {
  const raw = url.pathname.split('/prestashop-connector')[1] || '/'
  return raw.replace(/\/+$/, '') || '/'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const path = restPath(url)

  try {
    const authed = await authKey(req)
    if (authed instanceof Response) return authed
    const { key, shopUrl } = authed
    const db = admin()

    if (req.method === 'GET' && path === '/health') {
      return json({ status: 'ok', platform: 'prestashop', user_id: key.user_id, project_id: key.project_id })
    }

    if (req.method === 'POST' && path === '/connect') {
      const body = await req.json().catch(() => ({}))
      const urlShop = String(body.shop_url || shopUrl || '').replace(/\/+$/, '')
      if (!urlShop) return json({ error: 'shop_url_required' }, 400)
      const verdict = await classifyShopifyStorefrontUrl(urlShop)
      if (verdict === 'shopify') return json({ error: 'shopify_use_app' }, 400)
      if (verdict === 'unknown') return json({ error: 'site_unverified' }, 503)

      let projectId = key.project_id
      if (!projectId) {
        const { data: existing } = await db
          .from('projects')
          .select('id')
          .eq('user_id', key.user_id)
          .eq('website_url', urlShop)
          .maybeSingle()
        if (existing?.id) {
          projectId = existing.id
        } else {
          // Service-role insert bypasses the max_projects trigger (migration 044) — enforce here.
          const quota = await assertProjectQuota(db, key.user_id)
          if (!quota.ok) return json({ error: 'project_limit_reached', max: quota.max, count: quota.count }, 402)
          const shopLocale = inferSiteLocale({ url: urlShop, language: typeof body.language === 'string' ? body.language : null })
          const { data: created, error: ce } = await db
            .from('projects')
            .insert({
              user_id: key.user_id,
              name: body.shop_name || urlShop,
              website_url: urlShop,
              vertical: 'ecommerce',
              // Never inherit the Italian column defaults for an unknown shop.
              ...shopLocale,
              primary_language: shopLocale.language,
            })
            .select('id')
            .single()
          if (ce) throw ce
          projectId = created.id
        }
        await db.from('connector_api_keys').update({ project_id: projectId }).eq('id', key.id)
      }

      const { data: shop, error: se } = await db
        .from('connector_shops')
        .upsert(
          {
            user_id: key.user_id,
            project_id: projectId,
            platform: 'prestashop',
            shop_url: urlShop,
            shop_name: body.shop_name || null,
            prestashop_version: body.prestashop_version || null,
            module_version: body.module_version || null,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,shop_url' },
        )
        .select('id, project_id')
        .single()
      if (se) throw se
      return json({ ok: true, shop_id: shop.id, project_id: shop.project_id })
    }

    if (req.method === 'GET' && path === '/visibility') {
      const projectId = key.project_id
      if (!projectId) return json({ ok: true, overallShareOfVoice: 0, perEngine: [], hint: 'connect_first' })

      const since = new Date(Date.now() - 30 * 864e5).toISOString()
      const { data: qs } = await db.from('visibility_queries').select('id').eq('project_id', projectId)
      const queryIds = (qs ?? []).map((q) => q.id as string)
      if (!queryIds.length) return json({ ok: true, overallShareOfVoice: 0, perEngine: [] })

      const { data: runs } = await db
        .from('visibility_query_runs')
        .select('id, provider')
        .in('query_id', queryIds)
        .gte('run_at', since)
      const runList = runs ?? []
      if (!runList.length) return json({ ok: true, overallShareOfVoice: 0, perEngine: [] })

      const runProvider = new Map(runList.map((r) => [r.id as string, r.provider as string]))
      const { data: mentions } = await db
        .from('visibility_brand_mentions')
        .select('query_run_id, tracked_brand_id, competitor_brand_id, is_recommended')
        .in('query_run_id', [...runProvider.keys()])

      const per = {}
      for (const m of mentions ?? []) {
        const eng = runProvider.get(m.query_run_id as string) ?? 'unknown'
        per[eng] ??= { you: 0, comp: 0, rec: 0 }
        if (m.tracked_brand_id) {
          per[eng].you++
          if (m.is_recommended) per[eng].rec++
        } else if (m.competitor_brand_id) per[eng].comp++
      }
      const perEngine = Object.entries(per).map(([engine, v]) => ({
        engine,
        yourMentions: v.you,
        competitorMentions: v.comp,
        yourRecommended: v.rec,
        shareOfVoice: v.you + v.comp > 0 ? Math.round((v.you / (v.you + v.comp)) * 1000) / 10 : 0,
      }))
      const you = perEngine.reduce((a, e) => a + e.yourMentions, 0)
      const comp = perEngine.reduce((a, e) => a + e.competitorMentions, 0)
      return json({
        ok: true,
        overallShareOfVoice: you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : 0,
        perEngine,
      })
    }

    if (req.method === 'GET' && path === '/recommendations') {
      const projectId = key.project_id
      if (!projectId) return json({ ok: true, items: [] })
      const { data, error } = await db
        .from('content_proposals')
        .select('id, title, slug, primary_keyword, status, seo_score')
        .eq('project_id', projectId)
        .in('status', ['pending', 'approved'])
        .order('generated_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return json({ ok: true, items: data ?? [] })
    }

    if (req.method === 'POST' && path === '/catalog') {
      const body = await req.json().catch(() => ({}))
      const items = Array.isArray(body.items) ? body.items : []
      const urlShop = shopUrl
      if (!urlShop) return json({ error: 'shop_url_required' }, 400)
      const { data: shop } = await db
        .from('connector_shops')
        .select('id')
        .eq('user_id', key.user_id)
        .eq('shop_url', urlShop)
        .maybeSingle()
      if (!shop?.id) return json({ error: 'connect_first' }, 400)

      // Validate + clip before any write; dedupe on the (shop_id, entity_type, external_id)
      // conflict key so one batched upsert cannot hit the same row twice.
      const now = new Date().toISOString()
      const rows = new Map<string, Record<string, unknown>>()
      let rejected = 0
      for (const item of items.slice(0, CATALOG_MAX_ITEMS)) {
        if (!item || typeof item !== 'object') {
          rejected++
          continue
        }
        const entityType = String(item.type || 'product').trim().toLowerCase()
        const externalId = clip(item.id, 128)
        if (!CATALOG_ENTITY_TYPES.has(entityType) || !externalId) {
          rejected++
          continue
        }
        rows.set(`${entityType}:${externalId}`, {
          shop_id: shop.id,
          entity_type: entityType,
          external_id: externalId,
          name: clip(item.name, 255),
          url: clip(item.url, 500),
          meta_title: clip(item.meta_title, 255),
          meta_description: clip(item.meta_description, 500),
          updated_at: now,
        })
      }
      if (rows.size) {
        const { error: ue } = await db
          .from('connector_catalog_items')
          .upsert([...rows.values()], { onConflict: 'shop_id,entity_type,external_id' })
        if (ue) throw ue
      }
      await db
        .from('connector_shops')
        .update({ last_catalog_at: now, last_seen_at: now })
        .eq('id', shop.id)
      return json({ ok: true, upserted: rows.size, rejected })
    }

    return json({ error: 'not_found', path }, 404)
  } catch (e) {
    console.error('[prestashop-connector]', path, e instanceof Error ? e.message : String(e))
    // Never echo raw DB/internal error text to the module.
    return json({ error: 'internal_error' }, 500)
  }
})
