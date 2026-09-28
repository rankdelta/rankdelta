-- Traditional Google organic rank checks (DataForSEO SERP) per visibility store

CREATE TABLE IF NOT EXISTS serp_rank_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serp_rank_keywords_project ON serp_rank_keywords(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_serp_rank_keywords_project_phrase
  ON serp_rank_keywords (project_id, lower(trim(phrase)));

CREATE TABLE IF NOT EXISTS serp_rank_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_id UUID NOT NULL REFERENCES serp_rank_keywords(id) ON DELETE CASCADE,
  rank_absolute INT,
  ranking_url TEXT,
  result_title TEXT,
  serp_organic_count INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6),
  raw_response JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serp_rank_snapshots_keyword ON serp_rank_snapshots(keyword_id);
CREATE INDEX IF NOT EXISTS idx_serp_rank_snapshots_checked ON serp_rank_snapshots(checked_at DESC);

DROP TRIGGER IF EXISTS tr_serp_rank_keywords_updated ON serp_rank_keywords;
CREATE TRIGGER tr_serp_rank_keywords_updated
  BEFORE UPDATE ON serp_rank_keywords FOR EACH ROW EXECUTE FUNCTION visibility_touch_updated_at();

ALTER TABLE serp_rank_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE serp_rank_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "serp_rank_keywords_all" ON serp_rank_keywords;
CREATE POLICY "serp_rank_keywords_all" ON serp_rank_keywords FOR ALL USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = serp_rank_keywords.project_id AND p.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = serp_rank_keywords.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "serp_rank_snapshots_all" ON serp_rank_snapshots;
CREATE POLICY "serp_rank_snapshots_all" ON serp_rank_snapshots FOR ALL USING (
  EXISTS (
    SELECT 1 FROM serp_rank_keywords k
    JOIN projects p ON p.id = k.project_id
    WHERE k.id = serp_rank_snapshots.keyword_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM serp_rank_keywords k
    JOIN projects p ON p.id = k.project_id
    WHERE k.id = serp_rank_snapshots.keyword_id AND p.user_id = auth.uid()
  )
);
