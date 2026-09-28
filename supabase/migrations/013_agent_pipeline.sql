-- ============================================================
-- Migration 013: Rankdelta Autonomous Agent Pipeline
-- ============================================================
-- Adds tables for:
--   wp_connections   — WordPress site credentials (encrypted)
--   agent_runs       — Log of each agent stage execution
--   site_audits      — Cached audit results per project
--   content_plan     — Planned articles schedule
--   agent_activity   — Owner-facing activity feed
-- ============================================================

-- WordPress site connections
CREATE TABLE IF NOT EXISTS wp_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url      TEXT NOT NULL,
  username      TEXT NOT NULL,
  app_password  TEXT NOT NULL, -- stored encrypted via Supabase vault in production
  verified      BOOLEAN DEFAULT false,
  verified_at   TIMESTAMPTZ,
  site_name     TEXT,
  site_language TEXT DEFAULT 'it',
  site_niche    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE wp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own wp_connections"
  ON wp_connections FOR ALL
  USING (auth.uid() = user_id);

-- Agent run log (one row per stage execution)
CREATE TABLE IF NOT EXISTS agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('audit','plan','research','write','publish','monitor')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','completed','failed','awaiting_approval')),
  input         JSONB DEFAULT '{}',
  output        JSONB,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cost_cents    INTEGER DEFAULT 0,   -- EUR cents spent on this run
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_runs_project ON agent_runs(project_id, created_at DESC);
CREATE INDEX idx_agent_runs_status  ON agent_runs(project_id, status);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own agent_runs"
  ON agent_runs FOR SELECT
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Cached site audits (refreshed max once per 7 days)
CREATE TABLE IF NOT EXISTS site_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  result        JSONB NOT NULL,
  audited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own site_audits"
  ON site_audits FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Content plan (articles to write, scheduled)
CREATE TABLE IF NOT EXISTS content_plan (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword          TEXT NOT NULL,
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL,
  intent           TEXT DEFAULT 'informational',
  estimated_volume INTEGER DEFAULT 0,
  difficulty       INTEGER DEFAULT 50,
  scheduled_for    TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','in_progress','completed','failed')),
  wp_post_id       INTEGER,
  wp_post_url      TEXT,
  word_count       INTEGER,
  seo_score        INTEGER,
  geo_score        INTEGER,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_plan_project_status ON content_plan(project_id, status, scheduled_for);

ALTER TABLE content_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own content_plan"
  ON content_plan FOR ALL
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- Owner-facing activity feed (simple, non-technical)
CREATE TABLE IF NOT EXISTS agent_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'article_published','geo_mention','ranking_improved',
                'audit_completed','plan_created','error'
              )),
  description TEXT NOT NULL,
  url         TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_activity_project ON agent_activity(project_id, created_at DESC);

ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own activity"
  ON agent_activity FOR SELECT
  USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ── HELPER VIEWS ──────────────────────────────────────────────────────────────

-- Owner dashboard view: key metrics per project
CREATE OR REPLACE VIEW project_dashboard_summary AS
SELECT
  p.id                                          AS project_id,
  p.name                                        AS site_name,
  p.website_url                                 AS site_url,
  COUNT(DISTINCT cp.id) FILTER (WHERE cp.status = 'completed') AS articles_published,
  COUNT(DISTINCT cp.id) FILTER (WHERE cp.status = 'planned')   AS articles_planned,
  AVG(cp.seo_score) FILTER (WHERE cp.seo_score IS NOT NULL)    AS avg_seo_score,
  AVG(cp.geo_score) FILTER (WHERE cp.geo_score IS NOT NULL)    AS avg_geo_score,
  MAX(cp.updated_at) FILTER (WHERE cp.status = 'completed')    AS last_published_at,
  MIN(cp.scheduled_for) FILTER (WHERE cp.status = 'planned')   AS next_scheduled_at,
  COALESCE(SUM(ar.cost_cents), 0)                              AS total_cost_cents
FROM projects p
LEFT JOIN content_plan cp ON cp.project_id = p.id
LEFT JOIN agent_runs ar   ON ar.project_id = p.id
  AND ar.created_at >= date_trunc('month', now())
WHERE p.user_id = auth.uid()
GROUP BY p.id, p.name, p.website_url;

-- ── AUTO-UPDATE TRIGGERS ──────────────────────────────────────────────────────

CREATE TRIGGER update_wp_connections_updated_at
  BEFORE UPDATE ON wp_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_plan_updated_at
  BEFORE UPDATE ON content_plan
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── SUBSCRIPTION PLAN LIMITS ─────────────────────────────────────────────────
-- Add articles_per_month column to subscription plans reference
-- (uses existing credits table — 1 article = 100 credits)

COMMENT ON TABLE wp_connections  IS 'WordPress site credentials for autonomous agent publishing';
COMMENT ON TABLE agent_runs      IS 'Execution log for each agent pipeline stage';
COMMENT ON TABLE content_plan    IS 'Scheduled content plan — articles to write and publish';
COMMENT ON TABLE agent_activity  IS 'Owner-facing activity feed (non-technical language)';
