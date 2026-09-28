-- 043_stripe_webhook_hardening.sql
-- Security audit H3/M6: trial-credit idempotency + webhook event replay ledger.
-- H1: subscription_status gains 'unpaid' for Stripe unpaid subscriptions.

-- H1: map Stripe `unpaid` without coercing unknown statuses to active.
DO $$ BEGIN
  ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'unpaid';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- H3: atomic trial-credit grant guard (checkout.session.completed vs customer.subscription.created race).
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS trial_credits_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN subscriptions.trial_credits_granted_at IS
  'First time trial bonus credits were granted by stripe-webhook (idempotent; prevents double-grant on event races).';

-- M6: event-level replay idempotency — each Stripe event id is processed at most once.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_webhook_events IS
  'Stripe webhook event ledger. Service-role only (RLS on, no policies). Insert-first dedup in stripe-webhook.';
