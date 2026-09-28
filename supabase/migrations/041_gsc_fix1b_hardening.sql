-- 041_gsc_fix1b_hardening.sql
-- GSC FIX-1(b) from Wave J (#67): additive hardening over existing gsc_properties / gsc_analytics_cache.
--
-- 1. verified default false: explicit column until gsc-connect confirms server-side (MCP filters verified=true).
-- 2. period_days clamp: CHECK (period_days IN (7, 28, 90)) on cache UNIQUE(project_id, period_days).
-- 3. delete-on-disconnect: purge gsc_analytics_cache when the property row is removed.
--
-- Idempotent: safe to re-run. Skips when GSC tables are not yet provisioned.

DO $$
BEGIN
  IF to_regclass('public.gsc_properties') IS NULL THEN
    RAISE NOTICE 'gsc_properties missing — skipping 041_gsc_fix1b_hardening';
    RETURN;
  END IF;

  ALTER TABLE gsc_properties ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
END $$;

DO $$
BEGIN
  IF to_regclass('public.gsc_analytics_cache') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE gsc_analytics_cache DROP CONSTRAINT IF EXISTS gsc_period_days_allowed;
  ALTER TABLE gsc_analytics_cache ADD CONSTRAINT gsc_period_days_allowed
    CHECK (period_days IN (7, 28, 90));

  DELETE FROM gsc_analytics_cache WHERE period_days NOT IN (7, 28, 90);
END $$;

CREATE OR REPLACE FUNCTION purge_gsc_cache_on_disconnect() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM gsc_analytics_cache WHERE project_id = OLD.project_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF to_regclass('public.gsc_properties') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_gsc_purge_on_disconnect ON gsc_properties;
  CREATE TRIGGER trg_gsc_purge_on_disconnect
    AFTER DELETE ON gsc_properties
    FOR EACH ROW EXECUTE FUNCTION purge_gsc_cache_on_disconnect();
END $$;

REVOKE ALL ON FUNCTION purge_gsc_cache_on_disconnect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_gsc_cache_on_disconnect() TO service_role;
