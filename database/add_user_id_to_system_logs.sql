-- Migration: Add user_id to system_logs for multi-user data isolation
-- This allows each user to see only their own logs and costs
-- Date: 2026-01-17

-- Step 1: Add user_id column
ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Step 2: Create index for faster user-specific queries
CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON system_logs(user_id);

-- Step 3: Drop old permissive RLS policies
DROP POLICY IF EXISTS "Enable read access for all users" ON system_logs;
DROP POLICY IF EXISTS "Enable insert access for all users" ON system_logs;
DROP POLICY IF EXISTS "Allow all reads" ON system_logs;
DROP POLICY IF EXISTS "Allow all inserts" ON system_logs;

-- Step 4: Create new RLS policies for user isolation
-- Users can only read their own logs
CREATE POLICY "Users can read own logs" ON system_logs
  FOR SELECT USING (
    auth.uid() = user_id OR
    user_id IS NULL  -- Allow reading legacy logs without user_id (admin only scenario)
  );

-- Users can only insert logs for themselves
CREATE POLICY "Users can insert own logs" ON system_logs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR
    user_id IS NULL  -- Allow service role to insert without user_id
  );

-- Service role bypass (for Edge Functions using service_role_key)
-- Note: Service role already bypasses RLS by default in Supabase

-- Step 5: Clean up old logs (optional - run this if you want a fresh start)
-- WARNING: This will delete ALL existing logs!
-- TRUNCATE TABLE system_logs;

-- Verification query (run manually to check policies):
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies WHERE tablename = 'system_logs';
