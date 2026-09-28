/**
 * reportSummary rollup corrections (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportSummary.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { metric, nullSection } from '../reportBuild.ts'
import { buildCorrectedReportSummary } from '../reportSummary.ts'

Deno.test('buildCorrectedReportSummary passes through rankings avgPosition delta', () => {
  const data = {
    rankings: { avgPosition: metric(6, 8) },
    gsc: null,
    ga4: null,
    site_health: null,
  }
  const summary = buildCorrectedReportSummary(data, null)
  assertEquals((summary.avgPosition as { delta: number }).delta, -2)
})

Deno.test('buildCorrectedReportSummary passes through geo aiSov delta', () => {
  const geoSection = { sovOverall: metric(33.3, 23.1) }
  const summary = buildCorrectedReportSummary(
    { rankings: null, gsc: null, ga4: null, site_health: null },
    geoSection,
  )
  assertEquals((summary.aiSov as { value: number }).value, 33.3)
  assertEquals(Math.round((summary.aiSov as { delta: number }).delta * 10) / 10, 10.2)
})

Deno.test('buildCorrectedReportSummary is null-safe when sections are disconnected', () => {
  const summary = buildCorrectedReportSummary(
    {
      rankings: nullSection('not_connected'),
      gsc: nullSection('not_connected'),
      ga4: nullSection('not_connected'),
      site_health: nullSection('not_connected'),
    },
    null,
  )
  assertEquals((summary.aiSov as { value: number | null }).value, null)
  assertEquals((summary.avgPosition as { value: number | null }).value, null)
  assertEquals((summary.gscClicks as { value: number | null }).value, null)
})
