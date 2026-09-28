-- =============================================================================
-- Visibility tracker (AI visibility / GEO) — new core for AstroSEO pivot
-- Extends projects as workspace; does not drop legacy tables.
-- =============================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE workspace_market AS ENUM ('IT', 'US', 'global');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workspace_vertical AS ENUM ('saas', 'ecommerce', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE refresh_cadence AS ENUM ('weekly', 'every_3_days', 'daily');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE query_intent_type AS ENUM ('brand', 'category', 'comparison', 'use_case', 'problem');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE llm_provider AS ENUM ('chatgpt', 'perplexity', 'gemini', 'google_aio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mention_sentiment AS ENUM ('positive', 'neutral', 'negative');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Workspace (projects) extensions
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS primary_language VARCHAR(5) DEFAULT 'en'
    CHECK (primary_language IN ('it', 'en')),
  ADD COLUMN IF NOT EXISTS market workspace_market DEFAULT 'IT',
  ADD COLUMN IF NOT EXISTS vertical workspace_vertical DEFAULT 'saas',
  ADD COLUMN IF NOT EXISTS refresh_cadence refresh_cadence DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS seed_keywords JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS monthly_api_spend_cap_cents INT,
  ADD COLUMN IF NOT EXISTS api_spend_cents_period INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_spend_period_start TIMESTAMPTZ DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC');

COMMENT ON COLUMN projects.primary_language IS 'UI + LLM prompt language for this workspace';
COMMENT ON COLUMN projects.seed_keywords IS 'JSON array of strings for auto query generation';

-- Tracked brand (user brand + aliases)
CREATE TABLE IF NOT EXISTS tracked_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracked_brands_project ON tracked_brands(project_id);

-- Competitors
CREATE TABLE IF NOT EXISTS competitor_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_brands_project ON competitor_brands(project_id);

-- Tracked prompts (avoid reserved name "query")
CREATE TABLE IF NOT EXISTS visibility_queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'it',
  intent_type query_intent_type NOT NULL DEFAULT 'category',
  vertical workspace_vertical,
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_queries_project ON visibility_queries(project_id);
CREATE INDEX IF NOT EXISTS idx_visibility_queries_active ON visibility_queries(project_id, is_active);

-- One execution of a prompt against one provider
CREATE TABLE IF NOT EXISTS visibility_query_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID NOT NULL REFERENCES visibility_queries(id) ON DELETE CASCADE,
  provider llm_provider NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  raw_response JSONB,
  cited_sources JSONB,
  mentioned_brands JSONB,
  answer_text TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost_cents INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6),
  error_message TEXT,
  dataforseo_platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_query_runs_query ON visibility_query_runs(query_id);
CREATE INDEX IF NOT EXISTS idx_visibility_query_runs_run_at ON visibility_query_runs(run_at);

-- Parsed citations
CREATE TABLE IF NOT EXISTS visibility_citations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_run_id UUID NOT NULL REFERENCES visibility_query_runs(id) ON DELETE CASCADE,
  source_url TEXT,
  source_domain TEXT,
  rank_in_answer INT,
  snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_citations_run ON visibility_citations(query_run_id);
CREATE INDEX IF NOT EXISTS idx_visibility_citations_domain ON visibility_citations(source_domain);

-- Parsed mentions
CREATE TABLE IF NOT EXISTS visibility_brand_mentions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_run_id UUID NOT NULL REFERENCES visibility_query_runs(id) ON DELETE CASCADE,
  tracked_brand_id UUID REFERENCES tracked_brands(id) ON DELETE SET NULL,
  competitor_brand_id UUID REFERENCES competitor_brands(id) ON DELETE SET NULL,
  brand_name TEXT,
  mention_position INT,
  sentiment mention_sentiment,
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_mentions_run ON visibility_brand_mentions(query_run_id);

-- Rollups (nightly / on-demand)
CREATE TABLE IF NOT EXISTS visibility_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tracked_brand_id UUID REFERENCES tracked_brands(id) ON DELETE CASCADE,
  competitor_brand_id UUID REFERENCES competitor_brands(id) ON DELETE CASCADE,
  query_id UUID NOT NULL REFERENCES visibility_queries(id) ON DELETE CASCADE,
  provider llm_provider NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  mentions_count INT NOT NULL DEFAULT 0,
  avg_position NUMERIC(8, 2),
  share_of_voice NUMERIC(8, 4),
  visibility_index NUMERIC(8, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_scores_project_period ON visibility_scores(project_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_visibility_scores_query ON visibility_scores(query_id);

-- API spend audit (unit economics)
CREATE TABLE IF NOT EXISTS visibility_api_spend_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider llm_provider,
  action TEXT NOT NULL,
  cost_cents INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visibility_spend_project ON visibility_api_spend_events(project_id);
CREATE INDEX IF NOT EXISTS idx_visibility_spend_created ON visibility_api_spend_events(created_at);

-- Triggers updated_at
CREATE OR REPLACE FUNCTION visibility_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_tracked_brands_updated ON tracked_brands;
CREATE TRIGGER tr_tracked_brands_updated
  BEFORE UPDATE ON tracked_brands FOR EACH ROW EXECUTE FUNCTION visibility_touch_updated_at();

DROP TRIGGER IF EXISTS tr_competitor_brands_updated ON competitor_brands;
CREATE TRIGGER tr_competitor_brands_updated
  BEFORE UPDATE ON competitor_brands FOR EACH ROW EXECUTE FUNCTION visibility_touch_updated_at();

DROP TRIGGER IF EXISTS tr_visibility_queries_updated ON visibility_queries;
CREATE TRIGGER tr_visibility_queries_updated
  BEFORE UPDATE ON visibility_queries FOR EACH ROW EXECUTE FUNCTION visibility_touch_updated_at();

-- RLS
ALTER TABLE tracked_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_query_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_brand_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_api_spend_events ENABLE ROW LEVEL SECURITY;

-- Helper: project owned by user
-- Policies tracked_brands
DROP POLICY IF EXISTS "tracked_brands_select" ON tracked_brands;
CREATE POLICY "tracked_brands_select" ON tracked_brands FOR SELECT USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = tracked_brands.project_id AND p.user_id = auth.uid())
);
DROP POLICY IF EXISTS "tracked_brands_all" ON tracked_brands;
CREATE POLICY "tracked_brands_all" ON tracked_brands FOR ALL USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = tracked_brands.project_id AND p.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = tracked_brands.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "competitor_brands_all" ON competitor_brands;
CREATE POLICY "competitor_brands_all" ON competitor_brands FOR ALL USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = competitor_brands.project_id AND p.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = competitor_brands.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "visibility_queries_all" ON visibility_queries;
CREATE POLICY "visibility_queries_all" ON visibility_queries FOR ALL USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = visibility_queries.project_id AND p.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = visibility_queries.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "visibility_query_runs_all" ON visibility_query_runs;
CREATE POLICY "visibility_query_runs_all" ON visibility_query_runs FOR ALL USING (
  EXISTS (
    SELECT 1 FROM visibility_queries vq
    JOIN projects p ON p.id = vq.project_id
    WHERE vq.id = visibility_query_runs.query_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM visibility_queries vq
    JOIN projects p ON p.id = vq.project_id
    WHERE vq.id = visibility_query_runs.query_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "visibility_citations_all" ON visibility_citations;
CREATE POLICY "visibility_citations_all" ON visibility_citations FOR ALL USING (
  EXISTS (
    SELECT 1 FROM visibility_query_runs vr
    JOIN visibility_queries vq ON vq.id = vr.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE vr.id = visibility_citations.query_run_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM visibility_query_runs vr
    JOIN visibility_queries vq ON vq.id = vr.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE vr.id = visibility_citations.query_run_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "visibility_brand_mentions_all" ON visibility_brand_mentions;
CREATE POLICY "visibility_brand_mentions_all" ON visibility_brand_mentions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM visibility_query_runs vr
    JOIN visibility_queries vq ON vq.id = vr.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE vr.id = visibility_brand_mentions.query_run_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM visibility_query_runs vr
    JOIN visibility_queries vq ON vq.id = vr.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE vr.id = visibility_brand_mentions.query_run_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "visibility_scores_all" ON visibility_scores;
CREATE POLICY "visibility_scores_all" ON visibility_scores FOR ALL USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = visibility_scores.project_id AND p.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = visibility_scores.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "visibility_api_spend_select" ON visibility_api_spend_events;
CREATE POLICY "visibility_api_spend_select" ON visibility_api_spend_events FOR SELECT USING (user_id = auth.uid());

-- Inserts for spend events may be done via service role from Edge Functions; users read their own.
