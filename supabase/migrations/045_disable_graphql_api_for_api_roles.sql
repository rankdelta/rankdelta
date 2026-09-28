-- 045_disable_graphql_api_for_api_roles.sql
-- Supabase security advisor: pg_graphql_anon_table_exposed / pg_graphql_authenticated_table_exposed
-- (170 warnings). Nothing in the app, the MCP or the edge functions uses GraphQL (grep: 0 hits),
-- so the /graphql/v1 endpoint is pure attack surface for the anon/authenticated API roles.
-- RLS still applies through GraphQL, this just removes the second query surface entirely.
-- Reversible: GRANT USAGE ON SCHEMA graphql_public TO anon, authenticated;
-- Idempotent. Human-applied via migration pipeline only.

REVOKE USAGE ON SCHEMA graphql_public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphql_public FROM anon, authenticated;
