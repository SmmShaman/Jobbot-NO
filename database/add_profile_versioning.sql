-- Migration: Add profile versioning and source tracking to cv_profiles
-- Run this in Supabase SQL Editor

-- 1. Add source_type to track how profile was created
ALTER TABLE public.cv_profiles
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'generated';
-- Values: 'generated' (from AI analysis), 'edited' (manually modified)

-- 2. Add raw_resume_text to store extracted text from uploaded PDFs
ALTER TABLE public.cv_profiles
ADD COLUMN IF NOT EXISTS raw_resume_text text;

-- 3. Add parent_profile_id to track which profile was edited to create this one
ALTER TABLE public.cv_profiles
ADD COLUMN IF NOT EXISTS parent_profile_id uuid REFERENCES public.cv_profiles(id);

-- 4. Add profile_name for better identification
ALTER TABLE public.cv_profiles
ADD COLUMN IF NOT EXISTS profile_name text;

-- 5. Update existing profiles to have source_type='generated'
UPDATE public.cv_profiles
SET source_type = 'generated'
WHERE source_type IS NULL;

-- 6. Refresh schema cache
NOTIFY pgrst, 'reload config';

-- Example of profile creation flow:
--
-- 1. Upload PDF → Extract Text → Create Profile:
--    INSERT INTO cv_profiles (source_type, raw_resume_text, content, is_active)
--    VALUES ('generated', 'extracted text...', 'AI analyzed content...', true)
--
-- 2. Edit profile in UI → Create new profile as copy:
--    INSERT INTO cv_profiles (source_type, parent_profile_id, content, is_active)
--    VALUES ('edited', 'original-uuid', 'modified content...', false)
