-- Persist widget layout on scheduled reports.

ALTER TABLE report_schedules
  ADD COLUMN IF NOT EXISTS layout JSONB;

COMMENT ON COLUMN report_schedules.layout IS
  'Widget canvas layout applied when the schedule builds a report snapshot.';

-- Reload PostgREST schema cache so the updated report_schedules.layout is served immediately.
NOTIFY pgrst, 'reload schema';
