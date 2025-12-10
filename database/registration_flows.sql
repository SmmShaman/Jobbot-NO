-- ============================================================================
-- Registration Flows Table
-- Tracks the process of registering on recruitment sites
-- ============================================================================

-- Drop existing table if exists (for clean migration)
DROP TABLE IF EXISTS registration_flows CASCADE;

-- Create table for tracking registration flows
CREATE TABLE registration_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Site identification
    site_domain TEXT NOT NULL,                    -- 'webcruiter.no', 'easycruit.com', etc.
    site_name TEXT,                               -- Human-readable name
    registration_url TEXT NOT NULL,               -- URL where registration started

    -- Related job (optional - if registration triggered by job application)
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',                                -- Waiting to start
        'analyzing',                              -- Skyvern analyzing the registration form
        'registering',                            -- Filling registration form
        'waiting_for_user',                       -- Waiting for user input (question/verification)
        'email_verification',                     -- Email verification pending
        'sms_verification',                       -- SMS verification pending
        'link_verification',                      -- Link click verification pending
        'review_pending',                         -- Waiting for user confirmation before submit
        'submitting',                             -- Submitting final registration
        'completed',                              -- Registration successful
        'failed',                                 -- Registration failed
        'cancelled',                              -- Cancelled by user
        'timeout'                                 -- Timed out waiting for user
    )),

    -- Skyvern task tracking
    skyvern_task_id TEXT,                         -- Current Skyvern task ID
    skyvern_browser_session_id TEXT,              -- Browser session for multi-step registration

    -- Credentials being created
    registration_email TEXT,                      -- Email being used for registration
    generated_password TEXT,                      -- Auto-generated password

    -- Form data collected during registration
    form_fields JSONB DEFAULT '[]',               -- Array of {field_name, field_type, value, source}
    -- source: 'profile' | 'generated' | 'user_input' | 'default'

    -- Questions asked to user
    pending_question JSONB,                       -- Current question waiting for answer
    -- Structure: {question_id, field_name, question_text, options[], asked_at}

    -- All Q&A history
    qa_history JSONB DEFAULT '[]',                -- Array of {question, answer, answered_at, field_name}

    -- Verification tracking
    verification_type TEXT CHECK (verification_type IN (
        'none', 'email_code', 'email_link', 'sms_code', 'phone_call'
    )),
    verification_requested_at TIMESTAMPTZ,
    verification_code TEXT,                       -- Code entered by user
    verification_expires_at TIMESTAMPTZ,          -- When verification expires

    -- Telegram integration
    telegram_chat_id TEXT,                        -- Chat ID for notifications
    telegram_message_id INTEGER,                  -- Last message ID (for editing)

    -- Error tracking
    error_message TEXT,                           -- Last error message
    error_details JSONB,                          -- Detailed error info
    retry_count INTEGER DEFAULT 0,                -- Number of retry attempts

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,                       -- When registration actually started
    completed_at TIMESTAMPTZ,                     -- When registration completed
    expires_at TIMESTAMPTZ                        -- Overall timeout for the flow
);

-- Create indexes
CREATE INDEX idx_registration_flows_status ON registration_flows(status);
CREATE INDEX idx_registration_flows_domain ON registration_flows(site_domain);
CREATE INDEX idx_registration_flows_job ON registration_flows(job_id);
CREATE INDEX idx_registration_flows_skyvern ON registration_flows(skyvern_task_id);
CREATE INDEX idx_registration_flows_pending ON registration_flows(status) WHERE status IN ('pending', 'waiting_for_user', 'email_verification', 'sms_verification');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_registration_flows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_registration_flows_updated_at
    BEFORE UPDATE ON registration_flows
    FOR EACH ROW
    EXECUTE FUNCTION update_registration_flows_updated_at();

-- RLS Policies (permissive for single-user system)
ALTER TABLE registration_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on registration_flows"
    ON registration_flows
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Grant access
GRANT ALL ON registration_flows TO authenticated;
GRANT ALL ON registration_flows TO service_role;
GRANT ALL ON registration_flows TO anon;

-- ============================================================================
-- Registration Questions Table (for detailed Q&A tracking)
-- ============================================================================

DROP TABLE IF EXISTS registration_questions CASCADE;

CREATE TABLE registration_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to registration flow
    flow_id UUID NOT NULL REFERENCES registration_flows(id) ON DELETE CASCADE,

    -- Question details
    field_name TEXT NOT NULL,                     -- HTML field name/id
    field_type TEXT,                              -- 'text', 'select', 'radio', 'checkbox', 'file', etc.
    question_text TEXT NOT NULL,                  -- Question shown to user
    options JSONB,                                -- Available options for select/radio

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',                                -- Waiting for answer
        'answered',                               -- Answer received
        'skipped',                                -- User skipped
        'timeout',                                -- Timed out
        'auto_filled'                             -- Filled from profile automatically
    )),

    -- Answer
    answer TEXT,                                  -- User's answer
    answer_source TEXT CHECK (answer_source IN (
        'user_telegram',                          -- User answered via Telegram
        'profile',                                -- Taken from CV profile
        'generated',                              -- Auto-generated (e.g., password)
        'default'                                 -- Default value used
    )),

    -- Timestamps
    asked_at TIMESTAMPTZ DEFAULT NOW(),
    answered_at TIMESTAMPTZ,
    timeout_at TIMESTAMPTZ,                       -- When this question times out

    -- Telegram tracking
    telegram_message_id INTEGER                   -- Message ID for this question
);

-- Create indexes
CREATE INDEX idx_registration_questions_flow ON registration_questions(flow_id);
CREATE INDEX idx_registration_questions_status ON registration_questions(status);
CREATE INDEX idx_registration_questions_pending ON registration_questions(flow_id, status) WHERE status = 'pending';

-- RLS Policies
ALTER TABLE registration_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on registration_questions"
    ON registration_questions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Grant access
GRANT ALL ON registration_questions TO authenticated;
GRANT ALL ON registration_questions TO service_role;
GRANT ALL ON registration_questions TO anon;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE registration_flows IS 'Tracks the complete registration process on recruitment sites';
COMMENT ON COLUMN registration_flows.form_fields IS 'All fields filled: [{field_name, field_type, value, source}]';
COMMENT ON COLUMN registration_flows.qa_history IS 'Complete Q&A history: [{question, answer, answered_at, field_name}]';
COMMENT ON COLUMN registration_flows.pending_question IS 'Current question awaiting user response';
COMMENT ON TABLE registration_questions IS 'Individual questions asked during registration';
