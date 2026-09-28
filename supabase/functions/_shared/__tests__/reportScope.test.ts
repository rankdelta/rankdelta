/**
 * restrictReportData — a report stores only the sections its owner chose (deno).
 * The share link returns `data` whole, so an excluded section must not be in it.
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportScope.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { restrictReportData } from '../reportScope.ts'

const metric = (value: number | null) => ({ value, delta: null, deltaPct: null })

const assembled = () => ({
  meta: {
    periodStart: '2026-08-16',
    history: [{ reportId: 'r0', aiSov: 20, citationRate: 5, gscClicks: 900, gscImpressions: 12000, avgPosition: 14, ga4Sessions: 3100, aiSessions: 40, healthScore: 70, referringDomains: 55 }],
  },
  summary: {
    aiSov: metric(30.8),
    avgPosition: metric(21.7),
    gscClicks: metric(950),
    ga4Sessions: metric(3200),
    ga4AiAssistantSessions: metric(44),
    keyEvents: metric(12),
    healthScore: metric(54),
  },
  geo: { sovOverall: metric(30.8) },
  ai_attribution: {
    byEngine: [{ engine: 'chatgpt', sovPercent: 33, aiAssistantSessions: 30, keyEvents: 2, conversionRate: 6.7 }],
    topAiReferredLandingPages: [{ page: '/pricing', sessions: 12 }],
  },
  rankings: { avgPosition: metric(21.7), distribution: {}, topMovers: [], table: [] },
  gsc: { clicks: metric(950), impressions: metric(12000) },
  ga4: { sessions: metric(3200), topLandingPages: [{ page: '/secret-offer', sessions: 800 }] },
  site_health: { auditScore: 54, auditedAt: '2026-09-01T00:00:00Z', topIssues: [] },
  backlinks: { data: null, reason: 'not_connected' },
})

Deno.test('the Pro customer case: geo, attribution and rankings chosen, the rest never stored', () => {
  const out = restrictReportData(assembled(), ['geo', 'ai_attribution', 'rankings'])
  assertEquals(out.gsc, { data: null, reason: 'excluded' })
  assertEquals(out.ga4, { data: null, reason: 'excluded' })
  assertEquals(out.site_health, { data: null, reason: 'excluded' })
  assert(!JSON.stringify(out).includes('/secret-offer'), 'GA4 landing pages leaked')
  assert(!JSON.stringify(out).includes('3200'), 'GA4 sessions leaked')
})

Deno.test('scorecard tiles, history points and GA4 visits per engine follow the excluded sections', () => {
  const out = restrictReportData(assembled(), ['geo', 'ai_attribution', 'rankings']) as ReturnType<typeof assembled>
  assertEquals(out.summary.aiSov, metric(30.8))
  assertEquals(out.summary.avgPosition, metric(21.7))
  assertEquals(out.summary.gscClicks, metric(null))
  assertEquals(out.summary.ga4Sessions, metric(null))
  assertEquals(out.summary.healthScore, metric(null))
  const point = out.meta.history[0]!
  assertEquals([point.aiSov, point.avgPosition], [20, 14])
  assertEquals<unknown>([point.gscClicks, point.gscImpressions, point.ga4Sessions, point.aiSessions, point.healthScore], [null, null, null, null, null])
  assertEquals<unknown>(out.ai_attribution.byEngine[0], { engine: 'chatgpt', sovPercent: 33, aiAssistantSessions: null, keyEvents: null, conversionRate: null })
  assertEquals<unknown>(out.ai_attribution.topAiReferredLandingPages, [])
})

Deno.test('a not-connected section keeps its reason, and a report with every section is unchanged', () => {
  const data = assembled()
  const out = restrictReportData(data, ['geo', 'rankings'])
  assertEquals(out.backlinks, { data: null, reason: 'not_connected' })
  const all = restrictReportData(data, ['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'])
  assertEquals(all, data)
})
