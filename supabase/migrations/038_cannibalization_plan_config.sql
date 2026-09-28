-- Additive plan-tier hook for cannibalization analysis.
-- Default 100 keywords per check. Higher tiers can raise this later.
-- No billing logic — callers read the value and enforce the cap.

ALTER TABLE plan_configurations
  ADD COLUMN IF NOT EXISTS max_keywords_per_check INT NOT NULL DEFAULT 100;

ALTER TABLE plan_configurations
  DROP CONSTRAINT IF EXISTS plan_configurations_max_keywords_per_check_chk;

ALTER TABLE plan_configurations
  ADD CONSTRAINT plan_configurations_max_keywords_per_check_chk
  CHECK (max_keywords_per_check >= 1 AND max_keywords_per_check <= 10000);

COMMENT ON COLUMN plan_configurations.max_keywords_per_check IS
  'Max keywords considered per cannibalization check. Default analysis is stored rank snapshots only (no SERP cost).';
