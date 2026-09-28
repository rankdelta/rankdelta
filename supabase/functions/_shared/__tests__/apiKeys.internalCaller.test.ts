/**
 * resolveInternalReportCaller (deno).
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/apiKeys.internalCaller.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolveInternalReportCaller } from '../apiKeys.ts'

const SECRET = 'report-cron-secret-16'
const USER = '11111111-1111-4111-8111-111111111111'

function req(headers: Record<string, string>): Request {
  return new Request('https://example.test/seo-proxy', { method: 'POST', headers })
}

Deno.test('resolveInternalReportCaller accepts cron secret + bill-to UUID', () => {
  Deno.env.set('REPORT_SCHEDULE_CRON_SECRET', SECRET)
  const caller = resolveInternalReportCaller(
    req({
      'x-report-schedule-cron-secret': SECRET,
      'x-report-bill-to-user-id': USER,
    }),
  )
  assertEquals(caller?.userId, USER)
  assertEquals(caller?.via, 'internal')
})

Deno.test('resolveInternalReportCaller rejects wrong secret or invalid user id', () => {
  Deno.env.set('REPORT_SCHEDULE_CRON_SECRET', SECRET)
  assertEquals(
    resolveInternalReportCaller(
      req({
        'x-report-schedule-cron-secret': 'wrong-secret-16ch',
        'x-report-bill-to-user-id': USER,
      }),
    ),
    null,
  )
  assertEquals(
    resolveInternalReportCaller(
      req({
        'x-report-schedule-cron-secret': SECRET,
        'x-report-bill-to-user-id': 'not-a-uuid',
      }),
    ),
    null,
  )
})
