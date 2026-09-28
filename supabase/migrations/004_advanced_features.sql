-- Advanced Features Migration
-- Adds tables for content templates, optimization suggestions, internal links, content performance, notifications, and more

-- Content Templates table
CREATE TABLE IF NOT EXISTS content_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_type VARCHAR(50) NOT NULL CHECK (template_type IN ('blog_post', 'landing_page', 'product_description', 'meta_description', 'faq', 'email', 'social_media')),
  structure JSONB NOT NULL, -- Template structure with placeholders
  default_settings JSONB DEFAULT '{}'::jsonb,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Optimization Suggestions table
CREATE TABLE IF NOT EXISTS content_optimization_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  suggestion_type VARCHAR(50) NOT NULL CHECK (suggestion_type IN ('keyword_density', 'headings', 'images', 'links', 'readability', 'length', 'meta', 'schema')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  current_value TEXT,
  suggested_value TEXT,
  is_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Internal Linking Suggestions table
CREATE TABLE IF NOT EXISTS internal_linking_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  target_content_id UUID REFERENCES content(id) ON DELETE CASCADE,
  anchor_text VARCHAR(255) NOT NULL,
  context TEXT,
  relevance_score FLOAT,
  suggested_position INT, -- Character position in content
  is_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Performance Analytics table
CREATE TABLE IF NOT EXISTS content_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  metric_date DATE NOT NULL,
  views INT DEFAULT 0,
  engagement_time_seconds INT DEFAULT 0,
  bounce_rate FLOAT,
  conversions INT DEFAULT 0,
  conversion_rate FLOAT,
  organic_clicks INT DEFAULT 0,
  organic_impressions INT DEFAULT 0,
  organic_ctr FLOAT,
  average_position FLOAT,
  backlinks_count INT DEFAULT 0,
  social_shares INT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(content_id, metric_date)
);

-- Content Versions table (advanced versioning)
CREATE TABLE IF NOT EXISTS content_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  version_number INT NOT NULL,
  title VARCHAR(500),
  body TEXT NOT NULL,
  slug VARCHAR(500),
  metadata JSONB,
  change_summary TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Comments table (for collaboration)
CREATE TABLE IF NOT EXISTS content_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  comment_text TEXT NOT NULL,
  position_start INT, -- Character position in content
  position_end INT,
  is_resolved BOOLEAN DEFAULT false,
  parent_comment_id UUID REFERENCES content_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Briefs table
CREATE TABLE IF NOT EXISTS content_briefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  primary_keyword VARCHAR(255) NOT NULL,
  target_audience TEXT,
  content_angle TEXT,
  key_points JSONB, -- Array of key points to cover
  competitor_urls JSONB, -- Array of competitor URLs to analyze
  target_word_count INT,
  tone VARCHAR(50),
  seo_requirements JSONB,
  content_outline JSONB, -- Structured outline
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Meta Content table (meta descriptions, titles, alt text, etc.)
CREATE TABLE IF NOT EXISTS meta_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  meta_type VARCHAR(50) NOT NULL CHECK (meta_type IN ('title', 'meta_description', 'og_title', 'og_description', 'twitter_title', 'twitter_description', 'alt_text', 'schema_markup')),
  content_text TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  seo_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Refresh Jobs table
CREATE TABLE IF NOT EXISTS content_refresh_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_id UUID REFERENCES content(id) ON DELETE CASCADE NOT NULL,
  refresh_type VARCHAR(50) DEFAULT 'full' CHECK (refresh_type IN ('full', 'partial', 'update_facts', 'add_sections')),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  original_content_snapshot TEXT,
  refreshed_content TEXT,
  changes_summary JSONB,
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Content Recommendations table
CREATE TABLE IF NOT EXISTS content_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  recommendation_type VARCHAR(50) NOT NULL CHECK (recommendation_type IN ('topic', 'keyword', 'content_gap', 'competitor_analysis', 'trending_topic')),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  priority_score FLOAT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('content_proposal', 'ranking_change', 'content_scheduled', 'content_published', 'optimization_suggestion', 'performance_alert', 'system')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link_url VARCHAR(500),
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('content_performance', 'seo_analysis', 'keyword_ranking', 'competitor_analysis', 'content_audit', 'custom')),
  title VARCHAR(255) NOT NULL,
  report_data JSONB NOT NULL,
  format VARCHAR(20) DEFAULT 'pdf' CHECK (format IN ('pdf', 'html', 'json')),
  file_url VARCHAR(500),
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User Preferences table (extended)
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  language VARCHAR(10) DEFAULT 'it',
  theme VARCHAR(20) DEFAULT 'dark',
  notifications_enabled BOOLEAN DEFAULT true,
  email_notifications_enabled BOOLEAN DEFAULT true,
  default_content_length INT DEFAULT 2000,
  default_tone VARCHAR(50) DEFAULT 'professional',
  auto_save_enabled BOOLEAN DEFAULT true,
  auto_save_interval INT DEFAULT 2000, -- milliseconds
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_content_templates_user_id ON content_templates(user_id);
CREATE INDEX idx_content_templates_type ON content_templates(template_type);
CREATE INDEX idx_optimization_suggestions_content_id ON content_optimization_suggestions(content_id);
CREATE INDEX idx_internal_linking_content_id ON internal_linking_suggestions(content_id);
CREATE INDEX idx_content_performance_content_id ON content_performance(content_id);
CREATE INDEX idx_content_performance_date ON content_performance(metric_date);
CREATE INDEX idx_content_versions_content_id ON content_versions(content_id);
CREATE INDEX idx_content_comments_content_id ON content_comments(content_id);
CREATE INDEX idx_content_briefs_project_id ON content_briefs(project_id);
CREATE INDEX idx_meta_content_content_id ON meta_content(content_id);
CREATE INDEX idx_content_refresh_jobs_content_id ON content_refresh_jobs(content_id);
CREATE INDEX idx_content_refresh_jobs_status ON content_refresh_jobs(status);
CREATE INDEX idx_content_recommendations_project_id ON content_recommendations(project_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_project_id ON reports(project_id);

-- Enable Row Level Security
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_optimization_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_linking_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_refresh_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for content_templates
CREATE POLICY "Users can view their own templates or public templates"
  ON content_templates FOR SELECT
  USING (auth.uid() = user_id OR is_public = true);

CREATE POLICY "Users can create their own templates"
  ON content_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own templates"
  ON content_templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own templates"
  ON content_templates FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for content_optimization_suggestions
CREATE POLICY "Users can view suggestions for their content"
  ON content_optimization_suggestions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_optimization_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create suggestions for their content"
  ON content_optimization_suggestions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_optimization_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update suggestions for their content"
  ON content_optimization_suggestions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_optimization_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for internal_linking_suggestions
CREATE POLICY "Users can view internal linking suggestions for their content"
  ON internal_linking_suggestions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = internal_linking_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create internal linking suggestions for their content"
  ON internal_linking_suggestions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = internal_linking_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update internal linking suggestions for their content"
  ON internal_linking_suggestions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = internal_linking_suggestions.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content_performance
CREATE POLICY "Users can view performance data for their content"
  ON content_performance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_performance.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create performance data for their content"
  ON content_performance FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_performance.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content_versions
CREATE POLICY "Users can view versions of their content"
  ON content_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_versions.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create versions of their content"
  ON content_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_versions.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content_comments
CREATE POLICY "Users can view comments on their content"
  ON content_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_comments.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create comments on their content"
  ON content_comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_comments.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own comments"
  ON content_comments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments"
  ON content_comments FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for content_briefs
CREATE POLICY "Users can view briefs for their projects"
  ON content_briefs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_briefs.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create briefs for their projects"
  ON content_briefs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_briefs.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update briefs for their projects"
  ON content_briefs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_briefs.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for meta_content
CREATE POLICY "Users can view meta content for their content"
  ON meta_content FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = meta_content.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create meta content for their content"
  ON meta_content FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = meta_content.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update meta content for their content"
  ON meta_content FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = meta_content.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content_refresh_jobs
CREATE POLICY "Users can view refresh jobs for their content"
  ON content_refresh_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_refresh_jobs.content_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create refresh jobs for their content"
  ON content_refresh_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content
      JOIN projects ON projects.id = content.project_id
      WHERE content.id = content_refresh_jobs.content_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for content_recommendations
CREATE POLICY "Users can view recommendations for their projects"
  ON content_recommendations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_recommendations.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create recommendations for their projects"
  ON content_recommendations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_recommendations.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update recommendations for their projects"
  ON content_recommendations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = content_recommendations.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- RLS Policies for notifications
CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own notifications"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for reports
CREATE POLICY "Users can view their own reports"
  ON reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_preferences
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Add triggers for updated_at
CREATE TRIGGER update_content_templates_updated_at
  BEFORE UPDATE ON content_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_comments_updated_at
  BEFORE UPDATE ON content_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_briefs_updated_at
  BEFORE UPDATE ON content_briefs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meta_content_updated_at
  BEFORE UPDATE ON meta_content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

