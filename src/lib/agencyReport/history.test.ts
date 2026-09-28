import { describe, it, expect } from 'vitest'
import {
  buildReportHistory,
  deltaVsPreviousReport,
  extractHistoryPoint,
  historyMetricsWithData,
  historyMovement,
  historyNeighbours,
  historySeries,
  metricVsPreviousReport,
  parseStoredHistory,
  pctChange,
  previousReportDiffers,
  withCurrentReport,
  type ReportHistoryPoint,
  type ReportHistoryRow,
} from './history'

const m = (value: number | null, delta: number | null = null) => ({ value, delta, deltaPct: null })

type RowValues = Partial<Record<'health' | 'sov' | 'pos' | 'clicks' | 'sessions' | 'ai' | 'cite' | 'imp' | 'domains', number | null>>

function row(id: string, start: string, end: string, values: RowValues = {}, created_at?: string): ReportHistoryRow {
  return {
    id,
    period_start: start,
    period_end: end,
    created_at,
    data: {
      summary: {
        healthScore: m(values.health ?? null),
        aiSov: m(values.sov ?? null),
        avgPosition: m(values.pos ?? null),
        gscClicks: m(values.clicks ?? null),
        ga4Sessions: m(values.sessions ?? null),
        ga4AiAssistantSessions: m(values.ai ?? null),
        keyEvents: m(null),
      },
      geo: values.cite != null ? { citationRate: m(values.cite) } : { data: null, reason: 'not_connected' },
      gsc: values.imp != null ? { impressions: m(values.imp) } : { data: null, reason: 'not_connected' },
      backlinks: values.domains != null ? { referringDomains: values.domains } : { data: null, reason: 'not_connected' },
    },
  }
}

const july = row('r-jul', '2026-06-16', '2026-07-15', { sov: 12.5, clicks: 800, sessions: 3000, pos: 14.2, health: 61, cite: 20, imp: 40000, domains: 30, ai: 5 }, '2026-07-16T08:00:00Z')
const aug = row('r-aug', '2026-07-16', '2026-08-15', { sov: 18, clicks: 950, sessions: 3400, pos: 12.9, health: 66, cite: 25, imp: 46000, domains: 33, ai: 9 }, '2026-08-16T08:00:00Z')
const sep = row('r-sep', '2026-08-16', '2026-09-15', { sov: 21.4, clicks: 1100, sessions: 3900, pos: 11.1, health: 72, cite: 24, imp: 52000, domains: 35, ai: 14 }, '2026-09-16T08:00:00Z')

describe('extractHistoryPoint', () => {
  it('reads headline numbers from summary and the few section fields the summary lacks', () => {
    const p = extractHistoryPoint(sep)
    expect(p).toEqual({
      reportId: 'r-sep',
      periodStart: '2026-08-16',
      periodEnd: '2026-09-15',
      aiSov: 21.4,
      citationRate: 24,
      gscClicks: 1100,
      gscImpressions: 52000,
      avgPosition: 11.1,
      ga4Sessions: 3900,
      aiSessions: 14,
      healthScore: 72,
      referringDomains: 35,
    })
  })

  it('is null-safe on disconnected sections, missing summary and malformed data', () => {
    const empty = extractHistoryPoint({ id: 'x', period_start: '2026-01-01', period_end: '2026-01-31', data: null })
    expect(empty.aiSov).toBeNull()
    expect(empty.referringDomains).toBeNull()
    const junk = extractHistoryPoint({ id: 'y', period_start: '2026-01-01', period_end: '2026-01-31', data: { summary: 'nope', geo: 42, backlinks: { referringDomains: 'many' } } })
    expect(junk.gscClicks).toBeNull()
    expect(junk.referringDomains).toBeNull()
    const nan = extractHistoryPoint({ id: 'z', period_start: '2026-01-01', period_end: '2026-01-31', data: { summary: { aiSov: { value: Number.NaN } } } })
    expect(nan.aiSov).toBeNull()
  })

  it('falls back to section metrics when the summary block is missing', () => {
    const p = extractHistoryPoint({
      id: 'f',
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      data: {
        geo: { sovOverall: m(30), citationRate: m(10) },
        gsc: { clicks: m(500), impressions: m(9000) },
        ga4: { sessions: m(1200), aiAssistantSessions: m(7) },
        rankings: { avgPosition: m(8.5) },
        site_health: { auditScore: 77 },
      },
    })
    expect(p.aiSov).toBe(30)
    expect(p.gscClicks).toBe(500)
    expect(p.ga4Sessions).toBe(1200)
    expect(p.aiSessions).toBe(7)
    expect(p.avgPosition).toBe(8.5)
    expect(p.healthScore).toBe(77)
  })
})

describe('buildReportHistory', () => {
  it('sorts by period end, oldest first, whatever the input order', () => {
    const h = buildReportHistory([sep, july, aug])
    expect(h.map((p) => p.reportId)).toEqual(['r-jul', 'r-aug', 'r-sep'])
  })

  it('keeps one point per period — the latest build wins', () => {
    const rebuilt = row('r-sep-2', '2026-08-16', '2026-09-15', { sov: 22 }, '2026-09-17T10:00:00Z')
    const h = buildReportHistory([rebuilt, sep, july])
    expect(h.map((p) => p.reportId)).toEqual(['r-jul', 'r-sep-2'])
    expect(h[1]!.aiSov).toBe(22)
    // Same period, same timestamp: the later row in the input wins.
    const a = row('a', '2026-01-01', '2026-01-31', { sov: 1 })
    const b = row('b', '2026-01-01', '2026-01-31', { sov: 2 })
    expect(buildReportHistory([a, b])[0]!.reportId).toBe('b')
  })

  it('caps to the most recent 12 periods', () => {
    const rows = Array.from({ length: 15 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0')
      return row(`r${i}`, `2025-${month}-01`, `2025-${month}-28`, { sov: i })
    })
    const h = buildReportHistory(rows)
    expect(h).toHaveLength(12)
    expect(h[0]!.reportId).toBe('r3')
    expect(h[11]!.reportId).toBe('r14')
  })

  it('skips rows without an id or period', () => {
    const h = buildReportHistory([{ id: '', period_start: '2026-01-01', period_end: '2026-01-31' }, july])
    expect(h).toHaveLength(1)
  })
})

describe('withCurrentReport', () => {
  const stored = buildReportHistory([july, aug])

  it('appends the report on screen after the stored previous reports', () => {
    const h = withCurrentReport(stored, extractHistoryPoint(sep))
    expect(h.map((p) => p.reportId)).toEqual(['r-jul', 'r-aug', 'r-sep'])
  })

  it('lets the displayed report represent its period even if a later rebuild is listed', () => {
    const older = extractHistoryPoint(row('r-aug-old', '2026-07-16', '2026-08-15', { sov: 17 }))
    const h = withCurrentReport(stored, older)
    expect(h.map((p) => p.reportId)).toEqual(['r-jul', 'r-aug-old'])
    expect(h[1]!.aiSov).toBe(17)
  })

  it('never drops the displayed report when trimming to the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0')
      return extractHistoryPoint(row(`r${i}`, `2025-${month}-01`, `2025-${month}-28`, { sov: i }))
    })
    const ancient = extractHistoryPoint(row('old', '2024-01-01', '2024-01-31', { sov: 0 }))
    const h = withCurrentReport(many, ancient)
    expect(h).toHaveLength(12)
    expect(h[0]!.reportId).toBe('old')
  })
})

describe('neighbours and per-report deltas', () => {
  const h = buildReportHistory([july, aug, sep])

  it('finds previous and next reports around the current one', () => {
    expect(historyNeighbours(h, 'r-aug')).toMatchObject({ index: 1, previous: { reportId: 'r-jul' }, next: { reportId: 'r-sep' } })
    expect(historyNeighbours(h, 'r-jul').previous).toBeNull()
    expect(historyNeighbours(h, 'r-sep').next).toBeNull()
    expect(historyNeighbours(h, 'nope')).toEqual({ index: -1, previous: null, next: null })
  })

  it('computes the movement vs the previous report, null on the first report', () => {
    const d = deltaVsPreviousReport(h, 'r-sep', 'aiSov')!
    expect(d.previous.reportId).toBe('r-aug')
    expect(d.delta).toBeCloseTo(3.4)
    expect(d.deltaPct).toBeCloseTo(18.89, 1)
    expect(deltaVsPreviousReport(h, 'r-jul', 'aiSov')).toBeNull()
  })

  it('re-bases a metric on the previous report and tells when that differs from the snapshot prior', () => {
    const rebased = metricVsPreviousReport(21.4, 18)!
    expect(rebased.value).toBe(21.4)
    expect(rebased.delta).toBeCloseTo(3.4)
    expect(rebased.deltaPct).toBe(18.9)
    expect(metricVsPreviousReport(5, 0)).toEqual({ value: 5, delta: 5, deltaPct: 100 })
    expect(metricVsPreviousReport(null, 18)).toBeNull()
    // Snapshot compares 21.4 against 18 already (delta 3.4): the previous report adds nothing.
    expect(previousReportDiffers({ value: 21.4, delta: 3.4, deltaPct: 18.9 }, 18)).toBe(false)
    // Previous report was a different window: worth showing.
    expect(previousReportDiffers({ value: 21.4, delta: 3.4, deltaPct: 18.9 }, 15)).toBe(true)
    // No prior inside the snapshot at all: the previous report is the only comparison.
    expect(previousReportDiffers({ value: 21.4, delta: null, deltaPct: null }, 18)).toBe(true)
    expect(previousReportDiffers({ value: null, delta: null, deltaPct: null }, 18)).toBe(false)
  })
})

describe('historyMovement', () => {
  const h = buildReportHistory([july, aug, sep])

  it('reports first vs last, best and worst period for a higher-is-better metric', () => {
    const mv = historyMovement(h, 'aiSov')!
    expect(mv.first.reportId).toBe('r-jul')
    expect(mv.last.reportId).toBe('r-sep')
    expect(mv.delta).toBeCloseTo(8.9)
    expect(mv.deltaPct).toBeCloseTo(71.2)
    expect(mv.best.reportId).toBe('r-sep')
    expect(mv.worst.reportId).toBe('r-jul')
    expect(mv.direction).toBe('up')
    expect(mv.improved).toBe(true)
    expect(mv.count).toBe(3)
  })

  it('treats a falling rank position as an improvement', () => {
    const mv = historyMovement(h, 'avgPosition')!
    expect(mv.delta).toBeCloseTo(-3.1)
    expect(mv.direction).toBe('down')
    expect(mv.improved).toBe(true)
    expect(mv.best.reportId).toBe('r-sep')
    expect(mv.worst.reportId).toBe('r-jul')
  })

  it('picks the best period even when it is not the last one', () => {
    const mv = historyMovement(h, 'citationRate')!
    expect(mv.best.reportId).toBe('r-aug')
    expect(mv.worst.reportId).toBe('r-jul')
  })

  it('needs two reports with a value and flags flat movements', () => {
    expect(historyMovement(h.slice(2), 'aiSov')).toBeNull()
    const flat = buildReportHistory([row('a', '2026-01-01', '2026-01-31', { sov: 10 }), row('b', '2026-02-01', '2026-02-28', { sov: 10 })])
    expect(historyMovement(flat, 'aiSov')).toMatchObject({ direction: 'flat', improved: null, delta: 0 })
    // A metric no report carries is not a movement.
    expect(historyMovement(flat, 'referringDomains')).toBeNull()
  })
})

describe('series helpers', () => {
  const h = buildReportHistory([july, aug, sep])

  it('builds one point per report keyed by period end and skips gaps', () => {
    const gap = buildReportHistory([july, row('mid', '2026-07-16', '2026-08-15', {}), sep])
    expect(historySeries(gap, 'aiSov')).toEqual([
      { date: '2026-07-15', value: 12.5, reportId: 'r-jul' },
      { date: '2026-09-15', value: 21.4, reportId: 'r-sep' },
    ])
    expect(historySeries(h, 'referringDomains').map((p) => p.value)).toEqual([30, 33, 35])
  })

  it('lists the metric families with at least two readings, in display order', () => {
    expect(historyMetricsWithData(h)).toEqual(['aiSov', 'citationRate', 'gscClicks', 'gscImpressions', 'avgPosition', 'ga4Sessions', 'aiSessions', 'healthScore', 'referringDomains'])
    const sparse = buildReportHistory([row('a', '2026-01-01', '2026-01-31', { clicks: 1 }), row('b', '2026-02-01', '2026-02-28', { clicks: 2, sov: 3 })])
    expect(historyMetricsWithData(sparse)).toEqual(['gscClicks'])
  })

  it('pctChange is null without a non-zero base', () => {
    expect(pctChange(0, 5)).toBeNull()
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(-10, -5)).toBeCloseTo(50)
  })
})

describe('parseStoredHistory', () => {
  it('accepts well-formed stored points, drops junk and re-sorts', () => {
    const good: ReportHistoryPoint = extractHistoryPoint(sep)
    const raw = [good, { reportId: 'r-jul', periodStart: '2026-06-16', periodEnd: '2026-07-15', aiSov: '12' }, null, 'x', { periodEnd: '2026-01-01' }]
    const parsed = parseStoredHistory(raw)
    expect(parsed.map((p) => p.reportId)).toEqual(['r-jul', 'r-sep'])
    expect(parsed[0]!.aiSov).toBeNull()
    expect(parsed[1]).toEqual(good)
    expect(parseStoredHistory(undefined)).toEqual([])
    expect(parseStoredHistory({})).toEqual([])
  })
})
