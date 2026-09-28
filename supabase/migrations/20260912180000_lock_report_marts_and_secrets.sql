-- 20260912180000_lock_report_marts_and_secrets.sql
-- Tightens PostgREST exposure and removes remaining client-write paths. Idempotent.
--
--  1. report_*_daily_mart: materialized views have no RLS, so restrict them to
--     service_role (advisor materialized_view_in_api). Rollups are served via
--     get_portfolio_rollup() (ownership-scoped) and report-build (service_role).
--  2. keyword_metrics: restricts writes to service_role (re-asserts 020). Drops client
--     write policies and write grants; reads stay, writes go through seo-proxy.
--  3. squarespace_connections: column-level grants hide access_token / refresh_token
--     from clients (same approach as WP app passwords in 027). The OAuth callback and
--     optimize-products use service_role.
--  4. client_reports.share_token: clients may only CLEAR a token (revoke share);
--     minting stays in report-build (service_role + CSPRNG).
--  5. projects_protect_server_columns: run on BEFORE INSERT OR UPDATE so server-owned
--     spend/lock columns are protected on insert as well.
--  6. Pin search_path on report_schedule_* (advisor function_search_path_mutable).
--  7. Revoke EXECUTE on Shopify trigger SECURITY DEFINER helpers from anon/authenticated
--     (they still run as triggers; they must not be RPC-callable).
--  8. Revoke leftover PUBLIC EXECUTE on calculate_content_credits.

-- ── 1. Report marts: service_role only ────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.report_geo_daily_mart') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.report_geo_daily_mart FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.report_geo_daily_mart TO service_role;
  END IF;
  IF to_regclass('public.report_ranking_daily_mart') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.report_ranking_daily_mart FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.report_ranking_daily_mart TO service_role;
  END IF;
END $$;

-- ── 2. keyword_metrics: no client writes ───────────────────────────────────────
DROP POLICY IF EXISTS "auth insert keyword_metrics" ON public.keyword_metrics;
DROP POLICY IF EXISTS "auth update keyword_metrics" ON public.keyword_metrics;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.keyword_metrics FROM anon, authenticated;
GRANT SELECT ON TABLE public.keyword_metrics TO authenticated;

-- ── 3. Squarespace OAuth tokens unreadable by clients ─────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.squarespace_connections') IS NULL THEN
    RETURN;
  END IF;

  REVOKE ALL ON TABLE public.squarespace_connections FROM anon, authenticated;

  -- Disconnect from the app still needs DELETE of the caller's own row (RLS).
  GRANT DELETE ON TABLE public.squarespace_connections TO authenticated;
  GRANT SELECT (
    id, user_id, website_id, website_title, website_url,
    scope, expires_at, created_at, updated_at
  ) ON public.squarespace_connections TO authenticated;

  DROP POLICY IF EXISTS "Users can update own squarespace connections" ON public.squarespace_connections;
  CREATE POLICY "Users can update own squarespace connections"
    ON public.squarespace_connections FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

  CREATE OR REPLACE VIEW public.squarespace_connections_safe
    WITH (security_invoker = true) AS
  SELECT
    id, user_id, website_id, website_title, website_url,
    scope, expires_at, created_at, updated_at
  FROM public.squarespace_connections;

  EXECUTE $c$COMMENT ON VIEW public.squarespace_connections_safe IS
    'squarespace_connections without OAuth tokens — the only surface clients should read.'$c$;
END $$;

-- ── 4. share_token: clients may clear, never set ────────────────────────────
CREATE OR REPLACE FUNCTION public.client_reports_protect_share_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_role IN ('service_role', '') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.share_token := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: allow revoke (NULL) only; keep the previous token otherwise.
  IF NEW.share_token IS DISTINCT FROM OLD.share_token AND NEW.share_token IS NOT NULL THEN
    NEW.share_token := OLD.share_token;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.client_reports') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS trg_client_reports_protect_share_token ON public.client_reports;
  CREATE TRIGGER trg_client_reports_protect_share_token
    BEFORE INSERT OR UPDATE ON public.client_reports
    FOR EACH ROW EXECUTE FUNCTION public.client_reports_protect_share_token();
END $$;

REVOKE ALL ON FUNCTION public.client_reports_protect_share_token() FROM PUBLIC, anon, authenticated;

-- ── 5. projects: protect server columns on INSERT too ─────────────────────────
CREATE OR REPLACE FUNCTION public.projects_protect_server_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF v_role IN ('service_role', '') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.api_spend_cents_period := 0;
    NEW.api_spend_period_start := COALESCE(NEW.api_spend_period_start, now());
    NEW.visibility_scan_lock_at := NULL;
    NEW.visibility_scheduled_last_at := NULL;
  ELSE
    NEW.api_spend_cents_period := OLD.api_spend_cents_period;
    NEW.api_spend_period_start := OLD.api_spend_period_start;
    NEW.visibility_scan_lock_at := OLD.visibility_scan_lock_at;
    NEW.visibility_scheduled_last_at := OLD.visibility_scheduled_last_at;
  END IF;

  IF NEW.monthly_api_spend_cap_cents IS NOT NULL THEN
    NEW.monthly_api_spend_cap_cents := least(greatest(NEW.monthly_api_spend_cap_cents, 0), 20000);
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'api_spend_cents_period')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'visibility_scan_lock_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'visibility_scheduled_last_at')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'monthly_api_spend_cap_cents') THEN
    DROP TRIGGER IF EXISTS trg_projects_protect_server_columns ON public.projects;
    CREATE TRIGGER trg_projects_protect_server_columns
      BEFORE INSERT OR UPDATE ON public.projects
      FOR EACH ROW EXECUTE FUNCTION public.projects_protect_server_columns();
  END IF;
END $$;

-- ── 6. search_path on schedule helpers ───────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'report_schedule_is_due'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.report_schedule_is_due(text, integer, integer, timestamptz, date) SET search_path = public';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'report_schedule_next_run'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.report_schedule_next_run(text, integer, integer, date) SET search_path = public';
  END IF;
END $$;

-- ── 7. Shopify trigger helpers: not RPC-callable ────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'guard_shopify_wp_connection_writes',
        'guard_shopify_destination_writes',
        'guard_shopify_squarespace_connection_writes',
        'guard_shopify_project_writes',
        'guard_shopify_connector_shop_writes',
        'guard_shopify_shop_domain_writes',
        'strip_non_shopify_cms_on_shopify_handshake',
        'sync_shopify_shop_domain_from_destination'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
  END LOOP;
END $$;

-- ── 8. calculate_content_credits is not a client RPC ──────────────────────────
REVOKE ALL ON FUNCTION public.calculate_content_credits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_content_credits(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
