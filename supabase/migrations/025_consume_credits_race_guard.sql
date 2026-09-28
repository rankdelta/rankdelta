-- 025_consume_credits_race_guard.sql
--
-- Input invariants for consume_credits (service_role only since 023). The function already
-- takes `FOR UPDATE` on the balance row, which serializes concurrent consumes per user.
--
-- 1. Reject non-positive p_credits: a negative value would increase the balance, since the
--    UPDATE subtracts p_credits.
-- 2. Cap p_credits at 1,000,000 to bound runaway loops.
-- 3. Clamp bonus_credits at >= 0 explicitly.
--
-- Replaces the function body; signature unchanged.

CREATE OR REPLACE FUNCTION public.consume_credits(
  p_user_id UUID,
  p_action_type VARCHAR(50),
  p_credits INT,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_project_id UUID DEFAULT NULL,
  p_content_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_balance RECORD;
  v_new_remaining INT;
  v_from_bonus INT := 0;
BEGIN
  -- Invariant: only meaningful positive consumption amounts.
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid credits amount',
      'credits_required', COALESCE(p_credits, 0)
    );
  END IF;

  -- Bound runaway loops / upstream bugs.
  IF p_credits > 1000000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credits amount exceeds maximum allowed',
      'credits_required', p_credits
    );
  END IF;

  -- Serialize concurrent consumes for this user.
  SELECT * INTO v_balance
  FROM credit_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No credit balance found for user',
      'credits_remaining', 0
    );
  END IF;

  IF (v_balance.credits_remaining + v_balance.bonus_credits) < p_credits THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'credits_required', p_credits,
      'credits_remaining', v_balance.credits_remaining,
      'bonus_credits', v_balance.bonus_credits
    );
  END IF;

  IF v_balance.credits_remaining >= p_credits THEN
    v_new_remaining := v_balance.credits_remaining - p_credits;

    UPDATE credit_balances
    SET
      credits_remaining = v_new_remaining,
      credits_used_this_period = credits_used_this_period + p_credits,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    v_from_bonus := p_credits - v_balance.credits_remaining;

    UPDATE credit_balances
    SET
      credits_remaining = 0,
      bonus_credits = GREATEST(bonus_credits - v_from_bonus, 0),
      credits_used_this_period = credits_used_this_period + v_balance.credits_remaining,
      updated_at = now()
    WHERE user_id = p_user_id;

    v_new_remaining := 0;
  END IF;

  INSERT INTO credit_transactions (
    user_id,
    transaction_type,
    credits_change,
    credits_before,
    credits_after,
    description,
    metadata,
    project_id,
    content_id
  ) VALUES (
    p_user_id,
    p_action_type,
    -p_credits,
    v_balance.credits_remaining,
    v_new_remaining,
    p_description,
    p_metadata,
    p_project_id,
    p_content_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'credits_consumed', p_credits,
    'credits_remaining', v_new_remaining,
    'bonus_credits', GREATEST(v_balance.bonus_credits - v_from_bonus, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public;

-- Restrict to service_role (same grants as 023).
REVOKE ALL ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID)
  TO service_role;
