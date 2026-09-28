/**
 * Compact report view for the hosted MCP (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportAgentView.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { capArrays, compactClientReport, summarizeClientReport } from '../reportAgentView.ts'

const row = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-08-16',
  period_end: '2026-09-14',
  created_at: '2026-09-14T10:00:00Z',
  share_token: 'abc123',
  sections: ['summary', 'geo', 'gsc'],
  project: { name: 'Bravalo', website_url: 'https://bravalo.it' },
  branding: { agencyName: 'Studio Rossi' },
  narrative: {
    locale: 'it',
    executiveSummary: 'Il primo mese registra una share of voice dell’85%.',
    nextActions: Array.from({ length: 14 }, (_, i) => `Azione ${i + 1}`),
    sections: { geo: 'ChatGPT è il motore più forte.' },
  },
  data: {
    meta: { projectName: 'ignored-when-project-present', history: [{ reportId: 'r0' }] },
    summary: { aiSov: { value: 84.6 }, gscClicks: { value: 15994 }, healthScore: { value: 51 } },
    geo: { topPromptsMentioned: Array.from({ length: 25 }, (_, i) => `prompt ${i}`), trend: Array.from({ length: 60 }, (_, i) => ({ date: `d${i}` })) },
    gsc: { topQueries: Array.from({ length: 30 }, (_, i) => ({ key: `q${i}` })), table: Array.from({ length: 40 }, (_, i) => i) },
  },
}

Deno.test('capArrays caps generic arrays at 10, trends at 31, tables at 20', () => {
  const out = capArrays(row.data) as Record<string, Record<string, unknown[]>>
  assertEquals(out.geo.topPromptsMentioned.length, 10)
  assertEquals(out.geo.trend.length, 31)
  assertEquals(out.gsc.topQueries.length, 10)
  assertEquals(out.gsc.table.length, 20)
})

Deno.test('compactClientReport keeps identity, share url, narrative, history and capped sections', () => {
  const out = compactClientReport(row)
  assertEquals(out.project_name, 'Bravalo')
  assertEquals(out.website_url, 'https://bravalo.it')
  assertEquals(out.share_url, 'https://rankdelta.ai/r/abc123')
  assertEquals(out.locale, 'it')
  assertEquals((out.narrative.nextActions as string[]).length, 10)
  assertEquals(out.narrative.sections, { geo: 'ChatGPT è il motore più forte.' })
  assertEquals(out.history, [{ reportId: 'r0' }])
  const sections = out.sections as Record<string, unknown>
  assertEquals(Object.keys(sections).sort(), ['geo', 'gsc', 'summary'])
  assertEquals('meta' in sections, false)
})

Deno.test('compactClientReport falls back to meta when the project join is missing', () => {
  const out = compactClientReport({ ...row, project: null, share_token: null })
  assertEquals(out.project_name, 'ignored-when-project-present')
  assertEquals(out.share_url, null)
})

Deno.test('summarizeClientReport is one line per report with headline KPIs', () => {
  const out = summarizeClientReport(row)
  assertEquals(out.ai_share_of_voice, 84.6)
  assertEquals(out.gsc_clicks, 15994)
  assertEquals(out.avg_position, null)
  assertEquals(out.sections, ['summary', 'geo', 'gsc'])
})
