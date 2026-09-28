/**
 * publishableKey / secretKey / keySource (deno).
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/supabaseKeys.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  keySource,
  publishableKey,
  resetKeyCacheForTests,
  secretKey,
} from '../supabaseKeys.ts'

const VARS = [
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEYS',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

/** Clear every key var AND the module cache, so each case starts from a known state. */
function reset(): void {
  for (const name of VARS) Deno.env.delete(name)
  resetKeyCacheForTests()
}

Deno.test('new vars are preferred when present', () => {
  reset()
  Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'sb_publishable_new' }))
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_new' }))
  Deno.env.set('SUPABASE_ANON_KEY', 'legacy-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(publishableKey(), 'sb_publishable_new')
  assertEquals(secretKey(), 'sb_secret_new')
  assertEquals(keySource(), { publishable: 'new', secret: 'new' })
  reset()
})

Deno.test('legacy vars are used when the new ones are absent', () => {
  reset()
  Deno.env.set('SUPABASE_ANON_KEY', 'legacy-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(publishableKey(), 'legacy-anon')
  assertEquals(secretKey(), 'legacy-service')
  assertEquals(keySource(), { publishable: 'legacy', secret: 'legacy' })
  reset()
})

Deno.test('both absent resolves to empty string and missing', () => {
  reset()

  assertEquals(publishableKey(), '')
  assertEquals(secretKey(), '')
  assertEquals(keySource(), { publishable: 'missing', secret: 'missing' })
  reset()
})

Deno.test('malformed JSON dictionary falls back to the legacy var without throwing', () => {
  reset()
  Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', '{"default": ')
  Deno.env.set('SUPABASE_SECRET_KEYS', '[1, 2, 3]')
  Deno.env.set('SUPABASE_ANON_KEY', 'legacy-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  // A truncated JSON object does not parse, so it is taken as a bare key string (see below);
  // a JSON array is well-formed JSON but not a key dictionary, so it falls back.
  assertEquals(secretKey(), 'legacy-service')
  assertEquals(keySource().secret, 'legacy')
  reset()
})

Deno.test('JSON shapes that are not a key dictionary fall back to the legacy var', () => {
  for (const malformed of ['[1,2,3]', 'null', '42', '{}', '{"default": ""}', '{"default": 7}']) {
    reset()
    Deno.env.set('SUPABASE_SECRET_KEYS', malformed)
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

    assertEquals(secretKey(), 'legacy-service', `expected fallback for ${malformed}`)
    assertEquals(keySource().secret, 'legacy', `expected legacy source for ${malformed}`)
  }
  reset()
})

Deno.test('malformed new var with no legacy var resolves to empty string and missing', () => {
  reset()
  Deno.env.set('SUPABASE_SECRET_KEYS', '[1, 2, 3]')

  assertEquals(secretKey(), '')
  assertEquals(keySource().secret, 'missing')
  reset()
})

Deno.test('JSON dictionary picks the default entry', () => {
  reset()
  Deno.env.set(
    'SUPABASE_SECRET_KEYS',
    JSON.stringify({ billing: 'sb_secret_billing', default: 'sb_secret_default' }),
  )
  Deno.env.set(
    'SUPABASE_PUBLISHABLE_KEYS',
    JSON.stringify({ default: 'sb_publishable_default', preview: 'sb_publishable_preview' }),
  )
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(secretKey(), 'sb_secret_default')
  assertEquals(publishableKey(), 'sb_publishable_default')
  assertEquals(keySource(), { publishable: 'new', secret: 'new' })
  reset()
})

Deno.test('a single named entry is used even when it is not called default', () => {
  reset()
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ billing: 'sb_secret_billing' }))
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(secretKey(), 'sb_secret_billing')
  assertEquals(keySource().secret, 'new')
  reset()
})

Deno.test('several named entries with no default are ambiguous, so the legacy var wins', () => {
  reset()
  Deno.env.set(
    'SUPABASE_SECRET_KEYS',
    JSON.stringify({ billing: 'sb_secret_billing', reporting: 'sb_secret_reporting' }),
  )
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(secretKey(), 'legacy-service')
  assertEquals(keySource().secret, 'legacy')
  reset()
})

Deno.test('a bare (non-JSON) string in the new var is used as the key itself', () => {
  reset()
  Deno.env.set('SUPABASE_SECRET_KEYS', 'sb_secret_bare')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(secretKey(), 'sb_secret_bare')
  assertEquals(keySource().secret, 'new')
  reset()
})

Deno.test('an empty new var is treated as unset', () => {
  reset()
  Deno.env.set('SUPABASE_SECRET_KEYS', '   ')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')

  assertEquals(secretKey(), 'legacy-service')
  assertEquals(keySource().secret, 'legacy')
  reset()
})

Deno.test('the resolved value is cached for the life of the isolate', () => {
  reset()
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'legacy-service')
  assertEquals(secretKey(), 'legacy-service')

  // Changing the environment without resetting must NOT change the answer.
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_new' }))
  assertEquals(secretKey(), 'legacy-service')

  resetKeyCacheForTests()
  assertEquals(secretKey(), 'sb_secret_new')
  reset()
})
