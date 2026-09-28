// deno-lint-ignore-file no-explicit-any
/**
 * seo-proxy — server-side proxy for the APIs that can't be called from the browser.
 *
 * Why: DataForSEO (and arbitrary sitemap URLs) don't send CORS headers, so direct
 * browser calls fail. This Edge Function runs server-side: no CORS limits, and the
 * DataForSEO credentials stay on the server (never shipped to the client).
 *
 * Deploy:  supabase functions deploy seo-proxy
 * Secrets (set once in the Supabase dashboard → Edge Functions → Secrets):
 *   DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD   (SERP + keyword data)
 *   OPENROUTER_API_KEY                       (LLM — preferred; powers Kimi/Claude/GPT + Perplexity sonar)
 *   OPENAI_API_KEY                           (LLM fallback when no OpenRouter key)
 *   PERPLEXITY_API_KEY                       (optional — direct Perplexity fallback)
 *   PEXELS_API_KEY / UNSPLASH_ACCESS_KEY     (optional — stock images; never VITE_)
 * Keeping these server-side is what lets the client bundle ship WITHOUT any LLM/SEO keys.
 *
 * Request body:
 *   { "action": "dataforseo", "endpoint": "/serp/google/organic/live/advanced", "payload": {...} }
 *   { "action": "fetch", "url": "https://example.com/sitemap.xml" }
 *   { "action": "llm", "model": "moonshotai/kimi-k2", "messages": [...], "temperature": 0.7, "max_tokens": 8192 }
 */

import {
  adminClient,
  budgetBlockedResponse,
  DATAFORSEO_PRECHECK_CENTS,
  dataForSeoCostCentsFromResponse,
  estimateLlmCostCents,
  finalizeAccountSpend,
  llmCostCentsFromResponse,
  releaseAccountSpend,
  reserveAccountSpend,
} from '../_shared/accountBudget.ts'
import { assertPayingPlan, planRequiredResponse, resolveCaller, resolveInternalReportCaller, isInternalAccount } from '../_shared/apiKeys.ts'
import { extractReferringDomainRows } from '../_shared/linkIntersect.ts'
import { isAllowedDataForSeoEndpoint } from '../_shared/dataForSeoEndpoints.ts'
import { extractKeywordMetricRows } from '../_shared/keywordMetricsCache.ts'
import { getClientIp, ipRateLimitBucket } from '../_shared/clientIp.ts'
import { assertSafeOutboundUrl, cachedLookup, resolveSafeRedirectTarget } from '../_shared/ssrf.ts'
import { secretKey } from '../_shared/supabaseKeys.ts'
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts'

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const OPENAI_BASE = 'https://api.openai.com/v1'
const PERPLEXITY_BASE = 'https://api.perplexity.ai'

/**
 * DataForSEO endpoint allowlist — the /v3 families the app (src/services/*), the hosted MCP and
 * visibility-ops actually call. Anything else (e.g. task-post endpoints, merchant/app_data/
 * content_generation, or path tricks like `..`) is rejected with 400 so a leaked session/API key
 * cannot drive arbitrary paid DataForSEO endpoints through our credentials.
 */

/**
 * LLM model allowlist — the ids src/services/openrouter.ts (pricing map) / openai.ts, the MCP
 * generate_article tool and the Perplexity client send. Unknown ids are rejected with 400: the
 * pre-call spend estimate (accountBudget.llmRatePerMTokens) only knows these families, so an
 * arbitrary model could be far more expensive than what gets reserved against the cap.
 */
const ALLOWED_LLM_MODELS = new Set([
  'moonshotai/kimi-k2',
  'moonshotai/kimi-k2:free',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'perplexity/sonar',
  'perplexity/sonar-pro',
])

/** Map our OpenRouter model ids to OpenAI equivalents (mirrors the client, for the OpenAI fallback). */
function mapModelToOpenAI(model: string): string {
  switch (model) {
    case 'anthropic/claude-sonnet-4-6':
    case 'moonshotai/kimi-k2':
    case 'moonshotai/kimi-k2:free':
      return 'gpt-4o'
    default:
      return 'gpt-4o-mini'
  }
}

/** Allowed browser origins (defense-in-depth, audit #60 LOW-1). Bearer-token auth means
 * '*' was never directly exploitable, but pinning stops any other origin from driving
 * authenticated calls if a token ever leaks. Set ALLOWED_ORIGINS as a comma-separated
 * Edge secret to override; falls back to the known first-party frontends. */
const allowedOrigins = allowedBrowserOrigins(['https://astroseo.ai', 'https://www.astroseo.ai'])

/** Echo the Origin back only when it is allowlisted; omit the header entirely otherwise. */
function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  const origin = req.headers.get('origin')
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Vary'] = 'Origin'
  }
  return headers
}

function json(body: unknown, status = 200, cors?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(cors ?? {}), 'Content-Type': 'application/json' },
  })
}

// ── Input hardening ──────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 2_000_000        // reject oversized request payloads (413)
const MAX_FETCH_BYTES = 5_000_000       // cap proxied response size

const MAX_LLM_TOKENS = 8192

function clampLlmMaxTokens(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 4096
  return Math.min(MAX_LLM_TOKENS, Math.max(1, Math.round(n)))
}

// Best-effort in-memory rate limit (per warm instance, per client IP). Robust cross-instance
// limiting would need a shared store (Upstash/Postgres); this still blunts a single-source flood.
const RL_MAX = 60, RL_WINDOW_MS = 60_000
const rlHits = new Map<string, number[]>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (rlHits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS)
  recent.push(now)
  rlHits.set(key, recent)
  return recent.length > RL_MAX
}

// Authentication note: this function is deployed with verify_jwt=false because the Supabase gateway
// now rejects the project's legacy anon key (UNAUTHORIZED_LEGACY_JWT), which broke every call. We
// authenticate IN-FUNCTION via resolveCaller(): personal API keys (sk_astroseo_… from MCP / Settings)
// resolve to that key's user_id; browser sessions still go through getUser() JWT verification.
// Spend/quota is keyed on the resolved user id, so a key cannot spend against another account.
// Missing / revoked / invalid tokens → null → 401, so the proxy never becomes an open relay.

// ── Per-plan research-lookup quota ────────────────────────────────────────────
// Each 'dataforseo' call from the research tools (Site Explorer / Keyword Research / Bulk) counts
// as one lookup against the caller's plan quota (migration 019). Fail-CLOSED on infra errors:
// missing URL/key, HTTP failures, or thrown fetches → 503 (not unlimited). Missing subscription
// → cap 0. NULL research_lookups_monthly (agency) or SELF_HOST / internal → unlimited (null).
const SELF_HOST = (Deno.env.get('SELF_HOST') ?? '').toLowerCase() === 'true'
const _capCache = new Map<string, { cap: number | null; ts: number }>()
const CAP_TTL_MS = 5 * 60_000

type LookupCap = number | null | 'unavailable'

async function researchLookupCap(userId: string): Promise<LookupCap> {
  if (SELF_HOST) return null
  if (await isInternalAccount(userId)) return null
  const hit = _capCache.get(userId)
  if (hit && Date.now() - hit.ts < CAP_TTL_MS) return hit.cap
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = secretKey()
    if (!url || !key) return 'unavailable'
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    const subRes = await fetch(`${url}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan&limit=1`, { headers })
    if (!subRes.ok) return 'unavailable'
    const sub = (await subRes.json().catch(() => []))?.[0]
    if (!sub?.plan) {
      _capCache.set(userId, { cap: 0, ts: Date.now() })
      return 0
    }
    const planRes = await fetch(`${url}/rest/v1/plan_configurations?plan=eq.${sub.plan}&select=research_lookups_monthly&limit=1`, { headers })
    if (!planRes.ok) return 'unavailable'
    const row = (await planRes.json().catch(() => []))?.[0]
    if (!row) return 'unavailable'
    const cap = typeof row.research_lookups_monthly === 'number' ? row.research_lookups_monthly : null
    _capCache.set(userId, { cap, ts: Date.now() })
    return cap
  } catch {
    return 'unavailable'
  }
}

/** Enforce the plan's monthly research-lookup quota. Returns a 402/503 Response when blocked. */
async function enforceLookupQuota(userId: string, cors: Record<string, string>): Promise<Response | null> {
  const cap = await researchLookupCap(userId)
  if (cap === 'unavailable') {
    return json({ error: 'Research quota unavailable', code: 'quota_unavailable' }, 503, cors)
  }
  if (cap === 0) {
    return json({ error: 'Monthly research quota reached — upgrade your plan for more lookups.', code: 'research_quota_reached', used: 0, cap: 0 }, 402, cors)
  }
  if (cap == null) return null
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const key = secretKey()
    const res = await fetch(`${url}/rest/v1/rpc/check_and_record_research_lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_user_id: userId, p_cap: cap }),
    })
    if (!res.ok) {
      return json({ error: 'Research quota unavailable', code: 'quota_unavailable' }, 503, cors)
    }
    const out = await res.json().catch(() => null)
    if (out && out.allowed === false) {
      return json({ error: 'Monthly research quota reached — upgrade your plan for more lookups.', code: 'research_quota_reached', used: out.used, cap: out.cap }, 402, cors)
    }
  } catch {
    return json({ error: 'Research quota unavailable', code: 'quota_unavailable' }, 503, cors)
  }
  return null
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors)

  // verify_jwt is disabled at the gateway (legacy anon key rejected); authenticate here instead.
  // MCP forwards Authorization: Bearer sk_astroseo_… — JWT-only getUser() would 401 those calls.
  const caller = (await resolveCaller(req)) ?? resolveInternalReportCaller(req)
  if (!caller) return json({ error: 'unauthorized' }, 401, cors)
  const userId = caller.userId
  // Entitlement is per resolved user_id (any paying customer). Not a single-account allowlist.
  if (!(await assertPayingPlan(userId))) return planRequiredResponse(cors)
  const admin = adminClient()

  const clientIp = getClientIp(req)
  if (rateLimited(ipRateLimitBucket(clientIp))) return json({ error: 'Rate limit exceeded' }, 429, cors)

  // Read with a hard size cap so a giant payload can't be forced through.
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return json({ error: 'Invalid body' }, 400, cors)
  }
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413, cors)
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, cors)
  }
  if (typeof body !== 'object' || body === null || typeof body.action !== 'string') {
    return json({ error: 'Malformed request' }, 400, cors)
  }

  try {
    if (body.action === 'dataforseo') {
      const login = Deno.env.get('DATAFORSEO_LOGIN')
      const password = Deno.env.get('DATAFORSEO_PASSWORD')
      if (!login || !password) {
        return json({ error: 'DataForSEO keys not configured: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD as edge-function secrets (see SELF_HOSTING.md).' }, 500, cors)
      }
      if (typeof body.endpoint !== 'string') return json({ error: 'Missing endpoint' }, 400, cors)
      if (!isAllowedDataForSeoEndpoint(body.endpoint)) {
        // Visible in logs: a legitimate feature calling an endpoint missing from the allowlist.
        console.warn('seo-proxy: DataForSEO endpoint not allowed', body.endpoint.slice(0, 120))
        return json({ error: 'Endpoint not allowed' }, 400, cors)
      }

      // ETV: opt into DataForSEO's improved Estimated Traffic Volume formula (layout-aware CTR +
      // clickstream-normalized volume) on the Labs endpoints that return ETV. It becomes the API
      // default on 2026-11-01 and costs nothing extra (same endpoint, same rows) — injecting it
      // server-side keeps our "Est. traffic/mo" and "Traffic value" numbers GSC-aligned and
      // consistent across every caller (app + MCP), and avoids a silent step-change in November.
      if (/dataforseo_labs\/.*(ranked_keywords|domain_rank_overview|relevant_pages)/.test(body.endpoint)) {
        body.payload = { ...(body.payload && typeof body.payload === 'object' ? body.payload : {}), use_improved_etv: true }
      }

      // Plan quota gate: each research-tool call counts as one lookup against the plan's monthly cap.
      const quota = await enforceLookupQuota(userId, cors)
      if (quota) return quota

      // Atomic spend reserve — increment-and-check in one DB op (no read-then-write TOCTOU).
      const check = await reserveAccountSpend(admin, userId, DATAFORSEO_PRECHECK_CENTS, 'seo_proxy_dataforseo', { endpoint: body.endpoint })
      if (!check.allowed) return budgetBlockedResponse(check, cors)

      const auth = btoa(`${login}:${password}`)
      // A THROWN fetch (DNS failure, timeout, reset) must release the reservation too — otherwise
      // the estimate stays counted against the cap even though nothing was spent.
      try {
        const res = await fetch(`${DATAFORSEO_BASE}${body.endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify([body.payload ?? {}]),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const costCents = dataForSeoCostCentsFromResponse(data)
          await finalizeAccountSpend(admin, check.eventId, costCents, costCents / 100, { endpoint: body.endpoint })
          persistReferringDomains(admin, body.endpoint, body.payload, data)
          persistKeywordMetrics(admin, body.endpoint, body.payload, data)
        } else {
          await releaseAccountSpend(admin, check.eventId)
        }
        return json(data, res.ok ? 200 : res.status, cors)
      } catch (e) {
        await releaseAccountSpend(admin, check.eventId)
        throw e
      }
    }

    if (body.action === 'fetch') {
      if (typeof body.url !== 'string') return json({ error: 'Invalid url' }, 400, cors)
      const lookup = cachedLookup()
      const target = await assertSafeOutboundUrl(body.url, { lookup })
      if (!target) return json({ error: 'URL not allowed' }, 403, cors)
      // Follow redirects MANUALLY, re-validating every hop (hostname + DNS) — otherwise a public
      // URL could 302 to a private/link-local address (e.g. 169.254.169.254) and bypass the guard.
      let url = target
      let res: Response
      for (let hop = 0; ; hop++) {
        // Browser UA — many WAFs 403 obvious bot UAs, which silently breaks sitemap/page fetches.
        res = await fetch(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' }, redirect: 'manual' })
        if (res.status < 300 || res.status >= 400) break
        const loc = res.headers.get('location')
        if (!loc || hop >= 5) return json({ error: 'Too many redirects' }, 400, cors)
        const next = await resolveSafeRedirectTarget(url, loc, { lookup })
        if (!next) return json({ error: 'URL not allowed' }, 403, cors)
        url = next
      }
      const text = await readTextCapped(res, MAX_FETCH_BYTES)
      return json({ ok: res.ok, status: res.status, body: text }, 200, cors)
    }

    if (body.action === 'llm') {
      const model: string = typeof body.model === 'string' ? body.model : 'moonshotai/kimi-k2'
      if (!ALLOWED_LLM_MODELS.has(model)) return json({ error: 'Model not allowed' }, 400, cors)
      if (!Array.isArray(body.messages)) return json({ error: 'Missing messages' }, 400, cors)
      const payload = {
        messages: body.messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
        max_tokens: clampLlmMaxTokens(body.max_tokens),
      }

      // Atomic spend reserve — increment-and-check in one DB op (no read-then-write TOCTOU).
      const estCents = estimateLlmCostCents({ model, max_tokens: payload.max_tokens, messages: body.messages })
      const check = await reserveAccountSpend(
        admin,
        userId,
        estCents,
        'seo_proxy_llm',
        { model },
      )
      if (!check.allowed) return budgetBlockedResponse(check, cors)

      const openrouter = Deno.env.get('OPENROUTER_API_KEY')
      const openai = Deno.env.get('OPENAI_API_KEY')
      const perplexity = Deno.env.get('PERPLEXITY_API_KEY')
      const isPerplexityModel = model.startsWith('perplexity/')

      let url: string
      let headers: Record<string, string>
      let sendModel = model

      if (isPerplexityModel && !openrouter && perplexity) {
        // Direct Perplexity fallback (only when there's no OpenRouter key).
        url = `${PERPLEXITY_BASE}/chat/completions`
        sendModel = model.replace(/^perplexity\//, '')
        headers = { Authorization: `Bearer ${perplexity}`, 'Content-Type': 'application/json' }
      } else if (openrouter) {
        url = `${OPENROUTER_BASE}/chat/completions`
        headers = {
          Authorization: `Bearer ${openrouter}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://rankdelta.ai',
          'X-Title': 'Rankdelta Agent',
        }
      } else if (openai && !isPerplexityModel) {
        url = `${OPENAI_BASE}/chat/completions`
        sendModel = mapModelToOpenAI(model)
        headers = { Authorization: `Bearer ${openai}`, 'Content-Type': 'application/json' }
      } else {
        await releaseAccountSpend(admin, check.eventId)
        return json({ error: 'No LLM key configured: set OPENROUTER_API_KEY (or OPENAI_API_KEY / PERPLEXITY_API_KEY) as an edge-function secret (see SELF_HOSTING.md).' }, 500, cors)
      }

      // Same as dataforseo: a thrown fetch must release the reservation, not just a non-OK status.
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: sendModel, ...payload }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const costCents = llmCostCentsFromResponse(data, { model, max_tokens: payload.max_tokens })
          await finalizeAccountSpend(admin, check.eventId, costCents, costCents / 100, { model })
        } else {
          await releaseAccountSpend(admin, check.eventId)
        }
        return json(data, res.ok ? 200 : res.status, cors)
      } catch (e) {
        await releaseAccountSpend(admin, check.eventId)
        throw e
      }
    }

    if (body.action === 'keyword-metrics-upsert') {
      // Retired: the browser used to send these rows, so any account could overwrite volume and
      // difficulty for every tenant. The cache is now written from the DataForSEO response itself
      // (persistKeywordMetrics). Kept as a no-op so frontends already deployed do not error.
      return json({ ok: true, upserted: 0 }, 200, cors)
    }

    if (body.action === 'stock-image') {
      const provider = body.provider === 'unsplash' ? 'unsplash' : 'pexels'
      const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : ''
      const count = Math.min(10, Math.max(1, Number(body.count) || 1))
      if (!query) return json({ photos: [] }, 200, cors)

      if (provider === 'pexels') {
        const key = Deno.env.get('PEXELS_API_KEY') ?? ''
        if (!key) return json({ photos: [] }, 200, cors)
        const res = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
          { headers: { Authorization: key } },
        )
        const data = await res.json().catch(() => ({})) as { photos?: Array<{ src?: { large2x?: string; large?: string }; photographer?: string; photographer_url?: string; alt?: string }> }
        const photos = (data.photos ?? []).map((p) => ({
          url: p.src?.large2x || p.src?.large || '',
          photographer: p.photographer ?? '',
          photographerUrl: p.photographer_url ?? '',
          alt: p.alt ?? query,
        })).filter((p) => p.url)
        return json({ photos }, res.ok ? 200 : res.status, cors)
      }

      const key = Deno.env.get('UNSPLASH_ACCESS_KEY') ?? ''
      if (!key) return json({ photos: [] }, 200, cors)
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${key}` } },
      )
      const data = await res.json().catch(() => ({})) as { results?: Array<{ urls?: { regular?: string }; alt_description?: string; description?: string; user?: { name?: string; links?: { html?: string } } }> }
      const photos = (data.results ?? []).map((img) => ({
        url: img.urls?.regular ?? '',
        photographer: img.user?.name ?? '',
        photographerUrl: img.user?.links?.html ? `${img.user.links.html}?utm_source=rankdelta&utm_medium=referral` : '',
        alt: img.alt_description || img.description || query,
      })).filter((p) => p.url)
      return json({ photos }, res.ok ? 200 : res.status, cors)
    }

    if (body.action === 'openpagerank') {
      // Free authority cross-check (Domcop Open PageRank). Key stays server-side; no spend cap
      // charge (the API is free). Graceful: if unconfigured, tell the client so it hides the metric.
      const key = Deno.env.get('OPENPAGERANK_API_KEY')
      if (!key) return json({ error: 'openpagerank_not_configured' }, 200, cors)
      const domains: string[] = Array.isArray(body.domains)
        ? body.domains.filter((d: unknown): d is string => typeof d === 'string').slice(0, 100)
        : []
      if (!domains.length) return json({ error: 'no domains' }, 400, cors)
      const qs = domains.map((d) => `domains[]=${encodeURIComponent(d)}`).join('&')
      const res = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?${qs}`, {
        headers: { 'API-OPR': key },
      })
      const data = await res.json().catch(() => ({}))
      return json(data, res.ok ? 200 : res.status, cors)
    }

    return json({ error: 'Unknown action' }, 400, cors)
  } catch (e) {
    console.error('seo-proxy', e instanceof Error ? e.message : e)
    return json({ error: 'proxy error' }, 502, cors)
  }
})

/**
 * Best-effort persist of referring-domain rows the caller already paid for.
 * Fire-and-forget: failures must never change the live proxy response.
 */
/** Server-side keyword_metrics write from a DataForSEO volume / difficulty response (fire-and-forget). */
function persistKeywordMetrics(
  admin: ReturnType<typeof adminClient>,
  endpoint: string,
  payload: unknown,
  response: unknown,
): void {
  const extracted = extractKeywordMetricRows(endpoint, payload, response)
  if (!extracted) return
  void admin
    .from('keyword_metrics')
    // Each call writes only its own column: volume rows never reset difficulty and vice versa.
    .upsert(extracted.rows, { onConflict: 'keyword,location_code,language_code' })
    .then(({ error }) => {
      if (error) console.error('keyword_metrics persist failed', error.message)
    })
    .catch(() => {
      /* ignore — cache is optional */
    })
}

/** Read at most `max` bytes of a response body (res.text() would buffer all of it first). */
async function readTextCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0
  try {
    while (bytes < max) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.byteLength + bytes > max ? value.subarray(0, max - bytes) : value
      bytes += chunk.byteLength
      out += decoder.decode(chunk, { stream: true })
    }
    out += decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
  }
  return out
}

function persistReferringDomains(
  admin: ReturnType<typeof adminClient>,
  endpoint: string,
  payload: unknown,
  response: unknown,
): void {
  const rows = extractReferringDomainRows(endpoint, payload, response)
  if (!rows.length) return
  const now = new Date().toISOString()
  const upserts = rows.map((r) => ({
    target_domain: r.target_domain,
    referring_domain: r.referring_domain,
    referring_rank: r.referring_rank,
    links_to_target: r.links_to_target,
    sample_target_urls: r.sample_target_urls,
    source_endpoint: endpoint,
    fetched_at: now,
  }))
  void admin
    .from('backlink_referring_domains')
    .upsert(upserts, { onConflict: 'target_domain,referring_domain' })
    .then(({ error }) => {
      if (error && !/relation .* does not exist/i.test(error.message)) {
        console.error('backlink_referring_domains persist failed', error.message)
      }
    })
    .catch(() => {
      /* ignore — cache is optional */
    })
}
