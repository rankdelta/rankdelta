-- Shared cache of Google search volume + keyword difficulty (public, slow-changing data).
-- Lets us hit DataForSEO at most ~once/month per keyword instead of per Piano view.
CREATE TABLE IF NOT EXISTS keyword_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword TEXT NOT NULL,
  location_code INT NOT NULL,
  language_code TEXT NOT NULL,
  volume INT NOT NULL DEFAULT 0,
  difficulty INT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (keyword, location_code, language_code)
);

CREATE INDEX IF NOT EXISTS idx_keyword_metrics_lookup ON keyword_metrics (location_code, language_code, keyword);

ALTER TABLE keyword_metrics ENABLE ROW LEVEL SECURITY;

-- Non-sensitive public keyword data shared across all workspaces: any authenticated user can read
-- the cache and populate it.
CREATE POLICY "auth read keyword_metrics" ON keyword_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert keyword_metrics" ON keyword_metrics FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update keyword_metrics" ON keyword_metrics FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
