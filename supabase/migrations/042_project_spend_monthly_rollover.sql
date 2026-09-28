-- 042_project_spend_monthly_rollover.sql
-- Security audit C1: per-project API spend cap was effectively lifetime because
-- projects.api_spend_cents_period was incremented but api_spend_period_start was never rolled.
-- This replaces record_project_spend with monthly rollover + authoritative cap checks under row lock.

CREATE OR REPLACE FUNCTION public.record_project_spend(
  p_project_id UUID,
  p_cost_cents INT,
  p_cap_cents INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current INT;
  v_new INT;
  v_month_start TIMESTAMPTZ;
BEGIN
  IF p_cost_cents IS NULL OR p_cost_cents < 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_cost', 'new_spend', NULL);
  END IF;

  v_month_start := (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');

  PERFORM id FROM projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'project_not_found', 'new_spend', NULL);
  END IF;

  -- Roll stale periods forward and sync the column from month-to-date events.
  UPDATE projects p
  SET
    api_spend_cents_period = sub.spend,
    api_spend_period_start = v_month_start
  FROM (
    SELECT COALESCE(SUM(e.cost_cents), 0)::int AS spend
    FROM visibility_api_spend_events e
    WHERE e.project_id = p_project_id
      AND e.created_at >= v_month_start
  ) sub
  WHERE p.id = p_project_id
    AND (p.api_spend_period_start IS NULL OR p.api_spend_period_start < v_month_start);

  SELECT api_spend_cents_period INTO v_current
  FROM projects
  WHERE id = p_project_id;

  v_new := COALESCE(v_current, 0) + p_cost_cents;

  IF p_cap_cents IS NOT NULL AND v_new > p_cap_cents THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_exceeded', 'new_spend', v_current);
  END IF;

  UPDATE projects
  SET
    api_spend_cents_period = v_new,
    api_spend_period_start = COALESCE(api_spend_period_start, v_month_start)
  WHERE id = p_project_id;

  RETURN jsonb_build_object('allowed', true, 'new_spend', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.record_project_spend(UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_spend(UUID, INT, INT) TO service_role;
