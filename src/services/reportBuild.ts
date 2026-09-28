/**
 * Client service + contracts for report-build edge function.
 */

import { supabase } from '../lib/supabaseClient'
import type { ClientReportSnapshot, GscAiOverviewRow, ReportData, ReportGoals } from '../lib/agencyReport/types'
import type { ReportHistoryRow } from '../lib/agencyReport/history'
import { withCleanNarrative, withSectionSummary } from '../lib/agencyReport/snapshot'
import type { ReportLayout } from '../lib/agencyReport/layout'
import type { SectionKey } from '../lib/agencyReport/sections'
import type { WhiteLabelReportBranding } from '../lib/whiteLabelReport'

export type { ClientReportSnapshot, ReportGoals } from '../lib/agencyReport/types'
export type { SectionKey } from '../lib/agencyReport/sections'

export interface BuildClientReportInput {
  projectId: string
  periodStart?: string
  periodEnd?: string
  locale?: string
  goals?: ReportGoals
  branding?: Partial<WhiteLabelReportBranding>
  share?: boolean
  sections?: SectionKey[]
  layout?: ReportLayout
}

export interface ClientReportRow {
  id: string
  project_id: string
  period_start: string
  period_end: string
  /** Sections that built (the build strips the disconnected ones). */
  sections: SectionKey[]
  share_token: string | null
  created_at: string
  /** Saved layout — says which sections were wanted, so the history can name the missing ones. */
  layout?: ReportLayout | null
  /** `data->backlinks` only: 0/0/null means the domain was never analysed (see backlinksNeverAnalysed). */
  backlinks?: unknown
}

export async function buildClientReport(input: BuildClientReportInput): Promise<{
  ok: boolean
  report: ClientReportRow
  narrativeGenerated: boolean
}> {
  const { data, error } = await supabase.functions.invoke('report-build', { body: input })
  if (error) throw error
  if (!data?.ok) throw new Error(data?.error ?? 'report_build_failed')
  return data as { ok: boolean; report: ClientReportRow; narrativeGenerated: boolean }
}

export async function fetchClientReports(projectId: string): Promise<ClientReportRow[]> {
  const { data, error } = await supabase
    .from('client_reports')
    .select('id, project_id, period_start, period_end, sections, share_token, created_at, layout, backlinks:data->backlinks')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ClientReportRow[]
}

/** Columns behind the report history: json-path selects, so 12 reports cost one small request. */
const HISTORY_SELECT =
  'id, period_start, period_end, created_at, summary:data->summary, geoCitationRate:data->geo->citationRate, gscImpressions:data->gsc->impressions, backlinksReferringDomains:data->backlinks->referringDomains'

interface ClientReportHistoryRow {
  id: string
  period_start: string
  period_end: string
  created_at: string
  summary: unknown
  geoCitationRate: unknown
  gscImpressions: unknown
  backlinksReferringDomains: unknown
}

/**
 * Headline numbers of the project's reports (newest first, capped well above the 12 periods the
 * history keeps so duplicate builds of a period do not crowd out older ones).
 */
export async function fetchClientReportHistoryRows(projectId: string): Promise<ReportHistoryRow[]> {
  const { data, error } = await supabase
    .from('client_reports')
    .select(HISTORY_SELECT)
    .eq('project_id', projectId)
    .order('period_end', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(48)
  if (error) throw error
  return ((data ?? []) as unknown as ClientReportHistoryRow[]).map((row) => ({
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

export async function fetchClientReportById(reportId: string): Promise<ClientReportSnapshot | null> {
  const { data, error } = await supabase
    .from('client_reports')
    .select(
      'id, project_id, period_start, period_end, sections, data, narrative, branding, goals, layout, share_token, created_at',
    )
    .eq('id', reportId)
    .maybeSingle()
  if (error) throw error
  return data ? withCleanNarrative(withSectionSummary(data as ClientReportSnapshot)) : null
}

/** Mirrors get_shared_report SQL guard — avoids RPC for obviously invalid tokens. */
export function isValidShareToken(token: string | null | undefined): boolean {
  if (token == null) return false
  return token.trim().length >= 16
}

export async function fetchSharedReport(token: string): Promise<ClientReportSnapshot | null> {
  if (!isValidShareToken(token)) return null
  const { data, error } = await supabase.rpc('get_shared_report', { p_token: token })
  if (error) throw error
  return data ? withCleanNarrative(withSectionSummary(data as ClientReportSnapshot)) : null
}

/** A fresh client link for a report (report-build issues it: clients may clear a token, never set one). */
export async function reshareReport(reportId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; report?: { share_token?: string | null } }>('report-build', {
    body: { action: 'reshare', reportId },
  })
  if (error) throw error
  const token = data?.report?.share_token
  if (!token) throw new Error(data?.error ?? 'reshare_failed')
  return token
}

export async function revokeReportShare(reportId: string): Promise<void> {
  const { error } = await supabase.from('client_reports').update({ share_token: null }).eq('id', reportId)
  if (error) throw error
}

export async function updateReportData(reportId: string, data: ReportData): Promise<void> {
  const { error } = await supabase.from('client_reports').update({ data }).eq('id', reportId)
  if (error) throw error
}

export async function updateReportLayout(reportId: string, layout: ReportLayout): Promise<void> {
  const { error } = await supabase.from('client_reports').update({ layout }).eq('id', reportId)
  if (error) throw error
}

export async function attachGscAiOverviewCsv(
  reportId: string,
  currentData: ReportData,
  rows: GscAiOverviewRow[],
): Promise<ReportData> {
  const next: ReportData = {
    ...currentData,
    meta: {
      ...(currentData.meta ?? {}),
      gscAiOverviews: rows,
    },
  }
  await updateReportData(reportId, next)
  return next
}
