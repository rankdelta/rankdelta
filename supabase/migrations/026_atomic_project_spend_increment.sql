-- 026_atomic_project_spend_increment.sql
--
-- Atomic per-project spend accounting. A read-modify-write in the Edge Functions
-- (read api_spend_cents_period, make the paid call, write back the JS-computed total) lets
-- two concurrent requests overwrite each other's increment, under-counting spend and letting
-- the monthly cap be exceeded.
--
-- record_project_spend checks the cap and increments inside one transaction with a row
-- lock (FOR UPDATE). Edge Functions call it instead of read+update.
--
-- Signature: record_project_spend(p_project_id UUID, p_cost_cents INT, p_cap_cents INT | NULL)
-- RETURNS JSONB: { allowed: bool, reason?: text, new_spend: int }
-- If p_cap_cents IS NOT NULL and the new total would exceed it, nothing is written and
-- allowed=false. Callers still run their own optimistic pre-check; this is the
-- authoritative guard.
--
-- SECURITY DEFINER with pinned search_path (pattern 017). Restricted to service_role.

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
BEGIN
  IF p_cost_cents IS NULL OR p_cost_cents < 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_cost', 'new_spend', NULL);
  END IF;

  -- Row lock: serializes increments per project.
  SELECT api_spend_cents_period INTO v_current
  FROM projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'project_not_found', 'new_spend', NULL);
  END IF;

  v_new := COALESCE(v_current, 0) + p_cost_cents;

  IF p_cap_cents IS NOT NULL AND v_new > p_cap_cents THEN
    -- No write: the cap would be exceeded. The counter stays consistent and the caller
    -- knows to stop.
    RETURN jsonb_build_object('allowed', false, 'reason', 'cap_exceeded', 'new_spend', v_current);
  END IF;

  UPDATE projects
  SET api_spend_cents_period = v_new
  WHERE id = p_project_id;

  RETURN jsonb_build_object('allowed', true, 'new_spend', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.record_project_spend(UUID, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_project_spend(UUID, INT, INT) TO service_role;
