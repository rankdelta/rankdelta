-- 047_lock_privileged_functions.sql
-- Restricts SECURITY DEFINER functions to service_role (Supabase advisor 0028/0029) and pins
-- mutable search_path (0011). Covers flagship_edge_config(), invoke_flagship_monthly_bill(),
-- get_active_squarespace_connection(uuid) and encrypt_wp_password / decrypt_wp_password.
-- Edge Functions use service_role; pg_cron runs as the owner.
-- Each statement runs only when the function exists: the flagship functions belong to the hosted
-- cloud and are absent on a fresh self-hosted database.
-- Idempotent.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.flagship_edge_config()',
    'public.invoke_flagship_monthly_bill()',
    'public.get_active_squarespace_connection(uuid)',
    'public.decrypt_wp_password(text)',
    'public.encrypt_wp_password(text)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;

  -- Pin search_path on the remaining mutable-search_path functions (0011).
  FOREACH fn IN ARRAY ARRAY[
    'public.decrypt_wp_password(text)',
    'public.encrypt_wp_password(text)',
    'public.get_active_squarespace_connection(uuid)',
    'public.delete_expired_oauth_nonces()',
    'public.prevent_publish_destination_reown()',
    'public.squarespace_token_needs_refresh(timestamp with time zone)',
    'public.update_updated_at_column()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
    END IF;
  END LOOP;
END $$;
