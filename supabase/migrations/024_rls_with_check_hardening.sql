-- 024_rls_with_check_hardening.sql
--
-- Row Level Security for user-scoped UPDATE policies: adds an explicit WITH CHECK that
-- mirrors USING, so a row cannot be re-pointed to another owner or project (e.g. via a
-- writable projects.user_id / subscriptions.user_id), even if column grants change later.
--
-- Idempotent: DROP + CREATE.

-- projects: prevent moving a project to another user
DROP POLICY IF EXISTS "Users can update their own projects" ON projects;
CREATE POLICY "Users can update their own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- keywords / clusters / content: prevent re-pointing rows to another project
DROP POLICY IF EXISTS "Users can update keywords of their projects" ON keywords;
CREATE POLICY "Users can update keywords of their projects"
  ON keywords FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = keywords.project_id AND projects.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update clusters of their projects" ON clusters;
CREATE POLICY "Users can update clusters of their projects"
  ON clusters FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = clusters.project_id AND projects.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = clusters.project_id AND projects.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update content of their projects" ON content;
CREATE POLICY "Users can update content of their projects"
  ON content FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = content.project_id AND projects.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = content.project_id AND projects.user_id = auth.uid())
  );
