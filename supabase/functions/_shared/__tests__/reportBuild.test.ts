/**
 * Pure reportBuild helpers (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportBuild.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  aggregateAiSessionsByEngine,
  buildAiAttribution,
  buildDistributionBuckets,
  buildReportSummary,
  checkNarrativeGrounding,
  computeDelta,
  filterDailyRows,
  isConnectedSection,
  isNullSection,
  matchEngineFromSource,
  nearestCachePeriodDays,
  normalizeDomain,
  nullSection,
  parseNarrativeContent,
  periodDayCount,
  positionDistributionBucket,
  previousPeriod,
  readMetric,
  readMetricDelta,
  readMetricValue,
  shareOfVoice,
  sumDailyField,
} from '../reportBuild.ts'

Deno.test('buildReportSummary is null-safe when all sections disconnected', () => {
  const data = {
    geo: nullSection('not_connected'),
    rankings: nullSection('not_connected'),
    gsc: nullSection('not_connected'),
    ga4: nullSection('not_connected'),
    site_health: nullSection('not_connected'),
  }
  const summary = buildReportSummary(data, null)
  assertEquals(summary.aiSov.value, null)
  assertEquals(summary.gscClicks.value, null)
  assertEquals(summary.ga4Sessions.value, null)
  assertEquals(summary.healthScore.value, null)
})

Deno.test('periodDayCount counts inclusive calendar days', () => {
  assertEquals(periodDayCount('2026-02-01', '2026-02-28'), 28)
  assertEquals(periodDayCount('2026-02-28', '2026-02-01'), 0)
})

Deno.test('computeDelta handles nulls and zero previous values', () => {
  assertEquals(computeDelta(null, null), { value: null, delta: null, deltaPct: null })
  assertEquals(computeDelta(100, 80), { value: 100, delta: 20, deltaPct: 25 })
  assertEquals(computeDelta(50, 0), { value: 50, delta: 50, deltaPct: 100 })
})

Deno.test('positionDistributionBucket maps ranks to buckets', () => {
  assertEquals(positionDistributionBucket(1), '1')
  assertEquals(positionDistributionBucket(3.9), '2-3')
  assertEquals(positionDistributionBucket(10), '4-10')
  assertEquals(positionDistributionBucket(21), '21+')
  assertEquals(positionDistributionBucket(0), null)
})

Deno.test('aggregateAiSessionsByEngine sums sessions per AI engine', () => {
  const map = aggregateAiSessionsByEngine([
    { source: 'chatgpt.com / referral', sessions: 40, keyEvents: 2 },
    { source: 'Chat.OpenAI.com', sessions: 10 },
    { source: 'google / organic', sessions: 500 },
  ])
  assertEquals(map.get('chatgpt'), { sessions: 50, keyEvents: 2 })
  assertEquals(map.has('google'), false)
})

Deno.test('previousPeriod mirrors current period length', () => {
  const prev = previousPeriod('2026-02-01', '2026-02-28')
  assertEquals(prev, { start: '2026-01-04', end: '2026-01-31' })
})

Deno.test('nearestCachePeriodDays picks closest cache window', () => {
  assertEquals(nearestCachePeriodDays(6), 7)
  assertEquals(nearestCachePeriodDays(20), 28)
  assertEquals(nearestCachePeriodDays(80), 90)
})

Deno.test('shareOfVoice returns null when no mentions', () => {
  assertEquals(shareOfVoice(0, 0), null)
  assertEquals(shareOfVoice(5, 5), 50)
})

Deno.test('normalizeDomain strips protocol and path', () => {
  assertEquals(normalizeDomain('https://www.Example.com/page'), 'example.com')
  assertEquals(normalizeDomain('blog.example.co.uk'), 'blog.example.co.uk')
})

Deno.test('matchEngineFromSource detects AI assistants', () => {
  assertEquals(matchEngineFromSource('chatgpt.com / referral'), 'chatgpt')
  assertEquals(matchEngineFromSource('google organic'), null)
})

Deno.test('buildDistributionBuckets counts rank buckets', () => {
  assertEquals(buildDistributionBuckets([1, 2, 11, null, 25]), {
    '1': 1,
    '2-3': 1,
    '4-10': 0,
    '11-20': 1,
    '21+': 1,
  })
})

Deno.test('buildAiAttribution merges geo SoV with GA4 AI sessions', () => {
  const rows = buildAiAttribution(
    [{ engine: 'chatgpt', sovPercent: 40 }],
    [{ source: 'chatgpt.com', sessions: 120 }],
  )
  assertEquals(rows.length, 1)
  assertEquals(rows[0]?.engine, 'chatgpt')
  assertEquals(rows[0]?.sovPercent, 40)
  assertEquals(rows[0]?.aiAssistantSessions, 120)
})

// 23/09/26: without GA4 the rows carried aiAssistantSessions/keyEvents = 0, and the narrative
// told a client "zero AI-referred sessions and zero key events" for a source never connected.
Deno.test('buildAiAttribution without GA4: traffic fields are null, SoV kept', () => {
  const rows = buildAiAttribution([{ engine: 'chatgpt', sovPercent: 33.3 }, { engine: 'perplexity', sovPercent: 28.6 }], [], false)
  assertEquals(rows.length, 2)
  for (const r of rows) {
    assertEquals(r.aiAssistantSessions, null)
    assertEquals(r.keyEvents, null)
    assertEquals(r.conversionRate, null)
  }
  assertEquals(rows[0]?.sovPercent, 33.3)
})

Deno.test('buildAiAttribution with GA4 connected but no AI traffic: zeros are real zeros', () => {
  const rows = buildAiAttribution([{ engine: 'chatgpt', sovPercent: 10 }], [{ source: 'google', sessions: 50 }], true)
  assertEquals(rows[0]?.aiAssistantSessions, 0)
  assertEquals(rows[0]?.keyEvents, 0)
})

Deno.test('parseNarrativeContent strips json fence', () => {
  const parsed = parseNarrativeContent('```json\n{"executiveSummary":"Hi"}\n```')
  assert(parsed)
  assertEquals(parsed?.executiveSummary, 'Hi')
})

Deno.test('parseNarrativeContent recovers object from prose wrapper', () => {
  const parsed = parseNarrativeContent('Here is the report:\n{"nextActions":["a"]}\nThanks.')
  assert(parsed)
  assertEquals(parsed?.nextActions, ['a'])
})

Deno.test('isNullSection and isConnectedSection detect placeholders', () => {
  const placeholder = nullSection('not_connected')
  assert(isNullSection(placeholder))
  assertEquals(isConnectedSection(placeholder), false)
  assert(isConnectedSection({ clicks: { value: 1, delta: null, deltaPct: null } }))
})

Deno.test('readMetric helpers skip placeholders and missing fields', () => {
  const placeholder = nullSection('not_connected')
  assertEquals(readMetric(placeholder, 'clicks'), null)
  assertEquals(readMetricValue(placeholder, 'clicks'), null)
  assertEquals(readMetricDelta(placeholder, 'clicks'), null)
  const section = { clicks: { value: 10, delta: 2, deltaPct: 25 } }
  assertEquals(readMetric(section, 'clicks')?.value, 10)
  assertEquals(readMetricValue(section, 'clicks'), 10)
  assertEquals(readMetricDelta(section, 'clicks'), 2)
})

Deno.test('filterDailyRows and sumDailyField respect date bounds', () => {
  const rows = [
    { date: '2026-02-01', clicks: 10 },
    { date: '2026-02-15', clicks: 20 },
    { date: '2026-03-01', clicks: 5 },
  ]
  const filtered = filterDailyRows(rows, '2026-02-01', '2026-02-28')
  assertEquals(filtered.length, 2)
  assertEquals(sumDailyField(filtered, '2026-02-01', '2026-02-28', 'clicks'), 30)
})

Deno.test('checkNarrativeGrounding rejects invented numbers', () => {
  const data = { summary: { ga4Sessions: { value: 100, delta: null, deltaPct: null } } }
  const result = checkNarrativeGrounding({ executiveSummary: 'Sessions hit 9999.' }, data)
  assertEquals(result.grounded, false)
  assert(result.ungrounded.includes(9999))
})
