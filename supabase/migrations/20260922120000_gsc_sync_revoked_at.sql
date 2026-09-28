-- 20260922120000_gsc_sync_revoked_at.sql
-- Scheduled Search Console refresh: mark a grant the user revoked at Google.
--
-- report-schedule-runner refreshes gsc_analytics_cache unattended every day. When Google answers
-- `invalid_grant` the user removed our access at myaccount.google.com/permissions: no retry can
-- fix that, only a reconnect. Without somewhere to record it the cron would re-attempt the same
-- dead grant every night, and the app would keep showing a connection that no longer works.
--
-- The mark lives on gsc_properties, not gsc_oauth_tokens, because the browser can read
-- gsc_properties under RLS (owner-only SELECT policy) and has no access to the token table at all
-- — so the UI can surface "reconnect Search Console" without a new endpoint.
--
-- Nullable, no default, additive: existing rows read as "grant fine". The edge functions treat
-- both the write and the read as best-effort, so they behave correctly before this is applied
-- (the cron simply retries a revoked project daily until it is).
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF to_regclass('public.gsc_properties') IS NULL THEN
    RAISE NOTICE 'gsc_properties missing — skipping 20260922120000_gsc_sync_revoked_at';
    RETURN;
  END IF;

  ALTER TABLE gsc_properties ADD COLUMN IF NOT EXISTS sync_revoked_at TIMESTAMPTZ;

  EXECUTE $c$COMMENT ON COLUMN gsc_properties.sync_revoked_at IS
    'Set by the scheduled refresh when Google returned invalid_grant (user revoked access). Cleared on the next successful sync. NULL = grant is fine.'$c$;
END $$;

-- PostgREST caches the schema; without this the new column stays invisible to the API.
NOTIFY pgrst, 'reload schema';
