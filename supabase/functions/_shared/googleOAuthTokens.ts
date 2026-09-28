/**
 * Encryption-at-rest for Google OAuth refresh tokens (GSC + GA4) via Supabase Vault.
 *
 * The token tables (gsc_oauth_tokens / ga4_oauth_tokens) historically stored the refresh
 * token in a plaintext column. These helpers move it into Vault (pgsodium) behind a
 * `refresh_token_secret_id` reference, while remaining fully backward-compatible:
 *
 *  - write  → store the token in Vault (via the service-role-only vault_* RPCs from
 *             migration 053) and null the plaintext column. If Vault is unavailable the
 *             write falls back to the plaintext column so connecting never breaks.
 *  - read   → prefer the Vault secret; fall back to the plaintext column for legacy rows,
 *             and opportunistically re-store legacy plaintext into Vault (lazy migration).
 *  - delete → return the current token (for revoke at Google) and remove the Vault secret;
 *             the caller deletes the row.
 *
 * The plaintext column is kept (nullable) for rollback/fallback and can be dropped by a
 * follow-up migration once all rows are confirmed migrated.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type OAuthTokenTable = 'gsc_oauth_tokens' | 'ga4_oauth_tokens'

const SECRET_PREFIX: Record<OAuthTokenTable, string> = {
  gsc_oauth_tokens: 'gsc_refresh',
  ga4_oauth_tokens: 'ga4_refresh',
}

const secretName = (table: OAuthTokenTable, projectId: string) => `${SECRET_PREFIX[table]}:${projectId}`

/**
 * Upsert the refresh token for a project, preferring Vault storage.
 * `extra` carries the table's other columns (e.g. google_email, updated_by).
 */
export async function storeGoogleRefreshToken(
  admin: SupabaseClient,
  table: OAuthTokenTable,
  projectId: string,
  refreshToken: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  let secretId: string | null = null
  try {
    const { data, error } = await admin.rpc('vault_upsert_oauth_secret', {
      p_name: secretName(table, projectId),
      p_secret: refreshToken,
    })
    if (!error && data) secretId = data as string
  } catch (e) {
    console.error(`[oauth-vault] store secret failed for ${table}, storing plaintext`, e instanceof Error ? e.message : String(e))
  }

  const row: Record<string, unknown> = {
    project_id: projectId,
    ...extra,
    updated_at: new Date().toISOString(),
  }
  if (secretId) {
    row.refresh_token_secret_id = secretId
    row.refresh_token = null
  } else {
    row.refresh_token = refreshToken
    row.refresh_token_secret_id = null
  }
  // The caller treats a returned promise as "the token is stored". Swallowing this error is how
  // a connection silently fails: gsc-connect goes on to write gsc_properties and the analytics
  // cache, the UI reports success, and nothing was persisted — so the next sync answers
  // not_connected and the user is disconnected again. That is exactly what happened in
  // production on 2026-09-22, when gsc_oauth_tokens.refresh_token was still NOT NULL while the
  // Vault path writes null there. Fail loudly instead; the connect handler already maps a thrown
  // error to a real error response.
  const { error } = await admin.from(table).upsert(row)
  if (error) {
    throw new Error(`oauth_token_store_failed ${table}: ${error.message}`)
  }
}

/**
 * Read the refresh token for a project. Vault-first, plaintext fallback. Legacy plaintext
 * rows are lazily re-stored into Vault (best-effort).
 */
export async function readGoogleRefreshToken(
  admin: SupabaseClient,
  table: OAuthTokenTable,
  projectId: string,
): Promise<string | null> {
  const { data } = await admin
    .from(table)
    .select('refresh_token, refresh_token_secret_id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!data) return null

  if (data.refresh_token_secret_id) {
    try {
      const { data: sec, error } = await admin.rpc('vault_read_oauth_secret', { p_id: data.refresh_token_secret_id })
      if (!error && sec) return sec as string
    } catch (e) {
      console.error(`[oauth-vault] read secret failed for ${table}`, e instanceof Error ? e.message : String(e))
    }
  }

  const plaintext = (data.refresh_token as string | null) ?? null
  // Lazy migration: a legacy plaintext row gets moved into Vault on first read.
  if (plaintext && !data.refresh_token_secret_id) {
    try {
      const { data: newId, error } = await admin.rpc('vault_upsert_oauth_secret', {
        p_name: secretName(table, projectId),
        p_secret: plaintext,
      })
      if (!error && newId) {
        await admin.from(table).update({ refresh_token_secret_id: newId as string, refresh_token: null }).eq('project_id', projectId)
      }
    } catch (_e) {
      // best-effort; the plaintext value is still returned below
    }
  }
  return plaintext
}

/**
 * Read the token (for revoke) and remove its Vault secret. The caller deletes the row(s).
 */
export async function purgeGoogleRefreshToken(
  admin: SupabaseClient,
  table: OAuthTokenTable,
  projectId: string,
): Promise<string | null> {
  const { data } = await admin
    .from(table)
    .select('refresh_token, refresh_token_secret_id')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!data) return null

  let token = (data.refresh_token as string | null) ?? null
  if (data.refresh_token_secret_id) {
    try {
      const { data: sec } = await admin.rpc('vault_read_oauth_secret', { p_id: data.refresh_token_secret_id })
      if (sec) token = sec as string
    } catch (_e) { /* fall back to plaintext token */ }
    try {
      await admin.rpc('vault_delete_oauth_secret', { p_id: data.refresh_token_secret_id })
    } catch (e) {
      console.error(`[oauth-vault] delete secret failed for ${table}`, e instanceof Error ? e.message : String(e))
    }
  }
  return token
}
