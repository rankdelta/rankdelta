/**
 * Share-link contract tests (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportShare.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  isValidShareToken,
  SHARED_REPORT_FORBIDDEN_FIELDS,
  SHARED_REPORT_PUBLIC_FIELDS,
} from '../reportShare.ts'

Deno.test('isValidShareToken matches get_shared_report SQL guard', () => {
  assertEquals(isValidShareToken(null), false)
  assertEquals(isValidShareToken(''), false)
  assertEquals(isValidShareToken('short'), false)
  assertEquals(isValidShareToken('  fifteen-chars!! '), false)
  assertEquals(isValidShareToken(' sixteen-chars-ok'), true)
  assertEquals(isValidShareToken('a'.repeat(48)), true)
})

Deno.test('shared report public field contract excludes sensitive columns', () => {
  for (const forbidden of SHARED_REPORT_FORBIDDEN_FIELDS) {
    assertEquals(
      (SHARED_REPORT_PUBLIC_FIELDS as readonly string[]).includes(forbidden),
      false,
      `public fields must not include ${forbidden}`,
    )
  }
})
