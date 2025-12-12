-- ============================================================================
-- Update Registration Flows Table for Confirmation Flow
-- ============================================================================

-- Add new columns for confirmation flow
ALTER TABLE registration_flows
ADD COLUMN IF NOT EXISTS profile_data_snapshot JSONB,           -- Profile data shown in confirmation
ADD COLUMN IF NOT EXISTS edited_profile_data JSONB,             -- Edited profile data
ADD COLUMN IF NOT EXISTS pending_edit_field TEXT,               -- Field currently being edited
ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,      -- When confirmation was sent
ADD COLUMN IF NOT EXISTS confirmation_expires_at TIMESTAMPTZ,   -- When confirmation expires
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;              -- When user confirmed

-- Drop the old constraint
ALTER TABLE registration_flows DROP CONSTRAINT IF EXISTS registration_flows_status_check;

-- Add new status constraint with additional statuses
ALTER TABLE registration_flows
ADD CONSTRAINT registration_flows_status_check CHECK (status IN (
    'pending',              -- Waiting to start
    'analyzing',            -- Skyvern analyzing the registration form
    'registering',          -- Filling registration form
    'waiting_for_user',     -- Waiting for user input (question/verification)
    'waiting_confirmation', -- NEW: Waiting for user to confirm data
    'editing',              -- NEW: User is editing fields
    'editing_field',        -- NEW: User is editing a specific field
    'confirmed',            -- NEW: User confirmed data
    'email_verification',   -- Email verification pending
    'sms_verification',     -- SMS verification pending
    'link_verification',    -- Link click verification pending
    'review_pending',       -- Waiting for user confirmation before submit
    'submitting',           -- Submitting final registration
    'completed',            -- Registration successful
    'failed',               -- Registration failed
    'cancelled',            -- Cancelled by user
    'timeout'               -- Timed out waiting for user
));

-- Update index for pending flows
DROP INDEX IF EXISTS idx_registration_flows_pending;
CREATE INDEX idx_registration_flows_pending ON registration_flows(status)
WHERE status IN ('pending', 'waiting_for_user', 'waiting_confirmation', 'editing', 'editing_field', 'email_verification', 'sms_verification');

-- Comments
COMMENT ON COLUMN registration_flows.profile_data_snapshot IS 'Profile data shown in confirmation message';
COMMENT ON COLUMN registration_flows.edited_profile_data IS 'Profile data after user edits (used for registration)';
COMMENT ON COLUMN registration_flows.pending_edit_field IS 'Name of field currently being edited by user';
COMMENT ON COLUMN registration_flows.confirmation_sent_at IS 'When confirmation request was sent to Telegram';
COMMENT ON COLUMN registration_flows.confirmation_expires_at IS 'When confirmation request expires';
COMMENT ON COLUMN registration_flows.confirmed_at IS 'When user confirmed the data';
