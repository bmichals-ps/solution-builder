-- Action Scripts Table
-- Stores official Pypestream action node scripts for automatic deployment

CREATE TABLE IF NOT EXISTS action_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'official',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by name
CREATE INDEX IF NOT EXISTS idx_action_scripts_name ON action_scripts(name);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_action_scripts_category ON action_scripts(category);

-- Enable RLS
ALTER TABLE action_scripts ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read scripts (they're public/official)
CREATE POLICY "Anyone can read action scripts"
  ON action_scripts
  FOR SELECT
  USING (true);

-- Only service role can insert/update (admin operations)
CREATE POLICY "Service role can manage action scripts"
  ON action_scripts
  FOR ALL
  USING (auth.role() = 'service_role');

-- Comment for documentation
COMMENT ON TABLE action_scripts IS 'Official Pypestream action node Python scripts for chatbot deployment';
COMMENT ON COLUMN action_scripts.name IS 'Script name without .py extension (e.g., UserPlatformRouting)';
COMMENT ON COLUMN action_scripts.content IS 'Full Python script content';
COMMENT ON COLUMN action_scripts.category IS 'Script category: official, custom, deprecated';
