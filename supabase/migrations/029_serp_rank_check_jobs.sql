-- Resumable background jobs for Google SERP rank checks (DataForSEO).
-- Keywords are persisted in serp_rank_keywords first; this table tracks async position checks.

CREATE TABLE IF NOT EXISTS serp_rank_check_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial')),
  keyword_ids UUID[] NOT NULL,
  completed_ids UUID[] NOT NULL DEFAULT '{}',
  failed JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_project ON serp_rank_check_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_status ON serp_rank_check_jobs(status);
CREATE INDEX IF NOT EXISTS idx_serp_rank_check_jobs_updated ON serp_rank_check_jobs(updated_at);

DROP TRIGGER IF EXISTS tr_serp_rank_check_jobs_updated ON serp_rank_check_jobs;
CREATE TRIGGER tr_serp_rank_check_jobs_updated
  BEFORE UPDATE ON serp_rank_check_jobs
  FOR EACH ROW EXECUTE FUNCTION visibility_touch_updated_at();

ALTER TABLE serp_rank_check_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "serp_rank_check_jobs_select" ON serp_rank_check_jobs;
CREATE POLICY "serp_rank_check_jobs_select" ON serp_rank_check_jobs FOR SELECT USING (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = serp_rank_check_jobs.project_id AND p.user_id = auth.uid())
);

DROP POLICY IF EXISTS "serp_rank_check_jobs_insert" ON serp_rank_check_jobs;
CREATE POLICY "serp_rank_check_jobs_insert" ON serp_rank_check_jobs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM projects p WHERE p.id = serp_rank_check_jobs.project_id AND p.user_id = auth.uid())
    AND user_id = auth.uid()
);
