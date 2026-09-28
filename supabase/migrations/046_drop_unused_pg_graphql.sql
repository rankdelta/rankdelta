-- 046_drop_unused_pg_graphql.sql
-- The app, the hosted MCP and every edge function have zero GraphQL references, and the Supabase
-- advisor kept flagging all 86 tables as GraphQL-exposed even after 045 revoked schema usage.
-- Removing the extension closes /graphql/v1 entirely (REST + RLS are untouched).
-- Reversible: CREATE EXTENSION IF NOT EXISTS pg_graphql;
-- Idempotent. Human-applied via migration pipeline only.

DROP EXTENSION IF EXISTS pg_graphql;
