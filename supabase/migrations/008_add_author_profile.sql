-- Migration: Add author profile fields to projects
-- These fields are used for E-E-A-T and GEO optimization
-- Real author info instead of fabricated credentials

-- Add author profile columns to projects table
ALTER TABLE projects 
ADD COLUMN IF NOT EXISTS author_name TEXT,
ADD COLUMN IF NOT EXISTS author_bio TEXT,
ADD COLUMN IF NOT EXISTS author_expertise TEXT;

-- Add comment to explain the purpose
COMMENT ON COLUMN projects.author_name IS 'Real author name for E-E-A-T credibility';
COMMENT ON COLUMN projects.author_bio IS 'Author biography with credentials and experience';
COMMENT ON COLUMN projects.author_expertise IS 'Author area of expertise (e.g., SEO, Veterinary, Finance)';
