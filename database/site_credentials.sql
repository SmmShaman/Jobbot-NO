-- ============================================================================
-- Site Credentials Table
-- Stores login credentials for recruitment sites (Webcruiter, Easycruit, etc.)
-- ============================================================================

-- Drop existing table if exists (for clean migration)
DROP TABLE IF EXISTS site_credentials CASCADE;

-- Create table for storing site credentials
CREATE TABLE site_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Site identification
    site_domain TEXT NOT NULL,                    -- 'webcruiter.no', 'easycruit.com', etc.
    site_name TEXT,                               -- 'Webcruiter', 'Easycruit', etc.

    -- Credentials
    email TEXT NOT NULL,                          -- Login email
    password TEXT NOT NULL,                       -- Password (plain text - single user system)

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active',                                 -- Ready to use
        'needs_verification',                     -- Email/phone verification pending
        'verification_failed',                    -- Verification attempt failed
        'login_failed',                           -- Last login attempt failed
        'expired',                                -- Password expired or account locked
        'inactive'                                -- Manually deactivated
    )),

    -- Verification info
    verification_method TEXT CHECK (verification_method IN (
        'none',                                   -- No verification needed
        'email_code',                             -- Code sent to email
        'email_link',                             -- Verification link sent to email
        'sms_code',                               -- Code sent to SMS
        'phone_call'                              -- Phone verification call
    )),
    verification_email TEXT,                      -- Email used for verification (if different)
    verification_phone TEXT,                      -- Phone used for verification

    -- Skyvern integration
    skyvern_credential_id TEXT,                   -- ID in Skyvern's credential store (if synced)

    -- Profile data from registration (what was filled during registration)
    registration_data JSONB DEFAULT '{}',         -- All form fields filled during registration

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,                    -- Last successful login
    last_login_failed_at TIMESTAMPTZ,             -- Last failed login attempt
    verified_at TIMESTAMPTZ,                      -- When verification completed

    -- Constraints
    UNIQUE(site_domain, email)                    -- One credential per email per site
);

-- Create indexes
CREATE INDEX idx_site_credentials_domain ON site_credentials(site_domain);
CREATE INDEX idx_site_credentials_status ON site_credentials(status);
CREATE INDEX idx_site_credentials_email ON site_credentials(email);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_site_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_site_credentials_updated_at
    BEFORE UPDATE ON site_credentials
    FOR EACH ROW
    EXECUTE FUNCTION update_site_credentials_updated_at();

-- RLS Policies (permissive for single-user system)
ALTER TABLE site_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on site_credentials"
    ON site_credentials
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Grant access
GRANT ALL ON site_credentials TO authenticated;
GRANT ALL ON site_credentials TO service_role;
GRANT ALL ON site_credentials TO anon;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE site_credentials IS 'Stores login credentials for recruitment sites';
COMMENT ON COLUMN site_credentials.site_domain IS 'Domain of the recruitment site (e.g., webcruiter.no)';
COMMENT ON COLUMN site_credentials.password IS 'Password stored in plain text (single-user system)';
COMMENT ON COLUMN site_credentials.registration_data IS 'All form fields that were filled during registration';
COMMENT ON COLUMN site_credentials.skyvern_credential_id IS 'Reference to credential in Skyvern password store';
