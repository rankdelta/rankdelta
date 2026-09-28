/**
 * Report schedule CRUD + portfolio rollup service.
 */

import { supabase } from '../lib/supabaseClient'
import type { ReportGoals } from '../lib/agencyReport/types'
import type { ReportLayout } from '../lib/agencyReport/layout'
import type { SectionKey } from '../lib/agencyReport/sections'
import type { WhiteLabelReportBranding } from '../lib/whiteLabelReport'
import type { ReportCadence } from '../lib/agencyReport/schedule'

export interface ReportScheduleRow {
  id: string
  project_id: string
  user_id: string
  cadence: ReportCadence
  day_of_week: number | null
  day_of_month: number | null
  recipients: string[]
  sections: SectionKey[]
  branding: Partial<WhiteLabelReportBranding> | null
  goals: ReportGoals | null
  layout: ReportLayout | null
  last_run_at: string | null
  active: boolean
  created_at: string
}

export interface CreateReportScheduleInput {
  projectId: string
  cadence: ReportCadence
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  recipients: string[]
  sections?: SectionKey[]
  branding?: Partial<WhiteLabelReportBranding> | null
  goals?: ReportGoals | null
  layout?: ReportLayout | null
}

export interface PortfolioMetric {
  value: number | null
  delta: number | null
}

export interface PortfolioClientTile {
  projectId: string
  projectName: string
  websiteUrl: string | null
  latestReportId: string | null
  aiSov: PortfolioMetric
  avgPosition: PortfolioMetric
  gscClicks: PortfolioMetric
  ga4Sessions: PortfolioMetric
  healthScore: PortfolioMetric
}

export async function fetchReportSchedules(projectId: string): Promise<ReportScheduleRow[]> {
  const { data, error } = await supabase
    .from('report_schedules')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ReportScheduleRow[]
}

export async function createReportSchedule(input: CreateReportScheduleInput): Promise<ReportScheduleRow> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthorized')
  if (!input.projectId) throw new Error('missing_project')

  const { data, error } = await supabase
    .from('report_schedules')
    .insert({
      project_id: input.projectId,
      user_id: user.id,
      cadence: input.cadence,
      day_of_week: input.cadence === 'weekly' ? input.dayOfWeek : null,
      day_of_month: input.cadence === 'monthly' ? input.dayOfMonth : null,
      recipients: input.recipients,
      sections: input.sections ?? [],
      branding: input.branding ?? null,
      goals: input.goals ?? null,
      layout: input.layout ?? null,
      active: true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ReportScheduleRow
}

export async function updateReportSchedule(
  id: string,
  patch: Partial<Pick<ReportScheduleRow, 'recipients' | 'sections' | 'branding' | 'goals' | 'active'>>,
): Promise<void> {
  const { error } = await supabase.from('report_schedules').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteReportSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('report_schedules').delete().eq('id', id)
  if (error) throw error
}

export interface ScheduleTestSendResult {
  /** Subject line of the email that was sent, as the client would see it. */
  subject: string
  /** The caller's own account email — a test never reaches the schedule recipients. */
  sentTo: string
}

/**
 * Error codes the runner returns for a dry run. `no_report` = build a report for this client first;
 * `email_not_configured` = the transactional sender is not set up on the server.
 */
export type ScheduleTestSendErrorCode =
  | 'no_report'
  | 'schedule_not_found'
  | 'plan_required'
  | 'no_account_email'
  | 'email_not_configured'
  | 'unauthorized'
  | 'send_failed'

const KNOWN_TEST_SEND_ERRORS: ReadonlyArray<ScheduleTestSendErrorCode> = [
  'no_report',
  'schedule_not_found',
  'plan_required',
  'no_account_email',
  'email_not_configured',
  'unauthorized',
]

export class ScheduleTestSendError extends Error {
  public code: ScheduleTestSendErrorCode
  public constructor(code: string) {
    super(code)
    this.name = 'ScheduleTestSendError'
    this.code = (KNOWN_TEST_SEND_ERRORS as ReadonlyArray<string>).includes(code) ? (code as ScheduleTestSendErrorCode) : 'send_failed'
  }
}

/** The runner's error code out of a FunctionsHttpError response body, '' when there is none. */
async function edgeErrorCode(error: unknown): Promise<string> {
  try {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      const body = (await context.json()) as { error?: unknown } | null
      return typeof body?.error === 'string' ? body.error : ''
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * "Send me a test": the runner builds the scheduled email from the project's latest report,
 * exactly as the cron would, and sends it to the signed-in owner only (dry run — no queue row,
 * no last_run_at).
 */
export async function sendReportScheduleTest(scheduleId: string): Promise<ScheduleTestSendResult> {
  interface DryRunResponse {
    ok?: boolean
    subject?: unknown
    sent_to?: unknown
    error?: unknown
  }
  // Runner contract: snake_case body/response fields.
   
  const body = { schedule_id: scheduleId, dry_run: true }
  const { data, error } = (await supabase.functions.invoke('report-schedule-runner', { body })) as {
    data: DryRunResponse | null
    error: unknown
  }
  if (error) throw new ScheduleTestSendError((await edgeErrorCode(error)) || 'send_failed')
  if (!data?.ok || typeof data.subject !== 'string' || typeof data.sent_to !== 'string') {
    throw new ScheduleTestSendError(typeof data?.error === 'string' ? data.error : 'send_failed')
  }
  return { subject: data.subject, sentTo: data.sent_to }
}

export async function fetchPortfolioRollup(): Promise<PortfolioClientTile[]> {
  const { data, error } = await supabase.rpc('get_portfolio_rollup')
  if (error) throw error
  return (data ?? []) as PortfolioClientTile[]
}
