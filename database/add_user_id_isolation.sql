-- Multi-user isolation: add user_id to site_credentials
-- and unique constraint on user_knowledge_base

-- 1. Add user_id to site_credentials (already applied via Management API)
ALTER TABLE site_credentials ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Create unique index on (question, user_id) for proper per-user KB upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_kb_question_user ON user_knowledge_base(question, user_id);

-- 3. Create index for faster credential lookups per user
CREATE INDEX IF NOT EXISTS idx_site_credentials_user_domain ON site_credentials(user_id, site_domain);
