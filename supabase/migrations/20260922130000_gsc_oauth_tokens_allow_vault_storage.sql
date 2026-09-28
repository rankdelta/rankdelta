-- gsc_oauth_tokens.refresh_token was still NOT NULL while ga4_oauth_tokens had already been
-- relaxed. storeGoogleRefreshToken() writes `refresh_token: null` whenever the Vault path
-- succeeds (the token then lives in refresh_token_secret_id), so every GSC connect violated the
-- constraint. The upsert result was not inspected, so the failure was silent: gsc_properties and
-- gsc_analytics_cache were still written, the UI reported a successful connection, and nothing
-- was persisted — the connection died on the next sync. Observed in production on 2026-09-22
-- (a project connected at 15:25 UTC had a property row, a full analytics cache, and zero rows in
-- gsc_oauth_tokens).
--
-- Mirrors ga4_oauth_tokens. The CHECK keeps the real invariant: at least one storage location
-- must carry the token, so a nullable column can never mean "no token at all".
--
-- Idempotent: safe to re-run. Applied to production on 2026-09-22.

ALTER TABLE public.gsc_oauth_tokens ALTER COLUMN refresh_token DROP NOT NULL;

ALTER TABLE public.gsc_oauth_tokens DROP CONSTRAINT IF EXISTS gsc_oauth_tokens_token_present;
ALTER TABLE public.gsc_oauth_tokens ADD CONSTRAINT gsc_oauth_tokens_token_present
  CHECK (refresh_token IS NOT NULL OR refresh_token_secret_id IS NOT NULL);

ALTER TABLE public.ga4_oauth_tokens DROP CONSTRAINT IF EXISTS ga4_oauth_tokens_token_present;
ALTER TABLE public.ga4_oauth_tokens ADD CONSTRAINT ga4_oauth_tokens_token_present
  CHECK (refresh_token IS NOT NULL OR refresh_token_secret_id IS NOT NULL);

NOTIFY pgrst, 'reload schema';
