-- reserve_account_spend: store the provider through the llm_provider enum.
--
-- visibility_api_spend_events.provider is llm_provider (010_visibility_tracker.sql), but the function
-- (034, then 20260912190500) inserted the TEXT argument as is: "column provider is of type
-- llm_provider but expression is of type text". Every reservation with a provider failed, and the
-- callers fail closed as "monthly cap reached" (production, 28/09/26, a few minutes after
-- 20260912190500 was applied: hot-fixed with this same body). A name outside the enum is stored
-- as NULL instead of failing the paid call. Same signature, same behaviour otherwise (the cap used
-- at reserve time is stamped on the event for finalize_account_spend).

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
  v_provider llm_provider;
BEGIN
  IF p_user_id IS NULL OR p_cost_cents IS NULL OR p_cost_cents < 0 OR p_cap_cents IS NULL OR p_cap_cents < 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_args', 'spent_cents', NULL, 'cap_cents', p_cap_cents);
  END IF;

  -- provider is an enum column: a name outside the enum is stored as NULL, never an error.
  SELECT e INTO v_provider FROM unnest(enum_range(NULL::llm_provider)) AS e WHERE e::text = p_provider LIMIT 1;

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
    p_user_id, NULL, v_provider, p_action, p_cost_cents, p_cost_cents / 100.0,
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

REVOKE ALL ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_account_spend(UUID, INT, INT, TEXT, TEXT, JSONB) TO service_role;
