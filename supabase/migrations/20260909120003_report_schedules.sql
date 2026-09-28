-- 052_report_schedules.sql
-- Wave 4: scheduled agency reports + email queue + portfolio rollup RPC.

CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  day_of_week INT CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  day_of_month INT CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  branding JSONB,
  goals JSONB,
  last_run_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_cadence_fields CHECK (
    (cadence = 'weekly' AND day_of_week IS NOT NULL AND day_of_month IS NULL)
    OR (cadence = 'monthly' AND day_of_month IS NOT NULL AND day_of_week IS NULL)
  ),
  CONSTRAINT report_schedules_recipients_array CHECK (jsonb_typeof(recipients) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_project ON report_schedules(project_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_user ON report_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_active ON report_schedules(active) WHERE active = true;

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_schedules_select ON report_schedules
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = report_schedules.project_id
        AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY report_schedules_insert ON report_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = report_schedules.project_id
        AND projects.user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

CREATE POLICY report_schedules_update ON report_schedules
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = report_schedules.project_id
        AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = report_schedules.project_id
        AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY report_schedules_delete ON report_schedules
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = report_schedules.project_id
        AND projects.user_id = auth.uid()
    )
  );

REVOKE ALL ON report_schedules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO service_role;

-- Email delivery queue (no PII beyond owner-supplied recipient list).
CREATE TABLE IF NOT EXISTS report_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES report_schedules(id) ON DELETE SET NULL,
  report_id UUID NOT NULL REFERENCES client_reports(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  branding JSONB,
  share_url TEXT,
  summary JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_report_email_queue_pending
  ON report_email_queue(status, created_at) WHERE status = 'pending';

ALTER TABLE report_email_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_email_queue_select ON report_email_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_reports cr
      JOIN projects p ON p.id = cr.project_id
      WHERE cr.id = report_email_queue.report_id
        AND p.user_id = auth.uid()
    )
  );

REVOKE ALL ON report_email_queue FROM anon, authenticated;
GRANT SELECT ON report_email_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_email_queue TO service_role;

-- Returns true when a schedule should run on as_of (UTC date).
CREATE OR REPLACE FUNCTION report_schedule_is_due(
  p_cadence TEXT,
  p_day_of_week INT,
  p_day_of_month INT,
  p_last_run_at TIMESTAMPTZ,
  p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_dow INT;
  v_dom INT;
BEGIN
  IF p_as_of IS NULL THEN
    RETURN false;
  END IF;

  v_dow := EXTRACT(DOW FROM p_as_of)::INT;
  v_dom := EXTRACT(DAY FROM p_as_of)::INT;

  IF p_last_run_at IS NOT NULL AND (p_last_run_at AT TIME ZONE 'UTC')::date >= p_as_of THEN
    RETURN false;
  END IF;

  IF p_cadence = 'weekly' THEN
    RETURN p_day_of_week IS NOT NULL AND v_dow = p_day_of_week;
  END IF;

  IF p_cadence = 'monthly' THEN
    RETURN p_day_of_month IS NOT NULL AND v_dom = p_day_of_month;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION report_schedule_is_due(TEXT, INT, INT, TIMESTAMPTZ, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_schedule_is_due(TEXT, INT, INT, TIMESTAMPTZ, DATE) TO authenticated, service_role;

-- Next scheduled run date on or after from_date (UTC).
CREATE OR REPLACE FUNCTION report_schedule_next_run(
  p_cadence TEXT,
  p_day_of_week INT,
  p_day_of_month INT,
  p_from_date DATE DEFAULT CURRENT_DATE
)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cursor DATE := COALESCE(p_from_date, CURRENT_DATE);
  v_i INT := 0;
BEGIN
  IF p_cadence = 'weekly' AND p_day_of_week IS NOT NULL THEN
    WHILE v_i < 8 LOOP
      IF EXTRACT(DOW FROM v_cursor)::INT = p_day_of_week THEN
        RETURN v_cursor;
      END IF;
      v_cursor := v_cursor + 1;
      v_i := v_i + 1;
    END LOOP;
  END IF;

  IF p_cadence = 'monthly' AND p_day_of_month IS NOT NULL THEN
    WHILE v_i < 62 LOOP
      IF EXTRACT(DAY FROM v_cursor)::INT = p_day_of_month THEN
        RETURN v_cursor;
      END IF;
      v_cursor := v_cursor + 1;
      v_i := v_i + 1;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION report_schedule_next_run(TEXT, INT, INT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_schedule_next_run(TEXT, INT, INT, DATE) TO authenticated, service_role;

-- Due active schedules for the cron runner (service_role only).
CREATE OR REPLACE FUNCTION get_due_report_schedules(p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS SETOF report_schedules
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rs.*
  FROM report_schedules rs
  WHERE rs.active = true
    AND report_schedule_is_due(rs.cadence, rs.day_of_week, rs.day_of_month, rs.last_run_at, p_as_of);
$$;

REVOKE ALL ON FUNCTION get_due_report_schedules(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_due_report_schedules(DATE) TO service_role;

-- Daily runner: triggers edge function via pg_net when Vault secrets exist.
CREATE OR REPLACE FUNCTION run_due_report_schedules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_functions_url')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'report_schedule_cron_secret') THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url')
             || '/functions/v1/report-schedule-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-report-schedule-cron-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'report_schedule_cron_secret')
      ),
      body := '{"action":"process_due_schedules"}'::jsonb
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION run_due_report_schedules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_due_report_schedules() TO service_role;

-- Portfolio rollup: reads marts + integration caches (no per-request recompute).
CREATE OR REPLACE FUNCTION get_portfolio_rollup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_end DATE := CURRENT_DATE;
  v_start DATE := v_end - 27;
  v_prev_end DATE := v_start - 1;
  v_prev_start DATE := v_prev_end - 27;
  v_result JSONB := '[]'::jsonb;
  v_row JSONB;
  r RECORD;
  v_yours BIGINT;
  v_comp BIGINT;
  v_prev_yours BIGINT;
  v_prev_comp BIGINT;
  v_sov NUMERIC;
  v_prev_sov NUMERIC;
  v_avg_rank NUMERIC;
  v_prev_avg_rank NUMERIC;
  v_gsc_clicks BIGINT;
  v_prev_gsc_clicks BIGINT;
  v_ga4_sessions BIGINT;
  v_prev_ga4_sessions BIGINT;
  v_health NUMERIC;
  v_latest_report_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR r IN
    SELECT p.id, p.name, p.website_url
    FROM projects p
    WHERE p.user_id = v_user_id
    ORDER BY p.name
  LOOP
    SELECT
      COALESCE(SUM(your_mentions), 0),
      COALESCE(SUM(competitor_mentions), 0)
    INTO v_yours, v_comp
    FROM report_geo_daily_mart
    WHERE project_id = r.id AND day BETWEEN v_start AND v_end;

    SELECT
      COALESCE(SUM(your_mentions), 0),
      COALESCE(SUM(competitor_mentions), 0)
    INTO v_prev_yours, v_prev_comp
    FROM report_geo_daily_mart
    WHERE project_id = r.id AND day BETWEEN v_prev_start AND v_prev_end;

    v_sov := CASE WHEN (v_yours + v_comp) > 0
      THEN ROUND(100.0 * v_yours / (v_yours + v_comp), 1) ELSE NULL END;
    v_prev_sov := CASE WHEN (v_prev_yours + v_prev_comp) > 0
      THEN ROUND(100.0 * v_prev_yours / (v_prev_yours + v_prev_comp), 1) ELSE NULL END;

    SELECT AVG(rank_absolute), NULL
    INTO v_avg_rank, v_prev_avg_rank
    FROM (
      SELECT DISTINCT ON (keyword_id) rank_absolute
      FROM report_ranking_daily_mart
      WHERE project_id = r.id AND day BETWEEN v_start AND v_end AND rank_absolute IS NOT NULL
      ORDER BY keyword_id, day DESC
    ) cur;

    SELECT AVG(rank_absolute)
    INTO v_prev_avg_rank
    FROM (
      SELECT DISTINCT ON (keyword_id) rank_absolute
      FROM report_ranking_daily_mart
      WHERE project_id = r.id AND day BETWEEN v_prev_start AND v_prev_end AND rank_absolute IS NOT NULL
      ORDER BY keyword_id, day DESC
    ) prev;

    v_gsc_clicks := NULL;
    v_prev_gsc_clicks := NULL;
    SELECT
      COALESCE((
        SELECT SUM((elem->>'clicks')::numeric)
        FROM gsc_analytics_cache g,
          LATERAL jsonb_array_elements(COALESCE(g.daily_data, '[]'::jsonb)) elem
        WHERE g.project_id = r.id AND g.period_days = 28
          AND (elem->>'date')::date BETWEEN v_start AND v_end
        LIMIT 1
      ), 0),
      COALESCE((
        SELECT SUM((elem->>'clicks')::numeric)
        FROM gsc_analytics_cache g,
          LATERAL jsonb_array_elements(COALESCE(g.daily_data, '[]'::jsonb)) elem
        WHERE g.project_id = r.id AND g.period_days = 28
          AND (elem->>'date')::date BETWEEN v_prev_start AND v_prev_end
        LIMIT 1
      ), 0)
    INTO v_gsc_clicks, v_prev_gsc_clicks;

    v_ga4_sessions := NULL;
    v_prev_ga4_sessions := NULL;
    SELECT
      COALESCE((
        SELECT SUM((elem->>'sessions')::numeric)
        FROM ga4_analytics_cache g,
          LATERAL jsonb_array_elements(COALESCE(g.daily_data, '[]'::jsonb)) elem
        WHERE g.project_id = r.id AND g.period_days = 28
          AND (elem->>'date')::date BETWEEN v_start AND v_end
        LIMIT 1
      ), 0),
      COALESCE((
        SELECT SUM((elem->>'sessions')::numeric)
        FROM ga4_analytics_cache g,
          LATERAL jsonb_array_elements(COALESCE(g.daily_data, '[]'::jsonb)) elem
        WHERE g.project_id = r.id AND g.period_days = 28
          AND (elem->>'date')::date BETWEEN v_prev_start AND v_prev_end
        LIMIT 1
      ), 0)
    INTO v_ga4_sessions, v_prev_ga4_sessions;

    SELECT (sa.result->>'compositeHealth')::numeric
    INTO v_health
    FROM site_audits sa
    WHERE sa.project_id = r.id
    ORDER BY sa.audited_at DESC NULLS LAST
    LIMIT 1;

    SELECT cr.id INTO v_latest_report_id
    FROM client_reports cr
    WHERE cr.project_id = r.id
    ORDER BY cr.created_at DESC
    LIMIT 1;

    v_row := jsonb_build_object(
      'projectId', r.id,
      'projectName', r.name,
      'websiteUrl', r.website_url,
      'latestReportId', v_latest_report_id,
      'aiSov', jsonb_build_object('value', v_sov, 'delta', CASE WHEN v_sov IS NOT NULL AND v_prev_sov IS NOT NULL THEN v_sov - v_prev_sov ELSE NULL END),
      'avgPosition', jsonb_build_object('value', v_avg_rank, 'delta', CASE WHEN v_avg_rank IS NOT NULL AND v_prev_avg_rank IS NOT NULL THEN v_avg_rank - v_prev_avg_rank ELSE NULL END),
      'gscClicks', jsonb_build_object('value', v_gsc_clicks, 'delta', v_gsc_clicks - v_prev_gsc_clicks),
      'ga4Sessions', jsonb_build_object('value', v_ga4_sessions, 'delta', v_ga4_sessions - v_prev_ga4_sessions),
      'healthScore', jsonb_build_object('value', v_health, 'delta', NULL)
    );

    v_result := v_result || jsonb_build_array(v_row);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_portfolio_rollup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_portfolio_rollup() TO authenticated, service_role;

-- pg_cron: daily at 05:00 UTC (after marts refresh at 03:15).
DO $outer$
DECLARE
  v_job_id bigint;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'report-schedules-daily';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'report-schedules-daily',
    '0 5 * * *',
    $job$SELECT run_due_report_schedules();$job$
  );
EXCEPTION
  WHEN undefined_table OR undefined_object OR invalid_schema_name THEN
    RAISE NOTICE 'report schedules pg_cron schedule skipped (pg_cron not ready)';
END $outer$;
