// deno-lint-ignore-file no-explicit-any
// ai-visibility-check — PUBLIC landing widget. Language-aware "does AI cite you?" check:
// fetch homepage → infer brand/category/query in the site's language → ask ChatGPT-class model
// what it recommends → 3-level verdict (recommended / known-but-limited / absent) → email a report
// (Resend, gracefully skipped if unconfigured). Hardened: email-gate, per-IP rate limit
// (widget 5/h; server-to-server integrations 80/h), per (lang+domain) cache (7d), daily API cap,
// SSRF-guarded homepage fetch.
//
//  - Honeypot field ('website' must be EMPTY) and min-form-time (`formStartedAt`) for the widget.
//    Server-to-server integrations use {domain, email, lang} without formStartedAt. Set
//    CHECK_INTEGRATION_SECRET to require authenticated integrations (header
//    x-rankdelta-integration-secret); see request_guard.ts.
//  - No `cached` flag in the public response, so it does not reveal whether a domain was
//    checked recently by someone else.
//  - IPs stored hashed (SHA-256, server-side pepper) instead of raw (data minimization);
//    rate limiting still works since hashing is deterministic. See _shared/ipHash.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classifyRecommended } from './brand_match.ts'
import { buildReport } from './email.ts'
import { INTEGRATION_SECRET_HEADER, guardPublicCheckBots, isTrustedIntegration, shouldBlockOnEmailCap, shouldBlockOnIpCap, wantsResultEmail } from './request_guard.ts'
import { getClientIp } from '../_shared/clientIp.ts'
import { hashClientIp } from '../_shared/ipHash.ts'
import { forcedLanguageInstruction, languageMismatch, normalizeLang, publicCheckCacheKey, requestedCheckLang, wrongLanguageBody } from './language_guard.ts'
import { assertSafeOutboundUrl, assertSafePublicDomain, cachedLookup, isBlockedHostname, resolveSafeRedirectTarget } from '../_shared/ssrf.ts'
import { secretKey } from '../_shared/supabaseKeys.ts'
import { isSelfHostEnv } from '../_shared/appOrigin.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const DAILY_MAX = 1000, CACHE_DAYS = 7
// Abuse cap: limit report emails per address and globally so the public widget cannot spam Resend.
const EMAIL_MAX_PER_RECIPIENT_24H = 3
const GLOBAL_EMAIL_DAILY_MAX = 5000
const EMAIL_WINDOW_MS = 24 * 3600000
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

function normalizeDomain(input: string): string {
  let s = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  return s.split('/')[0].split('?')[0].split('#')[0]
}
function parseJson(s: string): any {
  if (!s) return null
  const t = s.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '')
  try { return JSON.parse(t) } catch { /* */ }
  const m = t.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* */ } }
  return null
}

async function llm(model: string, messages: any[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const orKey = Deno.env.get('OPENROUTER_API_KEY'), oaKey = Deno.env.get('OPENAI_API_KEY')
  const useOR = !!orKey, key = orKey || oaKey
  if (!key) throw new Error('No LLM key')
  const url = useOR ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
  const m = useOR ? model : model.replace(/^openai\//, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 22000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://rankdelta.ai', 'X-Title': 'Rankdelta' },
      body: JSON.stringify({ model: m, messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 600, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`LLM ${res.status}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  } finally { clearTimeout(timer) }
}

async function fetchSite(domain: string): Promise<{ title: string; desc: string; lang: string }> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const lookup = cachedLookup()
    const start = await assertSafeOutboundUrl(`https://${domain}`, { httpsOnly: true, lookup })
    if (!start) { clearTimeout(timer); return { title: '', desc: '', lang: '' } }
    // Follow redirects MANUALLY, re-validating each hop (hostname + DNS). This endpoint is PUBLIC.
    let current = start
    let res: Response
    for (let hop = 0; ; hop++) {
      res = await fetch(current.toString(), { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'Rankdelta-bot/1.0 (+https://rankdelta.ai)' } })
      if (res.status < 300 || res.status >= 400) break
      const loc = res.headers.get('location')
      if (!loc || hop >= 5) { clearTimeout(timer); return { title: '', desc: '', lang: '' } }
      const next = await resolveSafeRedirectTarget(current, loc, { lookup })
      if (!next) { clearTimeout(timer); return { title: '', desc: '', lang: '' } }
      current = next
    }
    clearTimeout(timer)
    if (!res.ok) return { title: '', desc: '', lang: '' }
    const html = (await res.text()).slice(0, 200000)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    const lang = (html.match(/<html[^>]+lang=["']([a-z]{2})/i)?.[1] || '').toLowerCase()
    return { title, desc, lang }
  } catch { return { title: '', desc: '', lang: '' } }
}

/**
 * The brand / category / query come from an LLM reading the SUBMITTED site's own title and meta
 * description, and they end up in a Rankdelta-branded email to any address the caller names.
 * Strip anything that could turn that email into a phishing lure: URLs, emails, phone-like runs,
 * control characters, and over-long text.
 */
function cleanEmailText(raw: unknown, max: number): string {
  let t = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi, ' ')
    .replace(/[<>"'`{}\[\]\\]/g, ' ')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > max) t = t.slice(0, max).trim()
  return t
}

type SendOutcome = { sent: boolean; error: string | null }
/**
 * Emails the visitor their own result. The outcome is logged and stored on the lead row: the
 * free check is the top of the funnel, and a silently unconfigured RESEND_* would mean every
 * captured lead receives nothing.
 */
async function sendReport(email: string, r: any, lang: string): Promise<SendOutcome> {
  const apiKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) {
    console.warn('[ai-visibility-check] result email skipped: RESEND_API_KEY / RESEND_FROM not configured')
    return { sent: false, error: 'unconfigured' }
  }
  try {
    const { subject, html } = buildReport(lang, r)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject, html }),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.error('[ai-visibility-check] result email failed', res.status, detail)
      return { sent: false, error: `resend_${res.status}` }
    }
    return { sent: true, error: null }
  } catch (e) {
    console.error('[ai-visibility-check] result email threw', e instanceof Error ? e.message : String(e))
    return { sent: false, error: 'exception' }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  // Self-host has no public landing widget: the only caller is onboarding, for a signed-in user.
  // Require a real session there so nobody on the internet can spend the operator's LLM key.
  const selfHost = isSelfHostEnv()
  if (selfHost) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const authClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey())
    const { data: authData } = token ? await authClient.auth.getUser(token) : { data: { user: null } }
    if (!authData?.user) return json({ error: 'unauthorized', message: 'Sign in to run this check.' }, 401)
  }
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const email = String(body?.email || '').trim().toLowerCase()
  const domain = normalizeDomain(body?.domain || '')
  // Requested probe language ('' = probe in the language the site targets). When set, the query
  // and category MUST come back in that language — an English ICP probed with a German query is a
  // wrong-language error, never a usable "absent".
  const lang = requestedCheckLang(body?.lang)
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email', message: 'Enter a valid email.' }, 400)
  if (!DOMAIN_RE.test(domain) || isBlockedHostname(domain) || !(await assertSafePublicDomain(domain))) return json({ error: 'invalid_domain', message: 'Enter a valid website domain.' }, 400)

  // Bot filters: honeypot always; formStartedAt timing unless the request is a trusted
  // server-to-server integration ({domain, email, lang}). Set CHECK_INTEGRATION_SECRET to require
  // authenticated integrations.
  const trustedIntegration = isTrustedIntegration(
    Deno.env.get('CHECK_INTEGRATION_SECRET'),
    req.headers.get(INTEGRATION_SECRET_HEADER),
  )
  const botGuard = guardPublicCheckBots(body, Date.now(), trustedIntegration)
  if (!botGuard.ok) return json(botGuard.body, botGuard.status)
  const programmatic = botGuard.programmatic

  const clientIp = getClientIp(req)
  const ipHash = await hashClientIp(clientIp)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey())

  const since = new Date(Date.now() - 3600000).toISOString()
  const { count: ipCount } = await supabase.from('public_check_leads').select('*', { count: 'exact', head: true }).eq('ip', ipHash).gte('created_at', since)
  // Widget: 5/h per IP. Integrations get a higher per-IP cap ("from your network" is this
  // limiter, not the LLM provider).
  if (shouldBlockOnIpCap(programmatic, ipCount ?? 0)) {
    return json({ error: 'rate_limited', message: 'Too many checks from your network. Please try again in a little while.' }, 429)
  }

  let result: any = null, apiSpent = false

  // Cache by domain (a site's target language is a property of the site, so a cached result
  // already carries the right language). Namespaced with a result-format version so older
  // entries are simply ignored — no destructive cache wipe needed when the format changes.
  const cacheKey = publicCheckCacheKey(domain, lang)
  const cacheSince = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString()
  const { data: cached } = await supabase.from('public_ai_checks').select('result').eq('domain', cacheKey).gte('checked_at', cacheSince).maybeSingle()

  if (cached?.result) {
    result = cached.result
  } else {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
    const { count: spentToday } = await supabase.from('public_check_leads').select('*', { count: 'exact', head: true }).eq('api_spent', true).gte('created_at', dayStart.toISOString())
    if ((spentToday ?? 0) >= DAILY_MAX) return json({ error: 'busy', message: 'We are running a lot of checks right now - try again later.' }, 503)
    try {
      const site = await fetchSite(domain)
      // Detect the language the SITE targets (from its own content/market), NOT the visitor's UI
      // locale: e.g. example.com is a .com targeting English, so it must be probed in English even
      // for an Italian visitor. The profile call returns the detected ISO code and writes the
      // category + query in that language; the recommendation call answers in the query's language.
      const profileFor = async (strict: boolean) => {
        const languageRule = lang
          ? forcedLanguageInstruction(lang, strict)
          : 'Write "category" and "query" in that detected language.'
        const raw = await llm('openai/gpt-4o-mini', [
          { role: 'system', content: 'You analyze a website and reply with strict JSON only.' },
          { role: 'user', content: `Website: ${domain}\nTitle: ${site.title || '(none)'}\nDescription: ${site.desc || '(none)'}\nHTML lang attribute: ${site.lang || '(unknown)'}\n\nDetect the website's PRIMARY target language — the language/market it actually targets, judged from its content (the html attribute is only a hint and may be wrong). Return JSON: {"lang": "<2-letter ISO code>", "brand": "<the brand/company name>", "category": "<short product/service category>", "query": "<a natural question a buyer would ask an AI assistant to discover options in this category>", "known": <true ONLY if you genuinely recognize this specific brand/company, else false>}. ${languageRule} The "query" MUST be generic about the category and MUST NOT mention this brand. Keep "category" under 6 words.` },
        ], { maxTokens: 300, temperature: strict ? 0.1 : 0.3 })
        return parseJson(raw) || {}
      }
      // Cheap, independent language check of the probe text (the profile call self-reports and is
      // exactly what went wrong for German/Spanish probes on English requests).
      const detectLanguage = async (text: string): Promise<string> => {
        try {
          const raw = await llm('openai/gpt-4o-mini', [
            { role: 'system', content: 'Reply with strict JSON only.' },
            { role: 'user', content: `What language is this text written in? Return JSON: {"lang": "<2-letter ISO 639-1 code>"}\n\n${text}` },
          ], { maxTokens: 20, temperature: 0 })
          return normalizeLang(parseJson(raw)?.lang)
        } catch { return '' }
      }
      let profile = await profileFor(false)
      let queryText = String(profile.query || '').trim()
      let observedLang = lang && queryText ? await detectLanguage(queryText) : ''
      if (lang && languageMismatch(lang, observedLang)) {
        profile = await profileFor(true)
        queryText = String(profile.query || '').trim()
        observedLang = queryText ? await detectLanguage(queryText) : ''
        if (languageMismatch(lang, observedLang)) {
          console.warn(`ai-visibility-check wrong_language domain=${domain} requested=${lang} detected=${observedLang}`)
          await supabase.from('public_check_leads').insert({ email, domain, ip: ipHash, api_spent: true })
          return json(wrongLanguageBody(lang, observedLang, cleanEmailText(queryText, 120)), 422)
        }
      }
      const det = String(profile.lang || '').toLowerCase().slice(0, 2)
      const useLang = lang || (/^[a-z]{2}$/.test(det) ? det : (site.lang || 'en'))
      const brand = cleanEmailText(String(profile.brand || domain.split('.')[0]).trim(), 40) || domain.split('.')[0]
      const category = cleanEmailText(String(profile.category || '').trim(), 60)
      const query = cleanEmailText(String(profile.query || (category ? `best ${category}` : `best tools like ${brand}`)).trim(), 120) || `best ${category || brand}`
      // The recommendation call is the cost/rate bottleneck. The widget uses gpt-4o; integrations
      // use gpt-4o-mini, which is cheaper and has higher provider rate limits.
      const recRaw = await llm(programmatic ? 'openai/gpt-4o-mini' : 'openai/gpt-4o', [
        { role: 'system', content: 'You are a helpful assistant. When asked for recommendations you name specific, real, well-known brands or products. Reply in the SAME LANGUAGE as the question, with strict JSON only.' },
        { role: 'user', content: `${query}\n\nReturn JSON: {"recommended": ["<name>", ...]} - the specific tools/companies/brands you would actually recommend, best first, max 8, real names only.` },
      ], { maxTokens: 400, temperature: 0.5 })
      const recommended: string[] = (() => { const rec = parseJson(recRaw) || {}; return Array.isArray(rec.recommended) ? rec.recommended.map((x: any) => String(x)).filter(Boolean).slice(0, 8) : [] })()
      // Whole-word/token brand matching (see brand_match.ts) — avoids the substring false positive
      // (e.g. brand "Ora" wrongly matching recommended "Aurora") that would fake a "recommended" verdict.
      const { cited, competitors } = classifyRecommended(brand, domain.split('.')[0], recommended, 5)
      // "known" now comes from the profile call (merged) — one fewer LLM round-trip per check.
      const known = profile.known === true
      const level = cited ? 'recommended' : (known ? 'known' : 'absent')
      result = { domain, brand, category, query, lang: useLang, query_lang: observedLang || useLang, cited, level, competitors, engine: 'ChatGPT' }
      await supabase.from('public_ai_checks').upsert({ domain: cacheKey, result, checked_at: new Date().toISOString(), hits: 1 }, { onConflict: 'domain' })
      apiSpent = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('ai-visibility-check error:', msg)
      // After a burst of fresh checks the LLM provider (OpenRouter) rate-limits or runs out of
      // credit; llm() then throws `LLM 429/402/503/529`. Surface that as a DISTINCT, retryable
      // signal (provider_busy, 503) instead of a generic check_failed (500), so an integration
      // backs off and retries rather than treating the domain as permanently un-checkable.
      // NOTE: we do NOT return level:"absent" here — we couldn't run the check, so "absent" would be
      // a false negative. The genuine not-found case already returns level:"absent" above.
      if (/LLM (402|429|500|502|503|529)/.test(msg)) {
        return json({ error: 'provider_busy', message: 'AI provider is rate-limited right now — retry shortly.' }, 503)
      }
      return json({ error: 'check_failed', message: 'Could not complete the check. Please try again.' }, 500)
    }
  }

  // Per-recipient + global daily email caps — independent of api_spent so cache hits cannot spam inboxes.
  const emailSince = new Date(Date.now() - EMAIL_WINDOW_MS).toISOString()
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
  const [recipientRes, globalEmailRes] = await Promise.all([
    supabase.from('public_check_leads').select('*', { count: 'exact', head: true }).eq('email', email).gte('created_at', emailSince),
    // The global cap protects the Resend budget from widget abuse. Exclude rows that never
    // send an email by default: the llms-txt tool ('llms-tool@internal') and programmatic
    // (integration) checks, which would otherwise count against widget visitors.
    supabase
      .from('public_check_leads')
      .select('*', { count: 'exact', head: true })
      .neq('email', 'llms-tool@internal')
      .or('source.is.null,source.neq.programmatic')
      .gte('created_at', dayStart.toISOString()),
  ])
  const overRecipient = (recipientRes.count ?? 0) >= EMAIL_MAX_PER_RECIPIENT_24H
  const overGlobal = (globalEmailRes.count ?? 0) >= GLOBAL_EMAIL_DAILY_MAX
  // Widget: email caps still 429/503. Integrations still get query/level/competitors — skip the
  // Resend send instead of failing the check.
  if (shouldBlockOnEmailCap(programmatic, overRecipient, overGlobal)) {
    if (overRecipient) {
      return json({ error: 'rate_limited', message: 'Too many reports sent to this email. Please try again later.' }, 429)
    }
    return json({ error: 'busy', message: 'We are running a lot of checks right now - try again later.' }, 503)
  }

  // Self-host never sends the hosted cloud's result email.
  const outcome: SendOutcome = selfHost || !wantsResultEmail(programmatic, body)
    ? { sent: false, error: 'not_requested' }
    : (overRecipient || overGlobal)
    ? { sent: false, error: 'rate_capped' }
    : await sendReport(email, result, result.lang || 'en')
  const emailSent = outcome.sent
  // Store the HASHED ip (data minimization); rate limiting still works because hashing is deterministic.
  const { data: leadRow } = await supabase
    .from('public_check_leads')
    .insert({ email, domain, ip: ipHash, api_spent: apiSpent })
    .select('id')
    .maybeSingle()
  // Email outcome, language and request source in a second write: the columns arrive with a
  // migration, and a lead must never be lost because the function was deployed before it ran.
  // `source` distinguishes widget visitors ('widget') from server-to-server integrations
  // ('programmatic').
  if (leadRow?.id) {
    const { error: metaErr } = await supabase
      .from('public_check_leads')
      .update({
        email_sent: emailSent,
        email_error: outcome.error,
        lang: result.lang || lang || null,
        source: programmatic ? 'programmatic' : 'widget',
      })
      .eq('id', leadRow.id)
    if (metaErr) console.warn('[ai-visibility-check] lead email outcome not stored (migration pending?)', metaErr.message)
  }
  // NOTE: `cached` is deliberately NOT returned anymore — it leaked whether someone else had
  // recently checked this domain. Response shape otherwise unchanged.
  return json({ ...result, emailSent })
})
