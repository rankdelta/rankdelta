-- 017_security_search_path_hardening.sql
-- Pin search_path on all public functions flagged by the Supabase security advisor
-- (function_search_path_mutable). For SECURITY DEFINER functions this closes a real
-- privilege-escalation vector: without a fixed search_path a caller could shadow an
-- unqualified table/function name via their own schema and have it run with the
-- function owner's elevated privileges.
--
-- `SET search_path = public` keeps existing behavior (unqualified refs resolve to the
-- public schema; pg_catalog is always searched implicitly). Fully-qualified refs such
-- as auth.uid() keep working regardless.
--
-- NOT changed here (verified, intentional):
--   * keyword_metrics always-true write policies — it is a SHARED, non-sensitive cache
--     of public keyword volumes, written client-side by useKeywordMetrics.ts. Locking
--     writes to service_role would break the cache. Accepted low risk (cache only).
--   * user_profiles "Allow insert for everyone" — device-scoped anonymous profiles for
--     the pre-signup public AI-check funnel; SELECT/UPDATE/DELETE are already isolated
--     by device_id. INSERT-open is required for anonymous onboarding (lead-gen).
--   * "User" (0 rows) / "profiles" (legacy) RLS-enabled-no-policy — locked by default.
--   * Leaked-password protection (HaveIBeenPwned) — Auth dashboard toggle, not SQL.

ALTER FUNCTION public.add_credits(p_user_id uuid, p_credits integer, p_transaction_type character varying, p_description text, p_is_bonus boolean) SET search_path = public;
ALTER FUNCTION public.calculate_content_credits(p_word_count integer) SET search_path = public;
ALTER FUNCTION public.consume_credits(p_user_id uuid, p_action_type character varying, p_credits integer, p_description text, p_metadata jsonb, p_project_id uuid, p_content_id uuid) SET search_path = public;
ALTER FUNCTION public.initialize_user_subscription() SET search_path = public;
ALTER FUNCTION public.reset_subscription_credits(p_user_id uuid, p_new_period_start timestamp with time zone, p_new_period_end timestamp with time zone) SET search_path = public;
ALTER FUNCTION public.setup_test_account(p_user_email text) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.visibility_touch_updated_at() SET search_path = public;
