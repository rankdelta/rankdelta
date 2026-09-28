-- 027_wp_credentials_at_rest.sql
--
-- Hides wp_connections.app_password from clients. A WordPress Application Password grants
-- write access to the connected site, so it should only be readable by service_role.
--
-- 1. Column-level grants: revoke table-wide SELECT from authenticated, then grant SELECT on
--    every column except app_password. RLS still applies on top.
-- 2. Add a view `wp_connections_safe` exposing everything except the password, for client
--    reads.
--
-- Publishing reads the password server-side in the `wp-publish` Edge Function
-- (service_role) and performs Basic auth there.

-- 1) Column-level lockdown: authenticated users may no longer read app_password.
REVOKE SELECT ON TABLE public.wp_connections FROM authenticated;
GRANT SELECT (
  id, project_id, user_id, site_url, username,
  verified, verified_at, site_name, site_language, site_niche,
  created_at, updated_at
) ON public.wp_connections TO authenticated;
-- Keep INSERT/UPDATE working (the client saves new connections). Writing a column requires
-- no SELECT grant.
GRANT INSERT (project_id, user_id, site_url, username, app_password,
              site_language, site_niche, verified)
  ON public.wp_connections TO authenticated;
GRANT UPDATE (site_url, username, app_password, site_language, site_niche, verified, verified_at)
  ON public.wp_connections TO authenticated;

-- 2) Safe view for client reads. security_invoker=true makes RLS apply to the caller
--    (views otherwise run with view-owner privileges).
CREATE OR REPLACE VIEW public.wp_connections_safe
  WITH (security_invoker = true) AS
SELECT
  id, project_id, user_id, site_url, username,
  verified, verified_at, site_name, site_language, site_niche,
  created_at, updated_at
FROM public.wp_connections;

COMMENT ON VIEW public.wp_connections_safe IS
  'wp_connections without app_password — the only surface clients should read.';
