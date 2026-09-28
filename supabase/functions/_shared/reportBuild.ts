/**
 * Report-build pure logic (Deno) — mirrors src/lib/reportBuild for edge functions.
 */

export type RankBucket = '1' | '2-3' | '4-10' | '11-20' | '21+'

export interface MetricWithDelta {
  value: number | null
  delta: number | null
  deltaPct: number | null
}

export function periodDayCount(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0
  return Math.round((e - s) / 86_400_000) + 1
}

export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const days = periodDayCount(start, end)
  const startMs = new Date(`${start}T00:00:00Z`).getTime()
  const prevEndMs = startMs - 86_400_000
  const prevStartMs = prevEndMs - (days - 1) * 86_400_000
  return {
    start: new Date(prevStartMs).toISOString().slice(0, 10),
    end: new Date(prevEndMs).toISOString().slice(0, 10),
  }
}

export function computeDelta(current: number | null, previous: number | null): MetricWithDelta {
  if (current == null && previous == null) return { value: null, delta: null, deltaPct: null }
  // First reading: no previous period → no movement. Treating "missing" as 0 produced
  // "+85 pp" / "+100%" chips on the first report a client ever received.
  if (previous == null) return { value: current, delta: null, deltaPct: null }
  const cur = current ?? 0
  const prev = previous
  const delta = cur - prev
  const deltaPct = prev !== 0 ? Math.round((1000 * delta) / prev) / 10 : cur !== 0 ? 100 : 0
  return { value: current, delta, deltaPct }
}

export function positionDistributionBucket(rank: number | null | undefined): RankBucket | null {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return null
  const r = Math.floor(rank)
  if (r === 1) return '1'
  if (r <= 3) return '2-3'
  if (r <= 10) return '4-10'
  if (r <= 20) return '11-20'
  return '21+'
}

export function buildDistributionBuckets(ranks: Array<number | null | undefined>): Record<RankBucket, number> {
  const out: Record<RankBucket, number> = { '1': 0, '2-3': 0, '4-10': 0, '11-20': 0, '21+': 0 }
  for (const r of ranks) {
    const b = positionDistributionBucket(r)
    if (b) out[b] += 1
  }
  return out
}

export function sumDailyField<T extends { date: string }>(
  rows: T[],
  start: string,
  end: string,
  field: keyof T,
): number {
  let sum = 0
  for (const row of rows) {
    if (row.date < start || row.date > end) continue
    const v = row[field]
    if (typeof v === 'number' && Number.isFinite(v)) sum += v
  }
  return sum
}

export function filterDailyRows<T extends { date: string }>(rows: T[], start: string, end: string): T[] {
  return rows.filter((r) => r.date >= start && r.date <= end).sort((a, b) => a.date.localeCompare(b.date))
}

export function nearestCachePeriodDays(dayCount: number): 7 | 28 | 90 {
  const opts: Array<7 | 28 | 90> = [7, 28, 90]
  let best: 7 | 28 | 90 = 28
  for (const o of opts) {
    if (Math.abs(o - dayCount) < Math.abs(best - dayCount)) best = o
  }
  return best
}

export const AI_ASSISTANT_SOURCE_PATTERNS: ReadonlyArray<{ engine: string; patterns: string[] }> = [
  { engine: 'chatgpt', patterns: ['chatgpt', 'chat.openai', 'openai'] },
  { engine: 'perplexity', patterns: ['perplexity'] },
  { engine: 'gemini', patterns: ['gemini', 'bard', 'google bard'] },
  { engine: 'claude', patterns: ['claude', 'anthropic'] },
  { engine: 'copilot', patterns: ['copilot', 'bing chat'] },
]

export function matchEngineFromSource(source: string): string | null {
  const s = source.toLowerCase()
  for (const { engine, patterns } of AI_ASSISTANT_SOURCE_PATTERNS) {
    if (patterns.some((p) => s.includes(p))) return engine
  }
  return null
}

export function aggregateAiSessionsByEngine(
  sources: Array<{ source: string; sessions: number; keyEvents?: number }>,
): Map<string, { sessions: number; keyEvents: number }> {
  const map = new Map<string, { sessions: number; keyEvents: number }>()
  for (const row of sources) {
    const engine = matchEngineFromSource(row.source)
    if (!engine) continue
    const cur = map.get(engine) ?? { sessions: 0, keyEvents: 0 }
    cur.sessions += row.sessions
    cur.keyEvents += row.keyEvents ?? 0
    map.set(engine, cur)
  }
  return map
}

export function buildAiAttribution(
  engineSov: Array<{ engine: string; sovPercent: number | null }>,
  ga4Sources: Array<{ source: string; sessions: number; keyEvents?: number }>,
  /**
   * False when the project has no GA4 connection. Traffic fields are then null ("no data"),
   * not 0: a 0 read as "ChatGPT sent zero visitors", and the narrative model wrote exactly
   * that into client reports for projects that never connected GA4.
   */
  ga4Connected = true,
) {
  const sessionsByEngine = aggregateAiSessionsByEngine(ga4Sources)
  const engines = new Set<string>([...engineSov.map((e) => e.engine), ...sessionsByEngine.keys()])
  const sovByEngine = new Map(engineSov.map((e) => [e.engine, e]))
  return [...engines].sort().map((engine) => {
    const sov = sovByEngine.get(engine)
    if (!ga4Connected) {
      return { engine, sovPercent: sov?.sovPercent ?? null, aiAssistantSessions: null, keyEvents: null, conversionRate: null }
    }
    const traffic = sessionsByEngine.get(engine) ?? { sessions: 0, keyEvents: 0 }
    const conversionRate =
      traffic.sessions > 0 ? Math.round((1000 * traffic.keyEvents) / traffic.sessions) / 10 : null
    return {
      engine,
      sovPercent: sov?.sovPercent ?? null,
      aiAssistantSessions: traffic.sessions,
      keyEvents: traffic.keyEvents,
      conversionRate,
    }
  })
}

const EXEMPT_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 7, 14, 28, 90, 100, 2024, 2025, 2026])

export function collectNumbersFromData(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (value == null) return out
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value)
    out.add(Math.round(value * 10) / 10)
    out.add(Math.round(value))
    return out
  }
  if (typeof value === 'string') {
    const matches = value.match(/-?\d+(?:\.\d+)?/g) ?? []
    for (const m of matches) {
      const n = Number(m)
      if (Number.isFinite(n)) out.add(n)
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbersFromData(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbersFromData(v, out)
  }
  return out
}

export function checkNarrativeGrounding(narrative: unknown, data: unknown): { grounded: boolean; ungrounded: number[] } {
  const allowed = collectNumbersFromData(data)
  const narrativeNums = collectNumbersFromData(narrative)
  const ungrounded: number[] = []
  for (const n of narrativeNums) {
    if (EXEMPT_NUMBERS.has(n)) continue
    if (allowed.has(n)) continue
    const rounded = Math.round(n * 10) / 10
    if (allowed.has(rounded) || allowed.has(Math.round(n))) continue
    ungrounded.push(n)
  }
  return { grounded: ungrounded.length === 0, ungrounded }
}

export type SectionKey =
  | 'summary'
  | 'geo'
  | 'ai_attribution'
  | 'rankings'
  | 'gsc'
  | 'ga4'
  | 'site_health'
  | 'backlinks'

export const REPORT_SECTIONS: SectionKey[] = [
  'summary',
  'geo',
  'ai_attribution',
  'rankings',
  'gsc',
  'ga4',
  'site_health',
  'backlinks',
]

export function nullSection(reason: string) {
  return { data: null, reason }
}

export function isNullSection(section: unknown): boolean {
  if (!section || typeof section !== 'object') return false
  const o = section as { data?: unknown; reason?: string }
  return o.data === null && typeof o.reason === 'string'
}

export function isConnectedSection<T>(section: T | null | undefined): section is T {
  return section != null && !isNullSection(section)
}

/** Safely read a MetricWithDelta field from a section object (skips nullSection placeholders). */
export function readMetric(section: unknown, field: string): MetricWithDelta | null {
  if (!isConnectedSection(section) || typeof section !== 'object') return null
  const raw = (section as Record<string, unknown>)[field]
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (!('value' in m) && !('delta' in m) && !('deltaPct' in m)) return null
  const value = m['value']
  const delta = m['delta']
  const deltaPct = m['deltaPct']
  return {
    value: typeof value === 'number' || value === null ? (value as number | null) : null,
    delta: typeof delta === 'number' || delta === null ? (delta as number | null) : null,
    deltaPct: typeof deltaPct === 'number' || deltaPct === null ? (deltaPct as number | null) : null,
  }
}

export function readMetricValue(section: unknown, field: string): number | null {
  return readMetric(section, field)?.value ?? null
}

export function readMetricDelta(section: unknown, field: string): number | null {
  return readMetric(section, field)?.delta ?? null
}

export function metric(value: number | null, previous: number | null) {
  const d = computeDelta(value, previous)
  return { value: d.value, delta: d.delta, deltaPct: d.deltaPct }
}

/** Summary KPI rollup — null-safe across disconnected or partial sections. */
export function buildReportSummary(
  data: Record<string, unknown>,
  geoSection: Record<string, unknown> | null,
): Record<string, MetricWithDelta> {
  const siteHealth = data['site_health']
  const healthScore =
    isConnectedSection(siteHealth) &&
    typeof siteHealth === 'object' &&
    'auditScore' in (siteHealth as object)
      ? ((siteHealth as { auditScore: number | null }).auditScore ?? null)
      : null

  const aiSov = isConnectedSection(geoSection) ? readMetric(geoSection, 'sovOverall') : null
  const avgPosition = readMetric(data['rankings'], 'avgPosition')

  return {
    healthScore: metric(healthScore, null),
    aiSov: aiSov ?? metric(null, null),
    avgPosition: avgPosition ?? metric(null, null),
    gscClicks: readMetric(data['gsc'], 'clicks') ?? metric(null, null),
    ga4Sessions: readMetric(data['ga4'], 'sessions') ?? metric(null, null),
    ga4AiAssistantSessions: readMetric(data['ga4'], 'aiAssistantSessions') ?? metric(null, null),
    keyEvents: readMetric(data['ga4'], 'keyEvents') ?? metric(null, null),
  }
}

export function shareOfVoice(yours: number, competitors: number): number | null {
  const total = yours + competitors
  return total > 0 ? Math.round((1000 * yours) / total) / 10 : null
}

export function normalizeDomain(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

/**
 * Single source of truth for the agency-report AI narrative prompt, shared by the on-demand
 * (report-build) and scheduled (report-schedule-runner) paths so both produce the same
 * agency-grade output. Grounded strictly in the data JSON.
 */
export function buildNarrativePrompt(
  data: unknown,
  locale: string,
): { system: string; user: string } {
  const lang = locale.startsWith('it') ? 'Italian' : 'English'
  const system = `You are a senior SEO & GEO (AI-search) strategist writing the monthly report a boutique agency sends its client. The reader is a smart business owner, not a technical SEO. Write in ${lang}.

Voice: confident, concrete, human. Lead with results, not process. No hedging about what the data shows ("it seems", "appears to"), no filler ("in today's landscape"), no buzzwords (leverage, synergy, holistic), and never state a number without saying what it means for the business. Every sentence earns its place.

Grounding (hard rule): use ONLY numbers that appear in the provided data JSON — never invent, round, or estimate a metric. When you explain WHY something changed or WHAT to do, reason qualitatively; do not attach a figure that is not in the data. Every number in your text MUST appear verbatim in the data JSON.

Audience (hard rule): this text goes to the client. Never write about the report itself, the software that produced it, tracking, monitoring, dashboards, data sources, data freshness or data that is missing, null or not connected — if a metric is absent, say nothing about it. Never recommend adding, requesting or configuring tracking or monitoring, or connecting a data source. Avoid internal vocabulary: say "AI answers" (never "runs"), and prefer "questions people ask AI assistants" to "prompts" or "queries".

Facts (hard rule): claim only what the data shows. Traffic, clicks, sessions and positions exist only when the gsc, ga4 or rankings sections are in the data; without them never call a page high-traffic, top-performing or ranking, and never target "pages that already rank". Present a cause as the likely reason, never as proven: an audit issue does not "block" or "limit" a metric, it can hold it back. A count you state must match the items you name. The health score and audit issues come from the last site audit (site_health.auditedAt): when that date is before meta.periodStart, refer to them as the last audit's, with its date, never as this period's.

AI visibility (geo): share of voice and the mentioned / not-mentioned lists are measured on questions that do not name the brand (geo.sovScope = "discovery"). geo.brandedPrompts are questions that already contain the brand name: never present a mention there as a win; mention them only when one of them does NOT name the brand, as a brand-reputation risk.

Return ONLY a valid JSON object with these keys:
- executiveSummary: 3-5 sentences. Open with the single most important outcome of this period, quantified with its change versus the previous period. Where the data supports it, tell the AI-search story — how share of voice in AI answers connects to AI-Assistant sessions and key events. Close on the one priority that matters most next. Plain prose, no headings or bullets.
- sections: an object keyed ONLY by the report sections that have data. For each, 1-2 sentences covering what changed, the most likely reason, and why it matters to the client. Omit any section whose data is null or marked not_connected — do not mention it or frame it as a gap.
- nextActions: 3-5 specific, impact-ordered recommendations actionable this month. Tie each to a concrete signal in the data (e.g. keywords sitting at positions 11-20, a rising engine, a page shedding clicks). Every action is work on the website, its content or the brand's presence elsewhere (pages, structured data, internal links, digital PR, the sources AI answers cite) — never about the report or how it is measured. No generic advice.`
  const user = `Here is the report data as JSON. Write the narrative described in your instructions, grounded strictly in these numbers.\n\n${JSON.stringify(data, null, 2)}`
  return { system, user }
}

/**
 * Parse an LLM narrative completion into a JSON object.
 *
 * Narrative models (e.g. kimi-k2) frequently wrap their JSON in a ```json … ```
 * markdown fence and/or add surrounding prose. A raw JSON.parse then throws and
 * the entire completion — fence and all — gets dumped verbatim into the report's
 * executive summary. Strip the fence, fall back to the outermost { … } span, and
 * only then parse. Returns null when no JSON object can be recovered.
 */
export function parseNarrativeContent(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') return null
  let s = content.trim()
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const inner = fenced?.[1]
  if (inner !== undefined) s = inner.trim()
  if (!s.startsWith('{')) {
    const first = s.indexOf('{')
    const last = s.lastIndexOf('}')
    if (first !== -1 && last > first) s = s.slice(first, last + 1)
  }
  try {
    const parsed = JSON.parse(s)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Sentences a client report must never contain: advice about the reporting tool itself
 * ("request Google AI Overviews tracking be added to next month's monitoring"), talk of null or
 * disconnected data. The prompt forbids them; this removes any that slip through, in English and
 * Italian. (Run counters are kept out of the payload instead: a sentence quoting them usually also
 * carries the headline number.)
 */
const TOOL_TALK: RegExp[] = [
  /\b(add|adding|added|set up|setting up|enable|enabling|request|requesting|configure|configuring|include|including|restore|restoring|resume|resuming|restart|restarting)\b[^.!?]{0,60}\b(tracking|monitoring)\b/i,
  /\b(tracking|monitoring)\b[^.!?]{0,40}\b(stopped|paused|halted|inactive|is off)\b/i,
  /\bintegrations?\b[^.!?]{0,60}\b(not (active|connected)|none)\b/i,
  /\b(tracking|monitoring)\b[^.!?]{0,40}\b(be added|is added|added to|set up|enabled|configured)\b/i,
  /\bnull data\b|\bdata (is|are) (null|missing|unavailable|not available)\b|\bno data (for|from|on)\b/i,
  /\bnot (yet )?connected\b|\b(connect|reconnect|link)\b[^.!?]{0,20}\b(search console|google analytics|ga4)\b/i,
  /\b(aggiung|attiv|configur|richied|impost|ripristin|riattiv)\w*[^.!?]{0,60}\b(tracciamento|monitoraggio)\b/i,
  /\b(tracciamento|monitoraggio)\b[^.!?]{0,40}\b(ferm[oa]|sospes[oa]|interrott[oa]|spent[oa])\b/i,
  /\bintegrazion[ei]\b[^.!?]{0,80}\b(non (attiv|conness|collegat)\w*|nessuna)\b|\bnessuna integrazione\b/i,
  /\bdati (null|mancanti|non disponibili)\b|\bnessun dato (per|da|su)\b/i,
  /\bnon (è |sono )?(ancora )?(collegat|conness)[oaie]\b|\b(collega|ricollega)\w*[^.!?]{0,20}\b(search console|google analytics|ga4)\b/i,
  // Raw payload words: a null value or a field name never belongs in client prose.
  /\bnull\b|\bnot_connected\b/i,
  /\b(sovOverall|sovByEngine|deltaPct|healthScore|aiSov|avgPosition|gscClicks|ga4Sessions|citationRate|auditedAt|periodStart|periodEnd)\b/,
]

export function isToolTalk(text: string): boolean {
  return TOOL_TALK.some((re) => re.test(text))
}

function dropToolTalkSentences(text: string): { text: string; removed: number } {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const kept = sentences.filter((s) => !isToolTalk(s))
  return { text: kept.join(' ').trim(), removed: sentences.length - kept.length }
}

/** Remove tool-talk from the executive summary, section commentary and next actions. */
export function removeToolTalk(parsed: Record<string, unknown>): { narrative: Record<string, unknown>; removed: number } {
  let removed = 0
  const out: Record<string, unknown> = { ...parsed }
  const summary = parsed['executiveSummary']
  if (typeof summary === 'string') {
    const r = dropToolTalkSentences(summary)
    // Never blank the headline: keep the original if every sentence matched.
    if (r.text) {
      out['executiveSummary'] = r.text
      removed += r.removed
    }
  }
  const rawSections = parsed['sections']
  if (rawSections && typeof rawSections === 'object' && !Array.isArray(rawSections)) {
    const sections: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rawSections as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        sections[key] = value
        continue
      }
      const r = dropToolTalkSentences(value)
      removed += r.removed
      if (r.text) sections[key] = r.text
    }
    out['sections'] = sections
  }
  const rawActions = parsed['nextActions']
  if (Array.isArray(rawActions)) {
    const actions = rawActions.filter((a) => !(typeof a === 'string' && isToolTalk(a)))
    removed += rawActions.length - actions.length
    out['nextActions'] = actions
  }
  return { narrative: out, removed }
}

export const NARRATIVE_LLM_MAX_ATTEMPTS = 2
export const NARRATIVE_LLM_TIMEOUT_MS = 30_000
const NARRATIVE_LLM_RETRY_BACKOFF_MS = 750

export type NarrativeLlmFailureReason =
  | 'llm_http_error'
  | 'missing_content'
  | 'unparseable_narrative'
  | 'empty_executive_summary'
  | 'fetch_error'
  | 'timeout'

export function isEmptyExecutiveSummary(parsed: Record<string, unknown>): boolean {
  const summary = parsed['executiveSummary']
  return typeof summary !== 'string' || summary.trim().length === 0
}

export function classifyNarrativeLlmResponse(
  res: Response,
  llmBody: unknown,
): { ok: true; parsed: Record<string, unknown> } | { ok: false; reason: NarrativeLlmFailureReason } {
  if (!res.ok) return { ok: false, reason: 'llm_http_error' }

  const content = (llmBody as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content
  if (typeof content !== 'string') return { ok: false, reason: 'missing_content' }

  const parsed = parseNarrativeContent(content)
  if (!parsed) return { ok: false, reason: 'unparseable_narrative' }
  if (isEmptyExecutiveSummary(parsed)) return { ok: false, reason: 'empty_executive_summary' }

  return { ok: true, parsed }
}

export interface NarrativeLlmRequest {
  supabaseUrl: string
  headers: Record<string, string>
  systemPrompt: string
  userPrompt: string
}

export interface NarrativeLlmRetryDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
  timeoutMs?: number
  backoffMs?: number
  logPrefix?: string
}

/**
 * Call seo-proxy LLM for report narrative with per-attempt timeout and retries.
 * Retries on non-2xx, missing content, unparseable JSON, or empty executiveSummary.
 */
export async function fetchNarrativeWithRetries(
  request: NarrativeLlmRequest,
  deps: NarrativeLlmRetryDeps = {},
): Promise<
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; reason: NarrativeLlmFailureReason }
> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const maxAttempts = deps.maxAttempts ?? NARRATIVE_LLM_MAX_ATTEMPTS
  const timeoutMs = deps.timeoutMs ?? NARRATIVE_LLM_TIMEOUT_MS
  const backoffMs = deps.backoffMs ?? NARRATIVE_LLM_RETRY_BACKOFF_MS
  const logPrefix = deps.logPrefix ?? '[narrative]'

  const url = `${request.supabaseUrl}/functions/v1/seo-proxy`
  const body = JSON.stringify({
    action: 'llm',
    model: 'moonshotai/kimi-k2',
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
  })

  let lastReason: NarrativeLlmFailureReason = 'fetch_error'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...request.headers,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      })

      const llmBody = await res.json().catch(() => ({}))
      const classified = classifyNarrativeLlmResponse(res, llmBody)
      if (classified.ok) return classified

      lastReason = classified.reason
      if (!res.ok) {
        console.error(
          `${logPrefix} narrative LLM failed`,
          res.status,
          JSON.stringify(llmBody).slice(0, 300),
        )
      } else if (lastReason === 'unparseable_narrative') {
        console.warn(`${logPrefix} narrative JSON unparseable; retrying`)
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      lastReason = isTimeout ? 'timeout' : 'fetch_error'
      if (!isTimeout) {
        console.error(
          `${logPrefix} narrative generation failed`,
          err instanceof Error ? err.message : String(err),
        )
      }
    } finally {
      clearTimeout(timeoutId)
    }

    if (attempt < maxAttempts) {
      console.warn(`${logPrefix} narrative attempt ${attempt}/${maxAttempts} failed: ${lastReason}`)
      await sleep(backoffMs * attempt)
    }
  }

  console.error(`${logPrefix} narrative generation exhausted retries: ${lastReason}`)
  return { ok: false, reason: lastReason }
}

/**
 * A narrative as stored by any past build, made client-safe the way the build is today: a summary
 * that is the model's raw ```json … ``` completion (builds before parseNarrativeContent) is
 * recovered, and tool-talk is removed. Used when a stored report is shown (web, PDF, deck) or
 * handed to an agent (MCP get_client_report).
 */
export function cleanStoredNarrative(stored: Record<string, unknown>): Record<string, unknown> {
  let narrative = stored
  const summary = narrative['executiveSummary']
  if (typeof summary === 'string' && /^\s*(```|\{)/.test(summary) && summary.includes('executiveSummary')) {
    const parsed = parseNarrativeContent(summary)
    if (parsed && typeof parsed['executiveSummary'] === 'string') narrative = { ...narrative, ...parsed }
  }
  return removeToolTalk(narrative).narrative
}
