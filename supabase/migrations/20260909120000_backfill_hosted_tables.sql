-- 20260909120000_backfill_hosted_tables.sql
-- Tables the app uses that the hosted database received outside this migration set: Search
-- Console storage, API keys, the store/CMS connector tables, the white-label API tables and the
-- integration logs. Reconstructed from the hosted schema (columns, keys, indexes, RLS, policies,
-- grants) so a fresh self-hosted database matches it. Everything is guarded (IF NOT EXISTS /
-- existence checks), so it is a no-op where the objects already exist.

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text DEFAULT 'Default'::text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.connector_api_keys (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  name text DEFAULT 'Personal'::text NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.connector_shops (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  platform text DEFAULT 'prestashop'::text NOT NULL,
  shop_url text NOT NULL,
  shop_name text,
  prestashop_version text,
  module_version text,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_catalog_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (user_id, shop_url)
);

CREATE TABLE IF NOT EXISTS public.connector_catalog_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.connector_shops(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  name text,
  url text,
  meta_title text,
  meta_description text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (shop_id, entity_type, external_id)
);

CREATE TABLE IF NOT EXISTS public.connector_link_codes (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.flagship_api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway_key_id text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  prefix text NOT NULL,
  label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.flagship_usage_invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_from timestamp with time zone NOT NULL,
  period_to timestamp with time zone NOT NULL,
  billed_usd numeric(12,6) DEFAULT 0 NOT NULL,
  currency text DEFAULT 'usd'::text NOT NULL,
  stripe_invoice_id text,
  stripe_invoice_item_id text,
  status text DEFAULT 'exported'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (user_id, period_from, period_to)
);

CREATE TABLE IF NOT EXISTS public.gsc_properties (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  permission_level text,
  connected_at timestamp with time zone DEFAULT now(),
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sync_revoked_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.gsc_oauth_tokens (
  project_id uuid NOT NULL PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  refresh_token text,
  google_email text,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  refresh_token_secret_id uuid,
  CONSTRAINT gsc_oauth_tokens_token_present CHECK (refresh_token IS NOT NULL OR refresh_token_secret_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.gsc_analytics_cache (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  period_days integer DEFAULT 28 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  ctr numeric(5,4) DEFAULT 0 NOT NULL,
  avg_position numeric(6,2) DEFAULT 0 NOT NULL,
  top_queries jsonb,
  top_pages jsonb,
  daily_data jsonb,
  fetched_at timestamp with time zone DEFAULT now(),
  fetched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, period_days)
);

CREATE TABLE IF NOT EXISTS public.integration_events (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  website_id text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oauth_nonces (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  nonce text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval)
);

CREATE TABLE IF NOT EXISTS public.optimization_log (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_id text NOT NULL,
  optimization_type text NOT NULL,
  product_count integer NOT NULL,
  success_count integer NOT NULL,
  failed_count integer NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publish_destinations (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type = ANY (ARRAY['wordpress'::text, 'shopify'::text, 'prestashop'::text, 'squarespace'::text, 'other'::text])),
  external_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  unlinked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.squarespace_connections (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_id text NOT NULL,
  website_title text,
  website_url text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE (user_id, website_id)
);

CREATE TABLE IF NOT EXISTS public.webhook_log (
  id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
  webhook_id text NOT NULL UNIQUE,
  webhook_type text NOT NULL,
  website_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone
);

-- ── Indexes ─────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys USING btree (key_hash) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_connector_api_keys_hash ON public.connector_api_keys USING btree (key_hash);
CREATE INDEX IF NOT EXISTS idx_connector_api_keys_user ON public.connector_api_keys USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_connector_shops_user ON public.connector_shops USING btree (user_id);
CREATE INDEX IF NOT EXISTS flagship_api_keys_user_idx ON public.flagship_api_keys USING btree (user_id);
CREATE INDEX IF NOT EXISTS flagship_usage_invoices_user_idx ON public.flagship_usage_invoices USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_gsc_analytics_cache_fetched ON public.gsc_analytics_cache USING btree (fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_analytics_cache_project ON public.gsc_analytics_cache USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_gsc_properties_project ON public.gsc_properties USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_integration_events_created_at ON public.integration_events USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_integration_events_event_type ON public.integration_events USING btree (event_type);
CREATE INDEX IF NOT EXISTS idx_integration_events_user_id ON public.integration_events USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires_at ON public.oauth_nonces USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_nonces_nonce ON public.oauth_nonces USING btree (nonce);
CREATE INDEX IF NOT EXISTS idx_optimization_log_created_at ON public.optimization_log USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_optimization_log_user_id ON public.optimization_log USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_optimization_log_website_id ON public.optimization_log USING btree (website_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_destinations_active_external ON public.publish_destinations USING btree (type, external_id) WHERE (unlinked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_publish_destinations_project ON public.publish_destinations USING btree (project_id) WHERE (unlinked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_squarespace_connections_expires_at ON public.squarespace_connections USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_squarespace_connections_user_id ON public.squarespace_connections USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_squarespace_connections_website_id ON public.squarespace_connections USING btree (website_id);
CREATE INDEX IF NOT EXISTS idx_webhook_log_received_at ON public.webhook_log USING btree (received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_log_webhook_id ON public.webhook_log USING btree (webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_log_website_id ON public.webhook_log USING btree (website_id);

-- ── Row Level Security ──────────────────────────────────────────────────────────────────────
-- Tables without a policy are service_role-only (RLS on, no policy = no rows for anon/authenticated).

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flagship_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flagship_usage_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gsc_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optimization_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.squarespace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_log ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('api_keys', 'Users can view their own api keys', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('connector_api_keys', 'Users can view own connector_api_keys', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('connector_api_keys', 'connector_keys_delete', 'DELETE', 'public', '(auth.uid() = user_id)', NULL),
    ('connector_api_keys', 'connector_keys_insert', 'INSERT', 'public', NULL, '(auth.uid() = user_id)'),
    ('connector_api_keys', 'connector_keys_select', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('connector_api_keys', 'connector_keys_update', 'UPDATE', 'public', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
    ('connector_catalog_items', 'connector_catalog_select', 'SELECT', 'public', '(EXISTS (SELECT 1 FROM public.connector_shops s WHERE s.id = connector_catalog_items.shop_id AND s.user_id = auth.uid()))', NULL),
    ('connector_shops', 'connector_shops_select', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('flagship_api_keys', 'users select own flagship keys', 'SELECT', 'authenticated', '(auth.uid() = user_id)', NULL),
    ('flagship_usage_invoices', 'users select own flagship invoices', 'SELECT', 'authenticated', '(auth.uid() = user_id)', NULL),
    ('gsc_analytics_cache', 'gsc_analytics_select', 'SELECT', 'authenticated', '(EXISTS (SELECT 1 FROM public.projects WHERE projects.id = gsc_analytics_cache.project_id AND projects.user_id = auth.uid()))', NULL),
    ('gsc_properties', 'gsc_properties_select', 'SELECT', 'authenticated', '(EXISTS (SELECT 1 FROM public.projects WHERE projects.id = gsc_properties.project_id AND projects.user_id = auth.uid()))', NULL),
    ('integration_events', 'Users can view own integration events', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('optimization_log', 'Users can view own optimization logs', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('publish_destinations', 'Users can view own publish_destinations', 'SELECT', 'public', '(auth.uid() = user_id)', NULL),
    ('squarespace_connections', 'Users can delete own squarespace connections', 'DELETE', 'public', '(auth.uid() = user_id)', NULL),
    ('squarespace_connections', 'Users can insert own squarespace connections', 'INSERT', 'public', NULL, '(auth.uid() = user_id)'),
    ('squarespace_connections', 'Users can update own squarespace connections', 'UPDATE', 'authenticated', '(auth.uid() = user_id)', '(auth.uid() = user_id)'),
    ('squarespace_connections', 'Users can view own squarespace connections', 'SELECT', 'public', '(auth.uid() = user_id)', NULL)
  ) AS v(tbl, name, cmd, role, qual, check_expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = p.tbl AND policyname = p.name) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO %s%s%s', p.name, p.tbl, p.cmd, p.role,
        CASE WHEN p.qual IS NOT NULL THEN ' USING ' || p.qual ELSE '' END,
        CASE WHEN p.check_expr IS NOT NULL THEN ' WITH CHECK ' || p.check_expr ELSE '' END);
    END IF;
  END LOOP;
END $$;

-- ── Grants tightened beyond the defaults ────────────────────────────────────────────────────
-- OAuth refresh tokens: service_role only. Search Console data: read-only for signed-in owners.
-- Squarespace: owners may read the non-secret columns and delete a connection.

REVOKE ALL ON public.gsc_oauth_tokens FROM anon, authenticated;
REVOKE ALL ON public.gsc_properties FROM anon, authenticated;
GRANT SELECT ON public.gsc_properties TO authenticated;
REVOKE ALL ON public.gsc_analytics_cache FROM anon, authenticated;
GRANT SELECT ON public.gsc_analytics_cache TO authenticated;
REVOKE ALL ON public.squarespace_connections FROM anon, authenticated;
GRANT DELETE ON public.squarespace_connections TO authenticated;
GRANT SELECT (id, user_id, website_id, website_title, website_url, scope, expires_at, created_at, updated_at)
  ON public.squarespace_connections TO authenticated;

-- ── Triggers ────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_publish_destination_reown()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'publish_destinations.user_id is immutable (cross-tenant re-own blocked)';
  END IF;
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_publish_destination_reown') THEN
    CREATE TRIGGER trg_prevent_publish_destination_reown BEFORE UPDATE ON public.publish_destinations
      FOR EACH ROW EXECUTE FUNCTION public.prevent_publish_destination_reown();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_squarespace_connections_updated_at') THEN
    CREATE TRIGGER update_squarespace_connections_updated_at BEFORE UPDATE ON public.squarespace_connections
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
