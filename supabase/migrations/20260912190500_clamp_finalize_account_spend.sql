-- Clamp finalize_account_spend so a reserved precheck (e.g. DATAFORSEO_PRECHECK_CENTS = 10)
-- cannot be overwritten with a much larger provider cost that would blow the monthly cap.
-- Stamp the cap used at reserve time onto the event metadata; finalize re-locks the account,
-- sums other events this month, and writes LEAST(reported, remaining room).

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
    p_user_id, NULL, p_provider, p_action, p_cost_cents, p_cost_cents / 100.0,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('account_cap_cents', p_cap_cents)
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
DECLARE
  v_user UUID;
  v_reserved INT;
  v_cap INT;
  v_spent_others INT;
  v_final INT;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT user_id, cost_cents,
         COALESCE(NULLIF(metadata->>'account_cap_cents', '')::int, 0)
    INTO v_user, v_reserved, v_cap
  FROM visibility_api_spend_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user::text));

  IF v_cap <= 0 THEN
    -- Fail closed: without a stored cap, never raise the reserved amount.
    v_final := LEAST(GREATEST(0, COALESCE(p_cost_cents, 0)), GREATEST(0, v_reserved));
  ELSE
    SELECT COALESCE(SUM(cost_cents), 0)::int INTO v_spent_others
    FROM visibility_api_spend_events
    WHERE user_id = v_user
      AND created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')
      AND id <> p_event_id;
    v_final := LEAST(GREATEST(0, COALESCE(p_cost_cents, 0)), GREATEST(0, v_cap - v_spent_others));
  END IF;

  UPDATE visibility_api_spend_events
  SET
    cost_cents = v_final,
    cost_usd = COALESCE(p_cost_usd, cost_usd),
    metadata = CASE
      WHEN p_metadata IS NULL THEN metadata
      ELSE COALESCE(metadata, '{}'::jsonb) || p_metadata
    END
  WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_account_spend(UUID, INT, NUMERIC, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_account_spend(UUID, INT, NUMERIC, JSONB) TO service_role;
