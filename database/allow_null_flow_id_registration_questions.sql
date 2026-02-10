-- ============================================================================
-- Allow NULL flow_id in registration_questions table
-- Needed for Skyvern Q&A questions that are not part of a registration flow
-- ============================================================================

-- Drop the existing foreign key constraint
ALTER TABLE registration_questions
    ALTER COLUMN flow_id DROP NOT NULL;

-- Add a field_type column to distinguish question sources
-- 'registration' = from registration flow, 'skyvern_form' = from Skyvern form filling
DO $$ BEGIN
    ALTER TABLE registration_questions ADD COLUMN IF NOT EXISTS field_context TEXT DEFAULT 'registration';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add user_id column for multi-user support (Q&A without flow_id)
DO $$ BEGIN
    ALTER TABLE registration_questions ADD COLUMN IF NOT EXISTS user_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add job_id for linking Q&A to specific job application
DO $$ BEGIN
    ALTER TABLE registration_questions ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Index for finding pending skyvern_form questions by user
CREATE INDEX IF NOT EXISTS idx_registration_questions_user_pending
    ON registration_questions(user_id, status) WHERE status = 'pending';
