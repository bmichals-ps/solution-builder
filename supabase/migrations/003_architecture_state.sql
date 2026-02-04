-- Add architecture state and deployment columns to projects table
-- This enables saving the full visual editor state for resuming work

-- Architecture state - stores flows, menu options, node positions, previews, etc.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS architecture_state JSONB;

-- Deployment details
ALTER TABLE projects ADD COLUMN IF NOT EXISTS widget_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bot_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version_id TEXT;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_architecture_state ON projects USING GIN (architecture_state);

COMMENT ON COLUMN projects.architecture_state IS 'Stores the full architecture editor state including flows, menu options, node positions, and flow previews as JSONB';
COMMENT ON COLUMN projects.widget_id IS 'Pypestream widget ID for the deployed bot';
COMMENT ON COLUMN projects.bot_id IS 'Pypestream bot ID (format: CustomerName.BotName)';
COMMENT ON COLUMN projects.version_id IS 'Pypestream version ID for the deployed version';
