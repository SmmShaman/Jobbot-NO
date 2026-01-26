-- Виправлення RLS для мульти-користувацького режиму
-- Кожен користувач бачить тільки СВОЇ дані

-- ============================================
-- JOBS TABLE
-- ============================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can insert own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;

-- Користувачі бачать тільки свої jobs
CREATE POLICY "Users can view own jobs" ON public.jobs
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own jobs" ON public.jobs
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs" ON public.jobs
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own jobs" ON public.jobs
FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- APPLICATIONS TABLE
-- ============================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.applications;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.applications;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.applications;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.applications;
DROP POLICY IF EXISTS "Users can view own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can insert own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update own applications" ON public.applications;
DROP POLICY IF EXISTS "Users can delete own applications" ON public.applications;

CREATE POLICY "Users can view own applications" ON public.applications
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own applications" ON public.applications
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own applications" ON public.applications
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own applications" ON public.applications
FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CV_PROFILES TABLE
-- ============================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.cv_profiles;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.cv_profiles;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.cv_profiles;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.cv_profiles;
DROP POLICY IF EXISTS "Users can view own profiles" ON public.cv_profiles;
DROP POLICY IF EXISTS "Users can insert own profiles" ON public.cv_profiles;
DROP POLICY IF EXISTS "Users can update own profiles" ON public.cv_profiles;
DROP POLICY IF EXISTS "Users can delete own profiles" ON public.cv_profiles;

CREATE POLICY "Users can view own profiles" ON public.cv_profiles
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profiles" ON public.cv_profiles
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profiles" ON public.cv_profiles
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own profiles" ON public.cv_profiles
FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.cv_profiles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USER_SETTINGS TABLE
-- ============================================
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_settings;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.user_settings;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.user_settings;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.user_settings;
DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
DROP POLICY IF EXISTS "Users can delete own settings" ON public.user_settings;

CREATE POLICY "Users can view own settings" ON public.user_settings
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON public.user_settings
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON public.user_settings
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings" ON public.user_settings
FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ПЕРЕВІРКА
-- ============================================
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('jobs', 'applications', 'cv_profiles', 'user_settings')
ORDER BY tablename, cmd;
