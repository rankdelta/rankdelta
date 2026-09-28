-- Content Proposals Table
-- Stores AI-generated content proposals awaiting user approval (human-in-the-loop)

CREATE TABLE IF NOT EXISTS content_proposals (
  id VARCHAR(255) PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  cluster_name VARCHAR(255) NOT NULL,
  cluster_keywords JSONB NOT NULL,
  primary_keyword VARCHAR(255),
  search_volume INT,
  difficulty FLOAT,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500),
  body TEXT NOT NULL DEFAULT '',
  seo_score FLOAT,
  readability_score FLOAT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'archived')),
  scheduled_date TIMESTAMP WITH TIME ZONE,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes (IF NOT EXISTS to avoid errors if already created)
CREATE INDEX IF NOT EXISTS idx_content_proposals_project_id ON content_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_content_proposals_status ON content_proposals(status);
CREATE INDEX IF NOT EXISTS idx_content_proposals_generated_at ON content_proposals(generated_at);

-- Enable Row Level Security
ALTER TABLE content_proposals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for content_proposals (DROP IF EXISTS to avoid conflicts)
DROP POLICY IF EXISTS "Users can view proposals of their projects" ON content_proposals;
DROP POLICY IF EXISTS "Users can create proposals for their projects" ON content_proposals;
DROP POLICY IF EXISTS "Users can update proposals of their projects" ON content_proposals;
DROP POLICY IF EXISTS "Users can delete proposals of their projects" ON content_proposals;

CREATE POLICY "Users can view proposals of their projects"
  ON content_proposals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create proposals for their projects"
  ON content_proposals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update proposals of their projects"
  ON content_proposals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete proposals of their projects"
  ON content_proposals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_proposals.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- Trigger to automatically update updated_at (DROP IF EXISTS to avoid conflicts)
DROP TRIGGER IF EXISTS update_content_proposals_updated_at ON content_proposals;
CREATE TRIGGER update_content_proposals_updated_at
  BEFORE UPDATE ON content_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

