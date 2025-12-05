-- Migration: Create finn_auth_requests table for 2FA code handling
-- Used by Skyvern webhook to receive verification codes from Telegram

CREATE TABLE IF NOT EXISTS finn_auth_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identification
    user_id UUID REFERENCES auth.users(id),
    telegram_chat_id TEXT NOT NULL,
    totp_identifier TEXT NOT NULL,  -- email or phone used for 2FA

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, code_requested, code_received, completed, expired, failed

    -- Verification code
    verification_code TEXT,  -- code entered by user in Telegram
    code_requested_at TIMESTAMPTZ,  -- when Skyvern requested the code
    code_received_at TIMESTAMPTZ,   -- when user entered the code

    -- Skyvern task info
    skyvern_task_id TEXT,

    -- Result
    success BOOLEAN,
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes')  -- 10 min timeout
);

-- Index for quick lookup by Skyvern webhook
CREATE INDEX IF NOT EXISTS idx_finn_auth_totp_identifier
ON finn_auth_requests(totp_identifier, status);

-- Index for Telegram bot lookup
CREATE INDEX IF NOT EXISTS idx_finn_auth_telegram_chat
ON finn_auth_requests(telegram_chat_id, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_finn_auth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finn_auth_requests_updated_at
    BEFORE UPDATE ON finn_auth_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_finn_auth_updated_at();

-- RLS policies (permissive for now - single user mode)
ALTER TABLE finn_auth_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on finn_auth_requests"
ON finn_auth_requests FOR ALL
USING (true)
WITH CHECK (true);

-- Comments
COMMENT ON TABLE finn_auth_requests IS 'Stores 2FA verification requests for FINN.no login via Skyvern';
COMMENT ON COLUMN finn_auth_requests.totp_identifier IS 'Email or phone number where 2FA code is sent';
COMMENT ON COLUMN finn_auth_requests.status IS 'pending=created, code_requested=Skyvern waiting, code_received=user entered, completed=success, expired=timeout, failed=error';
