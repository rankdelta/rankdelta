/**
 * Assemble immutable report data JSON from Postgres marts + integration caches.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  REPORT_SECTIONS,
  buildAiAttribution,
  buildDistributionBuckets,
  buildReportSummary,
  readMetric,
  filterDailyRows,
  metric,
  nearestCachePeriodDays,
  isNullSection,
  nullSection,
  normalizeDomain,
  periodDayCount,
  previousPeriod,
  shareOfVoice,
  sumDailyField,
  type SectionKey,
} from './reportBuild.ts'
import { buildCorrectedReportSummary } from './reportSummary.ts'
import {
  brandTermsFrom,
  brandedPromptResults,
  classifyVisibilityPrompts,
  competitorMentionCounts,
  groupVisibilityRunsByQuery,
  isBrandedPrompt,
  mentionCounts,
  mentionCountsBy,
  ownCitationCounts,
  ownCitationRate,
  runsInPeriod,
  sentimentCounts,
  splitBrandedPrompts,
  topCitedSourceDomains,
  type TrackedBrandTerms,
  type VisibilityRunRow,
} from './reportVisibility.ts'

type GscDaily = { date: string; clicks: number; impressions: number }
type Ga4Daily = { date: string; sessions: number; users?: number }

export interface AssembleReportInput {
  projectId: string
  periodStart: string
  periodEnd: string
  websiteUrl: string | null
  locale: string
}

export interface AssembledReport {
  sections: SectionKey[]
  data: Record<string, unknown>
}

type GeoMartRow = {
  day: string
  provider: string
  your_mentions: number | null
  competitor_mentions: number | null
  citations: number | null
  run_count: number | null
}

type RankingMartRow = {
  keyword_id: string
  phrase: string
  day: string
  rank_absolute: number | null
  ranking_url: string | null
  checked_at: string
}

interface FetchedReportData {
  gscProp: { id: string } | null
  ga4Prop: { id: string } | null
  gscCache: {
    clicks: number
    impressions: number
    ctr: number
    avg_position: number
    top_queries: unknown
    top_pages: unknown
    daily_data: unknown
    fetched_at: string | null
  } | null
  ga4Cache: {
    sessions: number
    users: number
    pageviews: number
    bounce_rate: number
    top_pages: unknown
    top_sources: unknown
    daily_data: unknown
  } | null
  geoRows: GeoMartRow[]
  rankRows: RankingMartRow[]
  siteAudit: { result: unknown; audited_at: string } | null
  visibilityRows: VisibilityRunRow[]
  competitors: Array<{ id: string; name: string; domain: string }>
  backlinkRows: Array<{ referring_domain: string; fetched_at: string }>
  trackedBrands: TrackedBrandTerms[]
}

interface AssemblyContext {
  periodStart: string
  periodEnd: string
  prev: { start: string; end: string }
  websiteUrl: string | null
  locale: string
  fetched: FetchedReportData
}

type SectionBuildOutcome =
  | { ok: true; key: SectionKey; value: unknown; geoSection?: Record<string, unknown> | null; ga4Sources?: Array<{ source: string; sessions: number }> }
  | { ok: false; key: SectionKey; error: string }

function logStage(stage: string, ms: number, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ tag: 'reportAssemble', stage, ms, ...extra }))
}

function logFetchError(query: string, result: { error?: { message: string } | null }): void {
  if (result.error) {
    console.warn(
      JSON.stringify({ tag: 'reportAssemble', stage: 'fetch_error', query, message: result.error.message }),
    )
  }
}

async function timedSectionBuild(
  key: SectionKey,
  build: () => SectionBuildOutcome,
): Promise<SectionBuildOutcome> {
  const start = Date.now()
  try {
    const outcome = await Promise.resolve(build())
    logStage(`section:${key}`, Date.now() - start, { ok: outcome.ok })
    return outcome
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logStage(`section:${key}`, Date.now() - start, { ok: false, error: message })
    return { ok: false, key, error: message }
  }
}

async function fetchReportData(
  admin: SupabaseClient,
  projectId: string,
  periodStart: string,
  periodEnd: string,
  prev: { start: string; end: string },
  websiteUrl: string | null,
  cacheDays: number,
): Promise<FetchedReportData> {
  const fetchStart = Date.now()
  const [
    gscProp,
    ga4Prop,
    gscCache,
    ga4Cache,
    geoMart,
    rankingMart,
    siteAudit,
    visibilityQueryRuns,
    competitors,
    backlinkRows,
    trackedBrands,
  ] = await Promise.all([
    admin.from('gsc_properties').select('id').eq('project_id', projectId).limit(1).maybeSingle(),
    admin.from('ga4_properties').select('id').eq('project_id', projectId).eq('verified', true).maybeSingle(),
    admin
      .from('gsc_analytics_cache')
      .select('clicks, impressions, ctr, avg_position, top_queries, top_pages, daily_data, fetched_at')
      .eq('project_id', projectId)
      .eq('period_days', cacheDays)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('ga4_analytics_cache')
      .select('sessions, users, pageviews, bounce_rate, top_pages, top_sources, daily_data')
      .eq('project_id', projectId)
      .eq('period_days', cacheDays)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('report_geo_daily_mart')
      .select('day, provider, your_mentions, competitor_mentions, citations, run_count')
      .eq('project_id', projectId)
      .gte('day', prev.start)
      .lte('day', periodEnd),
    admin
      .from('report_ranking_daily_mart')
      .select('keyword_id, phrase, day, rank_absolute, ranking_url, checked_at')
      .eq('project_id', projectId)
      .gte('day', prev.start)
      .lte('day', periodEnd),
    admin.from('site_audits').select('result, audited_at').eq('project_id', projectId).maybeSingle(),
    fetchVisibilityRuns(admin, projectId, prev.start),
    admin.from('competitor_brands').select('id, name, domain').eq('project_id', projectId),
    websiteUrl
      ? admin
          .from('backlink_referring_domains')
          .select('referring_domain, fetched_at')
          .eq('target_domain', normalizeDomain(websiteUrl))
      : Promise.resolve({ data: [], error: null }),
    admin.from('tracked_brands').select('name, domain, aliases').eq('project_id', projectId),
  ])
  logStage('fetch', Date.now() - fetchStart, { queryCount: 11 })
  logFetchError('gsc_properties', gscProp)
  logFetchError('ga4_properties', ga4Prop)
  logFetchError('gsc_analytics_cache', gscCache)
  logFetchError('ga4_analytics_cache', ga4Cache)
  logFetchError('report_geo_daily_mart', geoMart)
  logFetchError('report_ranking_daily_mart', rankingMart)
  logFetchError('site_audits', siteAudit)
  logFetchError('visibility_query_runs', visibilityQueryRuns)
  logFetchError('competitor_brands', competitors)
  logFetchError('backlink_referring_domains', backlinkRows)
  logFetchError('tracked_brands', trackedBrands)

  return {
    gscProp: gscProp.data,
    ga4Prop: ga4Prop.data,
    gscCache: gscCache.data,
    ga4Cache: ga4Cache.data,
    geoRows: geoMart.data ?? [],
    rankRows: rankingMart.data ?? [],
    siteAudit: siteAudit.data,
    visibilityRows: (visibilityQueryRuns.data ?? []) as unknown as VisibilityRunRow[],
    competitors: competitors.data ?? [],
    backlinkRows: backlinkRows.data ?? [],
    trackedBrands: (trackedBrands.data ?? []) as TrackedBrandTerms[],
  }
}

const RUNS_PAGE = 1000
const RUNS_MAX_PAGES = 10

/**
 * Every answer of the project's active prompts since the previous period started, newest first.
 * PostgREST caps a response at 1000 rows whatever `.limit()` asks for, so read it in pages
 * (a busy project runs ~250 answers a week).
 */
async function fetchVisibilityRuns(
  admin: SupabaseClient,
  projectId: string,
  since: string,
): Promise<{ data: VisibilityRunRow[]; error: { message: string } | null }> {
  const rows: VisibilityRunRow[] = []
  for (let page = 0; page < RUNS_MAX_PAGES; page++) {
    const { data, error } = await admin
      .from('visibility_query_runs')
      .select(
        'id, run_at, status, provider, mentioned_brands, visibility_brand_mentions(tracked_brand_id, competitor_brand_id, brand_name, sentiment), visibility_citations(source_domain, source_url), visibility_queries!inner(id, text, is_active, project_id)',
      )
      .eq('visibility_queries.project_id', projectId)
      .eq('visibility_queries.is_active', true)
      .gte('run_at', `${since}T00:00:00Z`)
      .order('run_at', { ascending: false })
      .range(page * RUNS_PAGE, (page + 1) * RUNS_PAGE - 1)
    if (error) return { data: rows, error }
    const batch = (data ?? []) as unknown as VisibilityRunRow[]
    rows.push(...batch)
    if (batch.length < RUNS_PAGE) break
  }
  return { data: rows, error: null }
}

function computeEngineSovByEngine(
  geoRows: GeoMartRow[],
  periodStart: string,
  periodEnd: string,
): Array<{ engine: string; sovPercent: number | null }> {
  const curGeo = geoRows.filter((r) => r.day >= periodStart && r.day <= periodEnd)
  const byEngine: Record<string, { yours: number; competitors: number }> = {}
  for (const r of curGeo) {
    const eng = byEngine[r.provider] ?? { yours: 0, competitors: 0 }
    eng.yours += r.your_mentions ?? 0
    eng.competitors += r.competitor_mentions ?? 0
    byEngine[r.provider] = eng
  }
  return Object.entries(byEngine).map(([engine, v]) => ({
    engine,
    sovPercent: shareOfVoice(v.yours, v.competitors),
  }))
}

/**
 * AI visibility (GEO) section.
 *
 * Measured on the answers themselves, active prompts only:
 * - Share of Voice, prompts won/missing, competitors, citation rate and sources use DISCOVERY
 *   prompts (the ones that don't name the brand). A branded prompt ("Acme vs Rival") gets Acme
 *   mentioned by construction, so counting it inflated every number; branded prompts are listed
 *   on their own in `brandedPrompts`. When a period has no discovery answers at all, the section
 *   falls back to every prompt and says so (`sovScope: 'all'`).
 * - Each mention counts once. The report_geo_daily_mart view is only a fallback for projects
 *   with no readable answers: it multiplies mentions by cited sources and keeps prompts that were
 *   switched off.
 */
function buildGeoSection(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, prev, fetched } = ctx
  const geoRows = fetched.geoRows
  if (geoRows.length === 0 && fetched.visibilityRows.length === 0) {
    return { ok: true, key: 'geo', value: nullSection('not_connected'), geoSection: null }
  }

  const periodRuns = runsInPeriod(fetched.visibilityRows, periodStart, periodEnd)
  const prevRuns = runsInPeriod(fetched.visibilityRows, prev.start, prev.end)
  if (periodRuns.length === 0 && prevRuns.length === 0) return buildGeoSectionFromMart(ctx)

  const terms = brandTermsFrom(fetched.trackedBrands)
  const discoveryOnly = (runs: VisibilityRunRow[]) =>
    runs.filter((r) => !isBrandedPrompt(r.visibility_queries?.text ?? '', terms))
  const curDiscovery = discoveryOnly(periodRuns)
  const hasDiscoveryAnswers = curDiscovery.some((r) => r.status === 'completed')
  const sovScope: 'discovery' | 'all' = hasDiscoveryAnswers ? 'discovery' : 'all'
  const curRuns = hasDiscoveryAnswers ? curDiscovery : periodRuns
  const prevScopeRuns = hasDiscoveryAnswers ? discoveryOnly(prevRuns) : prevRuns

  const cur = mentionCounts(curRuns)
  const previous = mentionCounts(prevScopeRuns)
  const byEngine = mentionCountsBy(curRuns, (r) => r.provider ?? null)
  const byDay = mentionCountsBy(curRuns, (r) => (typeof r.run_at === 'string' ? r.run_at.slice(0, 10) : null))

  const grouped = groupVisibilityRunsByQuery(periodRuns)
  const { discovery, branded } = splitBrandedPrompts(grouped, terms)
  const { mentioned: mentionedPrompts, notMentioned: notMentionedPrompts } = classifyVisibilityPrompts(
    sovScope === 'discovery' ? discovery : grouped,
  )

  const competitorMentions = competitorMentionCounts(curRuns)
  const competitorLeaderboard = fetched.competitors
    .map((c) => ({ id: c.id, name: c.name, mentions: competitorMentions.get(c.id) ?? 0 }))
    .sort((a, b) => b.mentions - a.mentions)

  const completedCount = (runs: VisibilityRunRow[]) => runs.filter((r) => r.status === 'completed').length

  const geoSection = {
    sovOverall: metric(
      shareOfVoice(cur.yours, cur.competitors),
      prevScopeRuns.length > 0 ? shareOfVoice(previous.yours, previous.competitors) : null,
    ),
    sovByEngine: [...byEngine.entries()].map(([engine, v]) => ({
      engine,
      sovPercent: shareOfVoice(v.yours, v.competitors),
    })),
    trend: [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        yours: v.yours,
        competitors: v.competitors,
        sovPercent: shareOfVoice(v.yours, v.competitors),
      })),
    topPromptsMentioned: mentionedPrompts.slice(0, 10),
    topPromptsNotMentioned: notMentionedPrompts.slice(0, 10),
    brandedPrompts: sovScope === 'discovery' ? brandedPromptResults(branded).slice(0, 10) : [],
    promptCounts: { discovery: discovery.size, branded: branded.size },
    sovScope,
    competitorLeaderboard,
    citationRate: metric(
      ownCitationRate(curRuns, ctx.websiteUrl),
      prevScopeRuns.length > 0 ? ownCitationRate(prevScopeRuns, ctx.websiteUrl) : null,
    ),
    // The sample behind the rate: "3 of 6 answers with sources" reads very differently from 50%.
    citationCounts: ownCitationCounts(curRuns, ctx.websiteUrl),
    // How the AI talks about the brand: branded prompts ("is Acme any good?") belong here.
    sentiment: sentimentCounts(periodRuns),
    topCitedSources: topCitedSourceDomains(curRuns, periodStart, periodEnd),
    runCounts: { current: completedCount(periodRuns), previous: completedCount(prevRuns) },
  }
  return { ok: true, key: 'geo', value: geoSection, geoSection }
}

/** Fallback when no answers can be read: the nightly mart (see the caveats above). */
function buildGeoSectionFromMart(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, prev, fetched } = ctx
  const geoRows = fetched.geoRows
  const curGeo = geoRows.filter((r) => r.day >= periodStart && r.day <= periodEnd)
  const prevGeo = geoRows.filter((r) => r.day >= prev.start && r.day <= prev.end)
  let curYours = 0
  let curComp = 0
  let prevYours = 0
  let prevComp = 0
  let curRuns = 0
  const trendMap = new Map<string, { yours: number; competitors: number }>()

  for (const r of curGeo) {
    curYours += r.your_mentions ?? 0
    curComp += r.competitor_mentions ?? 0
    curRuns += r.run_count ?? 0
    const t = trendMap.get(r.day) ?? { yours: 0, competitors: 0 }
    t.yours += r.your_mentions ?? 0
    t.competitors += r.competitor_mentions ?? 0
    trendMap.set(r.day, t)
  }
  for (const r of prevGeo) {
    prevYours += r.your_mentions ?? 0
    prevComp += r.competitor_mentions ?? 0
  }

  const geoSection = {
    sovOverall: metric(shareOfVoice(curYours, curComp), shareOfVoice(prevYours, prevComp)),
    sovByEngine: computeEngineSovByEngine(geoRows, periodStart, periodEnd),
    trend: [...trendMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        yours: v.yours,
        competitors: v.competitors,
        sovPercent: shareOfVoice(v.yours, v.competitors),
      })),
    topPromptsMentioned: [],
    topPromptsNotMentioned: [],
    brandedPrompts: [],
    promptCounts: { discovery: 0, branded: 0 },
    sovScope: 'all' as const,
    competitorLeaderboard: fetched.competitors.map((c) => ({ id: c.id, name: c.name, mentions: 0 })),
    citationRate: metric(null, null),
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    topCitedSources: [],
    runCounts: { current: curRuns, previous: prevGeo.reduce((s, r) => s + (r.run_count ?? 0), 0) },
  }
  return { ok: true, key: 'geo', value: geoSection, geoSection }
}

function buildRankingsSection(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, prev, fetched } = ctx
  const rankRows = fetched.rankRows
  if (rankRows.length === 0) {
    return { ok: true, key: 'rankings', value: nullSection('not_connected') }
  }

  const curRanks = rankRows.filter((r) => r.day >= periodStart && r.day <= periodEnd)
  const prevRanks = rankRows.filter((r) => r.day >= prev.start && r.day <= prev.end)
  const latestByKeyword = new Map<string, { phrase: string; rank: number | null; url: string | null; day: string }>()
  for (const r of curRanks) {
    const ex = latestByKeyword.get(r.keyword_id)
    if (!ex || r.day > ex.day) {
      latestByKeyword.set(r.keyword_id, {
        phrase: r.phrase,
        rank: r.rank_absolute,
        url: r.ranking_url,
        day: r.day,
      })
    }
  }
  const prevLatestByKeyword = new Map<string, { rank: number | null; day: string }>()
  for (const r of prevRanks) {
    const ex = prevLatestByKeyword.get(r.keyword_id)
    if (!ex || r.day > ex.day) {
      prevLatestByKeyword.set(r.keyword_id, {
        rank: r.rank_absolute,
        day: r.day,
      })
    }
  }

  const positions = [...latestByKeyword.values()].map((v) => v.rank)
  const positivePositions = positions.filter((p): p is number => p != null && p > 0)
  const avgCur =
    positivePositions.length > 0
      ? positivePositions.reduce((a, b) => a + b, 0) / positivePositions.length
      : null
  const prevPositions = [...prevLatestByKeyword.values()].map((v) => v.rank)
  const positivePrev = prevPositions.filter((p): p is number => p != null && p > 0)
  const avgPrev =
    positivePrev.length > 0 ? positivePrev.reduce((a, b) => a + b, 0) / positivePrev.length : null

  const movers = [...latestByKeyword.entries()]
    .map(([kid, cur]) => {
      const prevRank = prevLatestByKeyword.get(kid)?.rank ?? null
      const delta =
        cur.rank != null && prevRank != null ? Math.round((prevRank - cur.rank) * 10) / 10 : null
      return { phrase: cur.phrase, currentRank: cur.rank, previousRank: prevRank, delta, url: cur.url }
    })
    .filter((m) => m.delta != null && m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .slice(0, 10)

  return {
    ok: true,
    key: 'rankings',
    value: {
      avgPosition: metric(avgCur != null ? Math.round(avgCur * 10) / 10 : null, avgPrev != null ? Math.round(avgPrev * 10) / 10 : null),
      distribution: buildDistributionBuckets(positions),
      topMovers: movers,
      table: [...latestByKeyword.values()].map((v) => ({
        phrase: v.phrase,
        rank: v.rank,
        url: v.url,
      })),
    },
  }
}

function buildGscSection(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, prev, fetched } = ctx
  if (!fetched.gscProp) {
    return { ok: true, key: 'gsc', value: nullSection('not_connected') }
  }
  if (!fetched.gscCache) {
    return { ok: true, key: 'gsc', value: nullSection('not_connected') }
  }

  const daily = (fetched.gscCache.daily_data as GscDaily[]) ?? []
  const curDaily = filterDailyRows(daily, periodStart, periodEnd)
  const prevDaily = filterDailyRows(daily, prev.start, prev.end)
  const clicks = sumDailyField(curDaily, periodStart, periodEnd, 'clicks')
  const prevClicks = sumDailyField(prevDaily, prev.start, prev.end, 'clicks')
  const impressions = sumDailyField(curDaily, periodStart, periodEnd, 'impressions')
  const prevImpressions = sumDailyField(prevDaily, prev.start, prev.end, 'impressions')

  // Freshness. The GSC cache is only written when the user connects or syncs
  // manually — no scheduled refresh exists — so a connected project can hold a
  // snapshot that predates the report period entirely. When that happens the
  // daily rows do not cover the period and clicks/impressions sum to 0, while
  // avg_position still carries the old cache-level aggregate. Reporting that as
  // current period data is wrong, so surface the age and let the UI label or
  // suppress it instead of presenting stale numbers as fresh.
  const fetchedAt = (fetched.gscCache.fetched_at as string | null) ?? null
  const coversPeriod = curDaily.length > 0
  const staleAgainstPeriod = Boolean(fetchedAt) && fetchedAt! < periodEnd && !coversPeriod

  return {
    ok: true,
    key: 'gsc',
    value: {
      clicks: metric(clicks, prevClicks),
      impressions: metric(impressions, prevImpressions),
      ctr: metric(
        impressions > 0 ? (clicks / impressions) * 100 : 0,
        prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0,
      ),
      avgPosition: metric(fetched.gscCache.avg_position as number, fetched.gscCache.avg_position as number),
      trend: curDaily,
      topQueries: ((fetched.gscCache.top_queries as unknown[]) ?? []).slice(0, 20),
      topPages: ((fetched.gscCache.top_pages as unknown[]) ?? []).slice(0, 20),
      dataAsOf: fetchedAt,
      coversPeriod,
      stale: staleAgainstPeriod,
    },
  }
}

function mapGa4TopSources(topSources: unknown): Array<{ source: string; sessions: number }> {
  return ((topSources as Array<{ key: string; sessions: number }>) ?? []).map((s) => ({
    source: s.key,
    sessions: s.sessions,
  }))
}

function buildGa4Section(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, prev, fetched } = ctx
  if (!fetched.ga4Prop) {
    return { ok: true, key: 'ga4', value: nullSection('not_connected'), ga4Sources: [] }
  }
  if (!fetched.ga4Cache) {
    return { ok: true, key: 'ga4', value: nullSection('not_connected'), ga4Sources: [] }
  }

  const daily = (fetched.ga4Cache.daily_data as Ga4Daily[]) ?? []
  const curDaily = filterDailyRows(daily, periodStart, periodEnd)
  const prevDaily = filterDailyRows(daily, prev.start, prev.end)
  const sessions = sumDailyField(curDaily, periodStart, periodEnd, 'sessions')
  const prevSessions = sumDailyField(prevDaily, prev.start, prev.end, 'sessions')
  const users = sumDailyField(
    curDaily.map((d) => ({ ...d, users: d.users ?? 0 })),
    periodStart,
    periodEnd,
    'users',
  )
  const prevUsers = sumDailyField(
    prevDaily.map((d) => ({ ...d, users: d.users ?? 0 })),
    prev.start,
    prev.end,
    'users',
  )

  const topSources = mapGa4TopSources(fetched.ga4Cache.top_sources)
  const organicSessions = topSources
    .filter((s) => /google|bing|duckduck|yahoo|organic/i.test(s.source))
    .reduce((a, b) => a + b.sessions, 0)
  const aiSessions = topSources
    .filter((s) => /chatgpt|perplexity|gemini|claude|copilot|openai|bard/i.test(s.source))
    .reduce((a, b) => a + b.sessions, 0)
  const engagedEstimate = Math.round(sessions * (1 - (fetched.ga4Cache.bounce_rate as number ?? 0)))

  return {
    ok: true,
    key: 'ga4',
    value: {
      sessions: metric(sessions, prevSessions),
      users: metric(users, prevUsers),
      engagedSessions: metric(engagedEstimate, null),
      keyEvents: metric(null, null),
      organicShare: metric(sessions > 0 ? Math.round((1000 * organicSessions) / sessions) / 10 : null, null),
      aiAssistantSessions: metric(aiSessions, null),
      trend: curDaily,
      topLandingPages: ((fetched.ga4Cache.top_pages as unknown[]) ?? []).slice(0, 20),
      topSources,
    },
    ga4Sources: topSources,
  }
}

function buildSiteHealthSection(ctx: AssemblyContext): SectionBuildOutcome {
  const { fetched } = ctx
  if (!fetched.siteAudit?.result) {
    return { ok: true, key: 'site_health', value: nullSection('not_connected') }
  }
  const result = fetched.siteAudit.result as Record<string, unknown>
  const issues = Array.isArray(result.issues) ? result.issues : []
  return {
    ok: true,
    key: 'site_health',
    value: {
      auditScore: (result.compositeHealth ?? result.healthScore ?? null) as number | null,
      topIssues: issues.slice(0, 5),
      auditedAt: fetched.siteAudit.audited_at,
    },
  }
}

function buildBacklinksSection(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, websiteUrl, fetched } = ctx
  if (!websiteUrl) {
    return { ok: true, key: 'backlinks', value: nullSection('not_connected') }
  }
  const rows = fetched.backlinkRows
  // No stored referring domains = backlinks were never analysed for this site. Reporting
  // "0 referring domains" turned a missing source into a finding: the narrative told a client
  // to "prioritize backlink acquisition given 0 referring domains".
  if (rows.length === 0) {
    return { ok: true, key: 'backlinks', value: nullSection('not_connected') }
  }
  const periodStartMs = new Date(`${periodStart}T00:00:00Z`).getTime()
  const periodEndMs = new Date(`${periodEnd}T23:59:59Z`).getTime()
  const newDomains = rows.filter((r) => {
    const t = new Date(r.fetched_at).getTime()
    return t >= periodStartMs && t <= periodEndMs
  }).length
  return {
    ok: true,
    key: 'backlinks',
    value: {
      referringDomains: rows.length,
      new: newDomains,
      lost: null,
    },
  }
}

function buildAiAttributionSectionFromCtx(ctx: AssemblyContext): SectionBuildOutcome {
  const { periodStart, periodEnd, fetched } = ctx
  const engineSov = computeEngineSovByEngine(fetched.geoRows, periodStart, periodEnd)
  const ga4Sources = fetched.ga4Cache ? mapGa4TopSources(fetched.ga4Cache.top_sources) : []
  return buildAiAttributionSection(
    engineSov.length > 0 ? { sovByEngine: engineSov } : null,
    ga4Sources,
    Boolean(fetched.ga4Cache),
  )
}

function sectionValueOrPlaceholder(outcome: SectionBuildOutcome): unknown {
  if (!outcome.ok) return nullSection('not_connected')
  return outcome.value
}

/** Build summary KPIs from fetched data (runs in parallel with section builders). */
function buildSummarySectionFromCtx(ctx: AssemblyContext): SectionBuildOutcome {
  const geo = buildGeoSection(ctx)
  const rankings = buildRankingsSection(ctx)
  const gsc = buildGscSection(ctx)
  const ga4 = buildGa4Section(ctx)
  const siteHealth = buildSiteHealthSection(ctx)
  const partial: Record<string, unknown> = {
    rankings: sectionValueOrPlaceholder(rankings),
    gsc: sectionValueOrPlaceholder(gsc),
    ga4: sectionValueOrPlaceholder(ga4),
    site_health: sectionValueOrPlaceholder(siteHealth),
  }
  const geoSection = geo.ok && geo.geoSection ? geo.geoSection : null
  return { ok: true, key: 'summary', value: buildCorrectedReportSummary(partial, geoSection) }
}

function buildAiAttributionSection(
  geoSection: Record<string, unknown> | null,
  ga4Sources: Array<{ source: string; sessions: number }>,
  ga4Connected: boolean,
): SectionBuildOutcome {
  const engineSov =
    geoSection && Array.isArray(geoSection.sovByEngine)
      ? (geoSection.sovByEngine as Array<{ engine: string; sovPercent: number | null }>)
      : []

  if (engineSov.length === 0 && ga4Sources.length === 0) {
    return { ok: true, key: 'ai_attribution', value: nullSection('not_connected') }
  }

  const attribution = buildAiAttribution(engineSov, ga4Sources, ga4Connected)
  return {
    ok: true,
    key: 'ai_attribution',
    value: {
      byEngine: attribution,
      // The GA4 cache only stores top pages and top sources separately — there is no
      // landing-page × source breakdown, so an "AI-referred pages" list cannot be computed
      // truthfully. Empty hides the widget instead of relabelling every top page as AI traffic.
      topAiReferredLandingPages: [] as Array<{ page: string; sessions: number }>,
    },
  }
}

export async function assembleReportData(
  admin: SupabaseClient,
  input: AssembleReportInput,
): Promise<AssembledReport> {
  const totalStart = Date.now()
  const { projectId, periodStart, periodEnd, websiteUrl } = input
  const prev = previousPeriod(periodStart, periodEnd)
  const dayCount = periodDayCount(periodStart, periodEnd)
  const cacheDays = nearestCachePeriodDays(dayCount)

  const fetched = await fetchReportData(admin, projectId, periodStart, periodEnd, prev, websiteUrl, cacheDays)
  const ctx: AssemblyContext = {
    periodStart,
    periodEnd,
    prev,
    websiteUrl,
    locale: input.locale,
    fetched,
  }

  const data: Record<string, unknown> = {
    meta: {
      periodStart,
      periodEnd,
      previousPeriod: prev,
      builtAt: new Date().toISOString(),
      locale: input.locale,
    },
  }

  const sections: SectionKey[] = []

  const parallelSections: Array<{ key: SectionKey; build: () => SectionBuildOutcome }> = [
    { key: 'geo', build: () => buildGeoSection(ctx) },
    { key: 'rankings', build: () => buildRankingsSection(ctx) },
    { key: 'gsc', build: () => buildGscSection(ctx) },
    { key: 'ga4', build: () => buildGa4Section(ctx) },
    { key: 'site_health', build: () => buildSiteHealthSection(ctx) },
    { key: 'backlinks', build: () => buildBacklinksSection(ctx) },
    { key: 'ai_attribution', build: () => buildAiAttributionSectionFromCtx(ctx) },
    { key: 'summary', build: () => buildSummarySectionFromCtx(ctx) },
  ]

  const parallelStart = Date.now()
  const settled = await Promise.allSettled(
    parallelSections.map(({ key, build }) => timedSectionBuild(key, build)),
  )
  logStage('sections_parallel', Date.now() - parallelStart, { count: settled.length })

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    const fallbackKey = parallelSections[i].key
    if (result.status === 'rejected') {
      console.error('[reportAssemble] section build rejected', fallbackKey, result.reason)
      data[fallbackKey] = nullSection('error')
      continue
    }
    const outcome = result.value
    if (!outcome.ok) {
      console.error('[reportAssemble] section build failed', outcome.key, outcome.error)
      data[outcome.key] = nullSection('error')
      continue
    }
    data[outcome.key] = outcome.value
    if (outcome.key === 'summary') {
      sections.unshift('summary')
    } else if (!isNullSection(outcome.value)) {
      sections.push(outcome.key)
    }
  }

  if (!sections.includes('summary') && data['summary']) {
    sections.unshift('summary')
  }

  logStage('total', Date.now() - totalStart)

  return { sections: [...new Set([...REPORT_SECTIONS.filter((s) => sections.includes(s))])], data }
}
