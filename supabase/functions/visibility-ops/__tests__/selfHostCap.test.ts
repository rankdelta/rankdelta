/**
 * Self-host per-account spend cap (SELF_HOST_ACCOUNT_MONTHLY_CAP_CENTS): optional, unset = unlimited.
 *
 * Run: deno test --allow-env --allow-net supabase/functions/visibility-ops/__tests__/selfHostCap.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { SELF_HOST_UNLIMITED_CAP_CENTS, selfHostAccountCapCents } from '../../_shared/accountBudget.ts'

Deno.test('unset or invalid: unlimited, exactly as before', () => {
  assertEquals(selfHostAccountCapCents(undefined), SELF_HOST_UNLIMITED_CAP_CENTS)
  assertEquals(selfHostAccountCapCents(''), SELF_HOST_UNLIMITED_CAP_CENTS)
  assertEquals(selfHostAccountCapCents('0'), SELF_HOST_UNLIMITED_CAP_CENTS)
  assertEquals(selfHostAccountCapCents('-5'), SELF_HOST_UNLIMITED_CAP_CENTS)
  assertEquals(selfHostAccountCapCents('lots'), SELF_HOST_UNLIMITED_CAP_CENTS)
})

Deno.test('a positive value caps each account (whole cents, never above int4)', () => {
  assertEquals(selfHostAccountCapCents('5000'), 5000)
  assertEquals(selfHostAccountCapCents('1999.9'), 1999)
  assertEquals(selfHostAccountCapCents('99999999999'), SELF_HOST_UNLIMITED_CAP_CENTS)
})
