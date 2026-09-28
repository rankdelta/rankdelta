-- 20260923120000_cron_secrets_vault_autoscan.sql
--
-- Found 23/09/26: no scheduled AI-visibility scan has EVER run in prod. Every scan on record was
-- started by hand. Three reasons, all fixed here or in the same PR:
--
--  1. 033 only registered `visibility-weekly-autoscan` if two Vault secrets already existed. They
--     never did, so the job was never created (cron.job has no such row).
--  2. Even with the job, the Edge side compared the header against VISIBILITY_CRON_SECRET, a
--     function env var that also had to be set by hand, to the same value, in a second place.
--     Same for report-schedule-runner / REPORT_SCHEDULE_CRON_SECRET: `report-schedules-daily`
--     "succeeds" every morning and does nothing.
--  3. The weekly run walked every project in one request; at ~3 min per project it could never
--     get past the first one or two before the 400s Edge limit.
--
-- Now: Edge functions also accept the Vault value via get_cron_secret() (service_role only), and
-- the scan cron fires every 15 minutes, one project per call. Creating the Vault secrets is the
-- single remaining step (supabase/setup/cron-secrets.sql). Until then every job below is a no-op.
-- Idempotent.

-- ── 1. Vault read for Edge functions (service_role only, allow-listed names) ────────────────
CREATE OR REPLACE FUNCTION public.get_cron_secret(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v text;
BEGIN
  IF p_name NOT IN ('visibility_cron_secret', 'report_schedule_cron_secret') THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret(text) TO service_role;

COMMENT ON FUNCTION public.get_cron_secret(text) IS
  'Edge cron auth: returns an allow-listed Vault secret. service_role only.';

-- ── 2. pg_cron entry point for the visibility scan ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_visibility_autoscan()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'visibility_cron_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE NOTICE 'visibility autoscan skipped: Vault secrets supabase_functions_url / visibility_cron_secret missing';
    RETURN NULL;
  END IF;

  -- visibility-ops answers 202 at once and scans in the background (EdgeRuntime.waitUntil).
  SELECT net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/visibility-ops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visibility-cron-secret', v_secret
    ),
    body := '{"action":"cron_scheduled_run"}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION public.run_visibility_autoscan() FROM PUBLIC, anon, authenticated;

-- ── 3. Schedule: every 15 minutes, one due project per call ───────────────────────────────
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed; visibility-autoscan not scheduled';
    RETURN;
  END IF;

  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname IN ('visibility-weekly-autoscan', 'visibility-autoscan')
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule('visibility-autoscan', '*/15 * * * *', 'SELECT public.run_visibility_autoscan()');
END $$;
