/**
 * storeGoogleRefreshToken must never report success when the row was not written.
 *
 * Run: deno test --allow-env --no-check supabase/functions/_shared/__tests__/googleOAuthTokens.test.ts
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { storeGoogleRefreshToken } from '../googleOAuthTokens.ts'

type UpsertResult = { error: { message: string } | null }

function fakeAdmin(upsertResult: UpsertResult, rpcSecretId: string | null) {
  const rows: Record<string, unknown>[] = []
  return {
    rows,
    client: {
      rpc: () => Promise.resolve({ data: rpcSecretId, error: rpcSecretId ? null : { message: 'no vault' } }),
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          rows.push(row)
          return Promise.resolve(upsertResult)
        },
      }),
    },
  }
}

Deno.test('a failed upsert throws instead of silently reporting a stored token', async () => {
  // Production, 2026-09-22: gsc_oauth_tokens.refresh_token was NOT NULL while the Vault path
  // writes null there. The error was discarded, so the caller wrote gsc_properties and the
  // analytics cache and told the user they were connected — with no token stored at all.
  const admin = fakeAdmin({ error: { message: 'null value in column "refresh_token" violates not-null constraint' } }, 'secret-1')
  await assertRejects(
    () => storeGoogleRefreshToken(admin.client as never, 'gsc_oauth_tokens', 'p1', 'refresh-abc'),
    Error,
    'oauth_token_store_failed',
  )
})

Deno.test('the vault path stores the secret id and nulls the plaintext column', async () => {
  const admin = fakeAdmin({ error: null }, 'secret-1')
  await storeGoogleRefreshToken(admin.client as never, 'gsc_oauth_tokens', 'p1', 'refresh-abc')
  assertEquals(admin.rows.length, 1)
  assertEquals(admin.rows[0]?.refresh_token_secret_id, 'secret-1')
  assertEquals(admin.rows[0]?.refresh_token, null)
})

Deno.test('without vault it falls back to the plaintext column, still exactly one storage location', async () => {
  const admin = fakeAdmin({ error: null }, null)
  await storeGoogleRefreshToken(admin.client as never, 'gsc_oauth_tokens', 'p1', 'refresh-abc')
  assertEquals(admin.rows[0]?.refresh_token, 'refresh-abc')
  assertEquals(admin.rows[0]?.refresh_token_secret_id, null)
})
