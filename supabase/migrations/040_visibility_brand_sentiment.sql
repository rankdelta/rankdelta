-- Brand sentiment classifications — additive table only. Does not alter existing
-- columns (visibility_brand_mentions.sentiment stays as written by run_query).
-- Stores gpt-4o-mini classifications of already-saved visibility_query_runs.answer_text.

CREATE TABLE IF NOT EXISTS visibility_brand_sentiment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_run_id UUID NOT NULL REFERENCES visibility_query_runs(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  sentiment TEXT NOT NULL
    CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  accuracy NUMERIC(4, 3) NOT NULL DEFAULT 0.5
    CHECK (accuracy >= 0 AND accuracy <= 1),
  model TEXT,
  cost_usd NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visibility_brand_sentiment_run_brand
  ON visibility_brand_sentiment (query_run_id, brand_name);

CREATE INDEX IF NOT EXISTS idx_visibility_brand_sentiment_run
  ON visibility_brand_sentiment (query_run_id);

COMMENT ON TABLE visibility_brand_sentiment IS
  'Cached cheap-LLM sentiment of stored AI answers. get_brand_sentiment reads this; run_query never writes it.';

ALTER TABLE visibility_brand_sentiment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visibility_brand_sentiment_all" ON visibility_brand_sentiment;
CREATE POLICY "visibility_brand_sentiment_all" ON visibility_brand_sentiment FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM visibility_query_runs r
    JOIN visibility_queries vq ON vq.id = r.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE r.id = visibility_brand_sentiment.query_run_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
    FROM visibility_query_runs r
    JOIN visibility_queries vq ON vq.id = r.query_id
    JOIN projects p ON p.id = vq.project_id
    WHERE r.id = visibility_brand_sentiment.query_run_id AND p.user_id = auth.uid()
  )
);
