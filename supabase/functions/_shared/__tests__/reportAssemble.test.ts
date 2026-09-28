/**
 * assembleReportData integration tests (deno) — sparse / partial data must never throw.
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportAssemble.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { assembleReportData } from '../reportAssemble.ts'
import { isNullSection, previousPeriod } from '../reportBuild.ts'

const PERIOD = { start: '2026-02-01', end: '2026-02-28' }

function makeMockAdmin(
  tableData: Record<string, unknown>,
  fetchErrors: Record<string, string> = {},
) {
  const gteCalls: Array<{ table: string; column: string; value: unknown }> = []
  const resolve = (table: string) => {
    const errMsg = fetchErrors[table]
    if (errMsg) return { data: null, error: { message: errMsg } }
    const entry = tableData[table]
    if (entry === undefined) return { data: null, error: null }
    if (Array.isArray(entry) || (entry && typeof entry === 'object' && !('single' in (entry as object)))) {
      return { data: entry, error: null }
    }
    const row = entry as { single?: boolean; row?: unknown }
    return { data: row.row ?? null, error: null }
  }

  const chainFor = (table: string) => {
    const result = Promise.resolve(resolve(table))
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      gte: (column: string, value: unknown) => {
        gteCalls.push({ table, column, value })
        return chain
      },
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      maybeSingle: () => result,
      single: () => result,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        result.then(onFulfilled, onRejected),
    }
    return chain
  }

  return { from: (table: string) => chainFor(table), gteCalls }
}

const baseInput = {
  projectId: 'proj-1',
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  websiteUrl: null as string | null,
  locale: 'en',
}

const emptyAdmin = makeMockAdmin({
  gsc_properties: { single: true, row: null },
  ga4_properties: { single: true, row: null },
  gsc_analytics_cache: { single: true, row: null },
  ga4_analytics_cache: { single: true, row: null },
  report_geo_daily_mart: [],
  report_ranking_daily_mart: [],
  site_audits: { single: true, row: null },
  competitor_brands: [],
  visibility_query_runs: [],
})

Deno.test('(a) assembleReportData with every section not_connected', async () => {
  const result = await assembleReportData(emptyAdmin as never, baseInput)
  assert(result.sections.includes('summary'))
  for (const key of ['geo', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks', 'ai_attribution', 'summary']) {
    assert(key in result.data, `missing section key: ${key}`)
  }
  assert(isNullSection(result.data['geo']))
  assert(isNullSection(result.data['rankings']))
  assert(isNullSection(result.data['gsc']))
  assert(isNullSection(result.data['ga4']))
  const summary = result.data['summary'] as Record<string, { value: unknown }>
  assertEquals(summary['aiSov']?.value, null)
  assertEquals(summary['avgPosition']?.value, null)
})

Deno.test('(b) assembleReportData when only GEO is present', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [
      {
        day: '2026-02-10',
        provider: 'chatgpt',
        your_mentions: 5,
        competitor_mentions: 10,
        citations: 2,
        run_count: 4,
      },
    ],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [{ id: 'c1', name: 'Rival', domain: 'rival.com' }],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('geo'))
  assert(!isNullSection(result.data['geo']))
  const summary = result.data['summary'] as { aiSov: { value: number | null; delta: number | null } }
  const geo = result.data['geo'] as { sovOverall: { value: number | null; delta: number | null } }
  assertEquals(summary.aiSov.value, 33.3)
  assertEquals(summary.aiSov.delta, geo.sovOverall.delta)
})

Deno.test('(o) assembleReportData GSC prop without cache is not_connected', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: { id: 'gsc-1' } },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(!result.sections.includes('gsc'))
  assert(isNullSection(result.data['gsc']))
  const gsc = result.data['gsc'] as { reason: string }
  assertEquals(gsc.reason, 'not_connected')
})

Deno.test('(p) assembleReportData GA4 prop without cache is not_connected', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: { id: 'ga4-1' } },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(!result.sections.includes('ga4'))
  assert(isNullSection(result.data['ga4']))
})

Deno.test('(c) assembleReportData when only GSC is present', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: { id: 'gsc-1' } },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: {
      single: true,
      row: {
        clicks: 500,
        impressions: 12000,
        ctr: 4.2,
        avg_position: 12.5,
        top_queries: [],
        top_pages: [],
        daily_data: [{ date: '2026-02-10', clicks: 20, impressions: 400 }],
      },
    },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('gsc'))
  const summary = result.data['summary'] as { gscClicks: { value: number | null } }
  assertEquals(summary.gscClicks.value, 20)
})

Deno.test('(d) assembleReportData when only rankings are present', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-02-15',
        rank_absolute: 6,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-02-15T12:00:00Z',
      },
    ],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('rankings'))
  const summary = result.data['summary'] as { avgPosition: { value: number | null } }
  assertEquals(summary.avgPosition.value, 6)
})

Deno.test('(g) assembleReportData uses latest completed visibility run for prompt classification', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [
      {
        day: '2026-02-10',
        provider: 'chatgpt',
        your_mentions: 1,
        competitor_mentions: 0,
        citations: 0,
        run_count: 1,
      },
    ],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [
      {
        id: 'r1',
        status: 'completed',
        run_at: '2026-01-01T00:00:00Z',
        mentioned_brands: [],
        visibility_queries: { id: 'q1', text: 'best widgets', is_active: true },
      },
      {
        id: 'r2',
        status: 'completed',
        run_at: '2026-02-15T12:00:00Z',
        mentioned_brands: ['Acme'],
        visibility_queries: { id: 'q1', text: 'best widgets', is_active: true },
      },
    ],
  })
  const result = await assembleReportData(admin as never, baseInput)
  const geo = result.data['geo'] as { topPromptsMentioned: string[]; topPromptsNotMentioned: string[] }
  assert(geo.topPromptsMentioned.includes('best widgets'))
  assertEquals(geo.topPromptsNotMentioned.includes('best widgets'), false)
})

Deno.test('(i) assembleReportData summary avgPosition delta matches rankings section', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-02-15',
        rank_absolute: 6,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-02-15T12:00:00Z',
      },
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-01-20',
        rank_absolute: 8,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-01-20T12:00:00Z',
      },
    ],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  const summary = result.data['summary'] as { avgPosition: { value: number | null; delta: number | null } }
  const rankings = result.data['rankings'] as { avgPosition: { value: number | null; delta: number | null } }
  assertEquals(summary.avgPosition.delta, rankings.avgPosition.delta)
  assertEquals(summary.avgPosition.delta, -2)
})

Deno.test('(h) assembleReportData rankings use latest previous-period day per keyword', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-02-15',
        rank_absolute: 6,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-02-15T12:00:00Z',
      },
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-01-20',
        rank_absolute: 20,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-01-20T12:00:00Z',
      },
      {
        keyword_id: 'k1',
        phrase: 'widgets',
        day: '2026-01-10',
        rank_absolute: 30,
        ranking_url: 'https://example.com/widgets',
        checked_at: '2026-01-10T12:00:00Z',
      },
    ],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  const rankings = result.data['rankings'] as {
    topMovers: Array<{ delta: number | null }>
    avgPosition: { value: number | null; delta: number | null }
  }
  assertEquals(rankings.avgPosition.delta, -14)
  assertEquals(rankings.topMovers[0]?.delta, 14)
})

Deno.test('(f) assembleReportData logs per-stage timing', async () => {
  const logs: string[] = []
  const orig = console.log
  console.log = (...args: unknown[]) => {
    logs.push(String(args[0]))
    orig(...args)
  }
  try {
    await assembleReportData(emptyAdmin as never, baseInput)
    const stages = logs
      .filter((l) => l.includes('"tag":"reportAssemble"'))
      .map((l) => JSON.parse(l) as { stage: string; ms: number })
    assert(stages.some((s) => s.stage === 'fetch'))
    assert(stages.some((s) => s.stage === 'sections_parallel'))
    const parallel = stages.find((s) => s.stage === 'sections_parallel') as { count?: number }
    assertEquals(parallel.count, 8)
    assert(stages.some((s) => s.stage === 'total'))
    assert(stages.some((s) => s.stage === 'section:geo'))
    assert(stages.some((s) => s.stage === 'section:ai_attribution'))
  } finally {
    console.log = orig
  }
})

Deno.test('(j) assembleReportData logs fetch_error warnings without throwing', async () => {
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(String(args[0]))
    origWarn(...args)
  }
  const admin = makeMockAdmin(
    {
      gsc_properties: { single: true, row: null },
      ga4_properties: { single: true, row: null },
      gsc_analytics_cache: { single: true, row: null },
      ga4_analytics_cache: { single: true, row: null },
      report_geo_daily_mart: [],
      report_ranking_daily_mart: [],
      site_audits: { single: true, row: null },
      competitor_brands: [],
      visibility_query_runs: [],
    },
    { report_geo_daily_mart: 'permission denied' },
  )
  try {
    const result = await assembleReportData(admin as never, baseInput)
    assert(isNullSection(result.data['geo']))
    const fetchErrors = warnings
      .filter((w) => w.includes('"stage":"fetch_error"'))
      .map((w) => JSON.parse(w) as { query: string; message: string })
    assert(fetchErrors.some((e) => e.query === 'report_geo_daily_mart' && e.message === 'permission denied'))
  } finally {
    console.warn = origWarn
  }
})

Deno.test('(k) assembleReportData backlinks counts in-period referring domains', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
    backlink_referring_domains: [
      { referring_domain: 'a.com', fetched_at: '2026-02-10T00:00:00Z' },
      { referring_domain: 'b.com', fetched_at: '2026-01-05T00:00:00Z' },
      { referring_domain: 'c.com', fetched_at: '2026-02-20T00:00:00Z' },
    ],
  })
  const result = await assembleReportData(admin as never, {
    ...baseInput,
    websiteUrl: 'https://example.com',
  })
  assert(result.sections.includes('backlinks'))
  const backlinks = result.data['backlinks'] as { referringDomains: number; new: number }
  assertEquals(backlinks.referringDomains, 3)
  assertEquals(backlinks.new, 2)
})

Deno.test('(k2) assembleReportData backlinks never analysed is not_connected, not zero', async () => {
  const result = await assembleReportData(emptyAdmin as never, { ...baseInput, websiteUrl: 'https://example.com' })
  assert(isNullSection(result.data['backlinks']), 'no stored referring domains must not read as "0 referring domains"')
})

Deno.test('(l) assembleReportData site_health falls back to healthScore', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: {
      single: true,
      row: {
        audited_at: '2026-02-10T12:00:00Z',
        result: { healthScore: 67, issues: [] },
      },
    },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  const health = result.data['site_health'] as { auditScore: number }
  assertEquals(health.auditScore, 67)
})

Deno.test('(l2) assembleReportData site_health reads compositeHealth score', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: {
      single: true,
      row: {
        audited_at: '2026-02-10T12:00:00Z',
        result: { compositeHealth: 82, issues: [{ id: 'slow', severity: 'high' }] },
      },
    },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('site_health'))
  const health = result.data['site_health'] as { auditScore: number; topIssues: unknown[] }
  assertEquals(health.auditScore, 82)
  assertEquals(health.topIssues.length, 1)
})

Deno.test('(m) assembleReportData ai_attribution merges geo SoV with GA4 AI sessions', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: { id: 'ga4-1' } },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: {
      single: true,
      row: {
        sessions: 200,
        users: 150,
        pageviews: 400,
        bounce_rate: 0.4,
        top_pages: [{ key: '/landing', sessions: 50 }],
        top_sources: [{ key: 'chatgpt.com', sessions: 40 }],
        daily_data: [{ date: '2026-02-10', sessions: 200, users: 150 }],
      },
    },
    report_geo_daily_mart: [
      {
        day: '2026-02-10',
        provider: 'chatgpt',
        your_mentions: 8,
        competitor_mentions: 2,
        citations: 1,
        run_count: 2,
      },
    ],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('ai_attribution'))
  const attr = result.data['ai_attribution'] as {
    byEngine: Array<{ engine: string; sovPercent: number | null; aiAssistantSessions: number }>
  }
  const chatgpt = attr.byEngine.find((r) => r.engine === 'chatgpt')
  assert(chatgpt)
  assertEquals(chatgpt?.aiAssistantSessions, 40)
  assert(chatgpt?.sovPercent != null)
})

Deno.test('(e) assembleReportData GA4 with zero sessions', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: { id: 'ga4-1' } },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: {
      single: true,
      row: {
        sessions: 0,
        users: 0,
        pageviews: 0,
        bounce_rate: 0,
        top_pages: [],
        top_sources: [],
        daily_data: [{ date: '2026-02-10', sessions: 0, users: 0 }],
      },
    },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('ga4'))
  const ga4 = result.data['ga4'] as { sessions: { value: number | null } }
  assertEquals(ga4.sessions.value, 0)
  const summary = result.data['summary'] as { ga4Sessions: { value: number | null } }
  assertEquals(summary.ga4Sessions.value, 0)
})

Deno.test('(n) assembleReportData maps a rejected section builder to reason error', async () => {
  const explodingRanks = [
    {
      keyword_id: 'k1',
      phrase: 'widgets',
      day: '2026-02-15',
      rank_absolute: 5,
      ranking_url: null,
    },
  ]
  Object.defineProperty(explodingRanks, 'filter', {
    value: () => {
      throw new Error('rankings boom')
    },
  })

  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [
      {
        day: '2026-02-10',
        provider: 'chatgpt',
        your_mentions: 5,
        competitor_mentions: 10,
        citations: 2,
        run_count: 4,
      },
    ],
    report_ranking_daily_mart: explodingRanks,
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  const result = await assembleReportData(admin as never, baseInput)
  assert(result.sections.includes('geo'))
  assert(!result.sections.includes('rankings'))
  assert(!isNullSection(result.data['geo']))
  const rankings = result.data['rankings'] as { data: null; reason: string }
  assertEquals(rankings.data, null)
  assertEquals(rankings.reason, 'error')
  const gsc = result.data['gsc'] as { data: null; reason: string }
  assertEquals(gsc.reason, 'not_connected')
})

Deno.test('(o) visibility_query_runs fetch is bounded by previous-period start', async () => {
  const admin = makeMockAdmin({
    gsc_properties: { single: true, row: null },
    ga4_properties: { single: true, row: null },
    gsc_analytics_cache: { single: true, row: null },
    ga4_analytics_cache: { single: true, row: null },
    report_geo_daily_mart: [],
    report_ranking_daily_mart: [],
    site_audits: { single: true, row: null },
    competitor_brands: [],
    visibility_query_runs: [],
  })
  await assembleReportData(admin as never, baseInput)
  const expected = `${previousPeriod(PERIOD.start, PERIOD.end).start}T00:00:00Z`
  const visBounds = admin.gteCalls.filter(
    (c) => c.table === 'visibility_query_runs' && c.column === 'run_at',
  )
  assertEquals(visBounds.length, 1)
  assertEquals(visBounds[0].value, expected)
})
