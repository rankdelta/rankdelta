-- Idempotency for X Ads purchase (revenue) conversion — one event per subscription.
-- Client pay-now fires via browser pixel; trial first payment will fire server-side on invoice.paid.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS x_purchase_conversion_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN subscriptions.x_purchase_conversion_sent_at IS
  'When the X Ads purchase (revenue) conversion was sent for this subscription (server-side trial path, or future server dedup).';
