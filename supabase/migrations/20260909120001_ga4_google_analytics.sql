-- 050_ga4_google_analytics.sql
-- Google Analytics 4 integration: property connections + analytics cache (mirrors GSC).

CREATE TABLE IF NOT EXISTS ga4_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  display_name TEXT,
  permission_level TEXT,
  connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_ga4_properties_project ON ga4_properties(project_id);

CREATE TABLE IF NOT EXISTS ga4_analytics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  period_days INTEGER NOT NULL DEFAULT 28,
  sessions INTEGER NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0,
  pageviews INTEGER NOT NULL DEFAULT 0,
  bounce_rate NUMERIC(5, 4) NOT NULL DEFAULT 0,
  top_pages JSONB,
  top_sources JSONB,
  daily_data JSONB,
  fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fetched_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(project_id, period_days),
  CONSTRAINT ga4_period_days_allowed CHECK (period_days IN (7, 28, 90))
);

CREATE INDEX IF NOT EXISTS idx_ga4_analytics_cache_project ON ga4_analytics_cache(project_id);
CREATE INDEX IF NOT EXISTS idx_ga4_analytics_cache_fetched ON ga4_analytics_cache(fetched_at DESC);

CREATE TABLE IF NOT EXISTS ga4_oauth_tokens (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  google_email TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE ga4_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY ga4_properties_select ON ga4_properties
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = ga4_properties.project_id
        AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY ga4_analytics_select ON ga4_analytics_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = ga4_analytics_cache.project_id
        AND projects.user_id = auth.uid()
    )
  );

REVOKE ALL ON ga4_properties FROM anon, authenticated;
GRANT SELECT ON ga4_properties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ga4_properties TO service_role;

REVOKE ALL ON ga4_analytics_cache FROM anon, authenticated;
GRANT SELECT ON ga4_analytics_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ga4_analytics_cache TO service_role;

REVOKE ALL ON ga4_oauth_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ga4_oauth_tokens TO service_role;

CREATE OR REPLACE FUNCTION purge_ga4_cache_on_disconnect() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM ga4_analytics_cache WHERE project_id = OLD.project_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_ga4_purge_on_disconnect ON ga4_properties;
CREATE TRIGGER trg_ga4_purge_on_disconnect
  AFTER DELETE ON ga4_properties
  FOR EACH ROW EXECUTE FUNCTION purge_ga4_cache_on_disconnect();

REVOKE ALL ON FUNCTION purge_ga4_cache_on_disconnect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_ga4_cache_on_disconnect() TO service_role;
