-- Restricts client writes on billing and shared-cache tables to service_role.
--
-- 1. subscriptions: drop the client UPDATE policy. Plan/status changes come from Stripe
--    webhooks (service_role). SELECT stays.
-- 2. keyword_metrics: drop client INSERT/UPDATE policies on the shared cache. Reads stay;
--    writes go through seo-proxy (service_role bypasses RLS).

DROP POLICY IF EXISTS "Users can update their own subscription" ON subscriptions;

DROP POLICY IF EXISTS "auth insert keyword_metrics" ON keyword_metrics;
DROP POLICY IF EXISTS "auth update keyword_metrics" ON keyword_metrics;
