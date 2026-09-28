/**
 * Edge proxy client — routes CORS-blocked / credential-bearing API calls through the
 * `seo-proxy` Supabase Edge Function instead of calling the third-party API from the browser.
 * Keeps the DataForSEO / LLM credentials server-side (as Edge secrets), never in the client.
 *
 * Auth: calls go through `supabase.functions.invoke`, the same SDK path the working `visibility-ops`
 * feature uses. It attaches the current user's session JWT (Authorization) + the project apikey the
 * way the gateway accepts — a raw fetch with hand-built headers hit `UNAUTHORIZED_LEGACY_JWT` because
 * the legacy anon key is rejected. Opt-in via VITE_USE_SUPABASE_PROXY=true.
 */

import { supabase } from '../lib/supabaseClient'

const ENABLED = import.meta.env['VITE_USE_SUPABASE_PROXY'] === 'true'

/** Machine code the seo-proxy returns (HTTP 402) when the account hit its monthly API budget. */
export const ACCOUNT_BUDGET_ERROR_CODE = 'account_monthly_cap_reached'
export const RESEARCH_QUOTA_ERROR_CODE = 'research_quota_reached'
export const PLAN_REQUIRED_ERROR_CODE = 'plan_required'

interface ProxyErrorBody {
  error?: string
  code?: string
  used?: number
  cap?: number
  spent_cents?: number
  cap_cents?: number
}

/** Thrown when a proxied paid call is refused because the account is over its monthly spend cap. */
export class AccountBudgetError extends Error {
  readonly code = ACCOUNT_BUDGET_ERROR_CODE
  readonly spentCents?: number
  readonly capCents?: number
  constructor(message = 'Monthly API usage limit reached', spentCents?: number, capCents?: number) {
    super(message)
    this.name = 'AccountBudgetError'
    this.spentCents = spentCents
    this.capCents = capCents
  }
}

/** Thrown when the plan's monthly research-lookup quota is exhausted. */
export class ResearchQuotaError extends Error {
  readonly code = RESEARCH_QUOTA_ERROR_CODE
  readonly used: number
  readonly cap: number
  constructor(message: string, used: number, cap: number) {
    super(message)
    this.name = 'ResearchQuotaError'
    this.used = used
    this.cap = cap
  }
}

/** Thrown when the account has no paid plan. */
export class PlanRequiredError extends Error {
  readonly code = PLAN_REQUIRED_ERROR_CODE
  constructor(message = 'Paid plan required') {
    super(message)
    this.name = 'PlanRequiredError'
  }
}

export type ProxyQuotaError = AccountBudgetError | ResearchQuotaError | PlanRequiredError

function throwFrom402Body(bodyText: string): never {
  let msg = 'Request blocked — usage limit reached'
  let body: ProxyErrorBody = {}
  try {
    body = JSON.parse(bodyText) as ProxyErrorBody
    if (body?.error) msg = body.error
  } catch { /* keep default */ }

  const code = body.code
  if (code === RESEARCH_QUOTA_ERROR_CODE) {
    throw new ResearchQuotaError(
      msg,
      Number(body.used) || 0,
      Number(body.cap) || 0,
    )
  }
  if (code === PLAN_REQUIRED_ERROR_CODE) {
    throw new PlanRequiredError(msg)
  }
  throw new AccountBudgetError(msg, Number(body.spent_cents), Number(body.cap_cents))
}

/**
 * Setup errors the proxy returns on purpose when a provider key is missing ("… not configured: set
 * DATAFORSEO_LOGIN …"). They are written by us, safe to show, and tell a self-hoster what to do, so
 * they reach the UI even in production builds (other upstream bodies stay hidden).
 */
export function setupErrorFromBody(bodyText: string): string | null {
  try {
    const error = (JSON.parse(bodyText) as ProxyErrorBody)?.error
    return typeof error === 'string' && /configured: set [A-Z_]+/.test(error) ? error : null
  } catch {
    return null
  }
}

export function isProxyEnabled(): boolean {
  return ENABLED
}

/** Invoke the seo-proxy via the Supabase SDK (correct auth) with a Promise.race timeout. */
async function invokeProxy(body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined

  const invoke = supabase.functions.invoke('seo-proxy', headers ? { body, headers } : { body })
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`seo-proxy timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs),
  )

  const { data, error } = (await Promise.race([invoke, timeout])) as Awaited<typeof invoke>
  if (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const ctx = (error as { context?: Response }).context
    let bodyText = ''
    let status: number | undefined
    if (ctx && typeof ctx.text === 'function') {
      status = ctx.status
      try { bodyText = (await ctx.clone().text()).slice(0, 500) } catch { /* ignore */ }
      if (ctx.status === 402 && bodyText) {
        throwFrom402Body(bodyText)
      }
      const setupError = setupErrorFromBody(bodyText)
      if (setupError) throw new Error(setupError)
    }
    // Components render `e.message` raw, so the upstream body (which may echo internals) only goes
    // into the message in DEV. Production gets a short, stable message; the body is attached as a
    // non-enumerable `details` for debugging (not serialized / not shown).
    const prefix = status != null ? `seo-proxy error (${status})` : 'seo-proxy error'
    const err = new Error(
      import.meta.env.DEV
        ? `${prefix} — ${bodyText ? `${detail}: ${bodyText}` : detail}`
        : prefix,
    )
    Object.defineProperty(err, 'details', { value: bodyText || detail, enumerable: false })
    throw err
  }
  return data
}

/** Proxy a DataForSEO v3 call server-side. Returns the raw `{ tasks: [...] }` body. */
export async function proxyDataForSEO(endpoint: string, payload: unknown): Promise<unknown> {
  return invokeProxy({ action: 'dataforseo', endpoint, payload }, 60_000)
}

/** OpenAI-style chat-completions response (OpenRouter/OpenAI/Perplexity all share this shape). */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * Proxy an LLM chat-completion server-side. The Edge Function picks the provider from its own
 * secrets (OpenRouter → OpenAI fallback, or direct Perplexity for `perplexity/*` models), so no
 * LLM key ever reaches the browser. Returns the assistant message content.
 */
export async function proxyLLM(opts: {
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}): Promise<string> {
  const data = (await invokeProxy(
    { action: 'llm', model: opts.model, messages: opts.messages, temperature: opts.temperature, max_tokens: opts.maxTokens },
    opts.timeoutMs ?? 180_000,
  )) as ChatCompletion
  return data.choices?.[0]?.message?.content ?? ''
}

export async function proxyOpenPageRank(domains: string[]): Promise<unknown> {
  return invokeProxy({ action: 'openpagerank', domains }, 20_000)
}

/** Fetch a public URL server-side, keeping the HTTP outcome (callers that must know the page exists). */
export async function proxyFetchPage(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const data = (await invokeProxy({ action: 'fetch', url }, 30_000)) as { ok?: boolean; status?: number; body?: string }
  return { ok: data?.ok === true, status: typeof data?.status === 'number' ? data.status : 0, body: data?.body ?? '' }
}

export async function proxyFetchText(url: string): Promise<string> {
  return (await proxyFetchPage(url)).body
}

export interface StockPhoto {
  url: string
  photographer: string
  photographerUrl: string
  alt: string
}

export async function proxyStockImage(opts: {
  provider: 'pexels' | 'unsplash'
  query: string
  count?: number
}): Promise<StockPhoto[]> {
  if (!ENABLED) return []
  const data = (await invokeProxy(
    { action: 'stock-image', provider: opts.provider, query: opts.query, count: opts.count ?? 1 },
    20_000,
  )) as { photos?: StockPhoto[] }
  return Array.isArray(data?.photos) ? data.photos.filter((p) => p?.url) : []
}

export async function proxyKeywordMetricsUpsert(rows: Array<{
  keyword: string
  location_code: number
  language_code: string
  volume: number
  difficulty: number | null
  fetched_at: string
}>): Promise<void> {
  if (!ENABLED || rows.length === 0) return
  await invokeProxy({ action: 'keyword-metrics-upsert', rows }, 20_000)
}
