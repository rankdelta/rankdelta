-- 023_revoke_public_execute_credit_functions.sql
--
-- Restricts the SECURITY DEFINER credit functions from migration 009 to service_role.
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and PostgREST exposes
-- them through the `rpc` endpoint, so EXECUTE is revoked from PUBLIC, anon and
-- authenticated. Edge Functions call these functions with service_role and are unaffected.
--
-- NUMBERING: originally `021_revoke_...`; renumbered to 023 to avoid a collision with
-- `021_content_languages.sql` (022 was already taken). Same SQL, new name.

REVOKE ALL ON FUNCTION public.add_credits(UUID, INT, VARCHAR, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_subscription_credits(UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.setup_test_account(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_credits(UUID, INT, VARCHAR, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credits(UUID, VARCHAR, INT, TEXT, JSONB, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_subscription_credits(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.setup_test_account(TEXT) TO service_role;
