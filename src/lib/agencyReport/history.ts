/**
 * Report history — how one client trends across reports.
 *
 * Every client report is a snapshot of one period. To show "where is this client going", the
 * headline numbers of each snapshot are reduced to one compact point (`ReportHistoryPoint`) and
 * the points are lined up by period. The extractor reads only `data.summary` plus the few section
 * fields the summary does not carry (citation rate, impressions, referring domains), so a caller
 * can feed it partial rows (PostgREST json-path selects) as well as full snapshots.
 *
 * Mirrored in supabase/functions/_shared/reportHistory.ts — keep the two extractors in sync.
 */
import type { MetricWithDelta } from '../reportBuild/math'
import { isConnectedSection } from './sections'
import type {
  BacklinksSectionData,
  Ga4SectionData,
  GeoSectionData,
  GscSectionData,
  RankingsSectionData,
  ReportData,
  SiteHealthSectionData,
} from './types'

export interface ReportHistoryPoint {
  reportId: string
  periodStart: string
  periodEnd: string
  aiSov: number | null
  citationRate: number | null
  gscClicks: number | null
  gscImpressions: number | null
  avgPosition: number | null
  ga4Sessions: number | null
  aiSessions: number | null
  healthScore: number | null
  referringDomains: number | null
}

export type HistoryMetricKey = Exclude<keyof ReportHistoryPoint, 'reportId' | 'periodStart' | 'periodEnd'>

/** Metrics in display order with their "good direction" (rank position: lower is better). */
export const HISTORY_METRICS: ReadonlyArray<{ key: HistoryMetricKey; positiveIsGood: boolean }> = [
  { key: 'aiSov', positiveIsGood: true },
  { key: 'citationRate', positiveIsGood: true },
  { key: 'gscClicks', positiveIsGood: true },
  { key: 'gscImpressions', positiveIsGood: true },
  { key: 'avgPosition', positiveIsGood: false },
  { key: 'ga4Sessions', positiveIsGood: true },
  { key: 'aiSessions', positiveIsGood: true },
  { key: 'healthScore', positiveIsGood: true },
  { key: 'referringDomains', positiveIsGood: true },
]

export const HISTORY_MAX_POINTS = 12

/** Minimal row shape the extractor needs — a full `client_reports` row satisfies it. */
export interface ReportHistoryRow {
  id: string
  period_start: string
  period_end: string
  created_at?: string | null
  /** Full or partial snapshot data (`summary` + the section fields read below). */
  data?: unknown
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function metricValue(m: unknown): number | null {
  if (!m || typeof m !== 'object') return null
  return num((m as { value?: unknown }).value)
}

function section<T>(raw: unknown): T | null {
  return isConnectedSection<T>(raw as T | null | undefined) ? (raw as T) : null
}

/** Reduce one snapshot to its headline numbers. Never throws on partial or malformed data. */
export function extractHistoryPoint(row: ReportHistoryRow): ReportHistoryPoint {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as ReportData
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : null
  const geo = section<GeoSectionData>(data.geo)
  const gsc = section<GscSectionData>(data.gsc)
  const ga4 = section<Ga4SectionData>(data.ga4)
  const rankings = section<RankingsSectionData>(data.rankings)
  const health = section<SiteHealthSectionData>(data.site_health)
  const backlinks = section<BacklinksSectionData>(data.backlinks)

  return {
    reportId: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    aiSov: metricValue(summary?.aiSov) ?? metricValue(geo?.sovOverall),
    citationRate: metricValue(geo?.citationRate),
    gscClicks: metricValue(summary?.gscClicks) ?? metricValue(gsc?.clicks),
    gscImpressions: metricValue(gsc?.impressions),
    avgPosition: metricValue(summary?.avgPosition) ?? metricValue(rankings?.avgPosition),
    ga4Sessions: metricValue(summary?.ga4Sessions) ?? metricValue(ga4?.sessions),
    aiSessions: metricValue(summary?.ga4AiAssistantSessions) ?? metricValue(ga4?.aiAssistantSessions),
    healthScore: metricValue(summary?.healthScore) ?? num(health?.auditScore),
    referringDomains: num(backlinks?.referringDomains),
  }
}

function periodKey(p: { periodStart: string; periodEnd: string }): string {
  return `${p.periodStart}|${p.periodEnd}`
}

function byPeriod(a: ReportHistoryPoint, b: ReportHistoryPoint): number {
  return a.periodEnd.localeCompare(b.periodEnd) || a.periodStart.localeCompare(b.periodStart)
}

/**
 * Line up report rows by period: sorted by period end (oldest first), one point per period
 * (a period rebuilt twice keeps the latest build), capped to the most recent `max` periods.
 */
export function buildReportHistory(rows: ReportHistoryRow[], max = HISTORY_MAX_POINTS): ReportHistoryPoint[] {
  const latest = new Map<string, { row: ReportHistoryRow; stamp: string; order: number }>()
  rows.forEach((row, order) => {
    if (!row?.id || !row.period_start || !row.period_end) return
    const key = `${row.period_start}|${row.period_end}`
    const stamp = row.created_at ?? ''
    const prev = latest.get(key)
    // Later created_at wins; without timestamps the later row in the input wins.
    if (!prev || stamp > prev.stamp || (stamp === prev.stamp && order > prev.order)) {
      latest.set(key, { row, stamp, order })
    }
  })
  const points = [...latest.values()].map((e) => extractHistoryPoint(e.row)).sort(byPeriod)
  return max > 0 && points.length > max ? points.slice(points.length - max) : points
}

/**
 * Merge the report on screen into a history that may predate it (the compact history stored in
 * the snapshot lists the *previous* reports). The displayed report always represents its own
 * period, even when a later rebuild of the same period exists.
 */
export function withCurrentReport(history: ReportHistoryPoint[], current: ReportHistoryPoint, max = HISTORY_MAX_POINTS): ReportHistoryPoint[] {
  const key = periodKey(current)
  const rest = history.filter((p) => p.reportId !== current.reportId && periodKey(p) !== key)
  const points = [...rest, current].sort(byPeriod)
  if (max <= 0 || points.length <= max) return points
  // Keep the most recent periods but never drop the report being viewed.
  const trimmed = points.slice(points.length - max)
  if (trimmed.some((p) => p.reportId === current.reportId)) return trimmed
  return [current, ...trimmed.slice(1)]
}

/** Position of a report inside its history plus its neighbours (for the period navigator). */
export function historyNeighbours(
  history: ReportHistoryPoint[],
  reportId: string,
): { index: number; previous: ReportHistoryPoint | null; next: ReportHistoryPoint | null } {
  const index = history.findIndex((p) => p.reportId === reportId)
  if (index < 0) return { index: -1, previous: null, next: null }
  return { index, previous: history[index - 1] ?? null, next: history[index + 1] ?? null }
}

export function pctChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null
  return ((to - from) / Math.abs(from)) * 100
}

export interface HistoryMovement {
  key: HistoryMetricKey
  positiveIsGood: boolean
  first: ReportHistoryPoint
  last: ReportHistoryPoint
  delta: number
  deltaPct: number | null
  /** Period with the best value for this metric (highest, or lowest for rank position). */
  best: ReportHistoryPoint
  worst: ReportHistoryPoint
  direction: 'up' | 'down' | 'flat'
  /** Whether the movement is good news for the client (null when flat). */
  improved: boolean | null
  /** Points that carry a value for this metric. */
  count: number
}

/**
 * Movement of one metric across the whole history: first report with a value vs the latest,
 * plus the best and worst period. Null when fewer than two reports carry the metric.
 */
export function historyMovement(history: ReportHistoryPoint[], key: HistoryMetricKey): HistoryMovement | null {
  const def = HISTORY_METRICS.find((m) => m.key === key)
  if (!def) return null
  const points = history.filter((p) => p[key] != null)
  if (points.length < 2) return null
  const first = points[0]!
  const last = points[points.length - 1]!
  const better = (a: number, b: number) => (def.positiveIsGood ? a > b : a < b)
  let best = first
  let worst = first
  for (const p of points) {
    if (better(p[key]!, best[key]!)) best = p
    if (better(worst[key]!, p[key]!)) worst = p
  }
  const delta = last[key]! - first[key]!
  const flat = Math.abs(delta) < 1e-9
  const direction = flat ? 'flat' : delta > 0 ? 'up' : 'down'
  return {
    key,
    positiveIsGood: def.positiveIsGood,
    first,
    last,
    delta,
    deltaPct: pctChange(first[key], last[key]),
    best,
    worst,
    direction,
    improved: flat ? null : def.positiveIsGood ? delta > 0 : delta < 0,
    count: points.length,
  }
}

/** Movement of a metric between one report and the report before it (null on the first report). */
export function deltaVsPreviousReport(
  history: ReportHistoryPoint[],
  reportId: string,
  key: HistoryMetricKey,
): { previous: ReportHistoryPoint; delta: number; deltaPct: number | null } | null {
  const { index, previous } = historyNeighbours(history, reportId)
  if (index < 0 || !previous) return null
  const current = history[index]!
  if (current[key] == null || previous[key] == null) return null
  return { previous, delta: current[key]! - previous[key]!, deltaPct: pctChange(previous[key], current[key]) }
}

/**
 * The scorecard metric re-based on the previous *report* instead of the previous period inside
 * the snapshot. Null when either side has no value.
 */
export function metricVsPreviousReport(currentValue: number | null, previousValue: number | null): MetricWithDelta | null {
  if (currentValue == null || previousValue == null) return null
  const delta = currentValue - previousValue
  return { value: currentValue, delta, deltaPct: previousValue !== 0 ? Math.round((1000 * delta) / previousValue) / 10 : currentValue !== 0 ? 100 : 0 }
}

/**
 * True when the previous report's value is not what the snapshot already compares against
 * (the previous period), i.e. showing "vs previous report" adds information.
 */
export function previousReportDiffers(metric: MetricWithDelta | null | undefined, previousValue: number | null): boolean {
  if (!metric || metric.value == null || previousValue == null) return false
  if (metric.delta == null) return true
  const snapshotPrior = metric.value - metric.delta
  return Math.abs(snapshotPrior - previousValue) > 0.05
}

/** Series for one chart line: x = period end (ISO), y = value; reports without the metric are skipped. */
export function historySeries(history: ReportHistoryPoint[], key: HistoryMetricKey): Array<{ date: string; value: number; reportId: string }> {
  return history.filter((p) => p[key] != null).map((p) => ({ date: p.periodEnd, value: p[key]!, reportId: p.reportId }))
}

/** Metrics that at least two reports carry — the chart families worth drawing. */
export function historyMetricsWithData(history: ReportHistoryPoint[]): HistoryMetricKey[] {
  return HISTORY_METRICS.map((m) => m.key).filter((key) => history.filter((p) => p[key] != null).length >= 2)
}

/** Parse a stored `data.meta.history` (untrusted JSON) into well-formed points. */
export function parseStoredHistory(raw: unknown): ReportHistoryPoint[] {
  if (!Array.isArray(raw)) return []
  const out: ReportHistoryPoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Partial<Record<keyof ReportHistoryPoint, unknown>>
    if (typeof o.reportId !== 'string' || typeof o.periodStart !== 'string' || typeof o.periodEnd !== 'string') continue
    const point: ReportHistoryPoint = {
      reportId: o.reportId,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      aiSov: null,
      citationRate: null,
      gscClicks: null,
      gscImpressions: null,
      avgPosition: null,
      ga4Sessions: null,
      aiSessions: null,
      healthScore: null,
      referringDomains: null,
    }
    for (const { key } of HISTORY_METRICS) point[key] = num(o[key])
    out.push(point)
  }
  return out.sort(byPeriod)
}

/** Scorecard KPI → history metric (the summary names AI sessions differently). */
export const SUMMARY_TO_HISTORY_KEY: Record<string, HistoryMetricKey> = {
  healthScore: 'healthScore',
  aiSov: 'aiSov',
  avgPosition: 'avgPosition',
  gscClicks: 'gscClicks',
  ga4Sessions: 'ga4Sessions',
  ga4AiAssistantSessions: 'aiSessions',
}

/** Chart families of the "trend across reports" block: one line per key, the first key is the lead. */
export const HISTORY_FAMILIES: ReadonlyArray<{ id: 'sov' | 'clicks' | 'sessions' | 'health'; keys: HistoryMetricKey[] }> = [
  { id: 'sov', keys: ['aiSov', 'citationRate'] },
  { id: 'clicks', keys: ['gscClicks', 'gscImpressions'] },
  { id: 'sessions', keys: ['ga4Sessions', 'aiSessions'] },
  { id: 'health', keys: ['healthScore'] },
]

/** Columns of the compact "report by report" table. */
export const HISTORY_TABLE_KEYS: HistoryMetricKey[] = ['aiSov', 'gscClicks', 'ga4Sessions', 'avgPosition', 'healthScore']

/** History stored inside the snapshot at build time (data.meta.history — previous reports only). */
export function storedHistory(data: unknown): ReportHistoryPoint[] | null {
  const meta = data && typeof data === 'object' ? (data as { meta?: { history?: unknown } }).meta : null
  if (!meta || !Array.isArray(meta.history)) return null
  return parseStoredHistory(meta.history)
}

/**
 * The history to show for a report: the rows fetched in-app when available, otherwise the compact
 * history persisted in the snapshot (share page, PDF); the report on screen is always included.
 * Null when nothing is known about sibling reports.
 */
export function resolveReportHistory(
  report: ReportHistoryRow,
  fetched: ReportHistoryPoint[] | null | undefined,
): ReportHistoryPoint[] | null {
  const base = fetched ?? storedHistory(report.data)
  if (!base) return null
  return withCurrentReport(base, extractHistoryPoint(report))
}

/**
 * Scorecard tile movement against the previous report, only when that comparison differs from
 * the prior period the snapshot already shows (or when the snapshot has no prior at all).
 */
export function scorecardVsReport(
  history: ReportHistoryPoint[] | null | undefined,
  reportId: string,
  summaryKey: string,
  metric: MetricWithDelta | null | undefined,
): { key: HistoryMetricKey; delta: number; previous: ReportHistoryPoint } | null {
  const key = SUMMARY_TO_HISTORY_KEY[summaryKey]
  if (!history || !key || !metric) return null
  const movement = deltaVsPreviousReport(history, reportId, key)
  if (!movement || !previousReportDiffers(metric, movement.previous[key])) return null
  return { key, delta: movement.delta, previous: movement.previous }
}
