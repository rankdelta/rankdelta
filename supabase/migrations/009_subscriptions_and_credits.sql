-- =============================================================================
-- AstroSEO.ai Subscription & Credit System
-- Migration 009: Complete subscription management with Stripe integration
-- =============================================================================

-- Subscription Plans Enum
DO $$ BEGIN
  CREATE TYPE subscription_plan AS ENUM ('free', 'starter', 'growth', 'pro', 'agency');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Subscription Status Enum
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'past_due', 'trialing', 'paused', 'incomplete');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- SUBSCRIPTIONS TABLE
-- Tracks user subscription state, synced with Stripe
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- Stripe IDs
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  stripe_price_id VARCHAR(255),
  
  -- Plan Info
  plan subscription_plan NOT NULL DEFAULT 'free',
  status subscription_status NOT NULL DEFAULT 'active',
  
  -- Billing Cycle
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMP WITH TIME ZONE,
  
  -- Trial
  trial_start TIMESTAMP WITH TIME ZONE,
  trial_end TIMESTAMP WITH TIME ZONE,
  
  -- Limits based on plan
  max_projects INT NOT NULL DEFAULT 1,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================================================
-- CREDIT BALANCES TABLE
-- Tracks current and historical credit balances per user
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- Current Balance
  credits_remaining INT NOT NULL DEFAULT 0,
  credits_used_this_period INT NOT NULL DEFAULT 0,
  
  -- Monthly Allocation (from plan)
  monthly_credits INT NOT NULL DEFAULT 0,
  
  -- Bonus/Promotional Credits (don't expire with period)
  bonus_credits INT NOT NULL DEFAULT 0,
  
  -- Period Tracking
  period_start TIMESTAMP WITH TIME ZONE DEFAULT now(),
  period_end TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================================================
-- CREDIT TRANSACTIONS TABLE
-- Detailed log of all credit operations (audit trail)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Transaction Details
  transaction_type VARCHAR(50) NOT NULL CHECK (
    transaction_type IN (
      'subscription_reset',    -- Monthly reset from subscription
      'content_generation',    -- Content creation
      'perplexity_research',   -- Perplexity API call
      'perplexity_factcheck',  -- Fact-checking call
      'serp_analysis',         -- DataforSEO SERP
      'keyword_research',      -- DataforSEO keywords
      'rank_tracking',         -- Rank check
      'topical_map',           -- Topical map generation
      'content_refresh',       -- Content update/refresh
      'bonus_credit',          -- Promotional/bonus credits
      'refund',                -- Credit refund
      'admin_adjustment'       -- Manual admin adjustment
    )
  ),
  
  -- Credit Change (negative = consumption, positive = addition)
  credits_change INT NOT NULL,
  credits_before INT NOT NULL,
  credits_after INT NOT NULL,
  
  -- Context/Metadata
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Related entities (optional)
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================================================
-- PLAN CONFIGURATIONS TABLE
-- Stores plan details (can be updated without code changes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS plan_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Plan Identification
  plan subscription_plan NOT NULL UNIQUE,
  stripe_price_id VARCHAR(255),
  stripe_price_id_yearly VARCHAR(255),
  
  -- Pricing (in cents for precision)
  price_monthly_cents INT NOT NULL DEFAULT 0,
  price_yearly_cents INT,
  
  -- Limits
  monthly_credits INT NOT NULL DEFAULT 0,
  max_projects INT NOT NULL DEFAULT 1,
  
  -- Feature Flags
  features JSONB DEFAULT '{}'::jsonb,
  
  -- Display
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================================================
-- CREDIT COSTS TABLE
-- Configurable credit costs per action (allows easy adjustment)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credit_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Action Identification
  action_type VARCHAR(50) NOT NULL UNIQUE,
  
  -- Base Credit Cost
  base_credits INT NOT NULL,
  
  -- Multipliers (for variable costs like content length)
  -- e.g., content generation: base_credits + (words / words_per_credit)
  variable_unit VARCHAR(50), -- 'words', 'keywords', 'pages', etc.
  credits_per_unit FLOAT,
  min_credits INT,
  max_credits INT,
  
  -- Description for UI
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Active flag
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================================================
-- INSERT DEFAULT PLAN CONFIGURATIONS
-- GEO tracking is enabled on Pro and Agency plans only.
-- =============================================================================
INSERT INTO plan_configurations (plan, price_monthly_cents, price_yearly_cents, monthly_credits, max_projects, display_name, description, features)
VALUES
  -- Starter plan: single project, ~25 articles/month
  ('starter', 7900, 79000, 500, 1, 'Starter', 'Perfetto per blogger e piccoli siti web',
   '{"content_generation": true, "basic_seo": true, "perplexity_research": true, "rank_tracking": true, "topical_maps": true, "content_refresh": true, "gpt4o": true, "geo_tracking": false, "max_content_words": 3000, "articles_estimate": 25}'::jsonb),
  
  -- Growth plan: up to 3 projects, ~35 articles/month
  ('growth', 9900, 99000, 700, 3, 'Growth', 'Per freelancer e piccole agenzie con più clienti',
   '{"content_generation": true, "basic_seo": true, "perplexity_research": true, "rank_tracking": true, "topical_maps": true, "content_refresh": true, "gpt4o": true, "geo_tracking": false, "priority_support": true, "max_content_words": 4000, "articles_estimate": 35}'::jsonb),
  
  -- Pro plan: up to 10 projects, ~100 articles/month, 50 GEO queries/month
  ('pro', 29700, 297000, 2000, 10, 'Pro', 'Per agenzie e content marketer professionisti',
   '{"content_generation": true, "basic_seo": true, "perplexity_research": true, "rank_tracking": true, "topical_maps": true, "content_refresh": true, "gpt4o": true, "geo_tracking": true, "geo_queries_monthly": 50, "priority_support": true, "api_access": true, "white_label": false, "team_members": 3, "max_content_words": 5000, "articles_estimate": 100}'::jsonb),
  
  -- Agency plan: unlimited projects, ~400 articles/month, 200 GEO queries/month
  ('agency', 99700, 997000, 8000, -1, 'Agency', 'Potenziale illimitato per grandi agenzie',
   '{"content_generation": true, "basic_seo": true, "perplexity_research": true, "rank_tracking": true, "topical_maps": true, "content_refresh": true, "gpt4o": true, "geo_tracking": true, "geo_queries_monthly": 200, "priority_support": true, "api_access": true, "white_label": true, "dedicated_support": true, "team_members": -1, "max_content_words": -1, "articles_estimate": 400}'::jsonb)
ON CONFLICT (plan) DO UPDATE SET
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  monthly_credits = EXCLUDED.monthly_credits,
  max_projects = EXCLUDED.max_projects,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  updated_at = now();

-- =============================================================================
-- INSERT DEFAULT CREDIT COSTS
-- A full article pipeline (research + generation + fact-check) costs ~20 credits.
-- =============================================================================
INSERT INTO credit_costs (action_type, base_credits, variable_unit, credits_per_unit, min_credits, max_credits, display_name, description)
VALUES
  -- Content Generation (variable by word count)
  -- Base 8 + (words × 0.004) = 1000w→12, 2000w→16, 3000w→20
  ('content_generation', 8, 'words', 0.004, 10, 30, 'Generazione Contenuto', 
   'Generazione articolo AI con GPT-4o. Costo varia per lunghezza.'),
  
  -- Perplexity Research (included in full pipeline)
  ('perplexity_research', 2, NULL, NULL, NULL, NULL, 'Ricerca Perplexity', 
   'Ricerca pre-generazione per fatti verificati e fonti.'),
  
  -- Perplexity Fact-check
  ('perplexity_factcheck', 1, NULL, NULL, NULL, NULL, 'Fact-checking', 
   'Verifica post-generazione delle affermazioni.'),
  
  -- SERP Analysis
  ('serp_analysis', 1, NULL, NULL, NULL, NULL, 'Analisi SERP', 
   'Analisi risultati di ricerca per una keyword.'),
  
  -- Keyword Research (per batch of 10)
  ('keyword_research', 2, 'keywords', 0.2, 2, 15, 'Ricerca Keywords', 
   'Volume di ricerca e difficoltà per keywords.'),
  
  -- Rank Tracking (per keyword check)
  ('rank_tracking', 1, 'keywords', 0, 1, 30, 'Rank Tracking', 
   'Controlla posizione ranking per keywords.'),
  
  -- Topical Map Generation
  ('topical_map', 10, NULL, NULL, NULL, NULL, 'Mappa Topicale', 
   'Genera mappa topicale completa con cluster.'),
  
  -- Content Refresh (similar to generation but may reuse research)
  ('content_refresh', 6, 'words', 0.003, 10, 25, 'Aggiornamento Contenuto', 
   'Aggiorna e migliora contenuto esistente.'),
  
  -- GEO Tracking (only Pro+ plans) - DataforSEO LLM Mentions API
  -- 5 credits per query
  ('geo_tracking', 5, 'queries', 0, 5, 200, 'GEO Tracking', 
   'Traccia menzioni del brand nelle AI (ChatGPT, Claude, Gemini, Perplexity). Solo piani Pro+. Premium feature.')
ON CONFLICT (action_type) DO UPDATE SET
  base_credits = EXCLUDED.base_credits,
  variable_unit = EXCLUDED.variable_unit,
  credits_per_unit = EXCLUDED.credits_per_unit,
  min_credits = EXCLUDED.min_credits,
  max_credits = EXCLUDED.max_credits,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  updated_at = now();

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_credit_balances_user_id ON credit_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_balances_period_end ON credit_balances(period_end);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_costs ENABLE ROW LEVEL SECURITY;

-- Subscriptions: Users can only see their own
DROP POLICY IF EXISTS "Users can view their own subscription" ON subscriptions;
CREATE POLICY "Users can view their own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own subscription" ON subscriptions;
CREATE POLICY "Users can update their own subscription"
  ON subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

-- Credit Balances: Users can only see their own
DROP POLICY IF EXISTS "Users can view their own credit balance" ON credit_balances;
CREATE POLICY "Users can view their own credit balance"
  ON credit_balances FOR SELECT
  USING (auth.uid() = user_id);

-- Credit Transactions: Users can view their own
DROP POLICY IF EXISTS "Users can view their own transactions" ON credit_transactions;
CREATE POLICY "Users can view their own transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Plan Configurations: Public read
DROP POLICY IF EXISTS "Anyone can view plan configurations" ON plan_configurations;
CREATE POLICY "Anyone can view plan configurations"
  ON plan_configurations FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Credit Costs: Public read
DROP POLICY IF EXISTS "Anyone can view credit costs" ON credit_costs;
CREATE POLICY "Anyone can view credit costs"
  ON credit_costs FOR SELECT
  TO authenticated
  USING (is_active = true);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to initialize subscription and credits for new users
-- NO FREE PLAN: Users start with 0 credits and must subscribe
CREATE OR REPLACE FUNCTION initialize_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  -- Create subscription in 'incomplete' status (no active plan yet)
  -- User must complete checkout to activate
  INSERT INTO subscriptions (user_id, plan, status, max_projects)
  VALUES (NEW.id, 'starter', 'incomplete', 1)
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Create credit balance with 0 credits
  -- Credits will be added when subscription is activated via Stripe webhook
  INSERT INTO credit_balances (
    user_id, 
    credits_remaining, 
    credits_used_this_period,
    monthly_credits, 
    bonus_credits,
    period_start, 
    period_end
  )
  VALUES (
    NEW.id,
    0,  -- No credits until subscription active
    0,
    0,  -- Will be set by webhook when plan activated
    0,
    now(),
    now() + interval '30 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create subscription on user signup
DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_user_subscription();

-- Function to consume credits (called from services)
CREATE OR REPLACE FUNCTION consume_credits(
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
  v_result JSONB;
BEGIN
  -- Get current balance with lock
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
  
  -- Check if enough credits (including bonus)
  IF (v_balance.credits_remaining + v_balance.bonus_credits) < p_credits THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'credits_required', p_credits,
      'credits_remaining', v_balance.credits_remaining,
      'bonus_credits', v_balance.bonus_credits
    );
  END IF;
  
  -- Consume from regular credits first, then bonus
  IF v_balance.credits_remaining >= p_credits THEN
    v_new_remaining := v_balance.credits_remaining - p_credits;
    
    UPDATE credit_balances
    SET 
      credits_remaining = v_new_remaining,
      credits_used_this_period = credits_used_this_period + p_credits,
      updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    -- Use remaining regular + some bonus
    DECLARE
      v_from_bonus INT := p_credits - v_balance.credits_remaining;
    BEGIN
      UPDATE credit_balances
      SET 
        credits_remaining = 0,
        bonus_credits = bonus_credits - v_from_bonus,
        credits_used_this_period = credits_used_this_period + v_balance.credits_remaining,
        updated_at = now()
      WHERE user_id = p_user_id;
      
      v_new_remaining := 0;
    END;
  END IF;
  
  -- Log transaction
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
    'bonus_credits', v_balance.bonus_credits - GREATEST(0, p_credits - v_balance.credits_remaining)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add credits (for subscription reset or bonus)
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_credits INT,
  p_transaction_type VARCHAR(50),
  p_description TEXT DEFAULT NULL,
  p_is_bonus BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  v_balance RECORD;
  v_new_remaining INT;
BEGIN
  -- Get current balance
  SELECT * INTO v_balance
  FROM credit_balances
  WHERE user_id = p_user_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No credit balance found for user'
    );
  END IF;
  
  IF p_is_bonus THEN
    UPDATE credit_balances
    SET 
      bonus_credits = bonus_credits + p_credits,
      updated_at = now()
    WHERE user_id = p_user_id;
    
    v_new_remaining := v_balance.credits_remaining;
  ELSE
    v_new_remaining := v_balance.credits_remaining + p_credits;
    
    UPDATE credit_balances
    SET 
      credits_remaining = v_new_remaining,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
  
  -- Log transaction
  INSERT INTO credit_transactions (
    user_id,
    transaction_type,
    credits_change,
    credits_before,
    credits_after,
    description
  ) VALUES (
    p_user_id,
    p_transaction_type,
    p_credits,
    v_balance.credits_remaining,
    v_new_remaining,
    p_description
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'credits_added', p_credits,
    'credits_remaining', v_new_remaining,
    'is_bonus', p_is_bonus
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reset credits on subscription renewal
CREATE OR REPLACE FUNCTION reset_subscription_credits(
  p_user_id UUID,
  p_new_period_start TIMESTAMP WITH TIME ZONE,
  p_new_period_end TIMESTAMP WITH TIME ZONE
) RETURNS JSONB AS $$
DECLARE
  v_subscription RECORD;
  v_plan_config RECORD;
  v_old_balance INT;
BEGIN
  -- Get subscription
  SELECT * INTO v_subscription
  FROM subscriptions
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Subscription not found');
  END IF;
  
  -- Get plan configuration
  SELECT * INTO v_plan_config
  FROM plan_configurations
  WHERE plan = v_subscription.plan;
  
  -- Get current balance for logging
  SELECT credits_remaining INTO v_old_balance
  FROM credit_balances
  WHERE user_id = p_user_id;
  
  -- Reset credits to monthly allocation
  UPDATE credit_balances
  SET 
    credits_remaining = v_plan_config.monthly_credits,
    credits_used_this_period = 0,
    monthly_credits = v_plan_config.monthly_credits,
    period_start = p_new_period_start,
    period_end = p_new_period_end,
    updated_at = now()
  WHERE user_id = p_user_id;
  
  -- Log the reset transaction
  INSERT INTO credit_transactions (
    user_id,
    transaction_type,
    credits_change,
    credits_before,
    credits_after,
    description
  ) VALUES (
    p_user_id,
    'subscription_reset',
    v_plan_config.monthly_credits,
    v_old_balance,
    v_plan_config.monthly_credits,
    'Monthly credit reset for ' || v_plan_config.display_name || ' plan'
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'new_credits', v_plan_config.monthly_credits,
    'plan', v_subscription.plan
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate credits for content generation
CREATE OR REPLACE FUNCTION calculate_content_credits(p_word_count INT)
RETURNS INT AS $$
DECLARE
  v_cost RECORD;
  v_credits INT;
BEGIN
  SELECT * INTO v_cost
  FROM credit_costs
  WHERE action_type = 'content_generation' AND is_active = true;
  
  IF NOT FOUND THEN
    RETURN 18; -- Default fallback
  END IF;
  
  -- Calculate: base + (words * credits_per_unit)
  v_credits := v_cost.base_credits + CEIL(p_word_count * COALESCE(v_cost.credits_per_unit, 0.008));
  
  -- Apply min/max limits
  IF v_cost.min_credits IS NOT NULL THEN
    v_credits := GREATEST(v_credits, v_cost.min_credits);
  END IF;
  
  IF v_cost.max_credits IS NOT NULL THEN
    v_credits := LEAST(v_credits, v_cost.max_credits);
  END IF;
  
  RETURN v_credits;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update timestamps
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_credit_balances_updated_at ON credit_balances;
CREATE TRIGGER update_credit_balances_updated_at
  BEFORE UPDATE ON credit_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- GRANT PERMISSIONS FOR SERVICE ROLE
-- These allow the backend/Edge Functions to call the credit functions
-- =============================================================================
GRANT EXECUTE ON FUNCTION consume_credits TO service_role;
GRANT EXECUTE ON FUNCTION add_credits TO service_role;
GRANT EXECUTE ON FUNCTION reset_subscription_credits TO service_role;
GRANT EXECUTE ON FUNCTION calculate_content_credits TO service_role;

-- Allow service_role to insert subscriptions/credits (for webhooks)
GRANT INSERT, UPDATE ON subscriptions TO service_role;
GRANT INSERT, UPDATE ON credit_balances TO service_role;
GRANT INSERT ON credit_transactions TO service_role;

-- =============================================================================
-- DEVELOPMENT HELPER: setup_test_account
-- Gives an existing local test user the Agency plan and a large credit balance.
-- Restricted to service_role (EXECUTE revoked from PUBLIC/anon/authenticated in 023).
-- =============================================================================
CREATE OR REPLACE FUNCTION setup_test_account(p_user_email TEXT DEFAULT 'test@test.com')
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = p_user_email;
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found. Please sign up with ' || p_user_email || ' first.',
      'email', p_user_email
    );
  END IF;
  
  -- Upgrade to Agency plan with full access
  INSERT INTO subscriptions (
    user_id, 
    plan, 
    status, 
    max_projects,
    current_period_start,
    current_period_end
  )
  VALUES (
    v_user_id,
    'agency',
    'active',
    -1,  -- Unlimited projects
    now(),
    now() + interval '1 year'  -- 1 year access
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan = 'agency',
    status = 'active',
    max_projects = -1,
    current_period_start = now(),
    current_period_end = now() + interval '1 year',
    updated_at = now();
  
  -- Give unlimited credits (99999)
  INSERT INTO credit_balances (
    user_id,
    credits_remaining,
    credits_used_this_period,
    monthly_credits,
    bonus_credits,
    period_start,
    period_end
  )
  VALUES (
    v_user_id,
    99999,
    0,
    99999,
    0,
    now(),
    now() + interval '1 year'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    credits_remaining = 99999,
    credits_used_this_period = 0,
    monthly_credits = 99999,
    period_start = now(),
    period_end = now() + interval '1 year',
    updated_at = now();
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Test account setup complete with Agency plan + unlimited credits',
    'user_id', v_user_id,
    'email', p_user_email,
    'plan', 'agency',
    'credits', 99999,
    'features', jsonb_build_object(
      'content_generation', true,
      'perplexity_research', true,
      'geo_tracking', true,
      'rank_tracking', true,
      'topical_maps', true,
      'content_refresh', true,
      'api_access', true,
      'white_label', true,
      'unlimited_projects', true
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION setup_test_account TO service_role;

-- Comment explaining how to use
COMMENT ON FUNCTION setup_test_account IS 
'Sets up test account with full Agency access. 
Usage: SELECT setup_test_account(''test@test.com'');
Run this after the user signs up with test@test.com';

