-- Migration: Add has_enkel_soknad column to jobs table
-- This column tracks whether the job has "Enkel søknad" (Easy Apply) button on FINN.no

ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS has_enkel_soknad boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.jobs.has_enkel_soknad IS 'Indicates if the job has "Enkel søknad" (Easy Apply) button - detected during text extraction';

-- Create index for filtering jobs with easy apply
CREATE INDEX IF NOT EXISTS idx_jobs_enkel_soknad ON public.jobs(has_enkel_soknad) WHERE has_enkel_soknad = true;
