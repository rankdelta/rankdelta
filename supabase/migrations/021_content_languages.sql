-- Add Portuguese content language + PT SERP market.
-- (de/fr/es were widened in prod via widen_project_market_language.)

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_primary_language_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_primary_language_check
  CHECK (primary_language IN ('it', 'en', 'de', 'fr', 'es', 'pt'));

ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'PT';
