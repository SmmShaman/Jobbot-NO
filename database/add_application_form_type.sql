-- Migration: Add application form type detection system
-- This tracks whether job applications go through FINN, external forms, or require registration

-- 1. Create recruitment_agencies table to cache known agencies
CREATE TABLE IF NOT EXISTS public.recruitment_agencies (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    domain text UNIQUE NOT NULL,
    name text,
    form_type text NOT NULL CHECK (form_type IN ('form', 'registration', 'unknown')),
    detection_method text DEFAULT 'auto', -- 'auto' or 'manual'
    sample_urls text[], -- example URLs for reference
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Add index for fast domain lookup
CREATE INDEX IF NOT EXISTS idx_recruitment_agencies_domain ON public.recruitment_agencies(domain);

-- 2. Add application_form_type column to jobs table
-- Values: 'finn_easy' (Enkel søknad), 'external_form', 'external_registration', 'unknown', null (not checked)
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS application_form_type text;

-- 3. Add external_apply_url to store the actual application URL (if different from job URL)
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS external_apply_url text;

-- 4. Insert some known Norwegian recruitment agencies
INSERT INTO public.recruitment_agencies (domain, name, form_type, detection_method) VALUES
    ('webcruiter.no', 'Webcruiter', 'registration', 'manual'),
    ('webcruiter.com', 'Webcruiter', 'registration', 'manual'),
    ('jobylon.com', 'Jobylon', 'form', 'manual'),
    ('teamtailor.com', 'Teamtailor', 'registration', 'manual'),
    ('cvpartner.com', 'CV Partner', 'registration', 'manual'),
    ('recman.no', 'Recman', 'registration', 'manual'),
    ('easycruit.com', 'Easycruit', 'registration', 'manual'),
    ('varbi.com', 'Varbi', 'registration', 'manual'),
    ('jobbnorge.no', 'Jobbnorge', 'form', 'manual'),
    ('karrierestart.no', 'Karrierestart', 'form', 'manual'),
    ('finn.no', 'FINN', 'form', 'manual'),
    ('nav.no', 'NAV', 'form', 'manual'),
    ('linkedin.com', 'LinkedIn', 'registration', 'manual'),
    ('greenhouse.io', 'Greenhouse', 'form', 'manual'),
    ('lever.co', 'Lever', 'form', 'manual'),
    ('workday.com', 'Workday', 'registration', 'manual'),
    ('smartrecruiters.com', 'SmartRecruiters', 'registration', 'manual'),
    ('talentech.com', 'Talentech', 'registration', 'manual'),
    ('hrtool.no', 'HR Tool', 'registration', 'manual')
ON CONFLICT (domain) DO NOTHING;

-- Add comments
COMMENT ON TABLE public.recruitment_agencies IS 'Cache of known recruitment agencies and their application form types';
COMMENT ON COLUMN public.jobs.application_form_type IS 'Type of application: finn_easy, external_form, external_registration, unknown';
COMMENT ON COLUMN public.jobs.external_apply_url IS 'URL to external application page if not using FINN direct apply';
