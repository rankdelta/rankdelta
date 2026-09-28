import {
catalogCoverage,
auditScore,
coverageFromStoredAudit,
preferStoredAuditScore,
planAllowsArticles,
SHOP_LOOP_PATHS,
shopLoopShouldHandle,
expertNextActions,
AEO_GUIDANCE,
resolveArticleMoneyUrl,
mergeShopHygiene,
normalizeShopDomain,
parseShopHygiene,
type CatalogCoverageItem,
} from '../_shared/connector.ts'
import {
ACCOUNT_BUDGET_ERROR_CODE,
ACCOUNT_BUDGET_MESSAGE,
DATAFORSEO_PRECHECK_CENTS,
dataForSeoCostCentsFromResponse,
estimateLlmCostCents,
finalizeAccountSpend,
llmCostCentsFromResponse,
releaseAccountSpend,
reserveAccountSpend,
type BudgetCheck,
type Sb,
} from '../_shared/accountBudget.ts'
import {
articleLanguageName,
parseArticleCompletion,
refreshReviewMetadata,
reviewDraftBody,
} from '../_shared/connectorPublish.ts'
type JsonFn =(body: unknown,status?: number) => Response
type Db ={
from: (table: string) => any
}
/** Same 402 shape as seo-proxy's budgetBlockedResponse so app + connector clients branch on one code. */
export function budgetRefusedJson(json: JsonFn,check: BudgetCheck): Response {
return json({
error: ACCOUNT_BUDGET_MESSAGE,
code: ACCOUNT_BUDGET_ERROR_CODE,
spent_cents: check.spentCents,
cap_cents: check.capCents,
},402)
}
/** Map a writeArticleHtml failure to the right HTTP response (402 when the account cap refused it). */
export function articleErrorJson(json: JsonFn,written: {error: string;budget?: BudgetCheck }): Response {
if (written.budget) return budgetRefusedJson(json,written.budget)
return json({error: written.error },503)
}
export async function handleShopLoop(opts: {
db: Db
userId: string
method: string
rest: string
req: Request
json: JsonFn
entitlements: (sub: unknown) => Record<string,unknown>
loadSubscription: (userId: string) => Promise<unknown>
}): Promise<Response | null> {
const {db,userId,method,rest,req,json,entitlements,loadSubscription } =opts
const url =new URL(req.url)
if (!(SHOP_LOOP_PATHS as readonly string[]).includes(rest)) return null
let body: Record<string,unknown> ={}
if (method !=='GET' && method !=='HEAD') {
body =await readJson(req.clone())
}
const shopRaw =
url.searchParams.get('shop_domain') ||
url.searchParams.get('shop') ||
(typeof body.shop_domain ==='string' ? body.shop_domain : '')
if (!shopLoopShouldHandle(rest,shopRaw)) return null
const ctx =await loadShop(db,userId,shopRaw)
if (!ctx) return json({error: 'shop_not_linked' },404)
const sub =await loadSubscription(userId)
const ent =entitlements(sub)
if (method ==='GET' && rest ==='/v1/visibility') {
return json(await visibilityReport(db,ctx.projectId,ctx.websiteUrl))
}
if (method ==='POST' && rest ==='/v1/visibility/refresh') {
const created =await ensureVisibilityQueries(db,ctx)
await db.from('projects').update({visibility_schedule_enabled: true }).eq('id',ctx.projectId)
return json({
ok: true,
queries_inserted: created,
note: 'Prompts are stored on the hosted project. Mentions run on the visibility schedule (or the next hosted run).',
})
}
if (method ==='GET' && rest ==='/v1/audit') {
const {data } =await db
.from('site_audits')
.select('result, audited_at')
.eq('project_id',ctx.projectId)
.maybeSingle()
return json({
audited_at: data?.audited_at ?? null,
result: data?.result ?? null,
})
}
if (method ==='POST' && rest ==='/v1/audit/run') {
const catalog =Array.isArray(body.catalog) ? (body.catalog as CatalogCoverageItem[]) : []
const vis =await visibilityReport(db,ctx.projectId,ctx.websiteUrl)
const citedUrls =vis.citations.map((c) => c.source_url).filter(Boolean) as string[]
const coverage =catalogCoverage(catalog.slice(0,250),citedUrls)
const scored =auditScore(coverage,vis.overallShareOfVoice)
const {data: prevAudit } =await db
.from('site_audits')
.select('result')
.eq('project_id',ctx.projectId)
.maybeSingle()
const prevStored =(prevAudit?.result ?? {}) as Record<string,unknown>
const hygiene =mergeShopHygiene(prevStored.hygiene,body.hygiene)
const result ={
siteUrl: ctx.websiteUrl,
source: 'shopify_admin',
catalog_count: coverage.catalog_count,
cited_count: coverage.cited_count,
ignored_count: coverage.ignored_count,
ignored: coverage.ignored.slice(0,80),
queries: vis.queries.length,
share_of_voice: vis.overallShareOfVoice,
score: scored.score,
score_breakdown: scored.breakdown,
competitors: vis.competitors.slice(0,10),
hygiene,
auditedAt: new Date().toISOString(),
}
await db.from('site_audits').upsert(
{project_id: ctx.projectId,result,audited_at: result.auditedAt },
{onConflict: 'project_id' },
)
await db.from('site_audit_history').insert({
project_id: ctx.projectId,
composite: scored.score,
geo_structure: scored.breakdown.seo,
geo_content: scored.breakdown.citations,
pages_audited: coverage.catalog_count,
weak_pages: coverage.ignored_count,
audited_at: result.auditedAt,
})
return json({ok: true,result })
}
if ((method ==='GET' || method ==='POST') && rest ==='/v1/geo-loop') {
const catalog =method ==='POST' && Array.isArray(body.catalog)
? (body.catalog as CatalogCoverageItem[])
: []
const vis =await visibilityReport(db,ctx.projectId,ctx.websiteUrl)
const citedUrls =vis.citations.map((c) => c.source_url).filter(Boolean) as string[]
const {data: auditRow } =await db
.from('site_audits')
.select('result')
.eq('project_id',ctx.projectId)
.maybeSingle()
const stored =(auditRow?.result ?? {}) as Record<string,unknown>
const catalogProvided =catalog.length > 0
const hygiene =mergeShopHygiene(stored.hygiene,method ==='POST' ? body.hygiene : undefined)
const coverage =catalogProvided
? catalogCoverage(catalog.slice(0,250),citedUrls)
: coverageFromStoredAudit(stored)
const computed =auditScore(coverage,vis.overallShareOfVoice)
const scored =preferStoredAuditScore(computed,stored,catalogProvided)
const channels =['product','collection','page','blog','article'].map((type) => {
const items =coverage.ignored.filter((row) => String((row as {type?: string }).type) ===type)
return {type,needs_work: items.length,items: items.slice(0,20) }
})
if (method ==='POST' && catalogProvided) {
const result ={
siteUrl: ctx.websiteUrl,
source: 'shopify_geo_loop',
catalog_count: coverage.catalog_count,
cited_count: coverage.cited_count,
ignored_count: coverage.ignored_count,
ignored: coverage.ignored.slice(0,80),
share_of_voice: vis.overallShareOfVoice,
score: scored.score,
score_breakdown: scored.breakdown,
hygiene,
auditedAt: new Date().toISOString(),
}
await db.from('site_audits').upsert(
{project_id: ctx.projectId,result,audited_at: result.auditedAt },
{onConflict: 'project_id' },
)
} else if (method ==='POST' && Object.keys(parseShopHygiene(body.hygiene)).length) {
const auditedAt =
typeof stored.auditedAt ==='string' ? stored.auditedAt : new Date().toISOString()
await db.from('site_audits').upsert(
{project_id: ctx.projectId,result: {...stored,hygiene },audited_at: auditedAt },
{onConflict: 'project_id' },
)
}
return json({
ok: true,
score: scored.score,
score_breakdown: scored.breakdown,
channels,
citations: vis.citations.slice(0,80),
share_of_voice: vis.overallShareOfVoice,
your_mentions: vis.yourMentions,
your_recommended: vis.yourRecommended,
window_days: vis.window_days,
per_engine: vis.perEngine,
hygiene,
next_actions: expertNextActions(coverage,vis.overallShareOfVoice,{
platform: 'shopify',
hygiene,
}),
guidance: AEO_GUIDANCE,
})
}
if (method ==='GET' && rest ==='/v1/ranks') {
return json(await ranksReport(db,ctx.projectId))
}
if (method ==='POST' && rest ==='/v1/ranks/track') {
if (!ent.allows_articles) return json({error: 'plan_has_no_articles',entitlements: ent },403)
const phrase =typeof body.phrase ==='string' ? body.phrase.trim().slice(0,200) : ''
if (phrase.length < 2) return json({error: 'invalid_phrase' },400)
const targetUrl =typeof body.target_url ==='string' ? body.target_url.trim() : ''
const {data: existing } =await db
.from('serp_rank_keywords')
.select('id')
.eq('project_id',ctx.projectId)
.ilike('phrase',phrase)
.maybeSingle()
let keywordId =existing?.id as string | undefined
if (!keywordId) {
const {data: created,error } =await db
.from('serp_rank_keywords')
.insert({project_id: ctx.projectId,phrase,is_active: true })
.select('id')
.single()
if (error || !created) return json({error: error?.message ?? 'rank_track_failed' },500)
keywordId =created.id as string
}
if (targetUrl) {
const meta ={...(ctx.metadata || {}),rank_targets: {...(ctx.metadata.rank_targets || {}),[phrase.toLowerCase()]: targetUrl } }
await db.from('publish_destinations').update({metadata: meta,updated_at: new Date().toISOString() }).eq('id',ctx.destId)
}
return json({ok: true,keyword_id: keywordId,phrase,target_url: targetUrl || null })
}
if (method ==='POST' && rest ==='/v1/ranks/refresh') {
if (!ent.allows_articles) return json({error: 'plan_has_no_articles',entitlements: ent },403)
const requested =Array.isArray(body.keyword_ids)
? (body.keyword_ids as unknown[]).filter((x): x is string => typeof x ==='string').slice(0,8)
: []
let list: Array<{id: string;phrase: string }> =[]
if (requested.length) {
const {data } =await db
.from('serp_rank_keywords')
.select('id, phrase')
.eq('project_id',ctx.projectId)
.eq('is_active',true)
.in('id',requested)
list =data ?? []
} else {
const {data } =await db
.from('serp_rank_keywords')
.select('id, phrase')
.eq('project_id',ctx.projectId)
.eq('is_active',true)
.limit(8)
list =data ?? []
}
const results =[]
for (const kw of list) {
const one =await runOneSerp(db,userId,ctx,kw.id as string,kw.phrase as string)
if ('budget' in one && one.budget) {
// Account cap reached: 402 if nothing ran; otherwise return what did run and stop spending.
if (!results.length) return budgetRefusedJson(json,one.budget)
break
}
results.push(one)
}
return json({ok: true,results })
}
if (method ==='POST' && rest ==='/v1/articles/generate') {
if (!planAllowsArticles(String(ent.plan || '')) || !ent.paid) {
return json({error: 'plan_has_no_articles',entitlements: ent },403)
}
const keyword =typeof body.keyword ==='string' ? body.keyword.trim().slice(0,180) : ''
if (keyword.length < 2) return json({error: 'invalid_keyword' },400)
const moneyUrl =typeof body.money_url ==='string' ? body.money_url.trim() : ''
const written =await writeArticleHtml({
keyword,
brand: ctx.projectName,
websiteUrl: ctx.websiteUrl,
moneyUrl,
language: ctx.language,
db,
userId,
})
if ('error' in written) return articleErrorJson(json,written)
if ('needsReview' in written) {
// Unusable model output: keep it as a draft for review, never on the publish queue.
const draft =await insertNeedsReviewDraft(db,{
projectId: ctx.projectId,
destId: ctx.destId,
keyword,
moneyUrl,
source: 'shopify_admin',
written,
})
return articleNeedsReviewJson(json,written,{content_id: draft?.id ?? null,article: draft })
}
const slug =slugify(keyword)
const {data: row,error } =await db
.from('content')
.insert({
project_id: ctx.projectId,
destination_id: ctx.destId,
title: written.title,
slug,
body: written.html,
topic: keyword,
keywords_used: [keyword],
status: 'ready',
publish_state: 'ready_to_publish',
metadata: {
html: written.html,
source: 'shopify_admin',
focusKeyword: keyword,
moneyUrl: moneyUrl || null,
},
})
.select('id, title, slug')
.single()
if (error || !row) return json({error: error?.message ?? 'generate_failed' },500)
return json({ok: true,article: row })
}
if (method ==='POST' && rest ==='/v1/articles/refresh') {
if (!planAllowsArticles(String(ent.plan || '')) || !ent.paid) {
return json({error: 'plan_has_no_articles',entitlements: ent },403)
}
const id =typeof body.content_id ==='string' ? body.content_id : ''
if (!id) return json({error: 'invalid_content_id' },400)
const {data: row } =await db
.from('content')
.select('id, title, topic, destination_id, metadata')
.eq('id',id)
.eq('project_id',ctx.projectId)
.maybeSingle()
if (!row || row.destination_id !==ctx.destId) return json({error: 'not_found' },404)
const keyword =String(row.topic || row.title)
const moneyUrl =resolveArticleMoneyUrl(body.money_url,row.metadata)
const written =await writeArticleHtml({
keyword,
brand: ctx.projectName,
websiteUrl: ctx.websiteUrl,
moneyUrl,
language: ctx.language,
db,
userId,
})
if ('error' in written) return articleErrorJson(json,written)
if ('needsReview' in written) {
// Leave the live article (body, publish_state, external ids) untouched; only flag the refresh.
const {error: flagErr } =await db
.from('content')
.update({metadata: refreshReviewMetadata(row.metadata,written.reason,new Date().toISOString()) })
.eq('id',id)
if (flagErr) console.error('[connector-api] refresh review flag failed',flagErr.message)
return articleNeedsReviewJson(json,written,{content_id: id })
}
// Refreshing puts the row back on the publish queue. It keeps external_id/external_url, so
// /v1/articles/ready serves it with action 'update' and the plugin edits the existing post
// instead of creating a duplicate.
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
source: 'shopify_admin_refresh',
focusKeyword: keyword,
moneyUrl: moneyUrl || null,
},
})
.eq('id',id)
if (refreshErr) {
console.error('[connector-api] article refresh save failed',refreshErr.message)
return json({error: 'refresh_save_failed' },500)
}
return json({ok: true,article: {id,title: written.title } })
}
return json({error: 'not_found',path: rest },404)
}
async function readJson(req: Request): Promise<Record<string,unknown>> {
try {
const body =await req.json()
return body && typeof body ==='object' ? (body as Record<string,unknown>) : {}
} catch {
return {}
}
}
async function loadShop(db: Db,userId: string,shopRaw: string) {
// Same scheme/path/port-stripping gate as the rest of connector-api (and shopLoopShouldHandle),
// so `https://x.myshopify.com/` resolves to the destination stored as `x.myshopify.com`.
const shop =normalizeShopDomain(String(shopRaw || ''))
if (!shop) return null
const {data: dest } =await db
.from('publish_destinations')
.select('id, project_id, metadata')
.eq('user_id',userId)
.eq('type','shopify')
.eq('external_id',shop)
.is('unlinked_at',null)
.maybeSingle()
if (!dest?.project_id) return null
let projRes =await db
.from('projects')
.select('id, name, website_url, primary_language, store_platform')
.eq('id',dest.project_id)
.maybeSingle()
if (projRes.error) {
projRes =await db
.from('projects')
.select('id, name, website_url, primary_language')
.eq('id',dest.project_id)
.maybeSingle()
}
const project =projRes.data
if (!project) return null
const stamped =(project as {store_platform?: string | null }).store_platform
if (!stamped) {
const {error: stampErr } =await db
.from('projects')
.update({store_platform: 'shopify',updated_at: new Date().toISOString() })
.eq('id',project.id)
if (stampErr) console.error('[connector-api] store_platform stamp skipped',stampErr.message)
}
return {
destId: dest.id as string,
projectId: project.id as string,
projectName: String(project.name || shop),
websiteUrl: String(project.website_url || `https://${shop}`),
metadata: (dest.metadata ?? {}) as Record<string,any>,
language: String(project.primary_language || 'en'),
}
}
export async function visibilityReport(db: Db,projectId: string,websiteUrl: string) {
const since =new Date(Date.now() - 90 * 864e5).toISOString()
const {data: qs } =await db
.from('visibility_queries')
.select('id, text, intent_type, is_active')
.eq('project_id',projectId)
.order('created_at',{ascending: false })
.limit(80)
const queries =(qs ?? []).map((q: {id: string;text: string;intent_type: string;is_active: boolean }) => ({
id: q.id,
phrase: q.text,
intent: q.intent_type,
is_active: q.is_active,
}))
const queryIds =queries.map((q: {id: string }) => q.id)
if (!queryIds.length) {
return {
overallShareOfVoice: 0,
yourMentions: 0,
competitorMentions: 0,
yourRecommended: 0,
perEngine: [] as Array<Record<string,unknown>>,
competitors: [] as Array<Record<string,unknown>>,
queries,
mentions: [] as Array<Record<string,unknown>>,
citations: [] as Array<{source_url: string | null;source_domain: string | null }>,
window_days: 90,
website_url: websiteUrl,
}
}
const {data: runs } =await db
.from('visibility_query_runs')
.select('id, query_id, provider, run_at')
.in('query_id',queryIds)
.gte('run_at',since)
const runList =runs ?? []
const runIds =runList.map((r: {id: string }) => r.id)
const runProvider =new Map(runList.map((r: {id: string;provider: string }) => [r.id,r.provider]))
const runQuery =new Map(runList.map((r: {id: string;query_id: string }) => [r.id,r.query_id]))
const phraseById =new Map(queries.map((q: {id: string;phrase: string }) => [q.id,q.phrase]))
const {data: mentionRows } =runIds.length
? await db
.from('visibility_brand_mentions')
.select('query_run_id, tracked_brand_id, competitor_brand_id, brand_name, is_recommended')
.in('query_run_id',runIds)
: {data: [] as never[] }
const {data: brands } =await db.from('competitor_brands').select('id, name').eq('project_id',projectId)
const nameById =new Map((brands ?? []).map((b: {id: string;name: string }) => [b.id,b.name]))
const per: Record<string,{you: number;comp: number;rec: number }> ={}
const competitorTally: Record<string,{mentions: number;recommended: number }> ={}
const mentionsOut: Array<Record<string,unknown>> =[]
for (const m of mentionRows ?? []) {
const eng =String(runProvider.get(m.query_run_id) ?? 'unknown')
per[eng] ??={you: 0,comp: 0,rec: 0 }
const qid =runQuery.get(m.query_run_id) as string | undefined
const phrase =qid ? phraseById.get(qid) : ''
if (m.tracked_brand_id) {
per[eng].you++
if (m.is_recommended) per[eng].rec++
} else if (m.competitor_brand_id) {
per[eng].comp++
const name =nameById.get(m.competitor_brand_id) || m.brand_name || 'unknown'
competitorTally[name] ??={mentions: 0,recommended: 0 }
competitorTally[name].mentions++
if (m.is_recommended) competitorTally[name].recommended++
}
mentionsOut.push({
engine: eng,
phrase,
brand: m.brand_name,
yours: Boolean(m.tracked_brand_id),
recommended: Boolean(m.is_recommended),
})
}
const perEngine =Object.entries(per).map(([engine,v]) => ({
engine,
yourMentions: v.you,
competitorMentions: v.comp,
yourRecommended: v.rec,
shareOfVoice: v.you + v.comp > 0 ? Math.round((v.you / (v.you + v.comp)) * 1000) / 10 : 0,
}))
const you =perEngine.reduce((a,e) => a + e.yourMentions,0)
const comp =perEngine.reduce((a,e) => a + e.competitorMentions,0)
const {data: cites } =runIds.length
? await db.from('visibility_citations').select('source_url, source_domain, rank_in_answer').in('query_run_id',runIds).limit(200)
: {data: [] as never[] }
return {
overallShareOfVoice: you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : 0,
yourMentions: you,
competitorMentions: comp,
yourRecommended: perEngine.reduce((a,e) => a + e.yourRecommended,0),
perEngine,
competitors: Object.entries(competitorTally)
.map(([name,v]) => ({name,...v }))
.sort((a,b) => b.mentions - a.mentions),
queries,
mentions: mentionsOut.slice(0,80),
citations: cites ?? [],
window_days: 90,
website_url: websiteUrl,
}
}
async function ensureVisibilityQueries(
db: Db,
ctx: {projectId: string;projectName: string },
) {
const {count } =await db
.from('visibility_queries')
.select('id',{count: 'exact',head: true })
.eq('project_id',ctx.projectId)
if ((count ?? 0) >=8) return 0
const seeds =[
`${ctx.projectName} reviews`,
`is ${ctx.projectName} worth it`,
`best ${ctx.projectName} alternative`,
`where to buy ${ctx.projectName}`,
`who should buy from ${ctx.projectName}`,
`recommended store for this product`,
]
let inserted =0
for (const phrase of seeds) {
const {error } =await db.from('visibility_queries').insert({
project_id: ctx.projectId,
text: phrase,
language: 'en',
intent_type: phrase.toLowerCase().includes(ctx.projectName.toLowerCase()) ? 'brand' : 'category',
is_auto_generated: true,
is_active: true,
})
if (!error) inserted++
}
return inserted
}
async function ranksReport(db: Db,projectId: string) {
const {data: kws } =await db
.from('serp_rank_keywords')
.select('id, phrase, is_active, created_at')
.eq('project_id',projectId)
.order('created_at',{ascending: false })
.limit(50)
const keywords =kws ?? []
const ids =keywords.map((k: {id: string }) => k.id)
const latest: Record<string,{rank_absolute: number | null;ranking_url: string | null;checked_at: string }> ={}
if (ids.length) {
const {data: snaps } =await db
.from('serp_rank_snapshots')
.select('keyword_id, rank_absolute, ranking_url, checked_at')
.in('keyword_id',ids)
.order('checked_at',{ascending: false })
.limit(200)
for (const s of snaps ?? []) {
if (!latest[s.keyword_id as string]) {
latest[s.keyword_id as string] ={
rank_absolute: s.rank_absolute ?? null,
ranking_url: s.ranking_url ?? null,
checked_at: s.checked_at,
}
}
}
}
return {
keywords: keywords.map((k: {id: string;phrase: string;is_active: boolean }) => ({
...k,
latest: latest[k.id] ?? null,
})),
}
}
async function runOneSerp(
db: Db,
userId: string,
ctx: {projectId: string;websiteUrl: string },
keywordId: string,
phrase: string,
) {
const login =Deno.env.get('DATAFORSEO_LOGIN')
const pass =Deno.env.get('DATAFORSEO_PASSWORD')
if (!login || !pass) {
return {keywordId,phrase,skipped: true,reason: 'DataForSEO not configured' }
}
// Paid call: reserve against the account cap first (same guardrail as seo-proxy), finalize with
// the reported cost on success, release on any failure / throw.
const check =await reserveAccountSpend(db as unknown as Sb,userId,DATAFORSEO_PRECHECK_CENTS,'connector_api_dataforseo',{keyword_id: keywordId })
if (!check.allowed) return {keywordId,phrase,skipped: true,reason: check.reason ?? ACCOUNT_BUDGET_ERROR_CODE,budget: check }
const cred =btoa(`${login}:${pass}`)
let sjson: unknown ={}
try {
const sres =await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced',{
method: 'POST',
headers: {Authorization: `Basic ${cred}`,'Content-Type': 'application/json' },
body: JSON.stringify([
{keyword: phrase,location_code: 2840,language_code: 'en',depth: 20,device: 'desktop',os: 'windows' },
]),
})
sjson =await sres.json().catch(() => ({}))
if (sres.ok) {
const cents =dataForSeoCostCentsFromResponse(sjson)
await finalizeAccountSpend(db as unknown as Sb,check.eventId,cents,cents / 100,{keyword_id: keywordId })
} else {
await releaseAccountSpend(db as unknown as Sb,check.eventId)
}
} catch (e) {
await releaseAccountSpend(db as unknown as Sb,check.eventId)
throw e
}
const st0 =(sjson as {tasks?: Array<Record<string,unknown>> }).tasks?.[0]
const ok =st0?.status_code ===20000
let position: number | null =null
let rankingUrl: string | null =null
if (ok && st0) {
const items =((st0.result as Array<Record<string,unknown>> | undefined)?.[0]?.items as Array<Record<string,unknown>>) || []
const siteHost =(() => {
try {
return new URL(ctx.websiteUrl).hostname.replace(/^www\./,'')
} catch {
return ''
}
})()
for (const it of items) {
if (it.type !=='organic') continue
const url =String(it.url || '')
if (siteHost && url.includes(siteHost)) {
position =typeof it.rank_absolute ==='number' ? it.rank_absolute : null
rankingUrl =url
break
}
}
}
await db.from('serp_rank_snapshots').insert({
keyword_id: keywordId,
rank_absolute: position,
ranking_url: rankingUrl,
status: ok ? 'completed' : 'failed',
error_message: ok ? null : String(st0?.status_message || 'serp_failed').slice(0,500),
})
return {keywordId,phrase,position,rankingUrl }
}
function slugify(input: string) {
return input
.toLowerCase()
.replace(/[^a-z0-9]+/g,'-')
.replace(/^-|-$/g,'')
.slice(0,80) || 'article'
}
/**
 * Model output that is not the requested JSON (or was truncated). It is never queued for
 * publishing: generate stores it as a draft marked needs_review, refresh leaves the live article
 * untouched and flags the failed refresh.
 */
export type ArticleNeedsReview ={needsReview: true;reason: string;title: string;rawText: string }
export type WrittenArticle =
| {title: string;html: string }
| {error: string;budget?: BudgetCheck }
| ArticleNeedsReview
export async function writeArticleHtml(opts: {
keyword: string
brand: string
websiteUrl: string
moneyUrl: string
/** Project primary_language (ISO code); the article is written in it. Defaults to English. */
language?: string | null
db: Db
userId: string
}): Promise<WrittenArticle> {
const openrouterKey =Deno.env.get('OPENROUTER_API_KEY')
const openaiKey =Deno.env.get('OPENAI_API_KEY')
const key =openrouterKey || openaiKey
if (!key) return {error: 'llm_not_configured' }
const endpoint =openrouterKey
? 'https://openrouter.ai/api/v1/chat/completions'
: 'https://api.openai.com/v1/chat/completions'
const model =openrouterKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'
const maxTokens =2048
const money =opts.moneyUrl ? `Link the money page ${opts.moneyUrl} once in context.` : ''
const language =articleLanguageName(opts.language)
// Paid LLM call: reserve against the account cap (same guardrail as seo-proxy), finalize with the
// provider's usage on success, release on non-OK / throw. Refusal surfaces as `budget` → 402.
const admin =opts.db as unknown as Sb
const check =await reserveAccountSpend(admin,opts.userId,estimateLlmCostCents({model,max_tokens: maxTokens }),'connector_api_llm',{model,keyword: opts.keyword })
if (!check.allowed) return {error: check.reason ?? ACCOUNT_BUDGET_ERROR_CODE,budget: check }
let data: unknown ={}
try {
const res =await fetch(endpoint,{
method: 'POST',
headers: {
Authorization: `Bearer ${key}`,
'Content-Type': 'application/json',
},
body: JSON.stringify({
model,
temperature: 0.4,
max_tokens: maxTokens,
messages: [
{
role: 'system',
content:
'You write citation-grade ecommerce HTML for Google SEO and AI citation (GEO). Google AI Overviews use the same index and spam policies as Search; there is no special schema required. Do not produce thin, unattributed, or fake-FAQ filler (FAQ rich results were deprecated 7 May 2026). HTML only: h2, h3, p, ul, ol, table. No markdown, no script, no JSON-LD. First paragraph: 40-60 words that directly answer the keyword as a standalone claim, using the brand name in full (never "we" or "our store"). Each h2 is a buyer question or subtopic; the first sentence under it is a direct standalone answer. Keep sections self-contained (~120-180 words) so a model can cite one passage. Prefer a list or small comparison table when it helps extraction. One contextual link to the money URL if provided. Never invent prices, stock, certifications, reviews, medical claims, or statistics. No keyword stuffing. Return JSON {"title","html"} only.',
},
{
role: 'user',
content: `Brand: ${opts.brand}\nSite: ${opts.websiteUrl}\nKeyword: ${opts.keyword}\nLanguage: ${language}\n${money}\nWrite in ${language}: the title and all of the copy must be in ${language}.\nWrite ~800 words of extractable, fact-first copy a merchant could stand behind.`,
},
],
}),
})
data =await res.json().catch(() => ({}))
if (res.ok) {
const cents =llmCostCentsFromResponse(data,{model,max_tokens: maxTokens })
await finalizeAccountSpend(admin,check.eventId,cents,cents / 100,{model })
} else {
await releaseAccountSpend(admin,check.eventId)
}
} catch (e) {
await releaseAccountSpend(admin,check.eventId)
throw e
}
const choice =(data as {choices?: Array<{message?: {content?: string };finish_reason?: string | null }> }).choices?.[0]
const text =String(choice?.message?.content || '')
const parsed =parseArticleCompletion(text,opts.keyword,choice?.finish_reason ?? null)
if (parsed.kind ==='ok') return {title: parsed.title,html: parsed.html }
if (parsed.kind ==='empty') return {error: 'llm_empty' }
// Raw / truncated model text used to be wrapped in <h2> and queued as ready_to_publish, so a
// plugin could publish it live. It now comes back as needs_review and is never queued.
return {needsReview: true,reason: parsed.reason,title: opts.keyword.slice(0,180),rawText: text }
}
/** 422 for model output held for review: nothing was queued for publishing. */
export function articleNeedsReviewJson(
json: JsonFn,
written: ArticleNeedsReview,
extra: Record<string,unknown> ={},
): Response {
return json({
error: 'article_needs_review',
reason: written.reason,
message: 'The model returned an unusable article, so nothing was queued for publishing. Review it in the app or try again.',
...extra,
},422)
}
/**
 * Store unusable model output as a draft with status needs_review (escaped, never
 * ready_to_publish), so the paid generation is not lost and can be reviewed in the app.
 * Returns null when the insert fails (the caller still answers 422).
 */
export async function insertNeedsReviewDraft(
db: Db,
opts: {
projectId: string
destId: string
keyword: string
moneyUrl: string
source: string
written: ArticleNeedsReview
},
): Promise<{id: string;title: string;slug: string } | null> {
const {data,error } =await db
.from('content')
.insert({
project_id: opts.projectId,
destination_id: opts.destId,
title: opts.written.title,
slug: slugify(opts.keyword),
body: reviewDraftBody(opts.written.rawText),
topic: opts.keyword,
keywords_used: [opts.keyword],
status: 'needs_review',
publish_state: 'draft',
metadata: {
source: opts.source,
focusKeyword: opts.keyword,
moneyUrl: opts.moneyUrl || null,
needs_review: true,
review_reason: opts.written.reason,
},
})
.select('id, title, slug')
.single()
if (error || !data) {
console.error('[connector-api] needs_review draft insert failed',error?.message ?? 'no row')
return null
}
return data as {id: string;title: string;slug: string }
}
