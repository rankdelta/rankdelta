/**
 * Compact view of a client report for AI agents (hosted MCP `get_client_report`).
 *
 * A stored report carries daily trends, 30-row tables and the raw narrative — too much for a
 * tool result an agent has to reason over. This keeps every section and every KPI, but caps
 * the long arrays (top 10 rows, 31 trend points) so a full report fits in a few thousand tokens.
 */

export interface ClientReportRowForAgent {
  id: string
  project_id: string
  period_start: string
  period_end: string
  created_at: string
  share_token?: string | null
  sections?: unknown
  data: Record<string, unknown> | null
  narrative?: Record<string, unknown> | null
  branding?: Record<string, unknown> | null
  goals?: unknown
  project?: { name?: string | null; website_url?: string | null } | null
}

const DEFAULT_LIMIT = 10
const KEY_LIMITS: Record<string, number> = {
  trend: 31,
  daily: 31,
  dailyData: 31,
  table: 20,
  topMovers: 10,
}

/** Recursively cap arrays; keys in KEY_LIMITS get their own ceiling. */
export function capArrays(value: unknown, keyHint = '', depth = 0): unknown {
  if (depth > 12) return value
  if (Array.isArray(value)) {
    const limit = KEY_LIMITS[keyHint] ?? DEFAULT_LIMIT
    return value.slice(0, limit).map((v) => capArrays(v, keyHint, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = capArrays(v, k, depth + 1)
    }
    return out
  }
  return value
}

export function shareUrlFor(token: string | null | undefined, appOrigin = 'https://rankdelta.ai'): string | null {
  return token ? `${appOrigin}/r/${token}` : null
}

/** What an agent needs to talk about a report (or build a deck from it). */
export function compactClientReport(row: ClientReportRowForAgent, appOrigin = 'https://rankdelta.ai') {
  const data = (row.data ?? {}) as Record<string, unknown>
  const meta = (data.meta ?? {}) as Record<string, unknown>
  const narrative = (row.narrative ?? {}) as Record<string, unknown>
  const { meta: _meta, ...sections } = data
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project?.name ?? (meta.projectName as string | undefined) ?? null,
    website_url: row.project?.website_url ?? (meta.websiteUrl as string | undefined) ?? null,
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: row.created_at,
    locale: (narrative.locale as string | undefined) ?? (meta.locale as string | undefined) ?? null,
    share_url: shareUrlFor(row.share_token, appOrigin),
    branding: row.branding ?? null,
    goals: row.goals ?? null,
    history: meta.history ?? null,
    narrative: {
      executiveSummary: (narrative.executiveSummary as string | undefined) ?? '',
      nextActions: capArrays(narrative.nextActions ?? []),
      sections: narrative.sections ?? {},
    },
    sections: capArrays(sections),
  }
}

/** One line per report for `list_client_reports`. */
export function summarizeClientReport(row: ClientReportRowForAgent, appOrigin = 'https://rankdelta.ai') {
  const data = (row.data ?? {}) as Record<string, unknown>
  const summary = (data.summary ?? {}) as Record<string, { value?: number | null } | undefined>
  const meta = (data.meta ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project?.name ?? (meta.projectName as string | undefined) ?? null,
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: row.created_at,
    share_url: shareUrlFor(row.share_token, appOrigin),
    ai_share_of_voice: summary.aiSov?.value ?? null,
    gsc_clicks: summary.gscClicks?.value ?? null,
    ga4_sessions: summary.ga4Sessions?.value ?? null,
    avg_position: summary.avgPosition?.value ?? null,
    health_score: summary.healthScore?.value ?? null,
    sections: Array.isArray(row.sections) ? row.sections : Object.keys(data).filter((k) => k !== 'meta'),
  }
}
