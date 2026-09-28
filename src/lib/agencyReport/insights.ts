/**
 * Deterministic insight engine behind the Executive Briefing.
 *
 * Reads `report.data` only — never the LLM narrative — and turns it into three ranked lists the
 * agency can forward as-is: what went well (wins), what needs attention (watch) and what to do
 * next (actions). Every item is an i18n key plus pre-formatted params, so the sentence is written
 * by the translation file (EN + IT) and the numbers are real values from the snapshot.
 *
 * Honesty rules: a metric without a prior period (`delta === null`, or the computeDelta
 * "first reading" shape) is never a movement; zero-vs-zero is never a win; nothing is inferred
 * that the data does not contain (e.g. a competitor is only named when it has recorded mentions).
 */
import type { MetricWithDelta } from '../reportBuild/math'
import { hasBaseline } from './reportUi'
import { isConnectedSection, type SectionKey } from './sections'
import { ga4PageRows, gscTopRows, pagePath } from './tables'
import type {
  BacklinksSectionData,
  Ga4SectionData,
  GeoSectionData,
  GscSectionData,
  RankingsSectionData,
  ReportData,
  SiteHealthSectionData,
} from './types'

export type InsightKind = 'win' | 'watch' | 'action'

export interface Insight {
  kind: InsightKind
  /** Leaf key under `agencyReport.briefing.items` */
  key: string
  params: Record<string, string | number>
  /** Higher = more important; lists are sorted by it. */
  score: number
  section: SectionKey
}

export interface Briefing {
  wins: Insight[]
  watch: Insight[]
  actions: Insight[]
}

export interface BriefingOptions {
  locale?: string
  maxPerGroup?: number
}

const MAX_LIST = 3

function fmtInt(v: number, locale: string): string {
  return Math.round(v).toLocaleString(locale)
}

function fmtDec(v: number, locale: string, digits: number): string {
  return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** "12.5%" in en-US, "12,5%" in it-IT. */
function fmtPct(locale: string, v: number, digits = 0): string {
  return `${fmtDec(v, locale, digits)}%`
}

/**
 * Italian article + percentage, elided before vowel-initial numbers and "lo" before zero:
 * nel 14,3% · nell'8% · nello 0% (also il/l'/lo and del/dell'/dello). EN templates ignore it.
 */
export function itPctArticle(base: 'nel' | 'il' | 'del', pct: string): string {
  const n = parseInt(pct, 10)
  if (n === 0) return `${base === 'il' ? 'lo' : `${base}lo`} ${pct}`
  const vowel = n === 1 || n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) || (n >= 800 && n <= 899)
  if (vowel) return `${base === 'il' ? "l'" : `${base}l'`}${pct}`
  return `${base} ${pct}`
}

/** "#12" or "#7.7" / "#7,7". */
function fmtRank(locale: string, v: number): string {
  return `#${Number.isInteger(v) ? v : fmtDec(v, locale, 1)}`
}

/** Percent change from the prior period, recomputed from delta when deltaPct is missing. */
export function movementPct(m: MetricWithDelta | null | undefined): number | null {
  if (!m || !hasBaseline(m) || m.value == null || m.delta == null) return null
  if (m.deltaPct != null && Number.isFinite(m.deltaPct)) return m.deltaPct
  const prev = m.value - m.delta
  if (prev <= 0) return null
  return (m.delta / prev) * 100
}

function previousOf(m: MetricWithDelta): number | null {
  if (m.value == null || m.delta == null) return null
  return m.value - m.delta
}

function joinList(items: string[]): string {
  const shown = items.slice(0, MAX_LIST).map((s) => `“${s}”`).join(', ')
  return items.length > MAX_LIST ? `${shown} (+${items.length - MAX_LIST})` : shown
}

function truncate(s: string, max = 70): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function normalizeEngine(engine: string): string {
  const map: Record<string, string> = {
    openai: 'ChatGPT',
    chatgpt: 'ChatGPT',
    perplexity: 'Perplexity',
    gemini: 'Gemini',
    google: 'Google AI',
    google_ai: 'Google AI',
    google_aio: 'Google AI Overviews',
    anthropic: 'Claude',
    claude: 'Claude',
    copilot: 'Copilot',
    bing: 'Copilot',
  }
  const key = engine.trim().toLowerCase()
  return map[key] ?? engine
}

export function engineLabel(engine: string): string {
  return normalizeEngine(engine)
}

/**
 * The assembler splits prompts into mentioned / not mentioned from `visibility_query_runs.mentioned_brands`,
 * a column some scan pipelines leave empty while the mention mart (behind share of voice and the
 * trend) still counts brand mentions. When not a single prompt is "mentioned" yet the same data
 * says the brand is mentioned, the per-prompt split is contradictory and must not be presented.
 */
export function promptSplitReliable(geo: GeoSectionData): boolean {
  const mentioned = (geo.topPromptsMentioned ?? []).filter((p) => typeof p === 'string' && p.trim())
  if (mentioned.length > 0) return true
  const missing = (geo.topPromptsNotMentioned ?? []).filter((p) => typeof p === 'string' && p.trim())
  if (missing.length === 0) return true
  const sov = geo.sovOverall?.value ?? 0
  const trendMentions = (geo.trend ?? []).some((d) => (d.yours ?? 0) > 0)
  const engineMentions = (geo.sovByEngine ?? []).some((e) => (e.sovPercent ?? 0) > 0)
  return !(sov > 0 || trendMentions || engineMentions)
}

/**
 * False when the competitor counts contradict share of voice: a share below 100% means competitors
 * were mentioned, so a leaderboard where every competitor has 0 mentions (reports built from the
 * old mart, 14–15/09/26) must not label them "not mentioned yet".
 */
export function competitorCountsReliable(geo: GeoSectionData): boolean {
  const board = (geo.competitorLeaderboard ?? []).filter((c) => c && typeof c.name === 'string')
  if (board.length === 0) return true
  const sov = geo.sovOverall?.value
  if (sov == null || !Number.isFinite(sov) || sov >= 99.95) return true
  return board.some((c) => typeof c.mentions === 'number' && c.mentions > 0)
}

interface Ctx {
  locale: string
  wins: Insight[]
  watch: Insight[]
  actions: Insight[]
  /** Keywords already used by an action, so the list does not repeat one phrase three times. */
  usedPhrases: Set<string>
}

function push(ctx: Ctx, kind: InsightKind, section: SectionKey, key: string, score: number, params: Record<string, string | number>) {
  const item: Insight = { kind, key, params, score, section }
  if (kind === 'win') ctx.wins.push(item)
  else if (kind === 'watch') ctx.watch.push(item)
  else ctx.actions.push(item)
}

/** Positive/negative movement of a volume metric (clicks, sessions, impressions). */
function volumeMovement(
  ctx: Ctx,
  section: SectionKey,
  m: MetricWithDelta | undefined,
  keys: { up: string; down: string },
  weight: number,
  minPct = 5,
) {
  const pct = movementPct(m)
  if (m == null || pct == null || m.value == null) return
  const prev = previousOf(m)
  if (prev == null || (prev === 0 && m.value === 0)) return
  const params = {
    pct: fmtPct(ctx.locale, Math.abs(pct)),
    from: fmtInt(prev, ctx.locale),
    to: fmtInt(m.value, ctx.locale),
  }
  if (pct >= minPct) push(ctx, 'win', section, keys.up, Math.min(100, pct) * weight, params)
  else if (pct <= -minPct) push(ctx, 'watch', section, keys.down, Math.min(100, Math.abs(pct)) * weight, params)
}

function geoInsights(ctx: Ctx, geo: GeoSectionData) {
  const sov = geo.sovOverall
  const sovPct = sov?.value ?? null
  if (sov && hasBaseline(sov) && sov.delta != null && sovPct != null) {
    const prev = previousOf(sov)
    if (prev != null) {
      const params = { from: fmtPct(ctx.locale, prev, 1), to: fmtPct(ctx.locale, sovPct, 1), delta: fmtPct(ctx.locale, Math.abs(sov.delta), 1) }
      if (sov.delta >= 2) push(ctx, 'win', 'geo', 'sovUp', 40 + Math.min(60, sov.delta * 3), params)
      else if (sov.delta <= -2) push(ctx, 'watch', 'geo', 'sovDown', 40 + Math.min(60, Math.abs(sov.delta) * 3), params)
    }
  }

  const cite = geo.citationRate
  if (cite && hasBaseline(cite) && cite.delta != null && cite.value != null) {
    const prev = previousOf(cite)
    if (prev != null && !(prev === 0 && cite.value === 0)) {
      const params = { from: fmtPct(ctx.locale, prev, 1), to: fmtPct(ctx.locale, cite.value, 1) }
      if (cite.delta >= 2) push(ctx, 'win', 'geo', 'citationUp', 35 + Math.min(50, cite.delta * 2), params)
      else if (cite.delta <= -2) push(ctx, 'watch', 'geo', 'citationDown', 35 + Math.min(50, Math.abs(cite.delta) * 2), params)
    }
  }

  const splitOk = promptSplitReliable(geo)
  const mentioned = splitOk ? (geo.topPromptsMentioned ?? []).filter((p) => typeof p === 'string' && p.trim()) : []
  const missing = splitOk ? (geo.topPromptsNotMentioned ?? []).filter((p) => typeof p === 'string' && p.trim()) : []
  const total = mentioned.length + missing.length
  if (total > 0 && mentioned.length > 0) {
    const share = (mentioned.length / total) * 100
    // A state, not a movement: rank it below any real period-over-period change.
    push(ctx, 'win', 'geo', 'promptsWon', 10 + share / 5, {
      count: mentioned.length,
      total,
      pct: fmtPct(ctx.locale, share),
      list: joinList(mentioned),
    })
  }

  const leader = [...(geo.competitorLeaderboard ?? [])]
    .filter((c) => typeof c.mentions === 'number' && c.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions)[0]

  if (missing.length > 0) {
    const share = total > 0 ? (missing.length / total) * 100 : 0
    const base = { count: missing.length, total, pct: fmtPct(ctx.locale, share), list: joinList(missing) }
    if (leader) {
      push(ctx, 'watch', 'geo', 'promptsMissingCompetitor', 25 + share / 2, { ...base, competitor: leader.name })
    } else {
      push(ctx, 'watch', 'geo', 'promptsMissing', 20 + share / 2, base)
    }
    const first = missing[0]!
    if (leader) {
      push(ctx, 'action', 'geo', 'winPromptCompetitor', 58, { prompt: truncate(first), competitor: leader.name })
    } else {
      push(ctx, 'action', 'geo', 'winPrompt', 52, { prompt: truncate(first) })
    }
  }

  const engines = (geo.sovByEngine ?? []).filter((e) => e.sovPercent != null)
  if (engines.length > 1) {
    const sorted = [...engines].sort((a, b) => (b.sovPercent ?? 0) - (a.sovPercent ?? 0))
    const best = sorted[0]!
    const worst = sorted[sorted.length - 1]!
    if ((best.sovPercent ?? 0) >= 50) {
      const pct = fmtPct(ctx.locale, best.sovPercent ?? 0)
      push(ctx, 'win', 'geo', 'engineLead', 12 + (best.sovPercent ?? 0) / 5, {
        engine: normalizeEngine(best.engine),
        pct,
        nelPct: itPctArticle('nel', pct),
      })
    }
    if ((best.sovPercent ?? 0) - (worst.sovPercent ?? 0) >= 25 && (worst.sovPercent ?? 0) < 20) {
      const pct = fmtPct(ctx.locale, worst.sovPercent ?? 0)
      const bestPct = fmtPct(ctx.locale, best.sovPercent ?? 0)
      const params = {
        engine: normalizeEngine(worst.engine),
        pct,
        nelPct: itPctArticle('nel', pct),
        bestEngine: normalizeEngine(best.engine),
        bestPct,
        ilBestPct: itPctArticle('il', bestPct),
        nelBestPct: itPctArticle('nel', bestPct),
      }
      // "mentions the brand in only 0%" reads wrong in both languages: say it never does.
      const zero = (worst.sovPercent ?? 0) === 0
      push(ctx, 'watch', 'geo', zero ? 'engineGapZero' : 'engineGap', 30, params)
      push(ctx, 'action', 'geo', zero ? 'targetEngineZero' : 'targetEngine', 44, params)
    }
  }
}

function rankingInsights(ctx: Ctx, r: RankingsSectionData) {
  const avg = r.avgPosition
  if (avg && hasBaseline(avg) && avg.delta != null && avg.value != null) {
    const prev = previousOf(avg)
    if (prev != null) {
      const params = { from: fmtRank(ctx.locale, prev), to: fmtRank(ctx.locale, avg.value), delta: fmtDec(Math.abs(avg.delta), ctx.locale, 1) }
      if (avg.delta <= -0.5) push(ctx, 'win', 'rankings', 'avgPositionImproved', 30 + Math.min(50, Math.abs(avg.delta) * 8), params)
      else if (avg.delta >= 0.5) push(ctx, 'watch', 'rankings', 'avgPositionWorse', 30 + Math.min(50, avg.delta * 8), params)
    }
  }

  const movers = (r.topMovers ?? []).filter((m) => m.delta != null && m.delta !== 0)
  const withRanks = movers.filter((m) => m.currentRank != null && m.previousRank != null) as Array<{
    phrase: string
    currentRank: number
    previousRank: number
    delta: number
    url: string | null
  }>

  const enteredTop3 = withRanks.filter((m) => m.currentRank <= 3 && m.previousRank > 3)
  const enteredPage1 = withRanks.filter((m) => m.currentRank <= 10 && m.previousRank > 10 && !enteredTop3.includes(m))
  const droppedPage1 = withRanks.filter((m) => m.previousRank <= 10 && m.currentRank > 10)

  if (enteredTop3.length > 0) {
    push(ctx, 'win', 'rankings', 'enteredTop3', 45 + 10 * enteredTop3.length, {
      count: enteredTop3.length,
      list: joinList(enteredTop3.map((m) => m.phrase)),
    })
  }
  if (enteredPage1.length > 0) {
    push(ctx, 'win', 'rankings', 'enteredPage1', 35 + 8 * enteredPage1.length, {
      count: enteredPage1.length,
      list: joinList(enteredPage1.map((m) => m.phrase)),
    })
  }
  if (droppedPage1.length > 0) {
    push(ctx, 'watch', 'rankings', 'droppedPage1', 45 + 10 * droppedPage1.length, {
      count: droppedPage1.length,
      list: joinList(droppedPage1.map((m) => m.phrase)),
    })
    const worst = [...droppedPage1].sort((a, b) => a.previousRank - b.previousRank)[0]!
    if (!ctx.usedPhrases.has(worst.phrase)) {
      ctx.usedPhrases.add(worst.phrase)
      push(ctx, 'action', 'rankings', 'reclaimKeyword', 50, {
        phrase: worst.phrase,
        from: fmtRank(ctx.locale, worst.previousRank),
        to: fmtRank(ctx.locale, worst.currentRank),
      })
    }
  }

  const climbs = withRanks.filter((m) => m.delta > 0 && !enteredTop3.includes(m) && !enteredPage1.includes(m)).sort((a, b) => b.delta - a.delta)
  const bestClimb = climbs[0]
  if (bestClimb && bestClimb.delta >= 3) {
    push(ctx, 'win', 'rankings', 'keywordClimb', Math.min(55, 15 + bestClimb.delta * 3), {
      phrase: bestClimb.phrase,
      from: fmtRank(ctx.locale, bestClimb.previousRank),
      to: fmtRank(ctx.locale, bestClimb.currentRank),
      delta: Math.round(bestClimb.delta),
    })
  }
  const drops = withRanks.filter((m) => m.delta < 0 && !droppedPage1.includes(m)).sort((a, b) => a.delta - b.delta)
  const worstDrop = drops[0]
  if (worstDrop && Math.abs(worstDrop.delta) >= 3) {
    push(ctx, 'watch', 'rankings', 'keywordDrop', Math.min(55, 15 + Math.abs(worstDrop.delta) * 3), {
      phrase: worstDrop.phrase,
      from: fmtRank(ctx.locale, worstDrop.previousRank),
      to: fmtRank(ctx.locale, worstDrop.currentRank),
      delta: Math.round(Math.abs(worstDrop.delta)),
    })
  }

  // One push from page 1: positions 11–20, closest to 10 first.
  const nearPage1 = (r.table ?? [])
    .filter((k) => k.rank != null && k.rank >= 11 && k.rank <= 20 && !ctx.usedPhrases.has(k.phrase))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  for (const k of nearPage1.slice(0, 2)) {
    ctx.usedPhrases.add(k.phrase)
    push(ctx, 'action', 'rankings', 'keywordNearPage1', 48 - ((k.rank ?? 20) - 11), { phrase: k.phrase, rank: fmtRank(ctx.locale, k.rank!) })
  }
  const nearTop3 = (r.table ?? [])
    .filter((k) => k.rank != null && k.rank >= 4 && k.rank <= 5 && !ctx.usedPhrases.has(k.phrase))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]
  if (nearTop3) {
    ctx.usedPhrases.add(nearTop3.phrase)
    push(ctx, 'action', 'rankings', 'keywordNearTop3', 42, { phrase: nearTop3.phrase, rank: fmtRank(ctx.locale, nearTop3.rank!) })
  }
}

function gscInsights(ctx: Ctx, gsc: GscSectionData) {
  volumeMovement(ctx, 'gsc', gsc.clicks, { up: 'clicksUp', down: 'clicksDown' }, 1)
  volumeMovement(ctx, 'gsc', gsc.impressions, { up: 'impressionsUp', down: 'impressionsDown' }, 0.6, 10)

  // Impressions up, clicks not following: the SERP shows the site more, people click it less → titles/meta.
  const impPct = movementPct(gsc.impressions)
  const clickPct = movementPct(gsc.clicks)
  if (impPct != null && clickPct != null && impPct >= 10 && clickPct < 3 && (gsc.impressions?.value ?? 0) > 0) {
    push(ctx, 'watch', 'gsc', 'ctrGap', 50, { impPct: fmtPct(ctx.locale, impPct), clicksPct: `${clickPct >= 0 ? '+' : '-'}${fmtPct(ctx.locale, Math.abs(clickPct))}` })
  }

  const queries = gscTopRows(gsc.topQueries)
  const pages = gscTopRows(gsc.topPages)
  const maxImp = Math.max(0, ...queries.map((q) => q.impressions), ...pages.map((p) => p.impressions))

  // Query already on page 1 but rarely clicked: a title/meta rewrite is the cheapest lever available.
  const lowCtrQuery = queries
    .filter((q) => q.position != null && q.position <= 10 && q.impressions >= Math.max(300, maxImp * 0.15) && q.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)[0]
  if (lowCtrQuery) {
    push(ctx, 'action', 'gsc', 'improveCtrQuery', 60 + Math.min(20, Math.log10(lowCtrQuery.impressions + 1) * 3), {
      query: lowCtrQuery.key,
      impressions: fmtInt(lowCtrQuery.impressions, ctx.locale),
      ctr: fmtPct(ctx.locale, lowCtrQuery.ctr * 100, 1),
      position: lowCtrQuery.position != null ? fmtRank(ctx.locale, Math.round(lowCtrQuery.position * 10) / 10) : '—',
    })
  }

  const lowCtrPage = pages
    .filter((p) => p.position != null && p.position <= 12 && p.impressions >= Math.max(300, maxImp * 0.15) && p.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)[0]
  if (lowCtrPage) {
    push(ctx, 'action', 'gsc', 'improveCtrPage', 58 + Math.min(20, Math.log10(lowCtrPage.impressions + 1) * 3), {
      page: truncate(pagePath(lowCtrPage.key)),
      impressions: fmtInt(lowCtrPage.impressions, ctx.locale),
      ctr: fmtPct(ctx.locale, lowCtrPage.ctr * 100, 1),
    })
  }

  // Page-2 queries with real demand: one push from page 1.
  const nearPage1 = queries
    .filter((q) => q.position != null && q.position >= 11 && q.position <= 20 && q.impressions >= 50 && !ctx.usedPhrases.has(q.key))
    .sort((a, b) => b.impressions - a.impressions)
  for (const q of nearPage1.slice(0, 2)) {
    ctx.usedPhrases.add(q.key)
    push(ctx, 'action', 'gsc', 'queryNearPage1', 55 + Math.min(15, Math.log10(q.impressions + 1) * 3), {
      query: q.key,
      position: fmtRank(ctx.locale, Math.round(q.position! * 10) / 10),
      impressions: fmtInt(q.impressions, ctx.locale),
    })
  }

  // Best query of the period (state, low weight) so a first report still says something concrete.
  const top = [...queries].sort((a, b) => b.clicks - a.clicks)[0]
  if (top && top.clicks > 0) {
    push(ctx, 'win', 'gsc', 'topQuery', 8 + Math.min(12, Math.log10(top.clicks + 1) * 3), {
      query: top.key,
      clicks: fmtInt(top.clicks, ctx.locale),
      position: top.position != null ? fmtRank(ctx.locale, Math.round(top.position * 10) / 10) : '—',
    })
  }
}

function ga4Insights(ctx: Ctx, ga4: Ga4SectionData) {
  volumeMovement(ctx, 'ga4', ga4.sessions, { up: 'sessionsUp', down: 'sessionsDown' }, 0.9)
  volumeMovement(ctx, 'ga4', ga4.aiAssistantSessions, { up: 'aiSessionsUp', down: 'aiSessionsDown' }, 0.8, 10)
  volumeMovement(ctx, 'ga4', ga4.keyEvents, { up: 'keyEventsUp', down: 'keyEventsDown' }, 1.1)

  const share = ga4.organicShare
  if (share && hasBaseline(share) && share.delta != null && share.value != null) {
    const prev = previousOf(share)
    if (prev != null) {
      const params = { from: fmtPct(ctx.locale, prev, 1), to: fmtPct(ctx.locale, share.value, 1) }
      if (share.delta <= -2) push(ctx, 'watch', 'ga4', 'organicShareDown', 30 + Math.min(40, Math.abs(share.delta) * 3), params)
      else if (share.delta >= 2) push(ctx, 'win', 'ga4', 'organicShareUp', 25 + Math.min(40, share.delta * 3), params)
    }
  }

  const aiVal = ga4.aiAssistantSessions?.value
  if (aiVal != null && aiVal > 0 && !hasBaseline(ga4.aiAssistantSessions)) {
    push(ctx, 'win', 'ga4', 'aiSessionsState', 10 + Math.min(15, Math.log10(aiVal + 1) * 4), { sessions: fmtInt(aiVal, ctx.locale) })
  }

  const landing = ga4PageRows(ga4.topLandingPages).sort((a, b) => b.sessions - a.sessions)[0]
  if (landing && landing.sessions > 0) {
    push(ctx, 'win', 'ga4', 'topLandingPage', 6 + Math.min(10, Math.log10(landing.sessions + 1) * 2), {
      page: truncate(pagePath(landing.key)),
      sessions: fmtInt(landing.sessions, ctx.locale),
    })
  }
}

function healthInsights(ctx: Ctx, s: SiteHealthSectionData) {
  if (s.auditScore == null) return
  if (s.auditScore < 60) {
    push(ctx, 'watch', 'site_health', 'healthLow', 20 + (60 - s.auditScore) / 2, { score: Math.round(s.auditScore) })
    push(ctx, 'action', 'site_health', 'fixHealth', 30 + (60 - s.auditScore) / 2, { score: Math.round(s.auditScore) })
  }
}

function backlinkInsights(ctx: Ctx, b: BacklinksSectionData) {
  if (typeof b.new === 'number' && b.new > 0) {
    push(ctx, 'win', 'backlinks', 'newBacklinks', 10 + Math.min(25, b.new * 2), { count: b.new, domains: fmtInt(b.referringDomains ?? 0, ctx.locale) })
  }
  if (typeof b.lost === 'number' && b.lost > 0 && b.lost >= (b.new ?? 0)) {
    push(ctx, 'watch', 'backlinks', 'lostBacklinks', 15 + Math.min(30, b.lost * 2), { count: b.lost })
  }
}

function summaryFallbacks(ctx: Ctx, data: ReportData) {
  // Health score movement lives only in the summary block.
  const h = data.summary?.healthScore
  if (h && hasBaseline(h) && h.delta != null && h.value != null) {
    const prev = previousOf(h)
    if (prev != null) {
      const params = { from: Math.round(prev), to: Math.round(h.value), delta: Math.round(Math.abs(h.delta)) }
      if (h.delta >= 3) push(ctx, 'win', 'summary', 'healthUp', 20 + Math.min(40, h.delta * 2), params)
      else if (h.delta <= -3) push(ctx, 'watch', 'summary', 'healthDown', 20 + Math.min(40, Math.abs(h.delta) * 2), params)
    }
  }
}

function byScore(items: Insight[]): Insight[] {
  return [...items].sort((a, b) => b.score - a.score)
}

export function deriveBriefing(data: ReportData | null | undefined, opts: BriefingOptions = {}): Briefing {
  const ctx: Ctx = { locale: opts.locale ?? 'en-US', wins: [], watch: [], actions: [], usedPhrases: new Set() }
  const max = opts.maxPerGroup ?? 3
  if (!data) return { wins: [], watch: [], actions: [] }

  if (isConnectedSection<GeoSectionData>(data.geo)) geoInsights(ctx, data.geo)
  if (isConnectedSection<RankingsSectionData>(data.rankings)) rankingInsights(ctx, data.rankings)
  if (isConnectedSection<GscSectionData>(data.gsc)) gscInsights(ctx, data.gsc)
  if (isConnectedSection<Ga4SectionData>(data.ga4)) ga4Insights(ctx, data.ga4)
  if (isConnectedSection<SiteHealthSectionData>(data.site_health)) healthInsights(ctx, data.site_health)
  if (isConnectedSection<BacklinksSectionData>(data.backlinks)) backlinkInsights(ctx, data.backlinks)
  summaryFallbacks(ctx, data)

  return {
    wins: byScore(ctx.wins).slice(0, max),
    watch: byScore(ctx.watch).slice(0, max),
    actions: byScore(ctx.actions).slice(0, max),
  }
}

export function briefingIsEmpty(b: Briefing): boolean {
  return b.wins.length === 0 && b.watch.length === 0 && b.actions.length === 0
}

/** True when at least one headline metric carries a prior-period comparison. */
export function hasAnyBaseline(data: ReportData | null | undefined): boolean {
  if (!data) return false
  const metrics: Array<MetricWithDelta | undefined> = []
  if (data.summary) metrics.push(...Object.values(data.summary))
  if (isConnectedSection<GscSectionData>(data.gsc)) metrics.push(data.gsc.clicks, data.gsc.impressions)
  if (isConnectedSection<Ga4SectionData>(data.ga4)) metrics.push(data.ga4.sessions)
  if (isConnectedSection<GeoSectionData>(data.geo)) metrics.push(data.geo.sovOverall)
  if (isConnectedSection<RankingsSectionData>(data.rankings)) metrics.push(data.rankings.avgPosition)
  // 0 → 0 is a connected-but-empty source, not a comparison.
  return metrics.some((m) => hasBaseline(m) && !(m?.value === 0 && m?.delta === 0))
}
