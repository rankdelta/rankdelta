-- 20260927120000_geo_mart_count_each_mention_once.sql
--
-- report_geo_daily_mart feeds Share of Voice in the in-app dashboard, the portfolio rollup and,
-- as a fallback, client reports. Two defects, measured on production on 27/09/26:
--
-- 1. It LEFT JOINs brand mentions and citations in the same query and COUNT(*)s the mentions,
--    so every mention was counted once per cited source. A Perplexity answer citing 10 sources
--    counted each brand mention 10 times (Rankdelta.ai, last 30 days: 40 "mentions" instead of 4),
--    which skewed SoV toward the engines that cite the most. Now each mention row counts once.
-- 2. It kept answers from prompts the user had switched off. Reports already use active prompts
--    only; the mart now does the same.
--
-- The view is recreated (a materialized view can't be altered), with its indexes and the
-- service-role-only access set by 20260912180000_lock_report_marts_and_secrets, then refreshed.
-- The nightly refresh_report_marts() job keeps working unchanged.

DROP MATERIALIZED VIEW IF EXISTS public.report_geo_daily_mart;

CREATE MATERIALIZED VIEW public.report_geo_daily_mart AS
SELECT
  vq.project_id,
  (vqr.run_at AT TIME ZONE 'UTC')::date AS day,
  vqr.provider,
  COUNT(DISTINCT vbm.id) FILTER (WHERE vbm.tracked_brand_id IS NOT NULL) AS your_mentions,
  COUNT(DISTINCT vbm.id) FILTER (WHERE vbm.competitor_brand_id IS NOT NULL) AS competitor_mentions,
  COUNT(DISTINCT vc.id) AS citations,
  COUNT(DISTINCT vqr.id) AS run_count
FROM public.visibility_queries vq
JOIN public.visibility_query_runs vqr
  ON vqr.query_id = vq.id
 AND vqr.status = 'completed'
LEFT JOIN public.visibility_brand_mentions vbm ON vbm.query_run_id = vqr.id
LEFT JOIN public.visibility_citations vc ON vc.query_run_id = vqr.id
WHERE vq.is_active
GROUP BY vq.project_id, (vqr.run_at AT TIME ZONE 'UTC')::date, vqr.provider
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_geo_daily_mart_pk
  ON public.report_geo_daily_mart (project_id, day, provider);

CREATE INDEX IF NOT EXISTS idx_report_geo_daily_mart_project_day
  ON public.report_geo_daily_mart (project_id, day);

REVOKE ALL ON TABLE public.report_geo_daily_mart FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.report_geo_daily_mart TO service_role;

REFRESH MATERIALIZED VIEW public.report_geo_daily_mart;
