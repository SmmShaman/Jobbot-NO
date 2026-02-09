-- Worker heartbeat table for active worker detection
-- Used by /worker Telegram command to check if worker process is alive

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id text PRIMARY KEY DEFAULT 'main',
  last_heartbeat timestamptz,
  skyvern_healthy boolean DEFAULT false,
  poll_cycle integer DEFAULT 0,
  applications_processed integer DEFAULT 0,
  started_at timestamptz
);

ALTER TABLE worker_heartbeat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON worker_heartbeat FOR ALL USING (true);

-- Helper function to get user email from auth.users (for /worker command)
CREATE OR REPLACE FUNCTION get_user_email(uid uuid)
RETURNS TABLE(email text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT email::text FROM auth.users WHERE id = uid;
$$;
