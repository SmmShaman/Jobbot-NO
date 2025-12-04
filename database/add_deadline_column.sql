-- Add deadline (søknadsfrist) column to jobs table
-- This stores the application deadline date

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS deadline date;

-- Add index for filtering expired jobs
CREATE INDEX IF NOT EXISTS idx_jobs_deadline ON public.jobs (deadline);

-- Comment for documentation
COMMENT ON COLUMN public.jobs.deadline IS 'Application deadline (søknadsfrist) - date type for easy comparison';
