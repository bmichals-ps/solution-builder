-- Error Learning System Tables
-- Stores validation error patterns and their fixes for self-improvement

-- Table: error_patterns
-- Stores unique error patterns encountered during validation
CREATE TABLE IF NOT EXISTS error_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_signature TEXT UNIQUE NOT NULL,  -- Hash of normalized error for matching
  error_type TEXT NOT NULL,              -- Categorized error type, e.g., "NLU_DISABLED_MULTI_CHILD"
  field_name TEXT,                       -- CSV field that caused error, e.g., "Next Nodes", "Rich Asset Content"
  error_description TEXT NOT NULL,       -- Full error message from Bot Manager
  node_context JSONB,                    -- Sample node data that caused the error
  occurrence_count INTEGER DEFAULT 1,    -- How many times this error has been seen
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: fix_attempts
-- Logs every fix attempt with success/failure status
CREATE TABLE IF NOT EXISTS fix_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_pattern_id UUID REFERENCES error_patterns(id) ON DELETE CASCADE,
  fix_description TEXT NOT NULL,         -- Human-readable description of what change was made
  fix_diff JSONB,                        -- Before/after comparison of the node/field
  success BOOLEAN NOT NULL,              -- Whether this fix resolved the error
  applied_count INTEGER DEFAULT 1,       -- Total times this fix has been applied
  success_count INTEGER DEFAULT 0,       -- Times it successfully resolved the error
  failure_count INTEGER DEFAULT 0,       -- Times it failed to resolve the error
  confidence_score FLOAT GENERATED ALWAYS AS (
    CASE WHEN applied_count > 0 
    THEN success_count::FLOAT / applied_count 
    ELSE 0 END
  ) STORED,                              -- Auto-calculated success rate
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_applied_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate fix descriptions for the same error pattern
  UNIQUE(error_pattern_id, fix_description)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_error_patterns_signature ON error_patterns(error_signature);
CREATE INDEX IF NOT EXISTS idx_error_patterns_type ON error_patterns(error_type);
CREATE INDEX IF NOT EXISTS idx_error_patterns_occurrence ON error_patterns(occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_fix_attempts_error_pattern ON fix_attempts(error_pattern_id);
CREATE INDEX IF NOT EXISTS idx_fix_attempts_confidence ON fix_attempts(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_fix_attempts_success ON fix_attempts(success) WHERE success = true;

-- Enable Row Level Security
ALTER TABLE error_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow public read, service role write
-- Error patterns - everyone can read, only service role can write
CREATE POLICY "Allow public read on error_patterns" 
  ON error_patterns FOR SELECT 
  USING (true);

CREATE POLICY "Allow service role insert on error_patterns" 
  ON error_patterns FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow service role update on error_patterns" 
  ON error_patterns FOR UPDATE 
  USING (true);

-- Fix attempts - everyone can read, only service role can write  
CREATE POLICY "Allow public read on fix_attempts" 
  ON fix_attempts FOR SELECT 
  USING (true);

CREATE POLICY "Allow service role insert on fix_attempts" 
  ON fix_attempts FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow service role update on fix_attempts" 
  ON fix_attempts FOR UPDATE 
  USING (true);

-- Function to upsert error pattern (increment count if exists)
CREATE OR REPLACE FUNCTION upsert_error_pattern(
  p_error_signature TEXT,
  p_error_type TEXT,
  p_field_name TEXT,
  p_error_description TEXT,
  p_node_context JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO error_patterns (error_signature, error_type, field_name, error_description, node_context)
  VALUES (p_error_signature, p_error_type, p_field_name, p_error_description, p_node_context)
  ON CONFLICT (error_signature) DO UPDATE SET
    occurrence_count = error_patterns.occurrence_count + 1,
    last_seen_at = NOW(),
    -- Update node_context if provided and current is null
    node_context = COALESCE(error_patterns.node_context, EXCLUDED.node_context)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to upsert fix attempt (increment counts based on success)
CREATE OR REPLACE FUNCTION upsert_fix_attempt(
  p_error_pattern_id UUID,
  p_fix_description TEXT,
  p_fix_diff JSONB,
  p_success BOOLEAN
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO fix_attempts (error_pattern_id, fix_description, fix_diff, success, success_count, failure_count)
  VALUES (
    p_error_pattern_id, 
    p_fix_description, 
    p_fix_diff, 
    p_success,
    CASE WHEN p_success THEN 1 ELSE 0 END,
    CASE WHEN p_success THEN 0 ELSE 1 END
  )
  ON CONFLICT (error_pattern_id, fix_description) DO UPDATE SET
    applied_count = fix_attempts.applied_count + 1,
    success_count = fix_attempts.success_count + CASE WHEN p_success THEN 1 ELSE 0 END,
    failure_count = fix_attempts.failure_count + CASE WHEN p_success THEN 0 ELSE 1 END,
    last_applied_at = NOW(),
    -- Update fix_diff if provided
    fix_diff = COALESCE(EXCLUDED.fix_diff, fix_attempts.fix_diff)
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
