/**
 * report-schedule-runner — daily cron: refresh data sources, build due scheduled reports,
 * deliver emails.
 *
 * Auth: x-report-schedule-cron-secret header (pg_cron via run_due_report_schedules).
 *
 * Why Search Console is refreshed *here*, of all places: this is the one daily job that already
 * has a cron secret and a pg_cron entry, so reusing it needs no new secret and no new schedule.
 * It is also the right order — refreshing before sending is what makes a scheduled report carry
 * current numbers rather than whatever the last human visit to the Rankings page left in the
 * cache. `gsc-connect` cannot do this itself: it authenticates a user JWT, and a cron has none.
 *
 * The refresh pass is bounded by a wall-clock budget (GSC_SYNC_BUDGET_MS) measured from the top
 * of the invocation: Supabase kills a request that has not answered within the 150s idle timeout,
 * and sending due reports must never become unreachable because there was a lot to refresh.
 *
 * Dry run ("Send me a test" in the builder): `{ schedule_id, dry_run: true }` with the owner's user
 * JWT. Builds the email exactly as the cron would from the project's latest report and sends it to
 * the caller's own address only — no queue row, no last_run_at, no new report.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { assembleReportData } from '../_shared/reportAssemble.ts'
import { checkNarrativeGrounding, fetchNarrativeWithRetries, removeToolTalk } from '../_shared/reportBuild.ts'
import { buildTrimmedNarrativePrompt } from '../_shared/reportNarrativePayload.ts'
import {
  buildScheduledReportEmail,
  extractReportEmailSummary,
  sendScheduledReportEmail,
  type ReportEmailSummary,
} from '../_shared/reportEmail.ts'
import {
  GSC_SYNC_DEFAULT_BUDGET_MS,
  GSC_SYNC_DEFAULT_CAP,
  GSC_SYNC_DEFAULT_MAX_AGE_DAYS,
  GSC_SYNC_DEFAULT_PROJECT_TIMEOUT_MS,
  positiveNumberEnv,
  refreshScheduledGscProjects,
} from '../_shared/gscSync.ts'
import { loadReportHistory } from '../_shared/reportHistory.ts'
import { restrictReportData } from '../_shared/reportScope.ts'
import { appOrigin as resolveAppOrigin, isSelfHostEnv } from '../_shared/appOrigin.ts'
import {
  parseScheduleTestSendRequest,
  scheduledEmailBranding,
  scheduledReportLocale,
  scheduledReportShareUrl,
  scheduleTestSendResult,
  testSendRecipient,
} from '../_shared/reportScheduleTestSend.ts'
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts'
import { cronSecretMatches } from '../_shared/cronSecret.ts'
import { runOpsWatchdog } from '../_shared/opsWatchdog.ts'

type AdminClient = any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-report-schedule-cron-secret',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateShareToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function parseRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => EMAIL_RE.test(e))
}

// Self-hosted installs have no plans: every schedule runs and emails carry the agency branding.
async function isProPlusPlan(admin: AdminClient, userId: string): Promise<boolean> {
  if (isSelfHostEnv()) return true
  const { data } = await admin.from('subscriptions').select('plan').eq('user_id', userId).maybeSingle() as { data: { plan?: string } | null }
  const plan = data?.plan
  return plan === 'pro' || plan === 'agency'
}

async function isAgencyPlan(admin: AdminClient, userId: string): Promise<boolean> {
  if (isSelfHostEnv()) return true
  const { data } = await admin.from('subscriptions').select('plan').eq('user_id', userId).maybeSingle() as { data: { plan?: string } | null }
  return data?.plan === 'agency'
}

function degradedNarrative(locale: string, reason = 'generation_failed'): Record<string, unknown> {
  return {
    executiveSummary: '',
    sections: {},
    nextActions: [],
    locale,
    grounding: { grounded: false, ungrounded: [] },
    degraded: true,
    degradedReason: reason,
  }
}

async function generateNarrative(
  supabaseUrl: string,
  serviceKey: string,
  data: Record<string, unknown>,
  locale: string,
): Promise<Record<string, unknown>> {
  // Same trimmed payload as report-build: no internal counters or empty engines reach the model.
  const { system: systemPrompt, user: userPrompt } = buildTrimmedNarrativePrompt(data, locale)

  const llmResult = await fetchNarrativeWithRetries(
    {
      supabaseUrl,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: publishableKey(),
      },
      systemPrompt,
      userPrompt,
    },
    { logPrefix: '[report-schedule-runner]' },
  )

  if (!llmResult.ok) return degradedNarrative(locale, llmResult.reason)

  const { narrative: parsed, removed } = removeToolTalk(llmResult.parsed)
  if (removed > 0) console.warn('[report-schedule-runner] removed tool-talk sentences from narrative', removed)
  try {
    checkNarrativeGrounding(parsed, data)
  } catch {
    // grounding check must not block scheduled report delivery
  }
  return { ...parsed, locale }
}

async function processDueSchedules(admin: AdminClient): Promise<{ processed: number; emails: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = secretKey()
  const appOrigin = resolveAppOrigin()

  const { data: dueSchedules, error } = await (admin as any).rpc('get_due_report_schedules', {
    p_as_of: ymd(new Date()),
  })
  if (error) {
    console.error('[report-schedule-runner] get_due_report_schedules failed', error.message)
    return { processed: 0, emails: 0 }
  }

  let processed = 0
  let emails = 0

  for (const schedule of dueSchedules ?? []) {
    const userId = schedule.user_id as string
    const projectId = schedule.project_id as string

    if (!(await isProPlusPlan(admin, userId))) {
      console.warn('[report-schedule-runner] skip schedule — not Pro+', schedule.id)
      continue
    }

    const { data: project } = await admin
      .from('projects')
      .select('id, name, website_url, metadata, primary_language, language')
      .eq('id', projectId)
      .single()
    if (!project) continue

    const periodEnd = ymd(new Date())
    const start = new Date()
    start.setDate(start.getDate() - 27)
    const periodStart = ymd(start)
    const locale = scheduledReportLocale(project)
    const canAgency = await isAgencyPlan(admin, userId)

    const assembled = await assembleReportData(admin, {
      projectId,
      periodStart,
      periodEnd,
      websiteUrl: project.website_url,
      locale,
    })

    const requestedSections = Array.isArray(schedule.sections)
      ? (schedule.sections as string[]).filter((s) => typeof s === 'string')
      : null
    const finalSections =
      requestedSections && requestedSections.length > 0
        ? assembled.sections.filter((s) => requestedSections.includes(s))
        : assembled.sections

    // Client identity + compact history of the previous reports (share page and PDF read them).
    const history = await loadReportHistory(admin, projectId, '[report-schedule-runner]')
    const scheduledData = assembled.data as { meta?: Record<string, unknown> }
    scheduledData.meta = {
      ...(scheduledData.meta ?? {}),
      projectName: project.name ?? null,
      websiteUrl: project.website_url ?? null,
      history,
    }

    // Only the schedule's sections are stored, emailed and written about: the share link returns `data` whole.
    const scopedData = restrictReportData(assembled.data, finalSections)

    const narrative = await generateNarrative(supabaseUrl, serviceKey, scopedData, locale)

    const branding = scheduledEmailBranding(canAgency, schedule.branding, project.metadata)

    const shareToken = canAgency ? generateShareToken() : null

    const { data: inserted, error: insertErr } = await admin
      .from('client_reports')
      .insert({
        project_id: projectId,
        user_id: userId,
        period_start: periodStart,
        period_end: periodEnd,
        sections: finalSections,
        data: scopedData,
        narrative,
        share_token: shareToken,
        branding,
        goals: schedule.goals ?? null,
        layout: schedule.layout ?? null,
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      console.error('[report-schedule-runner] insert failed', insertErr?.message)
      continue
    }

    await admin
      .from('report_schedules')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', schedule.id)

    const recipients = parseRecipients(schedule.recipients)
    const shareUrl = scheduledReportShareUrl(appOrigin, inserted.id, shareToken)
    const summary = extractReportEmailSummary(scopedData, project.name, periodStart, periodEnd, narrative)
    const replyTo = await ownerEmail(admin, userId)

    for (const email of recipients) {
      const { data: queued } = await admin
        .from('report_email_queue')
        .insert({
          schedule_id: schedule.id,
          report_id: inserted.id,
          recipient_email: email,
          locale,
          branding,
          share_url: shareUrl,
          summary,
          status: 'pending',
        })
        .select('id')
        .single()

      if (!queued) continue

      const result = await sendScheduledReportEmail(email, locale, summary, shareUrl, branding as Record<string, unknown> | null, replyTo)
      await admin
        .from('report_email_queue')
        .update({
          status: result.ok ? 'sent' : 'failed',
          attempts: 1,
          last_error: result.ok ? null : result.error,
          sent_at: result.ok ? new Date().toISOString() : null,
        })
        .eq('id', queued.id)

      if (result.ok) emails += 1
    }

    processed += 1
  }

  return { processed, emails }
}

/**
 * The agency's own address, so a client's reply reaches whoever sent the report — not the
 * Rankdelta sending address. Best-effort: no reply-to is better than a failed send.
 */
async function ownerEmail(admin: AdminClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  try {
    const { data } = await admin.auth.admin.getUserById(userId)
    const email = data?.user?.email
    return typeof email === 'string' && email.includes('@') ? email : null
  } catch {
    return null
  }
}

async function processPendingEmails(admin: AdminClient): Promise<number> {
  // 'failed' rows are retried too: the first attempt marks a row failed, so filtering on
  // 'pending' alone meant no failed email was ever retried (e.g. while Resend rejected the
  // sender domain). Still capped at 3 attempts.
  const { data: pending } = await admin
    .from('report_email_queue')
    .select('id, schedule_id, recipient_email, locale, branding, share_url, summary, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(50)

  const ownerBySchedule = new Map<string, string | null>()
  let sent = 0
  for (const row of pending ?? []) {
    const scheduleId = row.schedule_id as string | null
    if (scheduleId && !ownerBySchedule.has(scheduleId)) {
      const { data: sched } = await admin.from('report_schedules').select('user_id').eq('id', scheduleId).maybeSingle()
      ownerBySchedule.set(scheduleId, await ownerEmail(admin, sched?.user_id))
    }
    const result = await sendScheduledReportEmail(
      row.recipient_email,
      row.locale ?? 'en',
      row.summary as ReportEmailSummary,
      row.share_url ?? '',
      row.branding as Record<string, unknown> | null,
      scheduleId ? ownerBySchedule.get(scheduleId) ?? null : null,
    )
    await admin
      .from('report_email_queue')
      .update({
        status: result.ok ? 'sent' : 'failed',
        attempts: (row.attempts ?? 0) + 1,
        last_error: result.ok ? null : result.error,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', row.id)
    if (result.ok) sent += 1
  }
  return sent
}

/**
 * Dry run for one schedule, on behalf of its owner (user JWT, not the cron secret).
 *
 * Ownership goes through the same RLS the builder relies on: the schedule is read with the
 * caller's own client, so a schedule on someone else's project is simply not found. The email is
 * built from the project's most recent report with the exact cron path (summary → template) and
 * sent to the caller's account email only. Nothing is written.
 */
async function sendScheduleTestEmail(req: Request, admin: AdminClient, scheduleId: string): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = publishableKey()
  const appOrigin = resolveAppOrigin()
  const authHeader = req.headers.get('Authorization') ?? ''

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  const sentTo = testSendRecipient(user.email)
  if (!sentTo) return json({ error: 'no_account_email' }, 400)

  // RLS: only schedules on projects the caller owns are visible through the user client.
  const { data: schedule, error: schedErr } = await userClient
    .from('report_schedules')
    .select('id, project_id, user_id, branding')
    .eq('id', scheduleId)
    .maybeSingle()
  if (schedErr) return json({ error: 'schedule_lookup_failed' }, 500)
  if (!schedule || schedule.user_id !== user.id) return json({ error: 'schedule_not_found' }, 404)

  if (!(await isProPlusPlan(admin, user.id))) return json({ error: 'plan_required' }, 403)

  const { data: project } = await admin
    .from('projects')
    .select('id, user_id, name, website_url, metadata, primary_language, language')
    .eq('id', schedule.project_id)
    .single()
  if (!project || project.user_id !== user.id) return json({ error: 'schedule_not_found' }, 404)

  // The latest report of the project stands in for the one the cron would build.
  const { data: report } = await admin
    .from('client_reports')
    .select('id, period_start, period_end, data, narrative, share_token')
    .eq('project_id', schedule.project_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!report) return json({ error: 'no_report' }, 404)

  const locale = scheduledReportLocale(project)
  const canAgency = await isAgencyPlan(admin, user.id)
  const branding = scheduledEmailBranding(canAgency, schedule.branding, project.metadata)
  const shareUrl = scheduledReportShareUrl(appOrigin, report.id, report.share_token)
  const summary = extractReportEmailSummary(
    (report.data ?? {}) as Record<string, unknown>,
    project.name ?? '',
    report.period_start,
    report.period_end,
    (report.narrative ?? null) as Record<string, unknown> | null,
  )

  const { subject } = buildScheduledReportEmail(locale, summary, shareUrl, branding)
  const result = await sendScheduledReportEmail(sentTo, locale, summary, shareUrl, branding)
  if (!result.ok) return json({ error: result.error ?? 'send_failed' }, 502)

  return json(scheduleTestSendResult(subject, sentTo, report.id))
}

/**
 * Daily maintenance pass over the data the reports are built from.
 *
 * Bounded three ways so it can never crowd out the sending that follows: a per-run project cap,
 * a wall-clock budget measured from the top of the invocation, and a per-project timeout on the
 * Google calls. Whatever a run does not reach keeps its old cache and leads tomorrow's
 * oldest-first queue.
 */
async function refreshDataSources(admin: AdminClient, startedAt: number) {
  try {
    return await refreshGscCaches(admin, startedAt)
  } catch (e) {
    // Belt and braces: the pass already contains its own failures, but the due schedules must go
    // out even if something unforeseen escapes it.
    const message = e instanceof Error ? e.message : String(e)
    console.error('[report-schedule-runner][gsc] pass aborted', message)
    return { refreshed: 0, skipped: 0, failed: 0, error: message.slice(0, 180) }
  }
}

async function refreshGscCaches(admin: AdminClient, startedAt: number) {
  return await refreshScheduledGscProjects(admin, {
    startedAt,
    budgetMs: positiveNumberEnv(Deno.env.get('GSC_SYNC_BUDGET_MS'), GSC_SYNC_DEFAULT_BUDGET_MS),
    cap: positiveNumberEnv(Deno.env.get('GSC_SYNC_MAX_PROJECTS'), GSC_SYNC_DEFAULT_CAP),
    // 1 = refresh anything not already refreshed today (the cron is daily and the Search Console
    // API is free). Set GSC_SYNC_MAX_AGE_DAYS=7 for the weekly cadence the UI assumes.
    maxAgeDays: positiveNumberEnv(Deno.env.get('GSC_SYNC_MAX_AGE_DAYS'), GSC_SYNC_DEFAULT_MAX_AGE_DAYS),
    projectTimeoutMs: positiveNumberEnv(
      Deno.env.get('GSC_SYNC_PROJECT_TIMEOUT_MS'),
      GSC_SYNC_DEFAULT_PROJECT_TIMEOUT_MS,
    ),
  })
}

Deno.serve(async (req) => {
  const startedAt = Date.now()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    secretKey(),
  )

  let body: { action?: string; schedule_id?: unknown; dry_run?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // Owner-initiated test send: user JWT, never the cron secret.
  const testSend = parseScheduleTestSendRequest(body)
  if (testSend) return sendScheduleTestEmail(req, admin, testSend.scheduleId)

  const hdr = req.headers.get('x-report-schedule-cron-secret')
  if (!(await cronSecretMatches(admin, hdr, 'REPORT_SCHEDULE_CRON_SECRET', 'report_schedule_cron_secret'))) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (body.action === 'process_pending_emails') {
    const sent = await processPendingEmails(admin)
    return json({ ok: true, sent })
  }

  const work = runDailyPass(admin, startedAt)

  // pg_cron calls through pg_net, which hangs up after 5s by default — far shorter than a GSC
  // refresh plus report builds. Answer at once and finish in the background (same pattern as
  // visibility-ops' cron). Without EdgeRuntime (local), wait for the result.
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work)
    return json({ ok: true, accepted: true }, 202)
  }
  return json({ ok: true, ...(await work) })
})

async function runDailyPass(admin: AdminClient, startedAt: number) {
  try {
    // Refresh first, send second: a scheduled report is only as current as the cache under it.
    // A failure inside the pass is already contained per project, and the pass returns instead of
    // throwing, so the sending below always runs.
    const gsc = await refreshDataSources(admin, startedAt)
    const result = await processDueSchedules(admin)
    const retried = await processPendingEmails(admin)
    // Last: look at the effects of everything above (and of the other crons) in the data.
    const watchdog = await runOpsWatchdog(admin)
    const summary = { ...result, retried, gsc, watchdog: { issues: watchdog.issues.map((i) => i.code), alert: watchdog.alert } }
    console.log('[report-schedule-runner] daily pass', JSON.stringify(summary))
    return summary
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[report-schedule-runner] daily pass failed', message)
    return { error: message.slice(0, 180) }
  }
}
