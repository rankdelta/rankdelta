-- 019_pricing_tiers_and_research_quota.sql
-- Plan tiers ($29 / $59 / $99; agency unchanged) with per-plan feature limits and a
-- server-enforced monthly research-lookup quota.
--
-- DEPLOY ORDER (cloud): this migration NULLs the Stripe price ids of the previous amounts so
-- checkout cannot charge an old price. Create the new Prices in Stripe (29/59/99 monthly +
-- 276/564/948 yearly) and write their ids into plan_configurations before deploying the
-- matching pricing page. Existing subscriptions keep their Stripe prices; nothing here touches
-- live subscriptions.

-- 1. Per-plan feature limits (NULL = unlimited / not enforced — e.g. agency, self-host).
ALTER TABLE plan_configurations
  ADD COLUMN IF NOT EXISTS research_lookups_monthly INT,
  ADD COLUMN IF NOT EXISTS account_hard_cap_cents INT,
  ADD COLUMN IF NOT EXISTS visibility_prompts INT,
  ADD COLUMN IF NOT EXISTS visibility_engines INT,
  ADD COLUMN IF NOT EXISTS visibility_checks_monthly INT,
  ADD COLUMN IF NOT EXISTS rank_keywords INT,
  ADD COLUMN IF NOT EXISTS articles_monthly INT;

-- 2. New tier prices + limits. Content is EXCLUDED from Starter (tools-first positioning).
UPDATE plan_configurations SET
  price_monthly_cents = 2900, price_yearly_cents = 27600,
  monthly_credits = 0,
  stripe_price_id = NULL, stripe_price_id_yearly = NULL,
  research_lookups_monthly = 100, account_hard_cap_cents = 1200, visibility_prompts = 10, visibility_engines = 1,
  visibility_checks_monthly = 10, rank_keywords = 50, articles_monthly = 0,
  updated_at = now()
WHERE plan = 'starter';

UPDATE plan_configurations SET
  price_monthly_cents = 5900, price_yearly_cents = 56400,
  monthly_credits = 500,
  stripe_price_id = NULL, stripe_price_id_yearly = NULL,
  research_lookups_monthly = 300, account_hard_cap_cents = 2400, visibility_prompts = 20, visibility_engines = 2,
  visibility_checks_monthly = 80, rank_keywords = 100, articles_monthly = 10,
  updated_at = now()
WHERE plan = 'growth';

UPDATE plan_configurations SET
  price_monthly_cents = 9900, price_yearly_cents = 94800,
  monthly_credits = 2000,
  stripe_price_id = NULL, stripe_price_id_yearly = NULL,
  research_lookups_monthly = 750, account_hard_cap_cents = 4000, visibility_prompts = 30, visibility_engines = 2,
  visibility_checks_monthly = 120, rank_keywords = 250, articles_monthly = 15,
  updated_at = now()
WHERE plan = 'pro';
-- agency: prices unchanged; limits stay NULL (unlimited; hard cap falls back to the global €50).
-- account_hard_cap_cents bounds monthly API spend per account and scales with the plan
-- ($12 / $24 / $40).

-- 3. Research-lookup quota, enforced server-side in seo-proxy. Own small ledger table
--    (service-role only; RLS on, no policies).
CREATE TABLE IF NOT EXISTS research_lookup_ledger (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period_month DATE NOT NULL,
  lookup_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (user_id, period_month)
);
ALTER TABLE research_lookup_ledger ENABLE ROW LEVEL SECURITY;

-- Atomically check the monthly lookup quota and, if there is room, count this lookup.
-- allowed=false leaves the counter unchanged (the call must be refused).
CREATE OR REPLACE FUNCTION check_and_record_research_lookup(
  p_user_id UUID,
  p_cap INT
) RETURNS JSONB AS $$
DECLARE
  v_month DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_used INT;
BEGIN
  INSERT INTO research_lookup_ledger (user_id, period_month, lookup_count)
  VALUES (p_user_id, v_month, 0)
  ON CONFLICT (user_id, period_month) DO NOTHING;

  SELECT lookup_count INTO v_used
  FROM research_lookup_ledger
  WHERE user_id = p_user_id AND period_month = v_month
  FOR UPDATE;

  IF v_used >= p_cap THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'cap', p_cap);
  END IF;

  UPDATE research_lookup_ledger
  SET lookup_count = lookup_count + 1, updated_at = now()
  WHERE user_id = p_user_id AND period_month = v_month;

  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'cap', p_cap);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION check_and_record_research_lookup(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_and_record_research_lookup(UUID, INT) TO service_role;
