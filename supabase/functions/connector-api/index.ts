/**
 * connector-api — cloud API for the Shopify app / WordPress / PrestaShop connectors.
 *
 * Shopify mandatory compliance (GDPR) webhooks — POST, no API key; authenticated ONLY by
 * `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(raw body, SHOPIFY_API_SECRET)):
 *   POST /v1/gdpr/customers-data-request  → we store no customer PII; logs the request, returns
 *                                            { ok: true, data: [] }.
 *   POST /v1/gdpr/customers-redact        → nothing to erase (no customer data stored); logs, 200.
 *   POST /v1/gdpr/shop-redact             → hard-deletes everything received from that shop:
 *                                            connector_catalog_items + connector_shops,
 *                                            connector_link_codes, content queued for the shop's
 *                                            destination, site_audits(+history) of the linked
 *                                            project, revokes the `Shopify <shop>` API keys and
 *                                            stamps publish_destinations.unlinked_at (same
 *                                            teardown as /v1/uninstall, plus the deletions).
 *   Missing SHOPIFY_API_SECRET → 503 not_configured. Bad/missing HMAC → 401. Body is parsed only
 *   after the signature verifies.
 */
import {createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { billingIssuedAtVerdict, issuedAtRequired } from '../_shared/billingReplay.ts'
import {userIdFromRequest } from '../_shared/jwtAuth.ts'
import {assertProjectQuota,ProjectLimitError } from '../_shared/projectQuota.ts'
import {
buildLlmsTxt,
buildLlmsFullTxt,
buildAgentsMd,
AEO_GUIDANCE,
coverageFromStoredAudit,
expertNextActions,
hasPaidEntitlement,
isDestinationType,
isShopifyPlan,
mapShopifySubscriptionStatus,
mintApiKey,
normalizeShopDomain,
normalizeSiteHost,
shouldRejectShopifyUrlOnNonShopifyLink,
publicProbeLooksLikeShopifyStorefront,
parseShopHygiene,
planAllowsArticles,
shopHomeChecklist,
SHOP_STATUS_HOME_KEYS,
shouldSkipMarketplaceBilling,
shouldSkipShopifyBilling,
sha256Hex,
stripGutenberg,
verifyShopifyBillingHmac,
type DestinationType,
} from '../_shared/connector.ts'
import {
articleErrorJson,
articleNeedsReviewJson,
handleShopLoop,
insertNeedsReviewDraft,
visibilityReport,
writeArticleHtml,
} from './shopRoutes.ts'
import {decidePublished,readyArticleAction,refreshReviewMetadata } from '../_shared/connectorPublish.ts'
import {secretKey } from '../_shared/supabaseKeys.ts'
const db =createClient(
Deno.env.get('SUPABASE_URL') ?? '',
secretKey(),
{auth: {persistSession: false } },
)
const CORS ={
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
}
const json =(body: unknown,status =200) =>
new Response(JSON.stringify(body),{
status,
headers: {...CORS,'Content-Type': 'application/json' },
})
const PLAN_MAX_PROJECTS: Record<string,number> ={starter: 1,growth: 3,pro: 10,agency: -1 }
/** Replay window for the signed billing payload; required by default (see _shared/billingReplay.ts). */
const ENTITLEMENTS_REQUIRE_ISSUED_AT =issuedAtRequired(Deno.env.get('ENTITLEMENTS_REQUIRE_ISSUED_AT'))
type KeyAuth ={userId: string;keyId: string }
async function apiKeyAuth(req: Request): Promise<KeyAuth | null> {
const token =req.headers.get('authorization')?.replace(/^Bearer\s+/i,'') ?? ''
// Accept the new prefix AND legacy sk_astroseo_ keys minted before the rebrand — never revoke by prefix.
if (!token.startsWith('sk_rankdelta_') && !token.startsWith('sk_astroseo_')) return null
const hash =await sha256Hex(token)
const {data,error } =await db
.from('connector_api_keys')
.select('id, user_id, revoked_at')
.eq('key_hash',hash)
.maybeSingle()
if (error || !data || data.revoked_at) return null
await db
.from('connector_api_keys')
.update({last_used_at: new Date().toISOString() })
.eq('id',data.id)
return {userId: data.user_id as string,keyId: data.id as string }
}
async function jwtUserId(req: Request): Promise<string | null> {
return userIdFromRequest(req)
}
function restPath(req: Request): string {
const pathname =new URL(req.url).pathname
const idx =pathname.indexOf('/connector-api')
const rest =idx >=0 ? pathname.slice(idx + '/connector-api'.length) : pathname
return rest.replace(/\/+$/,'') || '/'
}
async function readJson(req: Request): Promise<Record<string,unknown>> {
try {
const body =await req.json()
return body && typeof body ==='object' ? (body as Record<string,unknown>) : {}
} catch {
return {}
}
}
async function loadSubscription(userId: string) {
const {data } =await db
.from('subscriptions')
.select(
'id, user_id, plan, status, billing_provider, shopify_subscription_id, shopify_shop_domain, trial_end, current_period_end, max_projects',
)
.eq('user_id',userId)
.maybeSingle()
return data
}
function entitlementsPayload(sub: Awaited<ReturnType<typeof loadSubscription>>) {
const plan =(sub?.plan as string) || 'starter'
return {
plan,
status: sub?.status ?? 'incomplete',
billing_provider: sub?.billing_provider ?? 'stripe',
paid: hasPaidEntitlement(sub),
skip_shopify_billing: shouldSkipShopifyBilling(sub),
skip_woocommerce_billing: shouldSkipMarketplaceBilling(sub,'woocommerce'),
allows_articles: planAllowsArticles(plan) && hasPaidEntitlement(sub),
trial_end: sub?.trial_end ?? null,
shopify_shop_domain: sub?.shopify_shop_domain ?? null,
}
}
async function loadPublishedArticles(projectId: string) {
const {data: publishedRows } =await db
.from('content')
.select('title, external_url, topic')
.eq('project_id',projectId)
.eq('publish_state','published')
.not('external_url','is',null)
.limit(200)
return (publishedRows ?? [])
.filter((r) => r.external_url)
.map((r) => ({
title: r.title as string,
url: r.external_url as string,
summary: typeof r.topic ==='string' ? r.topic : null,
}))
}
function aeoFilesPayload(
project: {name: string;catalog_notes?: string | null },
websiteUrl: string,
articles: Array<{title: string;url: string;summary?: string | null }>,
) {
const llms_txt =buildLlmsTxt({
name: project.name,
websiteUrl,
description: project.catalog_notes,
articles: articles.slice(0,50).map(({title,url }) => ({title,url })),
})
const llms_full_txt =buildLlmsFullTxt({
name: project.name,
websiteUrl,
description: project.catalog_notes,
articles,
})
const agents_md =buildAgentsMd({
name: project.name,
websiteUrl,
articles: articles.slice(0,50),
})
return {
llms_txt,
llms_full_txt,
agents_md,
}
}
function isMissingColumnError(message: string | undefined,column: string) {
const msg =(message || '').toLowerCase()
return msg.includes(column.toLowerCase()) || msg.includes('schema cache') || msg.includes('could not find')
}
async function stampStorePlatform(projectId: string,platform: string) {
const {error } =await db
.from('projects')
.update({store_platform: platform,updated_at: new Date().toISOString() })
.eq('id',projectId)
if (error) console.error('[connector-api] store_platform stamp skipped',error.message)
}
async function insertShopProject(opts: {
userId: string
name: string
websiteUrl: string
storePlatform: string
}): Promise<{id: string;website_url: string | null;name: string }> {
// Service-role inserts bypass the max_projects trigger (migration 044) — enforce it here.
const quota =await assertProjectQuota(db,opts.userId)
if (!quota.ok) throw new ProjectLimitError(quota.max,quota.count)
const core ={
user_id: opts.userId,
name: opts.name,
website_url: opts.websiteUrl,
vertical: 'ecommerce',
language: 'en',
primary_language: 'en',
market: 'global',
}
const withPlatform ={...core,store_platform: opts.storePlatform }
let created =await db.from('projects').insert(withPlatform).select('id, website_url, name').single()
if (created.error && isMissingColumnError(created.error.message,'store_platform')) {
created =await db.from('projects').insert(core).select('id, website_url, name').single()
}
if (created.error || !created.data) throw new Error(created.error?.message ?? 'project_create_failed')
await stampStorePlatform(created.data.id,opts.storePlatform)
return created.data
}
async function ensureProjectForShop(
userId: string,
shop: string,
projectId?: string | null,
): Promise<{id: string;website_url: string | null;name: string }> {
if (projectId) {
const {data,error } =await db
.from('projects')
.select('id, website_url, name, user_id')
.eq('id',projectId)
.eq('user_id',userId)
.maybeSingle()
if (error || !data) throw new Error('project_not_found')
await stampStorePlatform(data.id,'shopify')
return {id: data.id,website_url: data.website_url,name: data.name }
}
const {data: existingDest } =await db
.from('publish_destinations')
.select('project_id')
.eq('type','shopify')
.eq('external_id',shop)
.is('unlinked_at',null)
.eq('user_id',userId)
.maybeSingle()
if (existingDest?.project_id) {
const {data: proj } =await db
.from('projects')
.select('id, website_url, name')
.eq('id',existingDest.project_id)
.maybeSingle()
if (proj) {
await stampStorePlatform(proj.id,'shopify')
return proj
}
}
return insertShopProject({
userId,
name: shop.replace('.myshopify.com',''),
websiteUrl: `https://${shop}`,
storePlatform: 'shopify',
})
}
async function upsertShopifyDestination(userId: string,projectId: string,shop: string) {
return upsertDestination(userId,projectId,'shopify',shop,{shop_domain: shop })
}
async function upsertDestination(
userId: string,
projectId: string,
type: DestinationType,
externalId: string,
metadata: Record<string,unknown> ={},
) {
const {data: existing } =await db
.from('publish_destinations')
.select('id')
.eq('user_id',userId)
.eq('type',type)
.eq('external_id',externalId)
.is('unlinked_at',null)
.maybeSingle()
if (existing) {
await db
.from('publish_destinations')
.update({
project_id: projectId,
user_id: userId,
metadata,
updated_at: new Date().toISOString(),
})
.eq('id',existing.id)
.eq('user_id',userId)
return existing.id as string
}
const {data,error } =await db
.from('publish_destinations')
.insert({
project_id: projectId,
user_id: userId,
type,
external_id: externalId,
metadata,
})
.select('id')
.single()
if (error || !data) throw new Error(error?.message ?? 'destination_create_failed')
return data.id as string
}
async function ensureProjectForSite(
userId: string,
host: string,
siteUrl: string,
storePlatform: string,
projectId?: string | null,
): Promise<{id: string;website_url: string | null;name: string }> {
if (projectId) {
const {data,error } =await db
.from('projects')
.select('id, website_url, name, user_id')
.eq('id',projectId)
.eq('user_id',userId)
.maybeSingle()
if (error || !data) throw new Error('project_not_found')
await stampStorePlatform(data.id,storePlatform)
return {id: data.id,website_url: data.website_url,name: data.name }
}
const {data: existingDest } =await db
.from('publish_destinations')
.select('project_id')
.eq('external_id',host)
.is('unlinked_at',null)
.eq('user_id',userId)
.maybeSingle()
if (existingDest?.project_id) {
const {data: proj } =await db
.from('projects')
.select('id, website_url, name')
.eq('id',existingDest.project_id)
.maybeSingle()
if (proj) {
await stampStorePlatform(proj.id,storePlatform)
return proj
}
}
return insertShopProject({
userId,
name: host,
websiteUrl: siteUrl,
storePlatform,
})
}
/** Shopify webhook signature: base64(HMAC-SHA256(raw body, app secret)), constant-time compare. */
async function verifyShopifyWebhookHmac(rawBody: string,presented: string,secret: string): Promise<boolean> {
if (!presented || !secret) return false
const key =await crypto.subtle.importKey(
'raw',
new TextEncoder().encode(secret),
{name: 'HMAC',hash: 'SHA-256' },
false,
['sign'],
)
const sig =await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(rawBody))
const bytes =new Uint8Array(sig)
let binary =''
for (const b of bytes) binary +=String.fromCharCode(b)
const expected =btoa(binary)
if (presented.length !==expected.length) return false
let diff =0
for (let i =0; i <presented.length; i++) diff |=presented.charCodeAt(i) ^ expected.charCodeAt(i)
return diff ===0
}
/** Best-effort audit trail for GDPR webhooks (integration_events needs a user_id; console otherwise). */
async function logGdprEvent(eventType: string,shop: string,userIds: string[],metadata: Record<string,unknown>) {
console.log('[connector-api][gdpr]',eventType,shop,JSON.stringify(metadata))
for (const userId of userIds) {
try {
const {error } =await db.from('integration_events').insert({
user_id: userId,
event_type: eventType,
website_id: shop,
metadata: {shop_domain: shop,...metadata },
})
if (error) console.error('[connector-api][gdpr] integration_events insert skipped',error.message)
} catch (e) {
console.error('[connector-api][gdpr] integration_events insert skipped',e instanceof Error ? e.message : String(e))
}
}
}
/** Users that ever linked this shop (linked or already unlinked) — GDPR routes carry no API key. */
async function shopUserIds(shop: string): Promise<string[]> {
const {data } =await db
.from('publish_destinations')
.select('user_id')
.eq('type','shopify')
.eq('external_id',shop)
const ids =new Set<string>()
for (const row of data ?? []) if (row.user_id) ids.add(String(row.user_id))
return [...ids]
}
/**
 * shop/redact: hard-delete everything received from the shop. Mirrors /v1/uninstall (unlink,
 * revoke keys, consume link codes, drop Shopify billing) plus the actual deletions.
 */
async function redactShop(shop: string): Promise<Record<string,number>> {
const now =new Date().toISOString()
const counts: Record<string,number> ={}
const {data: dests } =await db
.from('publish_destinations')
.select('id, project_id, user_id, unlinked_at')
.eq('type','shopify')
.eq('external_id',shop)
const destRows =dests ?? []
const destIds: string[] =destRows.map((d) => String(d.id))
const projectIds: string[] =[...new Set<string>(destRows.map((d) => d.project_id).filter(Boolean).map(String))]
const userIds: string[] =[...new Set<string>(destRows.map((d) => d.user_id).filter(Boolean).map(String))]
// Catalog + shop rows (connector_shops.shop_url is stored with or without scheme).
const {data: shops } =await db
.from('connector_shops')
.select('id')
.eq('platform','shopify')
.in('shop_url',[shop,`https://${shop}`,`http://${shop}`])
const shopIds =(shops ?? []).map((s) => String(s.id))
if (shopIds.length) {
const {count: items } =await db.from('connector_catalog_items').delete({count: 'exact' }).in('shop_id',shopIds)
counts.connector_catalog_items =items ?? 0
const {count: shopsDeleted } =await db.from('connector_shops').delete({count: 'exact' }).in('id',shopIds)
counts.connector_shops =shopsDeleted ?? 0
}
const {count: codes } =await db.from('connector_link_codes').delete({count: 'exact' }).eq('shop_domain',shop)
counts.connector_link_codes =codes ?? 0
if (destIds.length) {
// Articles queued/published for this shop's destination.
const {count: content } =await db.from('content').delete({count: 'exact' }).in('destination_id',destIds)
counts.content =content ?? 0
}
if (projectIds.length) {
// Audits are computed from the shop's catalog (ignored URLs, hygiene) — shop data. Only for
// projects that are actually Shopify-backed: a user may have linked the shop to a pre-existing
// WordPress/site project whose audits are not shop data.
const {data: shopProjects } =await db
.from('projects')
.select('id')
.in('id',projectIds)
.eq('store_platform','shopify')
const shopProjectIds =(shopProjects ?? []).map((p) => String(p.id))
if (shopProjectIds.length) {
const {count: audits } =await db.from('site_audits').delete({count: 'exact' }).in('project_id',shopProjectIds)
counts.site_audits =audits ?? 0
const {count: history } =await db.from('site_audit_history').delete({count: 'exact' }).in('project_id',shopProjectIds)
counts.site_audit_history =history ?? 0
await db.from('projects').update({store_platform: null,updated_at: now }).in('id',shopProjectIds)
}
}
if (destIds.length) {
await db.from('publish_destinations').update({unlinked_at: now,updated_at: now }).in('id',destIds).is('unlinked_at',null)
}
for (const userId of userIds) {
await db.from('connector_api_keys').update({revoked_at: now }).eq('user_id',userId).eq('name',`Shopify ${shop}`).is('revoked_at',null)
const sub =await loadSubscription(userId)
if (sub?.billing_provider ==='shopify' && sub.shopify_shop_domain ===shop) {
await db
.from('subscriptions')
.update({
plan: 'starter',
status: 'canceled',
shopify_subscription_id: null,
cancel_at_period_end: false,
canceled_at: now,
updated_at: now,
})
.eq('user_id',userId)
}
}
return counts
}
Deno.serve(async (req) => {
if (req.method ==='OPTIONS') return new Response('ok',{headers: CORS })
const rest =restPath(req)
const method =req.method.toUpperCase()
try {
if (method ==='GET' && rest ==='/v1/meta') {
return json({
ok: true,
handshake: true,
handshake_exchange: true,
shop_status: true,
geo_loop: true,
aeo_payload: true,
uninstall: true,
})
}
const gdpr =rest.match(/^\/v1\/gdpr\/(customers-data-request|customers-redact|shop-redact)$/)
if (gdpr) {
if (method !=='POST') return json({error: 'method_not_allowed' },405)
const secret =Deno.env.get('SHOPIFY_API_SECRET') ?? ''
if (!secret) return json({error: 'not_configured' },503)
// Verify over the RAW bytes before touching the body: JSON re-serialisation is not byte-stable.
const raw =await req.text()
const presented =req.headers.get('x-shopify-hmac-sha256') ?? ''
if (!(await verifyShopifyWebhookHmac(raw,presented,secret))) return json({error: 'unauthorized' },401)
let body: Record<string,unknown> ={}
try {
const parsed =JSON.parse(raw)
body =parsed && typeof parsed ==='object' ? (parsed as Record<string,unknown>) : {}
} catch {
body ={}
}
const shop =normalizeShopDomain(
typeof body.shop_domain ==='string' ? body.shop_domain : req.headers.get('x-shopify-shop-domain') ?? '',
)
if (!shop) return json({error: 'invalid_shop_domain' },400)
const topic =gdpr[1]
if (topic ==='customers-data-request') {
// Rankdelta never receives or stores customer records from the shop — nothing to export.
const dataRequest =body.data_request && typeof body.data_request ==='object' ? (body.data_request as Record<string,unknown>) : {}
await logGdprEvent('shopify_gdpr_customers_data_request',shop,await shopUserIds(shop),{
shop_id: body.shop_id ?? null,
data_request_id: dataRequest.id ?? null,
})
return json({ok: true,data: [] })
}
if (topic ==='customers-redact') {
// No customer PII stored — nothing to erase.
await logGdprEvent('shopify_gdpr_customers_redact',shop,await shopUserIds(shop),{shop_id: body.shop_id ?? null })
return json({ok: true })
}
// shop-redact (48h after uninstall): hard-delete the shop's data. Non-200 makes Shopify retry.
const userIds =await shopUserIds(shop)
const deleted =await redactShop(shop)
await logGdprEvent('shopify_gdpr_shop_redact',shop,userIds,{shop_id: body.shop_id ?? null,deleted })
return json({ok: true,deleted })
}
if (method ==='GET' && rest ==='/v1/keys') {
const userId =await jwtUserId(req)
if (!userId) return json({error: 'unauthorized' },401)
const {data,error } =await db
.from('connector_api_keys')
.select('id, prefix, name, last_used_at, revoked_at, created_at')
.eq('user_id',userId)
.order('created_at',{ascending: false })
if (error) throw error
return json({keys: data ?? [] })
}
if (method ==='POST' && rest ==='/v1/keys') {
const userId =await jwtUserId(req)
if (!userId) return json({error: 'unauthorized' },401)
const body =await readJson(req)
const name =typeof body.name ==='string' && body.name.trim() ? body.name.trim().slice(0,80) : 'Personal'
const minted =await mintApiKey()
const {data,error } =await db
.from('connector_api_keys')
.insert({
user_id: userId,
key_hash: minted.hash,
prefix: minted.prefix,
name,
})
.select('id, prefix, name, created_at')
.single()
if (error) throw error
return json({key: {...data,secret: minted.raw } },201)
}
const revoke =rest.match(/^\/v1\/keys\/([^/]+)$/)
if (method ==='DELETE' && revoke) {
const userId =await jwtUserId(req)
if (!userId) return json({error: 'unauthorized' },401)
const {data,error } =await db
.from('connector_api_keys')
.update({revoked_at: new Date().toISOString() })
.eq('id',revoke[1])
.eq('user_id',userId)
.is('revoked_at',null)
.select('id')
.maybeSingle()
if (error) throw error
if (!data) return json({error: 'not_found' },404)
return json({revoked: true })
}
if (method ==='POST' && rest ==='/v1/handshake') {
const userId =await jwtUserId(req)
if (!userId) return json({error: 'unauthorized' },401)
const body =await readJson(req)
const shop =typeof body.shop_domain ==='string' ? normalizeShopDomain(body.shop_domain) : null
if (!shop) return json({error: 'invalid_shop_domain' },400)
const projectIdIn =typeof body.project_id ==='string' ? body.project_id : null
const project =await ensureProjectForShop(userId,shop,projectIdIn)
await upsertShopifyDestination(userId,project.id,shop)
const code =crypto.randomUUID().replace(/-/g,'') + (await sha256Hex(crypto.randomUUID())).slice(0,16)
const codeHash =await sha256Hex(code)
const expires =new Date(Date.now() + 10 * 60 * 1000).toISOString()
const {error } =await db.from('connector_link_codes').insert({
code_hash: codeHash,
user_id: userId,
shop_domain: shop,
project_id: project.id,
expires_at: expires,
})
if (error) throw error
const sub =await loadSubscription(userId)
return json({
code,
expires_at: expires,
project_id: project.id,
shop_domain: shop,
entitlements: entitlementsPayload(sub),
})
}
if (method ==='POST' && rest ==='/v1/handshake/exchange') {
const body =await readJson(req)
const shop =typeof body.shop_domain ==='string' ? normalizeShopDomain(body.shop_domain) : null
const code =typeof body.code ==='string' ? body.code : ''
if (!shop || code.length < 32) return json({error: 'invalid_request' },400)
const codeHash =await sha256Hex(code)
const {data: row,error } =await db
.from('connector_link_codes')
.select('id, user_id, shop_domain, project_id, expires_at, used_at')
.eq('code_hash',codeHash)
.maybeSingle()
if (error) throw error
if (!row || row.used_at || row.shop_domain !==shop) return json({error: 'invalid_code' },401)
if (Date.parse(row.expires_at) < Date.now()) return json({error: 'code_expired' },401)
// Atomic consume BEFORE minting: two concurrent exchanges of the same code must not both get a key.
// The conditional update only wins for one caller; the other sees no row and is rejected.
const {data: consumed,error: consumeErr } =await db
.from('connector_link_codes')
.update({used_at: new Date().toISOString() })
.eq('id',row.id)
.is('used_at',null)
.select('id')
if (consumeErr) throw consumeErr
if (!consumed || !consumed.length) return json({error: 'invalid_code' },401)
const minted =await mintApiKey()
const {data: keyRow,error: keyErr } =await db
.from('connector_api_keys')
.insert({
user_id: row.user_id,
key_hash: minted.hash,
prefix: minted.prefix,
name: `Shopify ${shop}`,
})
.select('id')
.single()
if (keyErr || !keyRow) throw keyErr ?? new Error('key_create_failed')
const sub =await loadSubscription(row.user_id)
return json({
api_key: minted.raw,
project_id: row.project_id,
shop_domain: shop,
entitlements: entitlementsPayload(sub),
})
}
const key =await apiKeyAuth(req)
if (!key) return json({error: 'unauthorized' },401)
if (method ==='GET' && rest ==='/v1/entitlements') {
const sub =await loadSubscription(key.userId)
return json(entitlementsPayload(sub))
}
const shopLoop =await handleShopLoop({
db,
userId: key.userId,
method,
rest,
req,
json,
entitlements: entitlementsPayload as (sub: unknown) => Record<string,unknown>,
loadSubscription,
})
if (shopLoop) return shopLoop
if (method ==='GET' && rest ==='/v1/shop-status') {
const url =new URL(req.url)
const shop =normalizeShopDomain(url.searchParams.get('shop_domain') ?? '')
if (!shop) return json({error: 'invalid_shop_domain' },400)
const sub =await loadSubscription(key.userId)
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id')
.eq('user_id',key.userId)
.eq('type','shopify')
.eq('external_id',shop)
.is('unlinked_at',null)
.maybeSingle()
let project: {
id: string
name: string
website_url: string | null
store_platform?: string | null
} | null =null
let queueCount =0
let publishedCount =0
let audit: {score: number | null;audited_at: string | null } | null =null
let auditStored: Record<string,unknown> ={}
if (dest?.project_id) {
let projRes =await db
.from('projects')
.select('id, name, website_url, store_platform')
.eq('id',dest.project_id)
.maybeSingle()
if (projRes.error && isMissingColumnError(projRes.error.message,'store_platform')) {
projRes =await db
.from('projects')
.select('id, name, website_url')
.eq('id',dest.project_id)
.maybeSingle()
}
if (projRes.data) {
const stamped =(projRes.data as {store_platform?: string | null }).store_platform
if (!stamped) await stampStorePlatform(projRes.data.id,'shopify')
project ={
id: projRes.data.id,
name: projRes.data.name,
website_url: projRes.data.website_url,
store_platform: stamped || 'shopify',
}
}
const {count: ready } =await db
.from('content')
.select('id',{count: 'exact',head: true })
.eq('destination_id',dest.id)
.eq('publish_state','ready_to_publish')
const {count: published } =await db
.from('content')
.select('id',{count: 'exact',head: true })
.eq('destination_id',dest.id)
.eq('publish_state','published')
queueCount =ready ?? 0
publishedCount =published ?? 0
const {data: auditRow } =await db
.from('site_audits')
.select('result, audited_at')
.eq('project_id',dest.project_id)
.maybeSingle()
if (auditRow) {
auditStored =(auditRow.result ?? {}) as Record<string,unknown>
audit ={
score: typeof auditStored.score ==='number' ? auditStored.score : null,
audited_at: (auditRow.audited_at as string | null) ?? null,
}
}
}
let visibility: {
your_mentions: number
your_mentions_30d: number
share_of_voice: number | null
your_recommended: number
window_days: number
} | null =null
if (dest?.project_id) {
try {
const vis =await visibilityReport(db,dest.project_id,project?.website_url || `https://${shop}`)
visibility ={
your_mentions: vis.yourMentions,
your_mentions_30d: vis.yourMentions,
share_of_voice: vis.overallShareOfVoice,
your_recommended: vis.yourRecommended,
window_days: vis.window_days,
}
} catch {
visibility =null
}
}
const sov =
typeof auditStored.share_of_voice ==='number'
? (auditStored.share_of_voice as number)
: visibility?.share_of_voice ?? null
const coverage =coverageFromStoredAudit(auditStored)
const hygiene =parseShopHygiene(auditStored.hygiene)
const ent =entitlementsPayload(sub)
const missingSeo =coverage.rows.filter((r) => r.missing_seo_title || r.missing_seo_description).length
let ai_files: ReturnType<typeof aeoFilesPayload> | null =null
if (project) {
const articles =await loadPublishedArticles(project.id)
ai_files =aeoFilesPayload(
{name: project.name,catalog_notes: null },
project.website_url || `https://${shop}`,
articles,
)
}
const home ={
shop_domain: shop,
linked: Boolean(dest),
destination_id: dest?.id ?? null,
project,
queue_count: queueCount,
published_count: publishedCount,
visibility,
audit,
hygiene,
checklist: shopHomeChecklist({
linked: Boolean(dest),
paid: Boolean(ent.paid),
skip_shopify_billing: Boolean(ent.skip_shopify_billing),
audit_score: audit?.score ?? null,
has_visibility: Boolean(visibility),
hygiene,
missing_seo: missingSeo,
catalog_count: coverage.catalog_count,
}),
next_actions: expertNextActions(coverage,sov,{platform: 'shopify',hygiene }),
guidance: AEO_GUIDANCE,
ai_files,
entitlements: ent,
}
return json(Object.fromEntries(SHOP_STATUS_HOME_KEYS.map((k) => [k,home[k]])))
}
if (method ==='POST' && rest ==='/v1/link-shop') {
const body =await readJson(req)
const shop =typeof body.shop_domain ==='string' ? normalizeShopDomain(body.shop_domain) : null
if (!shop) return json({error: 'invalid_shop_domain' },400)
const projectIdIn =typeof body.project_id ==='string' ? body.project_id : null
const project =await ensureProjectForShop(key.userId,shop,projectIdIn)
const destinationId =await upsertShopifyDestination(key.userId,project.id,shop)
const sub =await loadSubscription(key.userId)
return json({
destination_id: destinationId,
project_id: project.id,
shop_domain: shop,
entitlements: entitlementsPayload(sub),
})
}
if (method ==='POST' && rest ==='/v1/link-destination') {
const body =await readJson(req)
const typeRaw =typeof body.type ==='string' ? body.type : ''
if (!isDestinationType(typeRaw) || typeRaw ==='shopify') {
return json({error: 'invalid_destination_type' },400)
}
const siteUrl =typeof body.site_url ==='string' ? body.site_url.trim() : ''
const host =normalizeSiteHost(siteUrl || (typeof body.site_host ==='string' ? body.site_host : ''))
if (!host) return json({error: 'invalid_site_host' },400)
const canonicalUrl =siteUrl && /^https?:\/\//i.test(siteUrl) ? siteUrl.replace(/\/+$/,'') : `https://${host}`
if (
shouldRejectShopifyUrlOnNonShopifyLink(typeRaw,host) ||
shouldRejectShopifyUrlOnNonShopifyLink(typeRaw,siteUrl) ||
shouldRejectShopifyUrlOnNonShopifyLink(typeRaw,canonicalUrl)
) {
return json({error: 'shopify_use_app' },400)
}
if (await publicProbeLooksLikeShopifyStorefront(canonicalUrl)) {
return json({error: 'shopify_use_app' },400)
}
const projectIdIn =typeof body.project_id ==='string' ? body.project_id : null
const platform =
typeRaw ==='wordpress' ? 'woocommerce' : typeRaw ==='prestashop' ? 'custom' : 'custom'
const project =await ensureProjectForSite(key.userId,host,canonicalUrl,platform,projectIdIn)
const destinationId =await upsertDestination(key.userId,project.id,typeRaw,host,{
site_url: canonicalUrl,
})
const sub =await loadSubscription(key.userId)
return json({
destination_id: destinationId,
project_id: project.id,
type: typeRaw,
site_host: host,
entitlements: entitlementsPayload(sub),
})
}
if (method ==='POST' && rest ==='/v1/entitlements/sync') {
const body =await readJson(req)
const shop =typeof body.shop_domain ==='string' ? normalizeShopDomain(body.shop_domain) : null
if (!shop) return json({error: 'invalid_shop_domain' },400)
const {data: dest } =await db
.from('publish_destinations')
.select('id')
.eq('user_id',key.userId)
.eq('type','shopify')
.eq('external_id',shop)
.is('unlinked_at',null)
.maybeSingle()
if (!dest) return json({error: 'shop_not_linked' },403)
const sub =await loadSubscription(key.userId)
if (shouldSkipShopifyBilling(sub)) {
return json({skipped: true,reason: 'stripe_active',entitlements: entitlementsPayload(sub) })
}
const shopifySecret =Deno.env.get('SHOPIFY_API_SECRET') ?? ''
const billingHmac =req.headers.get('x-shopify-billing-hmac-sha256') ?? String(body.billing_hmac ?? '')
if (!shopifySecret || !(await verifyShopifyBillingHmac(body,billingHmac,shopifySecret))) {
return json({error: 'billing_not_verified' },401)
}
// Replay window: `issued_at` is signed, so a captured payload cannot be re-sent later to restore a
// cancelled plan. A payload without it would verify forever, so it is required.
const issuedAtVerdict =billingIssuedAtVerdict(body.issued_at,Date.now(),ENTITLEMENTS_REQUIRE_ISSUED_AT)
if (issuedAtVerdict ==='stale') return json({error: 'billing_payload_stale' },401)
if (issuedAtVerdict ==='required') return json({error: 'billing_issued_at_required' },401)
const planRaw =typeof body.plan ==='string' ? body.plan : 'starter'
if (!isShopifyPlan(planRaw)) return json({error: 'invalid_plan' },400)
const shopifyStatus =typeof body.status ==='string' ? body.status : 'ACTIVE'
const trialEnd =typeof body.trial_end ==='string' ? body.trial_end : null
const shopifySubId =typeof body.shopify_subscription_id ==='string' ? body.shopify_subscription_id : null
const periodEnd =typeof body.current_period_end ==='string' ? body.current_period_end : null
const mapped =mapShopifySubscriptionStatus(shopifyStatus,trialEnd)
const maxProjects =PLAN_MAX_PROJECTS[planRaw] ?? 1
const {data: planConfig } =await db
.from('plan_configurations')
.select('monthly_credits, max_projects')
.eq('plan',planRaw)
.maybeSingle()
const patch ={
plan: planRaw,
status: mapped,
billing_provider: 'shopify',
shopify_subscription_id: shopifySubId,
shopify_shop_domain: shop,
trial_end: trialEnd,
current_period_end: periodEnd,
max_projects: planConfig?.max_projects ?? maxProjects,
updated_at: new Date().toISOString(),
}
if (sub) {
await db.from('subscriptions').update(patch).eq('user_id',key.userId)
} else {
await db.from('subscriptions').insert({user_id: key.userId,...patch })
}
const prev =sub?.status ?? null
if (mapped ==='trialing' && prev !=='trialing') {
await db.rpc('add_credits',{
p_user_id: key.userId,
p_credits: 100,
p_transaction_type: 'bonus_credit',
p_description: `Shopify trial ${planRaw} (14 days)`,
p_is_bonus: true,
})
} else if (mapped ==='active' && prev !=='active') {
const nowIso =new Date().toISOString()
await db.rpc('reset_subscription_credits',{
p_user_id: key.userId,
p_new_period_start: nowIso,
p_new_period_end: periodEnd ?? nowIso,
})
}
const fresh =await loadSubscription(key.userId)
return json({skipped: false,entitlements: entitlementsPayload(fresh) })
}
if (method ==='GET' && rest ==='/v1/articles/ready') {
const url =new URL(req.url)
const projectId =url.searchParams.get('project_id')
const shopParam =url.searchParams.get('shop_domain')
const shop =shopParam ? normalizeShopDomain(shopParam) : null
const typeParam =url.searchParams.get('type')
const destType: DestinationType =typeParam && isDestinationType(typeParam)
? typeParam
: shop
? 'shopify'
: 'wordpress'
const siteHost =normalizeSiteHost(url.searchParams.get('site_host') ?? '')
const sub =await loadSubscription(key.userId)
if (!planAllowsArticles(sub?.plan ?? '') || !hasPaidEntitlement(sub)) {
return json({error: 'plan_has_no_articles',entitlements: entitlementsPayload(sub) },403)
}
let destQuery =db
.from('publish_destinations')
.select('id, project_id, external_id')
.eq('user_id',key.userId)
.eq('type',destType)
.is('unlinked_at',null)
if (shop && destType ==='shopify') destQuery =destQuery.eq('external_id',shop)
if (siteHost) destQuery =destQuery.eq('external_id',siteHost)
if (projectId) destQuery =destQuery.eq('project_id',projectId)
const {data: dests,error: destErr } =await destQuery
if (destErr) throw destErr
const destIds =(dests ?? []).map((d) => d.id as string)
if (!destIds.length) return json({articles: [] })
const {data: rows,error } =await db
.from('content')
.select('id, project_id, title, slug, body, metadata, destination_id, publish_state, external_id, external_url')
.in('destination_id',destIds)
.eq('publish_state','ready_to_publish')
.order('generated_date',{ascending: true })
.limit(20)
if (error) throw error
const articles =(rows ?? []).map((row) => {
const meta =(row.metadata ?? {}) as Record<string,unknown>
const html =
typeof meta.html ==='string' ? meta.html : stripGutenberg(String(row.body ?? ''))
return {
id: row.id,
project_id: row.project_id,
title: row.title,
slug: row.slug,
html,
meta_title: meta.metaTitle ?? meta.meta_title ?? row.title,
meta_description: meta.metaDescription ?? meta.meta_description ?? '',
focus_keyword: meta.focusKeyword ?? meta.focus_keyword ?? '',
featured_image_url: meta.featuredImageUrl ?? meta.featured_image_url ?? null,
tags: Array.isArray(meta.tags) ? meta.tags : [],
// Additive fields: a refreshed article keeps the post it was published as. Plugins must
// UPDATE external_id when action is 'update' instead of creating a second live post.
external_id: row.external_id ?? null,
external_url: row.external_url ?? null,
action: readyArticleAction(row.external_id),
}
})
return json({articles })
}
const published =rest.match(/^\/v1\/articles\/([^/]+)\/published$/)
if (method ==='POST' && published) {
const body =await readJson(req)
const externalId =typeof body.external_id ==='string' ? body.external_id : ''
const externalUrl =typeof body.url ==='string' ? body.url : ''
if (!externalId || !externalUrl) return json({error: 'invalid_request' },400)
const {data: row,error } =await db
.from('content')
.select('id, project_id, destination_id, publish_state, external_id, external_url')
.eq('id',published[1])
.maybeSingle()
if (error) throw error
if (!row) return json({error: 'not_found' },404)
const {data: dest,error: destErr } =await db
.from('publish_destinations')
.select('id, user_id')
.eq('id',row.destination_id)
.eq('user_id',key.userId)
.maybeSingle()
if (destErr) throw destErr
if (!dest) return json({error: 'forbidden' },403)
// See decidePublished: repeated calls are a no-op, and a refresh reported with a different post
// id keeps the original post unless the plugin sends new_post: true.
const decision =decidePublished(
{
publish_state: (row.publish_state as string | null) ?? null,
external_id: (row.external_id as string | null) ?? null,
external_url: (row.external_url as string | null) ?? null,
},
{externalId,externalUrl,isNewPost: body.new_post ===true },
)
if (decision.kind ==='already_published') {
return json({
ok: true,
url: decision.externalUrl,
external_id: decision.externalId,
external_url: decision.externalUrl,
already_published: true,
})
}
const nowIso =new Date().toISOString()
const {error: updateErr } =await db
.from('content')
.update({
publish_state: 'published',
status: 'published',
external_id: decision.externalId,
external_url: decision.externalUrl,
published_date: nowIso,
updated_at: nowIso,
})
.eq('id',row.id)
if (updateErr) {
// Answering ok here left the row ready_to_publish, so /ready served it again → duplicate post.
// A real error lets the plugin retry; the retry is idempotent once the row is published.
console.error('[connector-api] mark published failed',updateErr.message)
return json({error: 'publish_record_failed' },500)
}
const {error: activityErr } =await db.from('agent_activity').insert({
project_id: row.project_id,
type: 'article_published',
description: `Articolo pubblicato sul canale esterno`,
url: decision.externalUrl,
metadata: {
connector: true,
external_id: decision.externalId,
...(decision.keptOriginal ? {reported_external_id: externalId,reported_url: externalUrl } : {}),
},
})
if (activityErr) console.error('[connector-api] publish activity log failed',activityErr.message)
return json({
ok: true,
url: decision.externalUrl,
external_id: decision.externalId,
external_url: decision.externalUrl,
already_published: false,
kept_original_post: decision.keptOriginal,
})
}
if (method ==='GET' && rest ==='/v1/aeo-payload') {
const url =new URL(req.url)
const shop =normalizeShopDomain(url.searchParams.get('shop_domain') ?? '')
const typeParam =url.searchParams.get('type')
const destType: DestinationType =
typeParam && isDestinationType(typeParam) ? typeParam : shop ? 'shopify' : 'wordpress'
const siteHost =shop || normalizeSiteHost(url.searchParams.get('site_host') ?? '')
if (!siteHost) return json({error: 'invalid_site_host' },400)
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id')
.eq('user_id',key.userId)
.eq('type',destType)
.eq('external_id',siteHost)
.is('unlinked_at',null)
.maybeSingle()
if (!dest) return json({error: 'destination_not_linked' },404)
let {data: project,error: projectErr } =await db
.from('projects')
.select('id, name, website_url, catalog_notes, store_platform')
.eq('id',dest.project_id)
.maybeSingle()
if (projectErr) {
const fallback =await db
.from('projects')
.select('id, name, website_url')
.eq('id',dest.project_id)
.maybeSingle()
project =fallback.data
? {...fallback.data,catalog_notes: null,store_platform: null }
: null
projectErr =fallback.error
}
if (projectErr || !project) return json({error: 'not_found' },404)
const websiteUrl =project.website_url || `https://${siteHost}`
const articles =await loadPublishedArticles(project.id)
const files =aeoFilesPayload(project,websiteUrl,articles)
const organization ={
'@context': 'https://schema.org',
'@type': 'Organization',
name: project.name,
url: websiteUrl,
}
const {data: auditRow } =await db
.from('site_audits')
.select('result')
.eq('project_id',dest.project_id)
.maybeSingle()
const storedAudit =(auditRow?.result ?? {}) as Record<string,unknown>
const hygiene =parseShopHygiene(storedAudit.hygiene)
const nextActions =expertNextActions(
coverageFromStoredAudit(storedAudit),
typeof storedAudit['share_of_voice'] ==='number' ? (storedAudit['share_of_voice'] as number) : null,
{platform: destType,hygiene },
)
return json({
project_id: project.id,
brand: project.name,
website_url: websiteUrl,
articles: articles.map(({title,url }) => ({title,url })),
...files,
organization_jsonld: organization,
hygiene,
guidance: AEO_GUIDANCE,
next_actions: nextActions,
})
}
if (method ==='POST' && rest ==='/v1/uninstall') {
const body =await readJson(req)
const shop =typeof body.shop_domain ==='string' ? normalizeShopDomain(body.shop_domain) : null
const typeRaw =typeof body.type ==='string' ? body.type : shop ? 'shopify' : ''
const destType =isDestinationType(typeRaw) ? typeRaw : null
const siteHost =
shop ||
(typeof body.site_host ==='string' ? normalizeSiteHost(body.site_host) : null) ||
(typeof body.site_url ==='string' ? normalizeSiteHost(body.site_url) : null)
if (!destType || !siteHost) return json({error: 'invalid_destination' },400)
const now =new Date().toISOString()
const {data: destRow } =await db
.from('publish_destinations')
.update({unlinked_at: now,updated_at: now })
.eq('user_id',key.userId)
.eq('type',destType)
.eq('external_id',siteHost)
.is('unlinked_at',null)
.select('project_id')
.maybeSingle()
if (destType ==='shopify') {
if (destRow?.project_id) {
await db.from('projects').update({store_platform: null,updated_at: now }).eq('id',destRow.project_id).eq('user_id',key.userId)
}
await db.from('connector_api_keys').update({revoked_at: now }).eq('user_id',key.userId).eq('name',`Shopify ${siteHost}`).is('revoked_at',null)
await db.from('connector_link_codes').update({used_at: now }).eq('user_id',key.userId).eq('shop_domain',siteHost).is('used_at',null)
const sub =await loadSubscription(key.userId)
if (sub?.billing_provider ==='shopify' && sub.shopify_shop_domain ===siteHost) {
await db
.from('subscriptions')
.update({
plan: 'starter',
status: 'canceled',
shopify_subscription_id: null,
cancel_at_period_end: false,
canceled_at: now,
updated_at: now,
})
.eq('user_id',key.userId)
}
}
return json({ok: true })
}
if (method ==='GET' && rest ==='/v1/visibility') {
const url =new URL(req.url)
const typeParam =url.searchParams.get('type')
const destType: DestinationType =typeParam && isDestinationType(typeParam) ? typeParam : 'wordpress'
const siteHost =normalizeSiteHost(url.searchParams.get('site_host') ?? '')
if (!siteHost) return json({error: 'invalid_site_host' },400)
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id')
.eq('user_id',key.userId)
.eq('type',destType)
.eq('external_id',siteHost)
.is('unlinked_at',null)
.maybeSingle()
if (!dest?.project_id) return json({your_mentions_30d: 0,share_of_voice: null })
try {
const {data: qs } =await db.from('visibility_queries').select('id').eq('project_id',dest.project_id)
const queryIds =(qs ?? []).map((q) => q.id as string)
if (!queryIds.length) return json({your_mentions_30d: 0,share_of_voice: null })
const since =new Date(Date.now() - 30 * 864e5).toISOString()
const {data: runs } =await db
.from('visibility_query_runs')
.select('id')
.in('query_id',queryIds)
.gte('run_at',since)
const runIds =(runs ?? []).map((r) => r.id as string)
if (!runIds.length) return json({your_mentions_30d: 0,share_of_voice: null })
const {data: mentions } =await db
.from('visibility_brand_mentions')
.select('tracked_brand_id, competitor_brand_id')
.in('query_run_id',runIds)
const you =(mentions ?? []).filter((m) => m.tracked_brand_id).length
const comp =(mentions ?? []).filter((m) => m.competitor_brand_id).length
return json({
your_mentions_30d: you,
share_of_voice: you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : null,
})
} catch {
return json({your_mentions_30d: 0,share_of_voice: null })
}
}
if (method ==='POST' && rest ==='/v1/content/refresh') {
const body =await readJson(req)
const typeRaw =typeof body.type ==='string' ? body.type : 'wordpress'
const destType =isDestinationType(typeRaw) ? typeRaw : 'wordpress'
const siteHost =normalizeSiteHost(typeof body.site_host ==='string' ? body.site_host : '')
if (!siteHost) return json({error: 'invalid_site_host' },400)
const postIds =Array.isArray(body.post_ids) ? body.post_ids.map(String) : []
if (!postIds.length) return json({error: 'no_posts_selected' },400)
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id')
.eq('user_id',key.userId)
.eq('type',destType)
.eq('external_id',siteHost)
.is('unlinked_at',null)
.maybeSingle()
if (!dest) return json({error: 'destination_not_linked' },404)
const sub =await loadSubscription(key.userId)
if (!planAllowsArticles(sub?.plan ?? '') || !hasPaidEntitlement(sub)) {
return json({error: 'plan_has_no_articles' },403)
}
const {data: project } =await db
.from('projects')
.select('name, website_url, primary_language')
.eq('id',dest.project_id)
.maybeSingle()
const brand =String(project?.name || siteHost)
const websiteUrl =String(project?.website_url || `https://${siteHost}`)
const refreshed: Array<{id: string;title: string;external_id: string }> =[]
const failed: Array<{id: string | null;external_id: string;error: string;reason?: string }> =[]
for (const postId of postIds.slice(0,10)) {
const {data: row } =await db
.from('content')
.select('id, title, topic, metadata')
.eq('destination_id',dest.id)
.eq('external_id',postId)
.maybeSingle()
if (!row) continue
const keyword =String(row.topic || row.title)
const written =await writeArticleHtml({
keyword,
brand,
websiteUrl,
moneyUrl: '',
language: (project?.primary_language as string | null | undefined) ?? null,
db,
userId: key.userId,
})
if ('error' in written) {
// Account cap reached: 402 if nothing was refreshed yet, otherwise stop spending and return partial.
if (written.budget) {
if (!refreshed.length) return articleErrorJson(json,written)
break
}
failed.push({id: row.id as string,external_id: postId,error: written.error })
continue
}
if ('needsReview' in written) {
// Unusable model output: the live post and its row stay as they are (not re-queued).
const {error: flagErr } =await db
.from('content')
.update({metadata: refreshReviewMetadata(row.metadata,written.reason,new Date().toISOString()) })
.eq('id',row.id)
if (flagErr) console.error('[connector-api] refresh review flag failed',flagErr.message)
failed.push({id: row.id as string,external_id: postId,error: 'article_needs_review',reason: written.reason })
continue
}
// Back on the publish queue with external_id kept → /ready serves it with action 'update'.
const {error: refreshErr } =await db
.from('content')
.update({
title: written.title,
body: written.html,
publish_state: 'ready_to_publish',
status: 'ready',
updated_at: new Date().toISOString(),
metadata: {
html: written.html,
source: `${destType}_refresh`,
focusKeyword: keyword,
},
})
.eq('id',row.id)
if (refreshErr) {
console.error('[connector-api] content refresh save failed',refreshErr.message)
failed.push({id: row.id as string,external_id: postId,error: 'refresh_save_failed' })
continue
}
refreshed.push({id: row.id as string,title: written.title,external_id: postId })
}
await db.from('agent_activity').insert({
project_id: dest.project_id,
type: 'content_refresh_requested',
description: `Refresh richiesto per ${postIds.length} post`,
metadata: {connector: true,post_ids: postIds,refreshed: refreshed.length,failed: failed.length },
})
return json({
ok: true,
queued: postIds.length,
refreshed: refreshed.length,
articles: refreshed,
failed,
})
}
if (method ==='POST' && rest ==='/v1/content/generate') {
const body =await readJson(req)
const typeRaw =typeof body.type ==='string' ? body.type : 'wordpress'
const destType =isDestinationType(typeRaw) ? typeRaw : 'wordpress'
const siteHost =normalizeSiteHost(typeof body.site_host ==='string' ? body.site_host : '')
if (!siteHost) return json({error: 'invalid_site_host' },400)
const topic =typeof body.topic ==='string' ? body.topic.trim() : ''
if (!topic) return json({error: 'topic_required' },400)
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id')
.eq('user_id',key.userId)
.eq('type',destType)
.eq('external_id',siteHost)
.is('unlinked_at',null)
.maybeSingle()
if (!dest) return json({error: 'destination_not_linked' },404)
const sub =await loadSubscription(key.userId)
if (!planAllowsArticles(sub?.plan ?? '') || !hasPaidEntitlement(sub)) {
return json({error: 'plan_has_no_articles' },403)
}
const {data: project } =await db
.from('projects')
.select('name, website_url, primary_language')
.eq('id',dest.project_id)
.maybeSingle()
const moneyUrl =typeof body.money_url ==='string' ? body.money_url.trim() : ''
const written =await writeArticleHtml({
keyword: topic,
brand: String(project?.name || siteHost),
websiteUrl: String(project?.website_url || `https://${siteHost}`),
moneyUrl,
language: (project?.primary_language as string | null | undefined) ?? null,
db,
userId: key.userId,
})
if ('error' in written) return articleErrorJson(json,written)
if ('needsReview' in written) {
// Unusable model output: kept as a needs_review draft, never on the publish queue.
const draft =await insertNeedsReviewDraft(db,{
projectId: dest.project_id as string,
destId: dest.id as string,
keyword: topic,
moneyUrl,
source: destType,
written,
})
return articleNeedsReviewJson(json,written,{topic,content_id: draft?.id ?? null,article: draft })
}
const slug =
topic
.toLowerCase()
.replace(/[^a-z0-9]+/g,'-')
.replace(/^-|-$/g,'')
.slice(0,80) || 'article'
const {data: row,error } =await db
.from('content')
.insert({
project_id: dest.project_id,
destination_id: dest.id,
title: written.title,
slug,
body: written.html,
topic,
keywords_used: [topic],
status: 'ready',
publish_state: 'ready_to_publish',
metadata: {
html: written.html,
source: destType,
focusKeyword: topic,
moneyUrl: moneyUrl || null,
},
})
.select('id, title, slug')
.single()
if (error || !row) {
if (error) console.error('[connector-api] article insert failed',error.message)
return json({error: 'generate_failed' },500)
}
await db.from('agent_activity').insert({
project_id: dest.project_id,
type: 'content_generation_requested',
description: `Generazione richiesta per: ${topic}`,
metadata: {connector: true,topic,content_id: row.id },
})
return json({ok: true,topic,article: row })
}
return json({error: 'not_found',path: rest },404)
} catch (e) {
if (e instanceof ProjectLimitError) {
return json({error: 'project_limit_reached',max: e.max,count: e.count },402)
}
const message =e instanceof Error ? e.message : String(e)
console.error('[connector-api]',rest,message)
// Never echo raw error text (DB/constraint/internal details) to connector clients.
return json({error: 'internal_error' },500)
}
})
