-- Generation Jobs Table
-- Tracks ongoing proposal generation jobs that can be resumed if interrupted

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  job_type VARCHAR(50) DEFAULT 'proposal_generation', -- 'proposal_generation' | 'content_generation'
  status VARCHAR(50) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'paused')),
  clusters_data JSONB NOT NULL, -- Array of clusters to process
  completed_clusters JSONB DEFAULT '[]'::jsonb, -- Array of completed cluster names
  current_cluster_index INT DEFAULT 0,
  total_clusters INT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_generation_jobs_project_id ON generation_jobs(project_id);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX idx_generation_jobs_started_at ON generation_jobs(started_at);

-- Enable Row Level Security
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for generation_jobs
CREATE POLICY "Users can view generation jobs of their projects"
  ON generation_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = generation_jobs.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create generation jobs for their projects"
  ON generation_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = generation_jobs.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update generation jobs of their projects"
  ON generation_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = generation_jobs.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete generation jobs of their projects"
  ON generation_jobs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = generation_jobs.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Trigger to automatically update updated_at
CREATE TRIGGER update_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

