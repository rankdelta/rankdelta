-- 049_perf_indexes_and_spend_sum.sql
-- Performance review: indexes for the access patterns the hooks / edge functions actually use on
-- the tables that grow per week, plus an aggregate RPC so the account spend cap is no longer
-- summed in JS over a PostgREST page (max-rows 1000 → a heavy account could exceed the cap).
-- Additive only, idempotent. Human-applied via migration pipeline only.

-- visibility_query_runs: .in('query_id').order('run_at' desc) everywhere; cron "latest run per query"
CREATE INDEX IF NOT EXISTS idx_visibility_query_runs_query_run_at
  ON visibility_query_runs (query_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_visibility_query_runs_inflight
  ON visibility_query_runs (query_id, run_at DESC) WHERE status IN ('pending', 'processing');

-- visibility_brand_mentions: FK columns (ON DELETE SET NULL) without indexes + dominant read
CREATE INDEX IF NOT EXISTS idx_visibility_mentions_tracked_brand
  ON visibility_brand_mentions (tracked_brand_id) WHERE tracked_brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visibility_mentions_competitor_brand
  ON visibility_brand_mentions (competitor_brand_id) WHERE competitor_brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visibility_mentions_run_brands
  ON visibility_brand_mentions (query_run_id) INCLUDE (tracked_brand_id, competitor_brand_id);

-- visibility_scores: FK columns (ON DELETE CASCADE) without indexes
CREATE INDEX IF NOT EXISTS idx_visibility_scores_tracked_brand ON visibility_scores (tracked_brand_id);
CREATE INDEX IF NOT EXISTS idx_visibility_scores_competitor_brand ON visibility_scores (competitor_brand_id);

-- visibility_api_spend_events: project cap (project_id + month), account usage (user_id + action + month)
CREATE INDEX IF NOT EXISTS idx_visibility_spend_project_created
  ON visibility_api_spend_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visibility_spend_user_action_created
  ON visibility_api_spend_events (user_id, action, created_at);

-- serp rank tracker
CREATE INDEX IF NOT EXISTS idx_serp_rank_snapshots_keyword_checked
  ON serp_rank_snapshots (keyword_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_serp_rank_keywords_project_active
  ON serp_rank_keywords (project_id, is_active);
CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_project_status_created
  ON serp_rank_check_jobs (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_active_updated
  ON serp_rank_check_jobs (updated_at) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_user ON serp_rank_check_jobs (user_id);

-- content / proposals / rankings / credits
CREATE INDEX IF NOT EXISTS idx_content_project_generated ON content (project_id, generated_date DESC);
CREATE INDEX IF NOT EXISTS idx_content_project_status ON content (project_id, status);
CREATE INDEX IF NOT EXISTS idx_content_proposals_project_generated
  ON content_proposals (project_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_proposals_project_status ON content_proposals (project_id, status);
CREATE INDEX IF NOT EXISTS idx_rankings_project_checked ON rankings (project_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON credit_transactions (user_id, created_at DESC);

-- Account spend since a timestamp, summed in SQL (service_role only; used by the edge functions).
CREATE OR REPLACE FUNCTION public.account_spend_cents_since(p_user_id UUID, p_since TIMESTAMPTZ)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_cents), 0)::INT
  FROM visibility_api_spend_events
  WHERE user_id = p_user_id AND created_at >= p_since;
$$;
REVOKE ALL ON FUNCTION public.account_spend_cents_since(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_spend_cents_since(UUID, TIMESTAMPTZ) TO service_role;
