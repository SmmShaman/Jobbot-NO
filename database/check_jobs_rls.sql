-- Перевірка RLS політик для таблиці jobs
SELECT 
    schemaname,
    tablename,
    rowsecurity,
    forcerlspolicy 
FROM pg_tables 
WHERE tablename = 'jobs';

-- Перевірка існуючих політик
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'jobs';

-- Перевірка кількості записів без RLS (використовуючи service_role)
-- Цей запит потрібно виконувати з service_role правами
SELECT count(*) as total_jobs 
FROM public.jobs;

-- Перевірка найновіших записів
SELECT 
    id, 
    title, 
    status, 
    created_at,
    updated_at
FROM public.jobs 
ORDER BY created_at DESC 
LIMIT 5;