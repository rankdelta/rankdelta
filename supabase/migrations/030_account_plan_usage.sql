-- UI-facing plan usage meters (research lookups, visibility checks, API spend).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.my_account_plan_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  v_plan text;
  v_internal boolean := false;
  v_research_used int := 0;
  v_research_cap int;
  v_visibility_used int := 0;
  v_visibility_cap int;
  v_api_spent int := 0;
  v_api_cap int := 5000;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.plan, COALESCE(s.is_internal, false)
  INTO v_plan, v_internal
  FROM subscriptions s
  WHERE s.user_id = v_user_id;

  SELECT COALESCE(lookup_count, 0) INTO v_research_used
  FROM research_lookup_ledger
  WHERE user_id = v_user_id AND period_month = v_month;

  IF v_internal THEN
    v_research_cap := NULL;
    v_api_cap := 20000;
  ELSIF v_plan IS NOT NULL THEN
    SELECT pc.research_lookups_monthly, pc.visibility_checks_monthly, pc.account_hard_cap_cents
    INTO v_research_cap, v_visibility_cap, v_api_cap
    FROM plan_configurations pc
    WHERE pc.plan = v_plan;
  END IF;

  v_api_cap := COALESCE(v_api_cap, 5000);

  SELECT COUNT(*)::int INTO v_visibility_used
  FROM visibility_api_spend_events
  WHERE user_id = v_user_id
    AND action = 'visibility_check'
    AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');

  SELECT COALESCE(SUM(cost_cents), 0)::int INTO v_api_spent
  FROM visibility_api_spend_events
  WHERE user_id = v_user_id
    AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');

  RETURN jsonb_build_object(
    'research_used', v_research_used,
    'research_cap', v_research_cap,
    'visibility_used', v_visibility_used,
    'visibility_cap', v_visibility_cap,
    'api_spent_cents', v_api_spent,
    'api_cap_cents', v_api_cap,
    'reset_at', ((v_month + interval '1 month') AT TIME ZONE 'utc')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_account_plan_usage() TO authenticated;
