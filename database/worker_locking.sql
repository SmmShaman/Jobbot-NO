-- Worker Locking: prevent multiple workers from processing the same application
-- Run this migration after worker_heartbeat.sql and setup_applications.sql

-- 1. Add locking columns to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 2. Index for fast claim queries
CREATE INDEX IF NOT EXISTS idx_applications_claim
  ON applications (status, worker_id)
  WHERE status IN ('sending', 'approved') AND worker_id IS NULL;

-- 3. Atomic claim function (optimistic locking with SKIP LOCKED)
CREATE OR REPLACE FUNCTION claim_applications(
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS SETOF applications
LANGUAGE sql
AS $$
  UPDATE applications
  SET worker_id = p_worker_id,
      claimed_at = now(),
      status = CASE WHEN status = 'approved' THEN 'sending' ELSE status END
  WHERE id IN (
    SELECT id FROM applications
    WHERE status IN ('sending', 'approved')
      AND worker_id IS NULL
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- 4. Release stale claims (for crashed workers)
CREATE OR REPLACE FUNCTION release_stale_claims(
  p_timeout_minutes integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  released integer;
BEGIN
  UPDATE applications
  SET worker_id = NULL, claimed_at = NULL
  WHERE worker_id IS NOT NULL
    AND claimed_at < now() - (p_timeout_minutes || ' minutes')::interval
    AND status = 'sending';
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

-- 5. Extend worker_heartbeat for multi-worker support
ALTER TABLE worker_heartbeat ALTER COLUMN id DROP DEFAULT;
ALTER TABLE worker_heartbeat ADD COLUMN IF NOT EXISTS hostname text;
ALTER TABLE worker_heartbeat ADD COLUMN IF NOT EXISTS location text;
