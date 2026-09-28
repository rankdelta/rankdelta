-- Add metadata column to projects table
-- This column stores JSONB data for content updates, approved/rejected candidates, etc.

-- Add metadata column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'projects' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE projects 
        ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        
        -- Create index on metadata for better query performance
        CREATE INDEX IF NOT EXISTS idx_projects_metadata ON projects USING gin (metadata);
        
        RAISE NOTICE 'Added metadata column to projects table';
    ELSE
        RAISE NOTICE 'metadata column already exists in projects table';
    END IF;
END $$;

