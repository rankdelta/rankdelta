/**
 * Ops watchdog — daily check for the failures that stay silent.
 *
 * These failure modes do not throw anywhere a human would see: pg_cron jobs that "succeed" while
 * doing nothing, paying projects that are never scanned, a first scan after onboarding that never
 * runs, GSC connections saved without a token, and result emails rejected by the mail provider.
 * This pass looks at the *effects* in the data rather than at job statuses, and emails the
 * internal account(s) when something is off. Runs at the end of report-schedule-runner's daily pass (no extra cron/secret).
 *
 * `evaluateOpsHealth` is pure (tested); `collectOpsSnapshot` does the reads.
 */

type Db = { from: (table: string) => any; auth?: any }

const DAY = 86_400_000
const HOUR = 3_600_000

export const PAID_PLANS = new Set(['starter', 'growth', 'pro', 'agency'])
export const PAYING_STATUSES = new Set(['active', 'trialing'])

export type OpsSnapshot = {
  now: number
  projects: Array<{
    id: string
    name: string | null
    user_id: string
    created_at: string
    visibility_schedule_enabled: boolean | null
    visibility_scheduled_last_at: string | null
  }>
  subscriptions: Array<{ user_id: string; plan: string | null; status: string | null; is_internal: boolean | null }>
  activeQueryProjectIds: string[]
  spendEvents: Array<{ project_id: string | null; action: string; created_at: string }>
  schedules: Array<{ id: string; project_id: string; cadence: string | null; last_run_at: string | null; created_at: string; active: boolean | null }>
  emailQueue: Array<{ id: string; status: string | null; created_at: string; last_error: string | null }>
  leadEmailErrors: Array<{ email_error: string | null; source: string | null; created_at: string }>
  gscProperties: Array<{ project_id: string; sync_revoked_at: string | null }>
  gscTokenProjectIds: string[]
}

export type OpsIssue = { code: string; severity: 'high' | 'medium'; count: number; detail: string; sample: string[] }

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)

function scheduleGraceDays(cadence: string | null): number {
  if (cadence === 'monthly') return 35
  if (cadence === 'biweekly') return 16
  return 9
}

export function evaluateOpsHealth(s: OpsSnapshot): OpsIssue[] {
  const issues: OpsIssue[] = []
  const subByUser = new Map(s.subscriptions.map((r) => [r.user_id, r]))
  const isPaying = (userId: string) => {
    const sub = subByUser.get(userId)
    if (!sub) return false
    if (sub.is_internal === true) return true
    return PAID_PLANS.has(String(sub.plan ?? '').toLowerCase()) && PAYING_STATUSES.has(String(sub.status ?? '').toLowerCase())
  }
  const withQueries = new Set(s.activeQueryProjectIds)
  const nameOf = (id: string) => s.projects.find((p) => p.id === id)?.name ?? id

  // 1. Paying projects the weekly scan has not reached in 8+ days.
  const stale = s.projects.filter((p) =>
    p.visibility_schedule_enabled !== false &&
    withQueries.has(p.id) &&
    isPaying(p.user_id) &&
    s.now - ms(p.created_at) > DAY &&
    (!p.visibility_scheduled_last_at || s.now - ms(p.visibility_scheduled_last_at) > 8 * DAY)
  )
  if (stale.length) {
    issues.push({
      code: 'visibility_scan_stale',
      severity: 'high',
      count: stale.length,
      detail: 'Paying projects with active prompts not scanned in 8+ days — the visibility-autoscan cron is not reaching them.',
      sample: stale.slice(0, 8).map((p) => p.name ?? p.id),
    })
  }

  // 2. Prompts generated (onboarding) but no first scan within the hour.
  const checksByProject = new Map<string, number[]>()
  for (const e of s.spendEvents) {
    if (e.action !== 'visibility_check' || !e.project_id) continue
    const arr = checksByProject.get(e.project_id) ?? []
    arr.push(ms(e.created_at))
    checksByProject.set(e.project_id, arr)
  }
  const missingInitial = new Set<string>()
  for (const e of s.spendEvents) {
    if (e.action !== 'generate_queries' || !e.project_id) continue
    const at = ms(e.created_at)
    if (s.now - at < HOUR || s.now - at > 7 * DAY) continue
    const checks = checksByProject.get(e.project_id) ?? []
    if (!checks.some((c) => c >= at)) missingInitial.add(e.project_id)
  }
  if (missingInitial.size) {
    issues.push({
      code: 'initial_scan_missing',
      severity: 'high',
      count: missingInitial.size,
      detail: 'Prompts were generated but the first visibility scan never ran — new users see an empty dashboard.',
      sample: [...missingInitial].slice(0, 8).map(nameOf),
    })
  }

  // 3. Active report schedules that should have run by now.
  const overdue = s.schedules.filter((r) => {
    if (r.active === false) return false
    const grace = scheduleGraceDays(r.cadence) * DAY
    const ref = r.last_run_at ?? r.created_at
    return s.now - ms(ref) > grace
  })
  if (overdue.length) {
    issues.push({
      code: 'report_schedule_overdue',
      severity: 'high',
      count: overdue.length,
      detail: 'Scheduled client reports past their cadence without a run — report-schedules-daily is not delivering.',
      sample: overdue.slice(0, 8).map((r) => nameOf(r.project_id)),
    })
  }

  // 4. Report emails stuck or failed for more than a day.
  const stuck = s.emailQueue.filter((q) => q.status !== 'sent' && s.now - ms(q.created_at) > DAY)
  if (stuck.length) {
    issues.push({
      code: 'report_email_stuck',
      severity: 'high',
      count: stuck.length,
      detail: 'Scheduled report emails not delivered after 24h.',
      sample: [...new Set(stuck.map((q) => q.last_error ?? q.status ?? 'unknown'))].slice(0, 5),
    })
  }

  // 5. Result emails rejected by the provider (not the by-design programmatic cap).
  // rate_capped / not_requested are decisions (ai-visibility-check EMAIL_SKIP_CODES), not failures.
  const skipCodes = new Set(['rate_capped', 'not_requested'])
  const leadErrs = s.leadEmailErrors.filter((l) => l.email_error && !skipCodes.has(l.email_error) && s.now - ms(l.created_at) <= DAY)
  if (leadErrs.length) {
    const widget = leadErrs.filter((l) => l.source === 'widget').length
    issues.push({
      code: 'lead_email_failed',
      severity: widget > 0 ? 'high' : 'medium',
      count: leadErrs.length,
      detail: `AI visibility check result emails failed in the last 24h (${widget} from real site visitors). resend_403 usually means RESEND_FROM uses a domain not verified in Resend.`,
      sample: [...new Set(leadErrs.map((l) => l.email_error as string))].slice(0, 5),
    })
  }

  // 6. Search Console marked connected but no refresh token stored.
  const tokens = new Set(s.gscTokenProjectIds)
  const noToken = s.gscProperties.filter((g) => !g.sync_revoked_at && !tokens.has(g.project_id))
  if (noToken.length) {
    issues.push({
      code: 'gsc_connected_without_token',
      severity: 'medium',
      count: noToken.length,
      detail: 'Search Console shows as connected but no token is stored — data will never refresh. Owner must Disconnect + Connect.',
      sample: noToken.slice(0, 8).map((g) => nameOf(g.project_id)),
    })
  }

  // 7. Google rejected a stored grant (the refresh marked it revoked): the customer's reports lose
  // Search Console until they reconnect. Several at once usually means an OAuth app problem
  // (e.g. a consent screen left in "Testing", where Google expires refresh tokens after 7 days).
  const revoked = s.gscProperties.filter((g) => g.sync_revoked_at)
  if (revoked.length) {
    issues.push({
      code: 'gsc_grant_revoked',
      severity: 'medium',
      count: revoked.length,
      detail:
        'Google rejected the Search Console grant — no fresh data until the owner reconnects. If this repeats about a week after connecting, check that the Google OAuth consent screen is "In production", not "Testing".',
      sample: revoked.slice(0, 8).map((g) => nameOf(g.project_id)),
    })
  }

  return issues
}

async function selectAll<T>(q: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await q().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

export async function collectOpsSnapshot(admin: Db, now = Date.now()): Promise<OpsSnapshot> {
  const since8d = new Date(now - 8 * DAY).toISOString()
  const since2d = new Date(now - 2 * DAY).toISOString()
  const [projects, subscriptions, queries, spendEvents, schedules, emailQueue, leadEmailErrors, gscProperties, gscTokens] =
    await Promise.all([
      selectAll<OpsSnapshot['projects'][number]>(() =>
        admin.from('projects').select('id, name, user_id, created_at, visibility_schedule_enabled, visibility_scheduled_last_at').order('id')),
      selectAll<OpsSnapshot['subscriptions'][number]>(() =>
        admin.from('subscriptions').select('user_id, plan, status, is_internal').order('user_id')),
      selectAll<{ project_id: string }>(() =>
        admin.from('visibility_queries').select('project_id').eq('is_active', true).order('id')),
      selectAll<OpsSnapshot['spendEvents'][number]>(() =>
        admin.from('visibility_api_spend_events').select('project_id, action, created_at')
          .in('action', ['generate_queries', 'visibility_check']).gte('created_at', since8d).order('created_at')),
      selectAll<OpsSnapshot['schedules'][number]>(() =>
        admin.from('report_schedules').select('id, project_id, cadence, last_run_at, created_at, active').order('id')),
      selectAll<OpsSnapshot['emailQueue'][number]>(() =>
        admin.from('report_email_queue').select('id, status, created_at, last_error').neq('status', 'sent').order('created_at')),
      selectAll<OpsSnapshot['leadEmailErrors'][number]>(() =>
        admin.from('public_check_leads').select('email_error, source, created_at')
          .not('email_error', 'is', null).gte('created_at', since2d).order('created_at')),
      selectAll<OpsSnapshot['gscProperties'][number]>(() =>
        admin.from('gsc_properties').select('project_id, sync_revoked_at').order('project_id')),
      selectAll<{ project_id: string }>(() => admin.from('gsc_oauth_tokens').select('project_id').order('project_id')),
    ])
  return {
    now,
    projects,
    subscriptions,
    activeQueryProjectIds: [...new Set(queries.map((q) => q.project_id))],
    spendEvents,
    schedules,
    emailQueue,
    leadEmailErrors,
    gscProperties,
    gscTokenProjectIds: gscTokens.map((t) => t.project_id),
  }
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export function buildOpsAlertEmail(issues: OpsIssue[]): { subject: string; html: string } {
  const high = issues.filter((i) => i.severity === 'high').length
  const subject = `Rankdelta ops: ${issues.length} issue${issues.length === 1 ? '' : 's'}${high ? ` (${high} high)` : ''}`
  const items = issues
    .map((i) =>
      `<li style="margin:0 0 14px;"><b>${esc(i.code)}</b> — ${i.count} · ${i.severity}<br>` +
      `<span style="color:#3f3f46;">${esc(i.detail)}</span>` +
      (i.sample.length ? `<br><span style="color:#71717a;font-size:13px;">${esc(i.sample.join(', '))}</span>` : '') +
      `</li>`)
    .join('')
  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<p>The daily watchdog found problems that no job reported as failed:</p><ul style="padding-left:18px;">${items}</ul>` +
    `<p style="color:#71717a;font-size:12px;">Sent by report-schedule-runner · opsWatchdog.ts</p></body></html>`
  return { subject, html }
}

async function internalRecipients(admin: Db): Promise<string[]> {
  const out = new Set<string>()
  const extra = (Deno.env.get('OPS_ALERT_EMAIL') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const e of extra) out.add(e)
  const { data } = await admin.from('subscriptions').select('user_id').eq('is_internal', true)
  for (const row of (data ?? []) as Array<{ user_id: string }>) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(row.user_id)
      if (u?.user?.email) out.add(u.user.email)
    } catch {
      /* skip */
    }
  }
  return [...out]
}

export async function runOpsWatchdog(admin: Db): Promise<{ issues: OpsIssue[]; alert: string }> {
  let issues: OpsIssue[]
  try {
    issues = evaluateOpsHealth(await collectOpsSnapshot(admin))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[ops-watchdog] snapshot failed', message)
    issues = [{ code: 'watchdog_failed', severity: 'high', count: 1, detail: `The watchdog itself could not read the data: ${message.slice(0, 160)}`, sample: [] }]
  }
  console.log('[ops-watchdog]', JSON.stringify(issues.map((i) => ({ code: i.code, count: i.count }))))
  if (!issues.length) return { issues, alert: 'none_needed' }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  const to = await internalRecipients(admin)
  if (!apiKey || !from || !to.length) {
    console.error('[ops-watchdog] cannot alert: email not configured or no internal recipient')
    return { issues, alert: 'not_configured' }
  }
  const { subject, html } = buildOpsAlertEmail(issues)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200)
      console.error('[ops-watchdog] alert email rejected', res.status, body)
      return { issues, alert: `resend_${res.status}` }
    }
    return { issues, alert: 'sent' }
  } catch (e) {
    console.error('[ops-watchdog] alert email failed', e instanceof Error ? e.message : String(e))
    return { issues, alert: 'send_failed' }
  }
}
