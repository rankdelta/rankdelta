-- 048_lock_dormant_device_auth_functions.sql
-- Restricts legacy device-id helper functions (sync_user_profile, get_user_id_from_device,
-- get_user_rank) to service_role. is_user_owner is left unchanged because RLS policies
-- reference it. Reversible with GRANT EXECUTE ... TO anon, authenticated.
-- Each statement runs only when the function exists (absent on a fresh self-hosted database).
-- Idempotent.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.sync_user_profile(text, text, text, text[], text[], text, integer, integer, integer, integer, integer, integer, boolean, date)',
    'public.get_user_id_from_device(text)',
    'public.get_user_rank(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;
