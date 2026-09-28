-- Wave 6: drag-and-drop report builder — layout on snapshots + saved templates.

ALTER TABLE client_reports
  ADD COLUMN IF NOT EXISTS layout JSONB;

COMMENT ON COLUMN client_reports.layout IS
  'Widget canvas layout (version, columns, widgets with grid positions and data bindings).';

CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '{"version":1,"columns":12,"widgets":[]}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_templates_user ON report_templates(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_templates_project ON report_templates(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_templates_select ON report_templates
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY report_templates_insert ON report_templates
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY report_templates_update ON report_templates
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY report_templates_delete ON report_templates
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON report_templates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates TO service_role;

-- Include layout in public share payload.
CREATE OR REPLACE FUNCTION get_shared_report(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row client_reports%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM client_reports
  WHERE share_token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'project_id', v_row.project_id,
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'sections', v_row.sections,
    'data', v_row.data,
    'narrative', v_row.narrative,
    'branding', v_row.branding,
    'goals', v_row.goals,
    'layout', v_row.layout,
    'created_at', v_row.created_at
  );
END;
$$;

-- Reload PostgREST schema cache so the updated get_shared_report is served immediately.
NOTIFY pgrst, 'reload schema';
