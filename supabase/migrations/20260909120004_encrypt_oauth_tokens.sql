-- 053_encrypt_oauth_tokens.sql
-- Encrypt Google OAuth refresh tokens (GSC + GA4) at rest via Supabase Vault (pgsodium).
--
-- Non-breaking, phased rollout:
--   * add a nullable refresh_token_secret_id reference to both token tables;
--   * relax ga4_oauth_tokens.refresh_token NOT NULL so a row can carry only the Vault ref;
--   * expose service-role-only vault_* helpers so the edge functions can create/read/delete
--     secrets without direct access to the vault schema.
-- The edge functions (gsc-connect / ga4-connect) read Vault-first and fall back to the
-- plaintext column, migrating legacy rows into Vault on first read. The plaintext column is
-- retained (nullable) for fallback/rollback and can be dropped by a later migration once all
-- rows are confirmed migrated.

ALTER TABLE gsc_oauth_tokens ADD COLUMN IF NOT EXISTS refresh_token_secret_id UUID;
ALTER TABLE ga4_oauth_tokens ADD COLUMN IF NOT EXISTS refresh_token_secret_id UUID;

-- ga4_oauth_tokens.refresh_token was NOT NULL; a Vault-backed row stores NULL there.
ALTER TABLE ga4_oauth_tokens ALTER COLUMN refresh_token DROP NOT NULL;

-- Vault helpers. SECURITY DEFINER (owned by the migration role, which can access vault.*);
-- granted to service_role only. service_role already has full table access, so this exposes
-- no new data — it only encapsulates the vault schema, which is otherwise not reachable by it.
CREATE OR REPLACE FUNCTION vault_upsert_oauth_secret(p_name TEXT, p_secret TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Replace any existing secret with this name (delete-then-create avoids depending on a
  -- specific vault.update_secret signature).
  DELETE FROM vault.secrets WHERE name = p_name;
  v_id := vault.create_secret(p_secret, p_name, 'google oauth refresh token');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault_read_oauth_secret(p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = p_id;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION vault_delete_oauth_secret(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION vault_upsert_oauth_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_read_oauth_secret(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault_delete_oauth_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vault_upsert_oauth_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION vault_read_oauth_secret(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION vault_delete_oauth_secret(UUID) TO service_role;
