-- Append-only history of site-health audits, so users can SEE their SEO+GEO health improve over time
-- after acting on the diagnosis (the "track your results" proof of the closed loop). site_audits keeps
-- the single latest result (one row per project); this table keeps a compact score snapshot per run.
CREATE TABLE IF NOT EXISTS site_audit_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  composite     INT NOT NULL,
  technical     INT,
  geo_structure INT,
  geo_content   INT,
  weak_pages    INT,
  pages_audited INT,
  audited_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_audit_history_lookup ON site_audit_history (project_id, audited_at DESC);

ALTER TABLE site_audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own site_audit_history"
  ON site_audit_history FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Seed one history point per project from the current stored audit, so the trend has a starting value
-- immediately (the next re-audit produces the second point and the progress line appears).
INSERT INTO site_audit_history (project_id, composite, technical, geo_structure, geo_content, weak_pages, pages_audited, audited_at)
SELECT
  project_id,
  COALESCE((result->>'compositeHealth')::int, (result->>'healthScore')::int, 0),
  (result->>'technicalScore')::int,
  (result->>'geoReadinessScore')::int,
  (result->>'freshnessScore')::int,
  (result->>'weakPageCount')::int,
  (result->>'pagesAudited')::int,
  audited_at
FROM site_audits
ON CONFLICT DO NOTHING;
