-- Internal (owner/dogfood) accounts: skip research lookup quota; higher monthly API cap (~€200).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_is_internal
  ON subscriptions (is_internal)
  WHERE is_internal = true;

COMMENT ON COLUMN subscriptions.is_internal IS
  'When true, research lookup quota is skipped and the monthly API hard cap is raised to ~€200 (still enforced).';

-- Operators mark internal accounts manually, e.g. (example only):
--   UPDATE subscriptions SET is_internal = true WHERE user_id = '<uuid>';
