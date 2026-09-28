-- 044_review_hardening.sql
-- RLS ownership, spend-counter integrity and plan data.
-- Idempotent (DROP IF EXISTS / CREATE OR REPLACE / ON CONFLICT).
--
--  1. wp_connections: the policy checks PROJECT ownership, not just the row's user_id
--     (with UNIQUE(project_id), a connection must only be creatable by the project owner).
--  2. projects: spend counters / scheduler locks are server-owned; a BEFORE UPDATE trigger
--     preserves them for non-service-role callers. Also clamps the user-set monthly cap.
--  3. visibility_api_spend_events: ON DELETE SET NULL, so deleting a project keeps its
--     spend in the account-level monthly total.
--  4. research_lookup_ledger: own-row SELECT so my_account_plan_usage() (SECURITY INVOKER)
--     can read research usage.
--  5. project_dashboard_summary view: security_invoker (RLS of the caller applies).
--  6. backlink_referring_domains: server-only cache; drop the client SELECT policy.
--  7. plan_configurations: seed an inactive 'free' row (the webhook downgrades to 'free')
--     and make reset_subscription_credits fail soft when the plan row is missing.
--  8. Drop the development helper setup_test_account.
--  9. Enforce max_projects in the database for paying accounts.

-- ── 1. wp_connections ownership ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own wp_connections" ON public.wp_connections;
CREATE POLICY "Users manage own wp_connections"
  ON public.wp_connections FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = wp_connections.project_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = wp_connections.project_id AND p.user_id = auth.uid())
  );
CREATE INDEX IF NOT EXISTS idx_wp_connections_user ON public.wp_connections(user_id);

-- ── 2. projects: server-owned counters ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.projects_protect_server_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
BEGIN
  -- service_role (edge functions) and direct SQL (no JWT) may write everything.
  IF v_role IN ('service_role', '') THEN
    RETURN NEW;
  END IF;

  -- Spend / scheduler state is maintained only by record_project_spend & the cron.
  NEW.api_spend_cents_period      := OLD.api_spend_cents_period;
  NEW.api_spend_period_start      := OLD.api_spend_period_start;
  NEW.visibility_scan_lock_at     := OLD.visibility_scan_lock_at;
  NEW.visibility_scheduled_last_at := OLD.visibility_scheduled_last_at;

  -- A user may lower/raise their own cap, but never above the hard ceiling.
  IF NEW.monthly_api_spend_cap_cents IS NOT NULL THEN
    NEW.monthly_api_spend_cap_cents := least(greatest(NEW.monthly_api_spend_cap_cents, 0), 20000);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  -- Only install when every referenced column exists (older self-host databases).
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'api_spend_cents_period')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'visibility_scan_lock_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'visibility_scheduled_last_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'monthly_api_spend_cap_cents') THEN
    DROP TRIGGER IF EXISTS trg_projects_protect_server_columns ON public.projects;
    CREATE TRIGGER trg_projects_protect_server_columns
      BEFORE UPDATE ON public.projects
      FOR EACH ROW EXECUTE FUNCTION public.projects_protect_server_columns();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.projects_protect_server_columns() FROM PUBLIC, anon, authenticated;

-- ── 3. spend events survive project deletion ────────────────────────────────
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.visibility_api_spend_events'::regclass
    AND contype = 'f'
    AND confrelid = 'public.projects'::regclass
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.visibility_api_spend_events DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.visibility_api_spend_events
    ADD CONSTRAINT visibility_api_spend_events_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
END $$;

-- ── 4. research usage readable by its owner ─────────────────────────────────
DROP POLICY IF EXISTS "Users read own research_lookup_ledger" ON public.research_lookup_ledger;
CREATE POLICY "Users read own research_lookup_ledger"
  ON public.research_lookup_ledger FOR SELECT
  USING (auth.uid() = user_id);

-- ── 5. dashboard view runs as the caller ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'project_dashboard_summary') THEN
    ALTER VIEW public.project_dashboard_summary SET (security_invoker = true);
  END IF;
END $$;

-- ── 6. backlink cache is server-only ────────────────────────────────────────
DROP POLICY IF EXISTS "auth read backlink_referring_domains" ON public.backlink_referring_domains;

-- ── 7. 'free' plan row + soft-fail credit reset ─────────────────────────────
INSERT INTO public.plan_configurations
  (plan, price_monthly_cents, price_yearly_cents, monthly_credits, max_projects, display_name, description, features, is_active)
VALUES
  ('free', 0, 0, 50, 1, 'Free', 'After a subscription ends', '{}'::jsonb, false)
ON CONFLICT (plan) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reset_subscription_credits(
  p_user_id UUID,
  p_new_period_start TIMESTAMP WITH TIME ZONE,
  p_new_period_end TIMESTAMP WITH TIME ZONE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription RECORD;
  v_plan_config RECORD;
  v_old_balance INT;
BEGIN
  SELECT * INTO v_subscription FROM subscriptions WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription not found');
  END IF;

  SELECT * INTO v_plan_config FROM plan_configurations WHERE plan = v_subscription.plan;
  IF NOT FOUND OR v_plan_config.monthly_credits IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan configuration not found', 'plan', v_subscription.plan);
  END IF;

  SELECT credits_remaining INTO v_old_balance FROM credit_balances WHERE user_id = p_user_id;

  UPDATE credit_balances
  SET
    credits_remaining = v_plan_config.monthly_credits,
    credits_used_this_period = 0,
    monthly_credits = v_plan_config.monthly_credits,
    period_start = p_new_period_start,
    period_end = p_new_period_end,
    updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (
    user_id, transaction_type, credits_change, credits_before, credits_after, description
  ) VALUES (
    p_user_id, 'subscription_reset', v_plan_config.monthly_credits, v_old_balance,
    v_plan_config.monthly_credits, 'Monthly credit reset for ' || v_plan_config.display_name || ' plan'
  );

  RETURN jsonb_build_object('success', true, 'new_credits', v_plan_config.monthly_credits, 'plan', v_subscription.plan);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_subscription_credits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_subscription_credits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ── 8. drop development helper ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.setup_test_account(TEXT);

-- ── 9. max_projects enforced server-side for paying accounts ────────────────
CREATE OR REPLACE FUNCTION public.projects_enforce_max_projects()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
  v_sub RECORD;
  v_count INT;
BEGIN
  IF v_role IN ('service_role', '') THEN
    RETURN NEW;
  END IF;

  SELECT status, max_projects INTO v_sub FROM subscriptions WHERE user_id = NEW.user_id;
  -- Only paying accounts carry a contractual limit; non-paying / self-host rows are gated by
  -- the plan checks on every paid action instead.
  IF NOT FOUND OR v_sub.status NOT IN ('active', 'trialing', 'past_due') THEN
    RETURN NEW;
  END IF;
  IF v_sub.max_projects IS NULL OR v_sub.max_projects < 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count FROM projects WHERE user_id = NEW.user_id;
  IF v_count >= v_sub.max_projects THEN
    RAISE EXCEPTION 'project_limit_reached' USING ERRCODE = 'check_violation',
      DETAIL = format('plan allows %s project(s)', v_sub.max_projects);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_projects_enforce_max_projects ON public.projects;
CREATE TRIGGER trg_projects_enforce_max_projects
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_enforce_max_projects();
REVOKE ALL ON FUNCTION public.projects_enforce_max_projects() FROM PUBLIC, anon, authenticated;
