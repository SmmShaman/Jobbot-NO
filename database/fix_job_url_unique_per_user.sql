-- Fix: Change job_url UNIQUE constraint to be per-user
-- Problem: Global UNIQUE(job_url) prevents same job for multiple users
-- Solution: UNIQUE(job_url, user_id) allows each user to have their own copy

-- 1. Drop the old global unique constraint
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_job_url_key;

-- 2. Drop the old index if exists
DROP INDEX IF EXISTS idx_jobs_job_url;

-- 3. Create new composite unique constraint (per-user unique)
ALTER TABLE public.jobs ADD CONSTRAINT jobs_job_url_user_id_key UNIQUE (job_url, user_id);

-- 4. Create new index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_jobs_job_url_user_id ON public.jobs(job_url, user_id);

-- 5. Verify the constraint
-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_name = 'jobs' AND constraint_type = 'UNIQUE';
