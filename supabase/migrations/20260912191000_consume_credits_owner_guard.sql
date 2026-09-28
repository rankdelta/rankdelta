-- Bind consume_credits to auth.uid() for authenticated callers.
-- Live client RPC (src/services/credits.ts) still needs EXECUTE for authenticated;
-- GRANT authenticated WITH an owner check (defense in depth vs a leaked session
-- spending someone else's credits). Anon stays revoked. service_role is unchanged.

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
  IF auth.role() = 'anon' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not authorized'
    );
  END IF;

  IF auth.role() = 'authenticated' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not authorized'
    );
  END IF;

  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid credits amount',
      'credits_required', COALESCE(p_credits, 0)
    );
  END IF;

  IF p_credits > 1000000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credits amount exceeds maximum allowed',
      'credits_required', p_credits
    );
  END IF;

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

REVOKE ALL ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID)
  TO authenticated, service_role;
