/**
 * "Send me a test" for a scheduled report — the pure parts of the dry run in report-schedule-runner.
 *
 * The cron path builds a fresh report, queues one email per recipient and stamps last_run_at. The
 * dry run must produce the *same email* the client would get, from the latest report the project
 * already has, and deliver it to the schedule owner only — without touching report_email_queue,
 * last_run_at, or client_reports. Everything here is decision logic, kept free of I/O so it can be
 * unit-tested; the runner does the fetching and the sending.
 */

export interface ScheduleTestSendRequest {
  scheduleId: string
}

/** `{ schedule_id, dry_run: true }` from an authenticated owner; anything else is not a dry run. */
export function parseScheduleTestSendRequest(body: unknown): ScheduleTestSendRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { dry_run?: unknown; schedule_id?: unknown }
  if (b.dry_run !== true) return null
  const scheduleId = typeof b.schedule_id === 'string' ? b.schedule_id.trim() : ''
  return scheduleId ? { scheduleId } : null
}

/** Where the email's button points: the public share page when the report has one, the portal otherwise. */
export function scheduledReportShareUrl(appOrigin: string, reportId: string, shareToken: string | null | undefined): string {
  const origin = appOrigin.replace(/\/+$/, '')
  return shareToken ? `${origin}/r/${shareToken}` : `${origin}/reports/portal/${reportId}`
}

/**
 * Branding the cron applies to a scheduled email: the schedule's own branding, else the project's
 * white-label settings — and nothing at all below the Agency plan (mirrors processDueSchedules).
 */
export function scheduledEmailBranding(
  canAgency: boolean,
  scheduleBranding: unknown,
  projectMetadata: unknown,
): Record<string, unknown> | null {
  if (!canAgency) return null
  if (scheduleBranding && typeof scheduleBranding === 'object') return scheduleBranding as Record<string, unknown>
  const wl = projectMetadata && typeof projectMetadata === 'object' ? (projectMetadata as Record<string, unknown>).white_label_report : null
  return wl && typeof wl === 'object' ? (wl as Record<string, unknown>) : null
}

/** Same resolution as report-build and the cron: content language first, market language as fallback. */
export function scheduledReportLocale(project: { language?: string | null; primary_language?: string | null } | null | undefined): 'it' | 'en' {
  return (project?.language || project?.primary_language) === 'it' ? 'it' : 'en'
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * The only address a test send may go to: the caller's own account email. Never a schedule
 * recipient, never a body field — the client must not receive an owner's test.
 */
export function testSendRecipient(callerEmail: unknown): string | null {
  const email = typeof callerEmail === 'string' ? callerEmail.trim().toLowerCase() : ''
  return EMAIL_RE.test(email) ? email : null
}

export interface ScheduleTestSendOk {
  ok: true
  dry_run: true
  subject: string
  sent_to: string
  report_id: string
}

export function scheduleTestSendResult(subject: string, sentTo: string, reportId: string): ScheduleTestSendOk {
  return { ok: true, dry_run: true, subject, sent_to: sentTo, report_id: reportId }
}
