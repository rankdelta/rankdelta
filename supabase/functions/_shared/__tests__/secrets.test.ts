/**
 * secretsMatch (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/secrets.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { secretsMatch } from '../secrets.ts'

Deno.test('secretsMatch accepts identical secrets', () => {
  assertEquals(secretsMatch('cron-secret-16ch', 'cron-secret-16ch'), true)
})

Deno.test('secretsMatch rejects missing, short, or different secrets', () => {
  assertEquals(secretsMatch(null, 'abc'), false)
  assertEquals(secretsMatch('abc', null), false)
  assertEquals(secretsMatch('ab', 'abc'), false)
  assertEquals(secretsMatch('abd', 'abc'), false)
})
