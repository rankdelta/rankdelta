-- 018_account_monthly_budget_cap.sql
-- ACCOUNT-LEVEL hard spend guardrail (see _shared/accountBudget.ts).
--
-- The pre-existing per-project cap (projects.monthly_api_spend_cap_cents, applied only in
-- serp_rank.ts) is optional and covers a single action. This migration is the schema half of a
-- HARD, DEFAULT, per-ACCOUNT cap: no user may cost AstroSEO more than ACCOUNT_MONTHLY_HARD_CAP_CENTS
-- (€50, tracked in USD cents) of real API spend in a calendar month.
--
-- Two changes, both additive/backward-compatible:
--   1. visibility_api_spend_events.project_id → NULLABLE. Spend routed through seo-proxy
--      (Site Explorer, article generation, ad-hoc LLM/DataForSEO) frequently has NO project
--      context, but MUST still be attributed to the user and counted toward the account cap.
--      user_id stays NOT NULL — the cap is keyed on the account, never on the project.
--   2. A covering index on (user_id, created_at) — the guard sums a user's spend for the current
--      month on every paid call, so this is a hot read path.
--
-- Plus a SECURITY INVOKER helper the UI uses to show "monthly account spend: €X / €50" without
-- pulling every row. It respects RLS (visibility_api_spend_events SELECT is user_id = auth.uid()),
-- so it can only ever total the caller's own spend.

-- 1. Allow account-level (project-less) spend rows.
ALTER TABLE visibility_api_spend_events ALTER COLUMN project_id DROP NOT NULL;

-- 2. Hot read path for the monthly per-account sum.
CREATE INDEX IF NOT EXISTS idx_visibility_spend_user_created
  ON visibility_api_spend_events(user_id, created_at);

-- 3. UI helper: caller's own API spend (cents) for the current calendar month (UTC).
--    SECURITY INVOKER so RLS applies — a user can only sum their own rows.
CREATE OR REPLACE FUNCTION public.my_account_api_spend_this_month_cents()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_cents), 0)::int
  FROM visibility_api_spend_events
  WHERE user_id = auth.uid()
    -- Start of the current calendar month in UTC, as a timestamptz (matches the JS guard's
    -- Date.UTC month boundary in _shared/accountBudget.ts — no session-timezone ambiguity).
    AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
$$;

GRANT EXECUTE ON FUNCTION public.my_account_api_spend_this_month_cents() TO authenticated;
