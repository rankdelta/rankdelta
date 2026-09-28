/**
 * cronSecretMatches (deno) — pg_cron → Edge auth accepts the env var OR the Vault value.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/cronSecret.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { cronSecretMatches } from '../cronSecret.ts'

const ENV = 'TEST_CRON_SECRET_ENV'
const VAULT_VALUE = 'vault-secret-0123456789abcdef'

function fakeAdmin(vault: Record<string, string | null>, calls: string[] = []) {
  return {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push(fn)
      const name = String(args?.p_name ?? '')
      return Promise.resolve({ data: fn === 'get_cron_secret' ? vault[name] ?? null : null, error: null })
    },
  }
}

Deno.test('accepts the Vault value when the env var is unset (the prod case)', async () => {
  Deno.env.delete(ENV)
  const ok = await cronSecretMatches(fakeAdmin({ v1: VAULT_VALUE }), VAULT_VALUE, ENV, 'v1')
  assertEquals(ok, true)
})

Deno.test('rejects a wrong, empty or missing header', async () => {
  Deno.env.delete(ENV)
  const admin = fakeAdmin({ v2: VAULT_VALUE })
  assertEquals(await cronSecretMatches(admin, 'nope-nope-nope-nope', ENV, 'v2'), false)
  assertEquals(await cronSecretMatches(admin, '', ENV, 'v2'), false)
  assertEquals(await cronSecretMatches(admin, null, ENV, 'v2'), false)
})

Deno.test('rejects everything when neither env nor Vault holds a secret', async () => {
  Deno.env.delete(ENV)
  assertEquals(await cronSecretMatches(fakeAdmin({}), VAULT_VALUE, ENV, 'v3'), false)
})

Deno.test('ignores a Vault value shorter than 16 chars', async () => {
  Deno.env.delete(ENV)
  assertEquals(await cronSecretMatches(fakeAdmin({ v4: 'short' }), 'short', ENV, 'v4'), false)
})

Deno.test('env var match short-circuits without touching Vault', async () => {
  Deno.env.set(ENV, 'env-secret-0123456789')
  const calls: string[] = []
  const ok = await cronSecretMatches(fakeAdmin({ v5: VAULT_VALUE }, calls), 'env-secret-0123456789', ENV, 'v5')
  assertEquals(ok, true)
  assertEquals(calls.length, 0)
  Deno.env.delete(ENV)
})

Deno.test('env var set to a different value still accepts the Vault value', async () => {
  Deno.env.set(ENV, 'env-secret-0123456789')
  const ok = await cronSecretMatches(fakeAdmin({ v6: VAULT_VALUE }), VAULT_VALUE, ENV, 'v6')
  assertEquals(ok, true)
  Deno.env.delete(ENV)
})

Deno.test('an RPC failure is a rejection, not a throw', async () => {
  Deno.env.delete(ENV)
  const admin = { rpc: () => Promise.reject(new Error('boom')) }
  assertEquals(await cronSecretMatches(admin, VAULT_VALUE, ENV, 'v7'), false)
})
