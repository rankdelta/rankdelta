/**
 * Share-link contract tests (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportShare.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  canShareReports,
  generateShareToken,
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

/** Minimal stand-in for the service-role client: one subscription row, plan feature flags. */
function fakeAdmin(sub: { plan: string; status: string } | null, whiteLabelPlans: string[] = []) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => ((q[col] = val), chain),
        in: (col: string, vals: string[]) => ((q[col] = vals), chain),
        limit: () => chain,
        maybeSingle: () => {
          if (table === 'subscriptions') {
            const ok = sub && (q.status as string[]).includes(sub.status)
            return Promise.resolve({ data: ok ? sub : null })
          }
          return Promise.resolve({ data: { features: { white_label: whiteLabelPlans.includes(q.plan as string) } } })
        },
      }
      return chain
    },
  }
}

Deno.test('generateShareToken: 48 hex chars, never repeats', () => {
  const a = generateShareToken()
  assertEquals(/^[0-9a-f]{48}$/.test(a), true)
  assertEquals(isValidShareToken(a), true)
  assertEquals(a === generateShareToken(), false)
})

Deno.test('canShareReports: Agency or a white-label plan with a paying status; always on self-host', async () => {
  assertEquals(await canShareReports(fakeAdmin({ plan: 'agency', status: 'active' }), 'u', false), true)
  assertEquals(await canShareReports(fakeAdmin({ plan: 'agency', status: 'past_due' }), 'u', false), true)
  assertEquals(await canShareReports(fakeAdmin({ plan: 'agency', status: 'canceled' }), 'u', false), false)
  assertEquals(await canShareReports(fakeAdmin({ plan: 'pro', status: 'active' }), 'u', false), false)
  assertEquals(await canShareReports(fakeAdmin({ plan: 'studio', status: 'active' }, ['studio']), 'u', false), true)
  assertEquals(await canShareReports(fakeAdmin(null), 'u', false), false)
  assertEquals(await canShareReports(fakeAdmin(null), 'u', true), true)
})
