-- One-time setup: the Vault secrets every pg_cron → Edge job reads.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor). Idempotent: re-running it
-- changes nothing. The secret values are random and never need to be copied anywhere — Edge
-- functions read them from Vault through get_cron_secret() (migration 20260923120000).
--
-- Replace <project-ref> with your project ref (Dashboard → Project Settings → General).
--
-- Unlocks:
--   visibility-autoscan     (every 15 min) — scheduled AI-visibility scans for paying projects
--   report-schedules-daily  (05:00 UTC)    — scheduled client reports + Search Console refresh

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_functions_url') THEN
    PERFORM vault.create_secret('https://<project-ref>.supabase.co', 'supabase_functions_url');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'visibility_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'visibility_cron_secret');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_schedule_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'report_schedule_cron_secret');
  END IF;
END $$;

-- Check (names only, never values):
SELECT name, created_at FROM vault.secrets
WHERE name IN ('supabase_functions_url', 'visibility_cron_secret', 'report_schedule_cron_secret');
