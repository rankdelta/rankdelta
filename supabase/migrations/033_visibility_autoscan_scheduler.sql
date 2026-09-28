-- 033_visibility_autoscan_scheduler.sql
-- Weekly AI visibility autoscan: lock column, opt-out default ON, pg_cron → visibility-ops.
--
-- Deploy notes:
--   1. Apply migration (db push).
--   2. Set Edge secret VISIBILITY_CRON_SECRET (random, 32+ chars).
--   3. Store matching secrets in Vault (Dashboard → Database → Vault) OR run the cron.schedule
--      block below manually once secrets exist:
--        supabase_functions_url  → https://<project-ref>.supabase.co
--        visibility_cron_secret    → same value as VISIBILITY_CRON_SECRET
--   4. Deploy visibility-ops edge function.
--   5. Verify: POST visibility-ops { "action": "cron_scheduled_run" } + x-visibility-cron-secret header.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility_scan_lock_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.visibility_scan_lock_at IS
  'UTC lock while a scheduled visibility batch is running (prevents duplicate concurrent scans)';
COMMENT ON COLUMN projects.visibility_scheduled_last_at IS
  'UTC: last completed automated cron batch for this project (alias: last_scheduled_scan_at)';

-- New projects auto-scan by default; users can opt out in Visibility settings.
ALTER TABLE projects
  ALTER COLUMN visibility_schedule_enabled SET DEFAULT true;

-- Backfill: projects that already track active prompts should participate in autoscan.
UPDATE projects p
SET visibility_schedule_enabled = true
WHERE visibility_schedule_enabled = false
  AND EXISTS (
    SELECT 1 FROM visibility_queries vq
    WHERE vq.project_id = p.id AND vq.is_active = true
  );

-- pg_cron → pg_net → visibility-ops (weekly, Monday 04:00 UTC). Skips safely when extensions
-- or Vault are unavailable (local dev / first boot before secrets are configured).
DO $outer$
DECLARE
  v_job_id bigint;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'visibility-weekly-autoscan';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_functions_url')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'visibility_cron_secret') THEN
    PERFORM cron.schedule(
      'visibility-weekly-autoscan',
      '0 4 * * 1',
      $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url')
               || '/functions/v1/visibility-ops',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-visibility-cron-secret',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'visibility_cron_secret')
        ),
        body := '{"action":"cron_scheduled_run"}'::jsonb
      ) AS request_id;
      $job$
    );
  END IF;
EXCEPTION
  WHEN undefined_table OR undefined_object OR invalid_schema_name THEN
    RAISE NOTICE 'visibility autoscan pg_cron schedule skipped (extensions/vault not ready)';
END $outer$;
