-- 028_revoke_initialize_user_subscription.sql
--
-- Restricts initialize_user_subscription() (SECURITY DEFINER, migration 009) to service_role.
-- It runs as the on_auth_user_created_subscription trigger, which is unaffected by EXECUTE
-- revokes; it should not be callable through the RPC endpoint.

REVOKE ALL ON FUNCTION public.initialize_user_subscription() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_user_subscription() FROM anon;
REVOKE ALL ON FUNCTION public.initialize_user_subscription() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_user_subscription() TO service_role;
