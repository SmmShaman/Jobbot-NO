-- ============================================================================
-- Add Magic Link Support to site_credentials
-- ============================================================================

-- Add auth_type column for distinguishing authentication methods
ALTER TABLE site_credentials
ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'password' CHECK (auth_type IN (
    'password',                               -- Standard password login
    'magic_link',                             -- Email magic link login
    'oauth',                                  -- OAuth (Google, LinkedIn, etc.)
    'unknown'                                 -- Unknown/not yet determined
));

-- Add notes column for additional info
ALTER TABLE site_credentials
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Drop and recreate status check constraint to include magic_link
ALTER TABLE site_credentials DROP CONSTRAINT IF EXISTS site_credentials_status_check;

ALTER TABLE site_credentials
ADD CONSTRAINT site_credentials_status_check CHECK (status IN (
    'active',                                 -- Ready to use
    'needs_verification',                     -- Email/phone verification pending
    'verification_failed',                    -- Verification attempt failed
    'login_failed',                           -- Last login attempt failed
    'expired',                                -- Password expired or account locked
    'inactive',                               -- Manually deactivated
    'magic_link'                              -- Site uses magic link - no auto-login possible
));

-- Update existing magic_link verification methods to auth_type
UPDATE site_credentials
SET auth_type = 'magic_link'
WHERE verification_method = 'email_link';

-- Add comment
COMMENT ON COLUMN site_credentials.auth_type IS 'Type of authentication: password, magic_link, oauth';
COMMENT ON COLUMN site_credentials.notes IS 'Additional notes about the site or credentials';

-- Allow null email/password for magic_link sites
ALTER TABLE site_credentials ALTER COLUMN email DROP NOT NULL;
ALTER TABLE site_credentials ALTER COLUMN password DROP NOT NULL;
