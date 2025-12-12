-- Application Confirmations Table
-- Tracks confirmation requests before Skyvern submits forms

CREATE TABLE IF NOT EXISTS application_confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    telegram_chat_id TEXT NOT NULL,

    -- Payload that will be submitted
    payload JSONB NOT NULL DEFAULT '{}',
    -- Contains: full_name, email, phone, cover_letter_preview, external_url

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending',
    -- pending: waiting for user response
    -- confirmed: user approved, ready to submit
    -- cancelled: user cancelled
    -- timeout: no response within timeout period
    -- submitted: Skyvern task completed

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    confirmed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,

    -- Telegram message ID for editing
    telegram_message_id TEXT
);

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_app_confirmations_status
ON application_confirmations(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_app_confirmations_app_id
ON application_confirmations(application_id);

-- RLS Policies (permissive for single-user system)
ALTER TABLE application_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for application_confirmations" ON application_confirmations;
CREATE POLICY "Allow all for application_confirmations"
ON application_confirmations FOR ALL
USING (true)
WITH CHECK (true);

-- Grant permissions
GRANT ALL ON application_confirmations TO authenticated;
GRANT ALL ON application_confirmations TO anon;
GRANT ALL ON application_confirmations TO service_role;
