/**
 * "Send me a test" for scheduled reports — pure decision logic of the runner's dry run (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportScheduleTestSend.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  parseScheduleTestSendRequest,
  scheduledEmailBranding,
  scheduledReportLocale,
  scheduledReportShareUrl,
  scheduleTestSendResult,
  testSendRecipient,
} from '../reportScheduleTestSend.ts'

Deno.test('parseScheduleTestSendRequest only accepts { schedule_id, dry_run: true }', () => {
  assertEquals(parseScheduleTestSendRequest({ schedule_id: ' abc ', dry_run: true }), { scheduleId: 'abc' })
  // The cron body and anything that is not an explicit dry run stay on the cron path.
  assertEquals(parseScheduleTestSendRequest({}), null)
  assertEquals(parseScheduleTestSendRequest({ action: 'process_pending_emails' }), null)
  assertEquals(parseScheduleTestSendRequest({ schedule_id: 'abc' }), null)
  assertEquals(parseScheduleTestSendRequest({ schedule_id: 'abc', dry_run: 'true' }), null)
  assertEquals(parseScheduleTestSendRequest({ schedule_id: '', dry_run: true }), null)
  assertEquals(parseScheduleTestSendRequest({ schedule_id: 42, dry_run: true }), null)
  assertEquals(parseScheduleTestSendRequest(null), null)
  assertEquals(parseScheduleTestSendRequest('dry_run'), null)
})

Deno.test('scheduledReportShareUrl prefers the public share page, falls back to the portal', () => {
  assertEquals(scheduledReportShareUrl('https://rankdelta.ai', 'r1', 'tok123'), 'https://rankdelta.ai/r/tok123')
  assertEquals(scheduledReportShareUrl('https://rankdelta.ai/', 'r1', null), 'https://rankdelta.ai/reports/portal/r1')
  assertEquals(scheduledReportShareUrl('https://rankdelta.ai', 'r1', undefined), 'https://rankdelta.ai/reports/portal/r1')
})

Deno.test('scheduledEmailBranding mirrors the cron: schedule branding, then project white-label, nothing below Agency', () => {
  const scheduleBranding = { agencyName: 'Studio Nord', primaryColor: '#0f766e' }
  const metadata = { white_label_report: { agencyName: 'Studio Sud' } }
  assertEquals(scheduledEmailBranding(true, scheduleBranding, metadata), scheduleBranding)
  assertEquals(scheduledEmailBranding(true, null, metadata), { agencyName: 'Studio Sud' })
  assertEquals(scheduledEmailBranding(true, null, { other: 1 }), null)
  assertEquals(scheduledEmailBranding(true, null, null), null)
  assertEquals(scheduledEmailBranding(false, scheduleBranding, metadata), null)
})

Deno.test('scheduledReportLocale: content language first, market language as fallback, en otherwise', () => {
  assertEquals(scheduledReportLocale({ language: 'it', primary_language: 'en' }), 'it')
  assertEquals(scheduledReportLocale({ language: null, primary_language: 'it' }), 'it')
  assertEquals(scheduledReportLocale({ language: 'en', primary_language: 'it' }), 'en')
  assertEquals(scheduledReportLocale({}), 'en')
  assertEquals(scheduledReportLocale(null), 'en')
})

Deno.test('testSendRecipient is the caller account email only, normalized', () => {
  assertEquals(testSendRecipient(' Owner@Agency.COM '), 'owner@agency.com')
  assertEquals(testSendRecipient(''), null)
  assertEquals(testSendRecipient('not-an-email'), null)
  assertEquals(testSendRecipient(undefined), null)
  assertEquals(testSendRecipient(['client@company.com']), null)
})

Deno.test('scheduleTestSendResult carries subject, sent_to and the report used, flagged as a dry run', () => {
  assertEquals(scheduleTestSendResult('Acme · SEO & AI visibility report · Aug 1 – Aug 28, 2026', 'owner@agency.com', 'r1'), {
    ok: true,
    dry_run: true,
    subject: 'Acme · SEO & AI visibility report · Aug 1 – Aug 28, 2026',
    sent_to: 'owner@agency.com',
    report_id: 'r1',
  })
})
