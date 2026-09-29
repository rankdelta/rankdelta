/**
 * MCP OAuth /token: the client gets a key minted for its connection, never the user's pasted key.
 *
 * Run: deno test --allow-env --no-check supabase/functions/mcp/__tests__/oauth_connection_key.test.ts
 */
import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hashApiKey } from '../../_shared/apiKeys.ts'
import { connectionKeyName, mintConnectionKey } from '../oauth.ts'

type Row = { id: string; user_id: string; name: string; key_prefix: string; key_hash: string; revoked_at: string | null }

/** Just enough of the supabase-js query builder for api_keys lookups, counts and inserts. */
function fakeDb(rows: Row[], opts: { failInsert?: boolean } = {}) {
  return {
    rows,
    from(_table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let head = false
      const q = {
        select(_cols: string, o?: { head?: boolean }) {
          head = !!o?.head
          return q
        },
        eq(col: keyof Row, val: unknown) {
          filters.push((r) => r[col] === val)
          return q
        },
        is(col: keyof Row, val: null) {
          filters.push((r) => r[col] === val)
          return q
        },
        maybeSingle() {
          return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null })
        },
        then(resolve: (v: unknown) => unknown) {
          const hit = rows.filter((r) => filters.every((f) => f(r)))
          return Promise.resolve(head ? { count: hit.length, error: null } : { data: hit, error: null }).then(resolve)
        },
        insert(row: Omit<Row, 'id' | 'revoked_at'>) {
          if (opts.failInsert) return Promise.resolve({ error: { message: 'insert failed' } })
          rows.push({ id: crypto.randomUUID(), revoked_at: null, ...row })
          return Promise.resolve({ error: null })
        },
      }
      return q
    },
  }
}

const USER = '11111111-1111-1111-1111-111111111111'
const PASTED = 'sk_rankdelta_pastedpastedpastedpasted'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

async function withPastedKey(extra: Partial<Row> = {}): Promise<Row[]> {
  return [{ id: 'k0', user_id: USER, name: 'Default', key_prefix: 'sk_rankdelta_pasted', key_hash: await hashApiKey(PASTED), revoked_at: null, ...extra }]
}

Deno.test('mints a separate, named key and never returns the pasted one', async () => {
  const db = fakeDb(await withPastedKey())
  // deno-lint-ignore no-explicit-any
  const token = await mintConnectionKey(db as any, PASTED, USER, REDIRECT)
  assert(token && token.startsWith('sk_rankdelta_'))
  assertNotEquals(token, PASTED)
  assertEquals(db.rows.length, 2)
  const minted = db.rows[1]
  assertEquals(minted.name, 'MCP · claude.ai')
  assertEquals(minted.user_id, USER)
  assertEquals(minted.key_hash, await hashApiKey(token!))
})

Deno.test('a pasted key revoked (or of another user) since /authorize gets nothing', async () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(await mintConnectionKey(fakeDb(await withPastedKey({ revoked_at: '2026-09-29T00:00:00Z' })) as any, PASTED, USER, REDIRECT), null)
  // deno-lint-ignore no-explicit-any
  assertEquals(await mintConnectionKey(fakeDb(await withPastedKey({ user_id: 'someone-else' })) as any, PASTED, USER, REDIRECT), null)
})

Deno.test('at the 10-key cap or on an insert error the connection still works with the pasted key', async () => {
  const full = await withPastedKey()
  for (let i = 1; i < 10; i++) full.push({ ...full[0], id: `k${i}`, key_hash: `h${i}` })
  // deno-lint-ignore no-explicit-any
  assertEquals(await mintConnectionKey(fakeDb(full) as any, PASTED, USER, REDIRECT), PASTED)
  // deno-lint-ignore no-explicit-any
  assertEquals(await mintConnectionKey(fakeDb(await withPastedKey(), { failInsert: true }) as any, PASTED, USER, REDIRECT), PASTED)
})

Deno.test('the key is named after the client host', () => {
  assertEquals(connectionKeyName('http://localhost:33418/callback'), 'MCP · localhost')
  assertEquals(connectionKeyName('https://chatgpt.com/connector_platform_oauth_redirect'), 'MCP · chatgpt.com')
  assertEquals(connectionKeyName('not a url'), 'MCP · client')
})
