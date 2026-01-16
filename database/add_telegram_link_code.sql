-- Migration: Add Telegram link code for secure account linking
-- This allows multi-user support where users can link their Telegram via a unique code

-- Add columns for link code and expiration
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS telegram_link_code TEXT,
ADD COLUMN IF NOT EXISTS telegram_link_code_expires_at TIMESTAMPTZ;

-- Index for fast lookup by code (only on non-null codes)
CREATE INDEX IF NOT EXISTS idx_user_settings_telegram_link_code
ON user_settings(telegram_link_code) WHERE telegram_link_code IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN user_settings.telegram_link_code IS 'Unique 6-character code for linking Telegram account';
COMMENT ON COLUMN user_settings.telegram_link_code_expires_at IS 'Expiration time for the link code (24 hours from generation)';
