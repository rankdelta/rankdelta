/**
 * Pure helpers for GEO visibility run aggregation (shared by reportAssemble).
 *
 * Brand mentions live in `visibility_brand_mentions` — one row per brand named in an answer,
 * `tracked_brand_id` set for the client's own brand, `competitor_brand_id` for a rival. The
 * legacy `visibility_query_runs.mentioned_brands` column is NULL on every run the scan pipeline
 * writes today, so it only serves as a fallback for old fixtures.
 */

export type VisibilityMentionRow = {
  tracked_brand_id?: string | null
  competitor_brand_id?: string | null
  brand_name?: string | null
  sentiment?: string | null
}

export type VisibilityRunRow = {
  id: string
  run_at: string
  status: string
  provider?: string | null
  mentioned_brands?: unknown
  visibility_brand_mentions?: VisibilityMentionRow[]
  visibility_citations?: Array<{ source_domain?: string }>
  visibility_queries: { id: string; text: string; is_active: boolean }
}

export type SentimentCounts = { positive: number; neutral: number; negative: number }

/** Runs whose run_at falls inside [periodStart, periodEnd] (inclusive, UTC days). */
export function runsInPeriod(
  rows: VisibilityRunRow[],
  periodStart: string,
  periodEnd: string,
): VisibilityRunRow[] {
  const periodStartMs = new Date(`${periodStart}T00:00:00Z`).getTime()
  const periodEndMs = new Date(`${periodEnd}T23:59:59Z`).getTime()
  return rows.filter((run) => {
    const t = new Date(run.run_at).getTime()
    return t >= periodStartMs && t <= periodEndMs
  })
}

/** Did this answer name the client's own brand? */
/** Bare host of a site URL or domain: lower-case, no scheme, no `www.`, no path. */
export function siteHost(urlOrDomain: string | null | undefined): string | null {
  const raw = String(urlOrDomain ?? '').trim().toLowerCase()
  if (!raw) return null
  const host = raw.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '')
  return host || null
}

/**
 * Citation rate, as the in-app dashboard defines it: the share of completed AI answers in the
 * period that link to the site's own domain (or a subdomain). Null without a site or answers.
 * Counting every citation of every domain instead (what the GEO mart's `citations` column holds)
 * reads ~800% on Perplexity, which returns several sources per answer.
 */
/**
 * Answers that link the client's site, out of the answers that cite any source. Only answers that
 * list sources can cite the site: ChatGPT and Gemini (API, no web search) never list any, and
 * counting them capped the rate near the share of Perplexity answers.
 */
export function ownCitationCounts(
  runs: VisibilityRunRow[],
  siteUrl: string | null | undefined,
): { cited: number; withSources: number } | null {
  const host = siteHost(siteUrl)
  if (!host) return null
  const withSources = runs.filter((r) => r.status === 'completed' && (r.visibility_citations ?? []).length > 0)
  if (withSources.length === 0) return null
  const cited = withSources.filter((r) =>
    (r.visibility_citations ?? []).some((c) => {
      const d = siteHost(c.source_domain)
      return !!d && (d === host || d.endsWith(`.${host}`))
    }),
  )
  return { cited: cited.length, withSources: withSources.length }
}

export function ownCitationRate(runs: VisibilityRunRow[], siteUrl: string | null | undefined): number | null {
  const counts = ownCitationCounts(runs, siteUrl)
  return counts ? Math.round((1000 * counts.cited) / counts.withSources) / 10 : null
}

export function runMentionsBrand(run: VisibilityRunRow): boolean {
  const mentions = run.visibility_brand_mentions
  if (Array.isArray(mentions) && mentions.some((m) => !!m.tracked_brand_id)) return true
  return Array.isArray(run.mentioned_brands) && run.mentioned_brands.length > 0
}

/** Group flat visibility_query_runs rows by parent query id. */
export function groupVisibilityRunsByQuery(
  rows: VisibilityRunRow[],
): Map<string, { text: string; runs: VisibilityRunRow[] }> {
  const map = new Map<string, { text: string; runs: VisibilityRunRow[] }>()
  for (const row of rows) {
    const q = row.visibility_queries
    if (!q?.id) continue
    const entry = map.get(q.id) ?? { text: q.text, runs: [] }
    entry.runs.push(row)
    map.set(q.id, entry)
  }
  return map
}

export function topCitedSourceDomains(
  rows: VisibilityRunRow[],
  periodStart: string,
  periodEnd: string,
  limit = 10,
): Array<{ domain: string; count: number }> {
  const citeDomainCount = new Map<string, number>()

  for (const run of runsInPeriod(rows, periodStart, periodEnd)) {
    const citations = run.visibility_citations ?? []
    for (const c of citations) {
      const d = c.source_domain ?? 'unknown'
      citeDomainCount.set(d, (citeDomainCount.get(d) ?? 0) + 1)
    }
  }

  return [...citeDomainCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }))
}

/**
 * Split prompts into "won" (the brand was named in at least one completed answer, any engine)
 * and "missing" (completed answers exist and none named the brand). Prompts with no completed
 * run are left out — there is nothing truthful to say about them. Won prompts are ordered by
 * how consistently the brand shows up; missing prompts by how often they were asked.
 */
export function classifyVisibilityPrompts(
  grouped: Map<string, { text: string; runs: VisibilityRunRow[] }>,
): { mentioned: string[]; notMentioned: string[] } {
  const won: Array<{ text: string; share: number }> = []
  const missing: Array<{ text: string; asked: number }> = []

  for (const { text, runs } of grouped.values()) {
    const completed = runs.filter((r) => r.status === 'completed')
    if (completed.length === 0) continue
    const hits = completed.filter(runMentionsBrand).length
    if (hits > 0) won.push({ text, share: hits / completed.length })
    else missing.push({ text, asked: completed.length })
  }

  return {
    mentioned: won.sort((a, b) => b.share - a.share || a.text.localeCompare(b.text)).map((p) => p.text),
    notMentioned: missing
      .sort((a, b) => b.asked - a.asked || a.text.localeCompare(b.text))
      .map((p) => p.text),
  }
}

/** competitor_brand_id → number of completed answers that named that competitor. */
export function competitorMentionCounts(rows: VisibilityRunRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const run of rows) {
    if (run.status !== 'completed') continue
    for (const m of run.visibility_brand_mentions ?? []) {
      if (!m.competitor_brand_id) continue
      counts.set(m.competitor_brand_id, (counts.get(m.competitor_brand_id) ?? 0) + 1)
    }
  }
  return counts
}

// ── Branded vs discovery prompts ────────────────────────────────────────────────────────────
//
// A prompt that already names the brand ("Rankdelta vs Zapier") gets the brand mentioned almost
// by construction. Counting it in Share of Voice or in "prompts won" inflates both, so the report
// measures visibility on discovery prompts (the ones buyers ask without naming you) and lists
// branded prompts on their own.

export type TrackedBrandTerms = { name?: string | null; domain?: string | null; aliases?: unknown }

type PromptGroup = { text: string; runs: VisibilityRunRow[] }

/** Lower-case, accents stripped, punctuation turned into spaces, single-spaced. */
export function foldPromptText(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The words that identify the client's brand in a prompt: names, aliases, the domain and its label. */
export function brandTermsFrom(brands: readonly TrackedBrandTerms[]): string[] {
  const out = new Set<string>()
  const add = (raw: unknown) => {
    const folded = foldPromptText(String(raw ?? ''))
    if (folded.length >= 3) out.add(folded)
  }
  for (const b of brands) {
    add(b.name)
    if (Array.isArray(b.aliases)) b.aliases.forEach(add)
    const host = siteHost(b.domain)
    if (host) {
      add(host)
      add(host.split('.')[0])
    }
  }
  return [...out]
}

/** Does the prompt name the brand (whole words, accents and punctuation ignored)? */
export function isBrandedPrompt(text: string, terms: readonly string[]): boolean {
  const hay = ` ${foldPromptText(text)} `
  return terms.some((t) => hay.includes(` ${t} `))
}

/** Split grouped prompts into discovery and branded, keyed as in groupVisibilityRunsByQuery. */
export function splitBrandedPrompts(
  grouped: Map<string, PromptGroup>,
  terms: readonly string[],
): { discovery: Map<string, PromptGroup>; branded: Map<string, PromptGroup> } {
  const discovery = new Map<string, PromptGroup>()
  const branded = new Map<string, PromptGroup>()
  for (const [id, entry] of grouped) {
    if (isBrandedPrompt(entry.text, terms)) branded.set(id, entry)
    else discovery.set(id, entry)
  }
  return { discovery, branded }
}

/** Branded prompts with whether any completed answer named the brand (most-asked first). */
export function brandedPromptResults(branded: Map<string, PromptGroup>): Array<{ text: string; mentioned: boolean }> {
  const rows: Array<{ text: string; mentioned: boolean; asked: number }> = []
  for (const { text, runs } of branded.values()) {
    const completed = runs.filter((r) => r.status === 'completed')
    if (completed.length > 0) rows.push({ text, mentioned: completed.some(runMentionsBrand), asked: completed.length })
  }
  rows.sort((a, b) => b.asked - a.asked || a.text.localeCompare(b.text))
  return rows.map(({ text, mentioned }) => ({ text, mentioned }))
}

// ── Share of Voice from the answers themselves ─────────────────────────────────────────────
//
// Each mention row counts once. The report_geo_daily_mart view joins mentions and citations in
// the same query, which multiplied every mention by the number of cited sources (10x on
// Perplexity), and it also keeps prompts that were switched off.

export type SovCounts = { yours: number; competitors: number }

export function mentionCounts(runs: readonly VisibilityRunRow[]): SovCounts {
  const out: SovCounts = { yours: 0, competitors: 0 }
  for (const run of runs) {
    if (run.status !== 'completed') continue
    for (const m of run.visibility_brand_mentions ?? []) {
      if (m.tracked_brand_id) out.yours += 1
      else if (m.competitor_brand_id) out.competitors += 1
    }
  }
  return out
}

/** Mention counts grouped by a key (engine, UTC day); runs with no key are skipped. */
export function mentionCountsBy(
  runs: readonly VisibilityRunRow[],
  key: (run: VisibilityRunRow) => string | null,
): Map<string, SovCounts> {
  const out = new Map<string, SovCounts>()
  for (const run of runs) {
    const k = key(run)
    if (!k) continue
    const c = mentionCounts([run])
    const acc = out.get(k) ?? { yours: 0, competitors: 0 }
    acc.yours += c.yours
    acc.competitors += c.competitors
    out.set(k, acc)
  }
  return out
}

/** Sentiment of the client's own mentions across completed answers (unknown → neutral). */
export function sentimentCounts(rows: VisibilityRunRow[]): SentimentCounts {
  const out: SentimentCounts = { positive: 0, neutral: 0, negative: 0 }
  for (const run of rows) {
    if (run.status !== 'completed') continue
    for (const m of run.visibility_brand_mentions ?? []) {
      if (!m.tracked_brand_id) continue
      if (m.sentiment === 'positive') out.positive += 1
      else if (m.sentiment === 'negative') out.negative += 1
      else out.neutral += 1
    }
  }
  return out
}
