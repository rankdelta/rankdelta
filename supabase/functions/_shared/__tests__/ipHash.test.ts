/**
 * hashClientIp (deno) — pepper from IP_HASH_PEPPER, else derived from the server-only secret key.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/ipHash.test.ts
 */

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hashClientIp, ipHashPepper } from '../ipHash.ts'
import { resetKeyCacheForTests } from '../supabaseKeys.ts'

const VARS = ['IP_HASH_PEPPER', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'] as const

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function withEnv(env: Partial<Record<(typeof VARS)[number], string>>, fn: () => Promise<void>) {
  const saved = new Map(VARS.map((k) => [k, Deno.env.get(k)]))
  try {
    for (const k of VARS) {
      const v = env[k]
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
    resetKeyCacheForTests()
    await fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
    resetKeyCacheForTests()
  }
}

Deno.test('uses IP_HASH_PEPPER when set (same hash format as before)', async () => {
  await withEnv({ IP_HASH_PEPPER: 'configured-pepper', SUPABASE_SERVICE_ROLE_KEY: 'srk-a' }, async () => {
    assertEquals(await ipHashPepper(), 'configured-pepper')
    assertEquals(await hashClientIp('203.0.113.7'), await sha256Hex('configured-pepper:203.0.113.7'))
  })
})

Deno.test('without IP_HASH_PEPPER the pepper is derived from the secret key, never a constant', async () => {
  let a = '', b = '', a2 = ''
  await withEnv({ SUPABASE_SERVICE_ROLE_KEY: 'srk-a' }, async () => {
    a = await ipHashPepper()
    a2 = await ipHashPepper()
    assertNotEquals(a, 'srk-a')
    assertNotEquals(a, '')
    assertEquals(await hashClientIp('203.0.113.7'), await sha256Hex(`${a}:203.0.113.7`))
  })
  await withEnv({ SUPABASE_SERVICE_ROLE_KEY: 'srk-b' }, async () => {
    b = await ipHashPepper()
  })
  assertEquals(a, a2)
  assertNotEquals(a, b)
})

Deno.test('an empty IP_HASH_PEPPER falls back to the derived pepper', async () => {
  await withEnv({ IP_HASH_PEPPER: '  ', SUPABASE_SERVICE_ROLE_KEY: 'srk-a' }, async () => {
    const derived = await ipHashPepper()
    assertNotEquals(derived.trim(), '')
    assertEquals(derived.length, 64)
  })
})

Deno.test('never throws when no key is configured at all', async () => {
  await withEnv({}, async () => {
    const h = await hashClientIp('198.51.100.1')
    assertEquals(h.length, 64)
  })
})
