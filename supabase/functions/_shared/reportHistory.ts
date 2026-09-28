/**
 * Report history — compact "one point per report" extraction, persisted into the snapshot at build
 * time (data.meta.history) so the public share page and the PDF can show how the client trends
 * across reports without access to sibling rows.
 *
 * Mirrors src/lib/agencyReport/history.ts (extractHistoryPoint / buildReportHistory) — keep in sync.
 */

import { isConnectedSection } from './reportBuild.ts'

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

/** Previous reports kept in the snapshot: 11 + the report itself = the 12 the UI shows. */
export const STORED_HISTORY_MAX = 11

export interface ReportHistoryRow {
  id: string
  period_start: string
  period_end: string
  created_at?: string | null
  data?: unknown
}

/** json-path selects: the summary block and the three section fields it does not carry. */
export const HISTORY_SELECT =
  'id, period_start, period_end, created_at, summary:data->summary, geoCitationRate:data->geo->citationRate, gscImpressions:data->gsc->impressions, backlinksReferringDomains:data->backlinks->referringDomains'

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function metricValue(m: unknown): number | null {
  if (!m || typeof m !== 'object') return null
  return num((m as { value?: unknown }).value)
}

function section(raw: unknown): Record<string, unknown> | null {
  return isConnectedSection(raw) && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

/** Reduce one snapshot (full or partial) to its headline numbers. Never throws. */
export function extractHistoryPoint(row: ReportHistoryRow): ReportHistoryPoint {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>
  const summary = data['summary'] && typeof data['summary'] === 'object' ? (data['summary'] as Record<string, unknown>) : null
  const geo = section(data['geo'])
  const gsc = section(data['gsc'])
  const ga4 = section(data['ga4'])
  const rankings = section(data['rankings'])
  const health = section(data['site_health'])
  const backlinks = section(data['backlinks'])

  return {
    reportId: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    aiSov: metricValue(summary?.['aiSov']) ?? metricValue(geo?.['sovOverall']),
    citationRate: metricValue(geo?.['citationRate']),
    gscClicks: metricValue(summary?.['gscClicks']) ?? metricValue(gsc?.['clicks']),
    gscImpressions: metricValue(gsc?.['impressions']),
    avgPosition: metricValue(summary?.['avgPosition']) ?? metricValue(rankings?.['avgPosition']),
    ga4Sessions: metricValue(summary?.['ga4Sessions']) ?? metricValue(ga4?.['sessions']),
    aiSessions: metricValue(summary?.['ga4AiAssistantSessions']) ?? metricValue(ga4?.['aiAssistantSessions']),
    healthScore: metricValue(summary?.['healthScore']) ?? num(health?.['auditScore']),
    referringDomains: num(backlinks?.['referringDomains']),
  }
}

function byPeriod(a: ReportHistoryPoint, b: ReportHistoryPoint): number {
  return a.periodEnd.localeCompare(b.periodEnd) || a.periodStart.localeCompare(b.periodStart)
}

/**
 * Sorted by period end (oldest first), one point per period (latest build wins), capped to the
 * most recent `max` periods.
 */
export function buildReportHistory(rows: ReportHistoryRow[], max = STORED_HISTORY_MAX): ReportHistoryPoint[] {
  const latest = new Map<string, { row: ReportHistoryRow; stamp: string; order: number }>()
  rows.forEach((row, order) => {
    if (!row?.id || !row.period_start || !row.period_end) return
    const key = `${row.period_start}|${row.period_end}`
    const stamp = row.created_at ?? ''
    const prev = latest.get(key)
    if (!prev || stamp > prev.stamp || (stamp === prev.stamp && order > prev.order)) {
      latest.set(key, { row, stamp, order })
    }
  })
  const points = [...latest.values()].map((e) => extractHistoryPoint(e.row)).sort(byPeriod)
  return max > 0 && points.length > max ? points.slice(points.length - max) : points
}

interface HistorySelectRow {
  id: string
  period_start: string
  period_end: string
  created_at: string | null
  summary: unknown
  geoCitationRate: unknown
  gscImpressions: unknown
  backlinksReferringDomains: unknown
}

/** Rebuild the extractor's input from the json-path select columns. */
export function historyRowsFromSelect(rows: HistorySelectRow[]): ReportHistoryRow[] {
  return rows.map((row) => ({
    id: row.id,
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: row.created_at,
    data: {
      summary: row.summary,
      geo: { citationRate: row.geoCitationRate },
      gsc: { impressions: row.gscImpressions },
      backlinks: { referringDomains: row.backlinksReferringDomains },
    },
  }))
}

// deno-lint-ignore no-explicit-any
type AdminClient = any

/**
 * The project's previous reports as compact points (oldest first, at most STORED_HISTORY_MAX).
 * Never throws: a failed query logs and yields an empty history so the build goes on.
 */
export async function loadReportHistory(admin: AdminClient, projectId: string, logPrefix = '[report-history]'): Promise<ReportHistoryPoint[]> {
  try {
    const { data, error } = await admin
      .from('client_reports')
      .select(HISTORY_SELECT)
      .eq('project_id', projectId)
      .order('period_end', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(48)
    if (error) {
      console.warn(`${logPrefix} history query failed`, error.message)
      return []
    }
    return buildReportHistory(historyRowsFromSelect((data ?? []) as HistorySelectRow[]))
  } catch (e) {
    console.warn(`${logPrefix} history load failed`, e instanceof Error ? e.message : String(e))
    return []
  }
}
