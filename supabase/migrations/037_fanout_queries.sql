-- Fanout query mining — additive table only. Does not alter existing columns.
-- Stores sub-questions extracted from already-stored visibility_query_runs
-- (People Also Ask / related searches / explicit questions in answer_text /
--  one cheap structured LLM extract).

CREATE TABLE IF NOT EXISTS fanout_queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID NOT NULL REFERENCES visibility_queries(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  question TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN (
      'people_also_ask',
      'related_searches',
      'people_also_search',
      'ai_overview_related',
      'answer_explicit',
      'llm_extract'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fanout_queries_query ON fanout_queries(query_id);
CREATE INDEX IF NOT EXISTS idx_fanout_queries_engine ON fanout_queries(query_id, engine);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fanout_queries_query_engine_question
  ON fanout_queries (query_id, engine, lower(question));

COMMENT ON TABLE fanout_queries IS 'Mined sub-questions from stored AI visibility answers; never written by run_query';
COMMENT ON COLUMN fanout_queries.engine IS 'visibility_query_runs.provider (chatgpt, google_aio, …)';
COMMENT ON COLUMN fanout_queries.source IS 'people_also_ask | related_searches | people_also_search | ai_overview_related | answer_explicit | llm_extract';

ALTER TABLE fanout_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fanout_queries_all" ON fanout_queries;
CREATE POLICY "fanout_queries_all" ON fanout_queries FOR ALL USING (
  EXISTS (
    SELECT 1 FROM visibility_queries vq
    JOIN projects p ON p.id = vq.project_id
    WHERE vq.id = fanout_queries.query_id AND p.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM visibility_queries vq
    JOIN projects p ON p.id = vq.project_id
    WHERE vq.id = fanout_queries.query_id AND p.user_id = auth.uid()
  )
);
