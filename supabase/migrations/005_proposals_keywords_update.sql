-- Update content_proposals table to include primary keyword and search volume

ALTER TABLE content_proposals
ADD COLUMN IF NOT EXISTS primary_keyword VARCHAR(255),
ADD COLUMN IF NOT EXISTS search_volume INT,
ADD COLUMN IF NOT EXISTS difficulty FLOAT,
ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMP WITH TIME ZONE;

-- Update status CHECK constraint to include 'archived'
-- Drop old constraint and create new one with 'archived'
ALTER TABLE content_proposals
DROP CONSTRAINT IF EXISTS content_proposals_status_check;

ALTER TABLE content_proposals
ADD CONSTRAINT content_proposals_status_check 
CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'archived'));

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_content_proposals_primary_keyword ON content_proposals(primary_keyword);
CREATE INDEX IF NOT EXISTS idx_content_proposals_scheduled_date ON content_proposals(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_content_proposals_search_volume ON content_proposals(search_volume);

