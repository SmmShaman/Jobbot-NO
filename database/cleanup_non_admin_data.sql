-- Cleanup jobs and applications for non-admin users
-- Run this in Supabase SQL Editor

-- First, let's see what we're dealing with
SELECT
    us.user_id,
    us.role,
    us.telegram_chat_id,
    us.created_at,
    (SELECT COUNT(*) FROM jobs j WHERE j.user_id = us.user_id) as job_count,
    (SELECT COUNT(*) FROM applications a WHERE a.user_id = us.user_id) as app_count
FROM user_settings us
ORDER BY us.created_at ASC;

-- Find the admin user_id (first user or role='admin')
-- This will be preserved
WITH admin_user AS (
    SELECT user_id
    FROM user_settings
    WHERE role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
)
SELECT user_id as admin_user_id FROM admin_user;

-- DELETE applications for non-admin users
DELETE FROM applications
WHERE user_id NOT IN (
    SELECT user_id
    FROM user_settings
    WHERE role = 'admin'
);

-- DELETE jobs for non-admin users
DELETE FROM jobs
WHERE user_id NOT IN (
    SELECT user_id
    FROM user_settings
    WHERE role = 'admin'
);

-- Verify cleanup
SELECT
    us.user_id,
    us.role,
    (SELECT COUNT(*) FROM jobs j WHERE j.user_id = us.user_id) as job_count,
    (SELECT COUNT(*) FROM applications a WHERE a.user_id = us.user_id) as app_count
FROM user_settings us
ORDER BY us.created_at ASC;
