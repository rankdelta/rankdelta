-- 051_client_reports.sql
-- Wave 2 agency reporting: unified report snapshots + shareable public read via token.

CREATE TABLE IF NOT EXISTS client_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative JSONB,
  share_token TEXT UNIQUE,
  branding JSONB,
  goals JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_reports_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_client_reports_project ON client_reports(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_reports_user ON client_reports(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_reports_share_token
  ON client_reports(share_token) WHERE share_token IS NOT NULL;

ALTER TABLE client_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_reports_select ON client_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = client_reports.project_id
        AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY client_reports_insert ON client_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = client_reports.project_id
        AND projects.user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

CREATE POLICY client_reports_update ON client_reports
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = client_reports.project_id
        AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = client_reports.project_id
        AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY client_reports_delete ON client_reports
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = client_reports.project_id
        AND projects.user_id = auth.uid()
    )
  );

REVOKE ALL ON client_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_reports TO service_role;

-- Public share read: only data/narrative/branding — no PII, no user_id.
CREATE OR REPLACE FUNCTION get_shared_report(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row client_reports%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM client_reports
  WHERE share_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'project_id', v_row.project_id,
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'sections', v_row.sections,
    'data', v_row.data,
    'narrative', v_row.narrative,
    'branding', v_row.branding,
    'goals', v_row.goals,
    'created_at', v_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION get_shared_report(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_shared_report(TEXT) TO anon, authenticated, service_role;

-- Heavy GEO aggregations: daily mart refreshed by pg_cron (report-build reads this).
CREATE MATERIALIZED VIEW IF NOT EXISTS report_geo_daily_mart AS
SELECT
  vq.project_id,
  (vqr.run_at AT TIME ZONE 'UTC')::date AS day,
  vqr.provider,
  COUNT(*) FILTER (WHERE vbm.tracked_brand_id IS NOT NULL) AS your_mentions,
  COUNT(*) FILTER (WHERE vbm.competitor_brand_id IS NOT NULL) AS competitor_mentions,
  COUNT(DISTINCT vc.id) AS citations,
  COUNT(DISTINCT vqr.id) AS run_count
FROM visibility_queries vq
JOIN visibility_query_runs vqr
  ON vqr.query_id = vq.id
 AND vqr.status = 'completed'
LEFT JOIN visibility_brand_mentions vbm ON vbm.query_run_id = vqr.id
LEFT JOIN visibility_citations vc ON vc.query_run_id = vqr.id
GROUP BY vq.project_id, (vqr.run_at AT TIME ZONE 'UTC')::date, vqr.provider
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_geo_daily_mart_pk
  ON report_geo_daily_mart (project_id, day, provider);

CREATE INDEX IF NOT EXISTS idx_report_geo_daily_mart_project_day
  ON report_geo_daily_mart (project_id, day);

-- Rankings mart: latest completed rank per keyword per UTC day.
CREATE MATERIALIZED VIEW IF NOT EXISTS report_ranking_daily_mart AS
SELECT DISTINCT ON (k.project_id, k.id, (s.checked_at AT TIME ZONE 'UTC')::date)
  k.project_id,
  k.id AS keyword_id,
  k.phrase,
  (s.checked_at AT TIME ZONE 'UTC')::date AS day,
  s.rank_absolute,
  s.ranking_url,
  s.checked_at
FROM serp_rank_keywords k
JOIN serp_rank_snapshots s
  ON s.keyword_id = k.id
 AND s.status = 'completed'
ORDER BY
  k.project_id,
  k.id,
  (s.checked_at AT TIME ZONE 'UTC')::date,
  s.checked_at DESC
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_ranking_daily_mart_pk
  ON report_ranking_daily_mart (project_id, keyword_id, day);

CREATE INDEX IF NOT EXISTS idx_report_ranking_daily_mart_project_day
  ON report_ranking_daily_mart (project_id, day);

-- Initial populate + nightly refresh (skips when pg_cron unavailable).
DO $outer$
BEGIN
  REFRESH MATERIALIZED VIEW report_geo_daily_mart;
  REFRESH MATERIALIZED VIEW report_ranking_daily_mart;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'report marts initial refresh skipped: %', SQLERRM;
END $outer$;

-- Nightly refresh of report marts.
CREATE OR REPLACE FUNCTION refresh_report_marts() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY report_geo_daily_mart;
  REFRESH MATERIALIZED VIEW CONCURRENTLY report_ranking_daily_mart;
END;
$$;

REVOKE ALL ON FUNCTION refresh_report_marts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_report_marts() TO service_role;

DO $outer$
DECLARE
  v_job_id bigint;
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'report-marts-refresh';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'report-marts-refresh',
    '15 3 * * *',
    $job$SELECT refresh_report_marts();$job$
  );
EXCEPTION
  WHEN undefined_table OR undefined_object OR invalid_schema_name THEN
    RAISE NOTICE 'report marts pg_cron schedule skipped (pg_cron not ready)';
END $outer$;
