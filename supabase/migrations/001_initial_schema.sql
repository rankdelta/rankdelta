-- AstroSEO.ai Database Schema
-- Initial migration with RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(255) NOT NULL,
  website_url VARCHAR(500),
  primary_keyword VARCHAR(255),
  main_topic VARCHAR(255),
  tone VARCHAR(50) DEFAULT 'professional',
  content_length INT DEFAULT 2000,
  language VARCHAR(10) DEFAULT 'it',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Keywords table
CREATE TABLE keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  keyword VARCHAR(255) NOT NULL,
  search_volume INT,
  difficulty FLOAT,
  cluster_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Clusters table (Topical Map)
CREATE TABLE clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  cluster_name VARCHAR(255) NOT NULL,
  keywords_list JSONB NOT NULL,
  content_gaps JSONB,
  visualization_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Generated Content table
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500),
  body TEXT NOT NULL,
  metadata JSONB,
  topic VARCHAR(255),
  keywords_used JSONB,
  seo_score FLOAT,
  readability_score FLOAT,
  status VARCHAR(50) DEFAULT 'draft',
  generated_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  published_date TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Revisions table (for content refresh tracking)
CREATE TABLE revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  original_body TEXT NOT NULL,
  updated_body TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- API Usage Logs table
CREATE TABLE api_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action VARCHAR(100) NOT NULL,
  tokens_used INT,
  cost_usd FLOAT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_keywords_project_id ON keywords(project_id);
CREATE INDEX idx_keywords_cluster_id ON keywords(cluster_id);
CREATE INDEX idx_clusters_project_id ON clusters(project_id);
CREATE INDEX idx_content_project_id ON content(project_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_revisions_content_id ON revisions(content_id);
CREATE INDEX idx_api_logs_user_id ON api_logs(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects
CREATE POLICY "Users can view their own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects"
  ON projects FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for keywords
CREATE POLICY "Users can view keywords of their projects"
  ON keywords FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = keywords.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create keywords for their projects"
  ON keywords FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = keywords.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update keywords of their projects"
  ON keywords FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = keywords.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete keywords of their projects"
  ON keywords FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = keywords.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for clusters
CREATE POLICY "Users can view clusters of their projects"
  ON clusters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = clusters.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create clusters for their projects"
  ON clusters FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = clusters.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update clusters of their projects"
  ON clusters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = clusters.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete clusters of their projects"
  ON clusters FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = clusters.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content
CREATE POLICY "Users can view content of their projects"
  ON content FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create content for their projects"
  ON content FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update content of their projects"
  ON content FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete content of their projects"
  ON content FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for revisions
CREATE POLICY "Users can view revisions of their content"
  ON revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = revisions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create revisions for their content"
  ON revisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = revisions.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for api_logs
CREATE POLICY "Users can view their own API logs"
  ON api_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own API logs"
  ON api_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to automatically update updated_at
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_updated_at
  BEFORE UPDATE ON content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

