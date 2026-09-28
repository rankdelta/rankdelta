/**
 * reportHistory — compact per-report points stored in the snapshot (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportHistory.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { metric, nullSection } from '../reportBuild.ts'
import {
  buildReportHistory,
  extractHistoryPoint,
  historyRowsFromSelect,
  loadReportHistory,
  STORED_HISTORY_MAX,
  type ReportHistoryRow,
} from '../reportHistory.ts'

function row(id: string, start: string, end: string, sov: number | null, created_at?: string): ReportHistoryRow {
  return {
    id,
    period_start: start,
    period_end: end,
    created_at,
    data: {
      summary: {
        healthScore: metric(70, null),
        aiSov: metric(sov, null),
        avgPosition: metric(9.5, null),
        gscClicks: metric(1200, null),
        ga4Sessions: metric(4000, null),
        ga4AiAssistantSessions: metric(12, null),
        keyEvents: metric(null, null),
      },
      geo: sov != null ? { citationRate: metric(30, null) } : nullSection('not_connected'),
      gsc: { impressions: metric(50000, null) },
      backlinks: { referringDomains: 41 },
    },
  }
}

Deno.test('extractHistoryPoint reads summary + the section fields the summary lacks, null-safe', () => {
  const p = extractHistoryPoint(row('r1', '2026-08-16', '2026-09-15', 21.4))
  assertEquals(p, {
    reportId: 'r1',
    periodStart: '2026-08-16',
    periodEnd: '2026-09-15',
    aiSov: 21.4,
    citationRate: 30,
    gscClicks: 1200,
    gscImpressions: 50000,
    avgPosition: 9.5,
    ga4Sessions: 4000,
    aiSessions: 12,
    healthScore: 70,
    referringDomains: 41,
  })
  const empty = extractHistoryPoint({ id: 'x', period_start: '2026-01-01', period_end: '2026-01-31', data: null })
  assertEquals(empty.aiSov, null)
  assertEquals(empty.referringDomains, null)
  const disconnected = extractHistoryPoint(row('r2', '2026-07-16', '2026-08-15', null))
  assertEquals(disconnected.aiSov, null)
  assertEquals(disconnected.citationRate, null)
  const junk = extractHistoryPoint({ id: 'j', period_start: '2026-01-01', period_end: '2026-01-31', data: { summary: 'nope', backlinks: { referringDomains: 'many' } } })
  assertEquals(junk.gscClicks, null)
  assertEquals(junk.referringDomains, null)
})

Deno.test('buildReportHistory sorts by period, keeps the latest build per period and caps to 11', () => {
  const rows = [
    row('sep', '2026-08-16', '2026-09-15', 21, '2026-09-16T08:00:00Z'),
    row('jul', '2026-06-16', '2026-07-15', 12, '2026-07-16T08:00:00Z'),
    row('sep-rebuild', '2026-08-16', '2026-09-15', 22, '2026-09-17T08:00:00Z'),
    row('aug', '2026-07-16', '2026-08-15', 18, '2026-08-16T08:00:00Z'),
  ]
  const h = buildReportHistory(rows)
  assertEquals(h.map((p) => p.reportId), ['jul', 'aug', 'sep-rebuild'])
  assertEquals(h[2].aiSov, 22)

  const many = Array.from({ length: 15 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    return row(`r${i}`, `2025-${m}-01`, `2025-${m}-28`, i)
  })
  const capped = buildReportHistory(many)
  assertEquals(capped.length, STORED_HISTORY_MAX)
  assertEquals(capped[0].reportId, 'r4')
  assertEquals(capped[10].reportId, 'r14')
})

Deno.test('historyRowsFromSelect rebuilds the extractor input from json-path columns', () => {
  const rows = historyRowsFromSelect([
    {
      id: 'a',
      period_start: '2026-08-16',
      period_end: '2026-09-15',
      created_at: '2026-09-16T00:00:00Z',
      summary: { aiSov: metric(21.4, null), gscClicks: metric(900, null) },
      geoCitationRate: metric(25, null),
      gscImpressions: metric(40000, null),
      backlinksReferringDomains: 33,
    },
    {
      id: 'b',
      period_start: '2026-07-16',
      period_end: '2026-08-15',
      created_at: null,
      summary: null,
      geoCitationRate: null,
      gscImpressions: null,
      backlinksReferringDomains: null,
    },
  ])
  const [a, b] = buildReportHistory(rows)
  assertEquals(a.reportId, 'b')
  assertEquals(a.aiSov, null)
  assertEquals(a.referringDomains, null)
  assertEquals(b.reportId, 'a')
  assertEquals(b.aiSov, 21.4)
  assertEquals(b.citationRate, 25)
  assertEquals(b.gscImpressions, 40000)
  assertEquals(b.referringDomains, 33)
})

function fakeAdmin(result: { data?: unknown; error?: { message: string } | null }, calls: string[]) {
  const builder = {
    select(s: string) {
      calls.push(`select:${s}`)
      return builder
    },
    eq(k: string, v: string) {
      calls.push(`eq:${k}=${v}`)
      return builder
    },
    order(k: string) {
      calls.push(`order:${k}`)
      return builder
    },
    limit(n: number) {
      calls.push(`limit:${n}`)
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
    },
  }
  return { from: (table: string) => (calls.push(`from:${table}`), builder) }
}

Deno.test('loadReportHistory queries only the summary columns and never throws', async () => {
  const calls: string[] = []
  const admin = fakeAdmin(
    {
      data: [
        { id: 'a', period_start: '2026-08-16', period_end: '2026-09-15', created_at: '2026-09-16T00:00:00Z', summary: { aiSov: metric(21.4, null) }, geoCitationRate: null, gscImpressions: null, backlinksReferringDomains: null },
      ],
    },
    calls,
  )
  const h = await loadReportHistory(admin, 'p1')
  assertEquals(h.length, 1)
  assertEquals(h[0].aiSov, 21.4)
  assertEquals(calls[0], 'from:client_reports')
  assertEquals(calls[1].startsWith('select:id, period_start, period_end, created_at, summary:data->summary'), true)
  assertEquals(calls[1].includes('data->geo->citationRate'), true)
  assertEquals(calls.includes('eq:project_id=p1'), true)

  const failing = fakeAdmin({ error: { message: 'boom' } }, [])
  assertEquals(await loadReportHistory(failing, 'p1'), [])
  const throwing = { from: () => { throw new Error('down') } }
  assertEquals(await loadReportHistory(throwing, 'p1'), [])
})
