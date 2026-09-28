/**
 * evaluateOpsHealth (deno) — each check fires on the failure it exists for, and stays quiet otherwise.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/opsWatchdog.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildOpsAlertEmail, evaluateOpsHealth, type OpsSnapshot } from '../opsWatchdog.ts'

const NOW = Date.parse('2026-09-23T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()
const agoH = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

function base(): OpsSnapshot {
  return {
    now: NOW,
    projects: [],
    subscriptions: [
      { user_id: 'paid', plan: 'growth', status: 'active', is_internal: false },
      { user_id: 'free', plan: 'starter', status: 'incomplete', is_internal: false },
      { user_id: 'internal', plan: 'agency', status: 'active', is_internal: true },
    ],
    activeQueryProjectIds: [],
    spendEvents: [],
    schedules: [],
    emailQueue: [],
    leadEmailErrors: [],
    gscProperties: [],
    gscTokenProjectIds: [],
  }
}

const codes = (s: OpsSnapshot) => evaluateOpsHealth(s).map((i) => i.code)

Deno.test('healthy snapshot → no issues', () => {
  const s = base()
  s.projects = [{ id: 'p1', name: 'Fresh', user_id: 'paid', created_at: ago(30), visibility_schedule_enabled: true, visibility_scheduled_last_at: ago(2) }]
  s.activeQueryProjectIds = ['p1']
  assertEquals(codes(s), [])
})

Deno.test('paying project never scanned (the ACME case) → visibility_scan_stale', () => {
  const s = base()
  s.projects = [{ id: 'p1', name: 'ACME', user_id: 'paid', created_at: ago(22), visibility_schedule_enabled: true, visibility_scheduled_last_at: null }]
  s.activeQueryProjectIds = ['p1']
  const issues = evaluateOpsHealth(s)
  assertEquals(issues.map((i) => i.code), ['visibility_scan_stale'])
  assertEquals(issues[0].sample, ['ACME'])
})

Deno.test('stale check ignores unpaid owners, opted-out, prompt-less and brand-new projects', () => {
  const s = base()
  s.projects = [
    { id: 'a', name: 'unpaid', user_id: 'free', created_at: ago(30), visibility_schedule_enabled: true, visibility_scheduled_last_at: null },
    { id: 'b', name: 'optout', user_id: 'paid', created_at: ago(30), visibility_schedule_enabled: false, visibility_scheduled_last_at: null },
    { id: 'c', name: 'noprompts', user_id: 'paid', created_at: ago(30), visibility_schedule_enabled: true, visibility_scheduled_last_at: null },
    { id: 'd', name: 'new', user_id: 'paid', created_at: agoH(3), visibility_schedule_enabled: true, visibility_scheduled_last_at: null },
  ]
  s.activeQueryProjectIds = ['a', 'b', 'd']
  assertEquals(codes(s), [])
})

Deno.test('internal account counts as paying', () => {
  const s = base()
  s.projects = [{ id: 'p', name: 'Own', user_id: 'internal', created_at: ago(30), visibility_schedule_enabled: true, visibility_scheduled_last_at: ago(9) }]
  s.activeQueryProjectIds = ['p']
  assertEquals(codes(s), ['visibility_scan_stale'])
})

Deno.test('prompts generated without a first scan → initial_scan_missing; a scan after clears it', () => {
  const s = base()
  s.projects = [{ id: 'g', name: 'Brightly', user_id: 'free', created_at: ago(2), visibility_schedule_enabled: true, visibility_scheduled_last_at: null }]
  s.spendEvents = [{ project_id: 'g', action: 'generate_queries', created_at: agoH(5) }]
  assertEquals(codes(s), ['initial_scan_missing'])
  s.spendEvents.push({ project_id: 'g', action: 'visibility_check', created_at: agoH(5) })
  assertEquals(codes(s), [])
})

Deno.test('initial scan within the first hour is not flagged yet', () => {
  const s = base()
  s.spendEvents = [{ project_id: 'g', action: 'generate_queries', created_at: new Date(NOW - 10 * 60_000).toISOString() }]
  assertEquals(codes(s), [])
})

Deno.test('weekly schedule never run after 9 days → report_schedule_overdue; monthly gets 35 days', () => {
  const s = base()
  s.schedules = [
    { id: 's1', project_id: 'x', cadence: 'weekly', last_run_at: null, created_at: ago(10), active: true },
    { id: 's2', project_id: 'y', cadence: 'monthly', last_run_at: ago(20), created_at: ago(60), active: true },
    { id: 's3', project_id: 'z', cadence: 'weekly', last_run_at: null, created_at: ago(30), active: false },
  ]
  const issues = evaluateOpsHealth(s)
  assertEquals(issues.map((i) => i.code), ['report_schedule_overdue'])
  assertEquals(issues[0].count, 1)
})

Deno.test('report email not sent after a day → report_email_stuck', () => {
  const s = base()
  s.emailQueue = [
    { id: 'q1', status: 'failed', created_at: ago(2), last_error: 'resend_403' },
    { id: 'q2', status: 'pending', created_at: agoH(2), last_error: null },
  ]
  const issues = evaluateOpsHealth(s)
  assertEquals(issues.map((i) => i.code), ['report_email_stuck'])
  assertEquals(issues[0].count, 1)
})

Deno.test('lead email provider failures flag; the programmatic rate_capped skip does not', () => {
  const s = base()
  s.leadEmailErrors = [
    { email_error: 'rate_capped', source: 'programmatic', created_at: agoH(1) },
    { email_error: 'not_requested', source: 'programmatic', created_at: agoH(1) },
    { email_error: 'resend_403', source: 'widget', created_at: agoH(3) },
    { email_error: 'resend_403', source: 'programmatic', created_at: ago(3) },
  ]
  const issues = evaluateOpsHealth(s)
  assertEquals(issues.map((i) => i.code), ['lead_email_failed'])
  assertEquals(issues[0].count, 1)
  assertEquals(issues[0].severity, 'high')
})

Deno.test('GSC row without a stored token → gsc_connected_without_token (revoked rows ignored)', () => {
  const s = base()
  s.projects = [{ id: 'ac', name: 'Brewcraft', user_id: 'paid', created_at: ago(90), visibility_schedule_enabled: false, visibility_scheduled_last_at: null }]
  s.gscProperties = [
    { project_id: 'ac', sync_revoked_at: null },
    { project_id: 'ok', sync_revoked_at: null },
    { project_id: 'rev', sync_revoked_at: ago(1) },
  ]
  s.gscTokenProjectIds = ['ok']
  const issues = evaluateOpsHealth(s)
  assertEquals(issues.map((i) => i.code), ['gsc_connected_without_token', 'gsc_grant_revoked'])
  assertEquals(issues[0].sample, ['Brewcraft'])
  assertEquals(issues[1].count, 1)
})

Deno.test('no GSC rows → no GSC issues', () => {
  const s = base()
  s.gscProperties = [{ project_id: 'ok', sync_revoked_at: null }]
  s.gscTokenProjectIds = ['ok']
  assertEquals(evaluateOpsHealth(s).filter((i) => i.code.startsWith('gsc_')), [])
})

Deno.test('alert email escapes names and counts high severity', () => {
  const { subject, html } = buildOpsAlertEmail([
    { code: 'x', severity: 'high', count: 2, detail: 'd', sample: ['<b>&co</b>'] },
    { code: 'y', severity: 'medium', count: 1, detail: 'e', sample: [] },
  ])
  assertEquals(subject, 'Rankdelta ops: 2 issues (1 high)')
  assertEquals(html.includes('&lt;b&gt;&amp;co&lt;/b&gt;'), true)
})
