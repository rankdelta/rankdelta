-- Scheduled visibility runs (refresh_cadence + visibility_schedule_enabled)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility_schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility_scheduled_last_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.visibility_schedule_enabled IS 'When true, cron may run active visibility queries per refresh_cadence';
COMMENT ON COLUMN projects.visibility_scheduled_last_at IS 'UTC: last completed automated cron cycle for this project';
