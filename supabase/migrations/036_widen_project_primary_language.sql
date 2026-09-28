-- Future-proof primary_language for additional RESEARCH_MARKETS locales.
-- The project market selector stays scoped to it/en/de/fr/es/pt until the app is updated.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_primary_language_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_primary_language_check
  CHECK (primary_language IN (
    'it', 'en', 'de', 'fr', 'es', 'pt',
    'nl', 'pl', 'cs', 'hu', 'ro', 'el', 'sv', 'no', 'da', 'fi', 'tr', 'uk', 'ja', 'ko', 'zh', 'th', 'id', 'vi', 'ar'
  ));

-- Workspace market enum: ISO codes for widened project selector.
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'DE';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'FR';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'ES';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'GB';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'CA';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'AU';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'IE';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'IN';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'MX';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'AR';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'CO';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'BR';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'AT';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'CH';
ALTER TYPE workspace_market ADD VALUE IF NOT EXISTS 'BE';
