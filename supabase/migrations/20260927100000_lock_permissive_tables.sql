-- 20260927100000_lock_permissive_tables.sql
--
-- Closes write access that was open to anyone, found by the Supabase security advisor and a
-- policy audit on 27/09/26. No data was exposed: every table below was empty.
--
-- 1. optimization_log: an INSERT policy "Service role can insert optimization logs" applied to
--    every role WITH CHECK (true), so anyone holding the public anon key could insert rows. The
--    service role bypasses RLS anyway; the only writer (squarespace-optimize-products) inserts as
--    the signed-in user, so the rule becomes "users insert their own rows".
-- 2. seo_explorer_cache: no code reads or writes it; signed-in users could insert and overwrite
--    any row. Access is removed (the table stays; reversible with GRANT).
-- 3. Legacy device-auth tables from an earlier app (user_profiles, reading_progress,
--    saved_insights, daily_progress, user_achievements, quiz_results, bookmarks): no code uses
--    them, and user_profiles accepted inserts from anyone. Access is removed; the tables stay.
--
-- Each statement runs only when the object exists (none of these exist on a fresh install except
-- optimization_log). Idempotent.

DO $$
BEGIN
  IF to_regclass('public.optimization_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role can insert optimization logs" ON public.optimization_log;
    DROP POLICY IF EXISTS "Users can insert own optimization logs" ON public.optimization_log;
    CREATE POLICY "Users can insert own optimization logs" ON public.optimization_log
      FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
    REVOKE INSERT, UPDATE, DELETE ON public.optimization_log FROM anon;
  END IF;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'seo_explorer_cache',
    'user_profiles', 'reading_progress', 'saved_insights', 'daily_progress',
    'user_achievements', 'quiz_results', 'bookmarks'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
