-- Migration: Add 'email' as valid application_form_type
-- For jobs where application is done via direct email (mailto: link)

-- Update the comment to reflect all valid form types
COMMENT ON COLUMN public.jobs.application_form_type IS 'Type of application: finn_easy, external_form, external_registration, email, nav_direct, unknown';

-- Note: PostgreSQL text columns don't have constraints by default,
-- so 'email' and 'nav_direct' values can be inserted without migration.
-- This file is for documentation purposes.

-- Example values:
-- 'finn_easy' - FINN's internal "Enkel søknad" form
-- 'external_form' - External website with application form
-- 'external_registration' - External site requiring account registration (Webcruiter, etc.)
-- 'email' - Direct email application (mailto: link)
-- 'nav_direct' - NAV job with direct employer contact
-- 'unknown' - Type not yet determined
-- NULL - Not yet checked
