-- 034_atomic_account_spend_reserve.sql
-- seo-proxy spend-cap TOCTOU: assertAccountBudget read + logSpend insert were two steps, so
-- concurrent requests could both pass the cap check. This RPC serializes per-user with an
-- advisory lock and inserts the reservation in the same transaction as the cap check.

CREATE OR REPLACE FUNCTION public.reserve_account_spend(
  p_user_id UUID,
  p_cost_cents INT,
  p_cap_cents INT,
  p_action TEXT,
  p_provider TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spent INT;
  v_new INT;
  v_event_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_cost_cents IS NULL OR p_cost_cents < 0 OR p_cap_cents IS NULL OR p_cap_cents < 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_args', 'spent_cents', NULL, 'cap_cents', p_cap_cents);
  END IF;

  -- Serialize monthly cap checks per account (same pattern as record_project_spend row lock).
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT COALESCE(SUM(cost_cents), 0)::int INTO v_spent
  FROM visibility_api_spend_events
  WHERE user_id = p_user_id
    AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');

  v_new := v_spent + p_cost_cents;
  IF v_new > p_cap_cents THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'account_monthly_cap_reached',
      'spent_cents', v_spent,
      'cap_cents', p_cap_cents
    );
  END IF;

  INSERT INTO visibility_api_spend_events (
    user_id, project_id, provider, action, cost_cents, cost_usd, metadata
  ) VALUES (
    p_user_id, NULL, p_provider, p_action, p_cost_cents, p_cost_cents / 100.0, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'spent_cents', v_spent,
    'cap_cents', p_cap_cents,
    'event_id', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_account_spend(
  p_event_id UUID,
  p_cost_cents INT,
  p_cost_usd NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE visibility_api_spend_events
  SET
    cost_cents = GREATEST(0, COALESCE(p_cost_cents, cost_cents)),
    cost_usd = COALESCE(p_cost_usd, cost_usd),
    metadata = COALESCE(p_metadata, metadata)
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_account_spend(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM visibility_api_spend_events WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_account_spend(UUID, INT, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_account_spend(UUID, INT, NUMERIC, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.release_account_spend(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_account_spend(UUID) TO service_role;
