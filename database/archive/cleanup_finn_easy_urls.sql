-- Cleanup script: Clear wrong external_apply_url for FINN Easy Apply jobs
-- Run this in Supabase SQL Editor

-- Step 1: Show jobs that will be affected (preview)
SELECT
    id,
    title,
    has_enkel_soknad,
    application_form_type,
    external_apply_url,
    job_url
FROM jobs
WHERE (has_enkel_soknad = true OR application_form_type = 'finn_easy')
  AND external_apply_url IS NOT NULL;

-- Step 2: Clear external_apply_url for FINN Easy Apply jobs
-- Uncomment to run:
/*
UPDATE jobs
SET external_apply_url = NULL
WHERE (has_enkel_soknad = true OR application_form_type = 'finn_easy')
  AND external_apply_url IS NOT NULL;
*/

-- Step 3: Verify cleanup
-- SELECT COUNT(*) as cleaned_jobs
-- FROM jobs
-- WHERE (has_enkel_soknad = true OR application_form_type = 'finn_easy')
--   AND external_apply_url IS NULL;
