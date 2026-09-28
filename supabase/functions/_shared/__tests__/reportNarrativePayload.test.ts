/**
 * trimReportDataForNarrative — keeps grounding numbers, drops verbose arrays.
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportNarrativePayload.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { nullSection } from '../reportBuild.ts'
import {
  buildTrimmedNarrativePrompt,
  narrativePayloadByteSize,
  trimReportDataForNarrative,
} from '../reportNarrativePayload.ts'

const fullData: Record<string, unknown> = {
  meta: {
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    previousPeriod: { start: '2026-01-04', end: '2026-01-31' },
    builtAt: '2026-03-01T00:00:00.000Z',
    locale: 'en',
  },
  summary: {
    healthScore: { value: 72, delta: null, deltaPct: null },
    aiSov: { value: 33.3, delta: 5, deltaPct: 17.6 },
    avgPosition: { value: 6, delta: -1, deltaPct: -14.3 },
    gscClicks: { value: 500, delta: 50, deltaPct: 11.1 },
    ga4Sessions: { value: 1200, delta: 100, deltaPct: 9.1 },
    ga4AiAssistantSessions: { value: 45, delta: null, deltaPct: null },
    keyEvents: { value: 12, delta: null, deltaPct: null },
  },
  geo: nullSection('not_connected'),
  rankings: {
    avgPosition: { value: 6, delta: -1, deltaPct: -14.3 },
    distribution: { '1': 2, '2-3': 3, '4-10': 5, '11-20': 8, '21+': 4 },
    topMovers: [{ phrase: 'widgets', currentRank: 6, previousRank: 12, delta: 6, url: null }],
    table: Array.from({ length: 200 }, (_, i) => ({ phrase: `kw-${i}`, rank: i + 1, url: null })),
  },
  gsc: {
    clicks: { value: 500, delta: 50, deltaPct: 11.1 },
    impressions: { value: 12000, delta: 1000, deltaPct: 9.1 },
    ctr: { value: 4.2, delta: 0, deltaPct: 0 },
    avgPosition: { value: 12.5, delta: 0, deltaPct: 0 },
    trend: Array.from({ length: 28 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, clicks: 20, impressions: 400 })),
    topQueries: Array.from({ length: 20 }, (_, i) => ({ query: `q${i}`, clicks: 10 })),
    topPages: Array.from({ length: 20 }, (_, i) => ({ page: `/p${i}`, clicks: 5 })),
  },
  ga4: {
    sessions: { value: 1200, delta: 100, deltaPct: 9.1 },
    users: { value: 900, delta: 80, deltaPct: 9.8 },
    engagedSessions: { value: 800, delta: null, deltaPct: null },
    keyEvents: { value: 12, delta: null, deltaPct: null },
    organicShare: { value: 62.5, delta: null, deltaPct: null },
    aiAssistantSessions: { value: 45, delta: null, deltaPct: null },
    trend: Array.from({ length: 28 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, sessions: 40 })),
    topLandingPages: Array.from({ length: 20 }, (_, i) => ({ page: `/lp${i}`, sessions: 30 })),
    topSources: [{ source: 'google', sessions: 500 }],
  },
  ai_attribution: {
    byEngine: [{ engine: 'chatgpt', sovPercent: 40, aiAssistantSessions: 30, keyEvents: 5, conversionRate: 16.7 }],
    topAiReferredLandingPages: [{ page: '/home', sessions: 20 }],
  },
  site_health: {
    auditScore: 72,
    topIssues: [{ id: 'missing-alt', severity: 'warning' }],
    auditedAt: '2026-02-20T12:00:00Z',
  },
  backlinks: { referringDomains: 42, new: 3, lost: null },
}

Deno.test('trimReportDataForNarrative omits not_connected sections', () => {
  const trimmed = trimReportDataForNarrative(fullData)
  assert(!('geo' in trimmed))
})

Deno.test('trimReportDataForNarrative drops verbose arrays but keeps KPI numbers', () => {
  const trimmed = trimReportDataForNarrative(fullData)
  const rankings = trimmed.rankings as Record<string, unknown>
  assert(!('table' in rankings))
  assertEquals((rankings.distribution as Record<string, number>)['11-20'], 8)

  const gsc = trimmed.gsc as Record<string, unknown>
  assert(!('trend' in gsc))
  assertEquals((gsc.clicks as { value: number }).value, 500)

  const meta = trimmed.meta as Record<string, unknown>
  assert(!('builtAt' in meta))
  assertEquals(meta.locale, 'en')
})

Deno.test('buildTrimmedNarrativePrompt embeds trimmed JSON in user message', () => {
  const { user } = buildTrimmedNarrativePrompt(fullData, 'en')
  assert(!user.includes('"table"'))
  assert(user.includes('"summary"'))
})

Deno.test('trimReportDataForNarrative handles sparse disconnected report', () => {
  const sparse = {
    meta: {
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      previousPeriod: { start: '2026-01-04', end: '2026-01-31' },
      builtAt: '2026-03-01T00:00:00.000Z',
      locale: 'en',
    },
    summary: {
      healthScore: { value: null, delta: null, deltaPct: null },
      aiSov: { value: null, delta: null, deltaPct: null },
      avgPosition: { value: null, delta: null, deltaPct: null },
      gscClicks: { value: null, delta: null, deltaPct: null },
      ga4Sessions: { value: null, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: null, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    },
    geo: nullSection('not_connected'),
    rankings: nullSection('not_connected'),
    gsc: nullSection('not_connected'),
    ga4: nullSection('not_connected'),
    ai_attribution: nullSection('not_connected'),
    site_health: nullSection('not_connected'),
    backlinks: nullSection('not_connected'),
  }
  const trimmed = trimReportDataForNarrative(sparse)
  assert(!('geo' in trimmed))
  assert(!('rankings' in trimmed))
  // Every headline metric is null: nothing to say, so the model does not see "null" to write about.
  assert(!('summary' in trimmed))
  assert(!('builtAt' in (trimmed.meta as Record<string, unknown>)))
})

Deno.test('trimReportDataForNarrative reduces payload size materially', () => {
  const before = narrativePayloadByteSize(fullData)
  const after = narrativePayloadByteSize(trimReportDataForNarrative(fullData))
  assert(after < before * 0.5, `expected >50% reduction, got ${before} -> ${after}`)
})

Deno.test('trimReportDataForNarrative drops null attribution fields so the model cannot cite them', () => {
  const trimmed = trimReportDataForNarrative({
    ai_attribution: {
      byEngine: [{ engine: 'chatgpt', sovPercent: 33.3, aiAssistantSessions: null, keyEvents: null, conversionRate: null }],
      topAiReferredLandingPages: [],
    },
  }) as Record<string, { byEngine: Array<Record<string, unknown>> }>
  const row = trimmed.ai_attribution.byEngine[0]
  assertEquals(row, { engine: 'chatgpt', sovPercent: 33.3 })
})
