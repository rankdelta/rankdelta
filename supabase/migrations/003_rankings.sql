-- Rankings table for SEO position tracking
CREATE TABLE rankings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  position INT,
  url TEXT,
  title TEXT,
  search_volume INT,
  difficulty FLOAT,
  previous_position INT,
  change INT DEFAULT 0,
  location_code INT DEFAULT 2826,
  language_code VARCHAR(10) DEFAULT 'it',
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Rankings history table for tracking position changes over time
CREATE TABLE ranking_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ranking_id UUID REFERENCES rankings(id) ON DELETE CASCADE NOT NULL,
  position INT,
  url TEXT,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes
CREATE INDEX idx_rankings_project_id ON rankings(project_id);
CREATE INDEX idx_rankings_keyword ON rankings(keyword);
CREATE INDEX idx_rankings_checked_at ON rankings(checked_at);
CREATE INDEX idx_ranking_history_ranking_id ON ranking_history(ranking_id);
CREATE INDEX idx_ranking_history_checked_at ON ranking_history(checked_at);

-- Enable RLS
ALTER TABLE rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rankings
CREATE POLICY "Users can view rankings of their projects"
  ON rankings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = rankings.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create rankings for their projects"
  ON rankings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = rankings.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update rankings of their projects"
  ON rankings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = rankings.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete rankings of their projects"
  ON rankings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = rankings.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for ranking_history
CREATE POLICY "Users can view ranking history of their projects"
  ON ranking_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rankings
      JOIN projects ON projects.id = rankings.project_id
      WHERE rankings.id = ranking_history.ranking_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create ranking history for their projects"
  ON ranking_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rankings
      JOIN projects ON projects.id = rankings.project_id
      WHERE rankings.id = ranking_history.ranking_id
      AND projects.user_id = auth.uid()
    )
  );

