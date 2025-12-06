-- Виправлення RLS політик для таблиці jobs

-- 1. Спочатку видаляємо існуючі політики, якщо вони є
DROP POLICY IF EXISTS "Enable read access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.jobs;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.jobs;

-- 2. Створюємо нові політики з правильним синтаксисом
-- Політика для читання - дозволяємо всім
CREATE POLICY "Enable read access for all users" ON public.jobs
FOR SELECT USING (true);

-- Політика для вставки - дозволяємо всім
CREATE POLICY "Enable insert access for all users" ON public.jobs
FOR INSERT WITH CHECK (true);

-- Політика для оновлення - дозволяємо всім
CREATE POLICY "Enable update access for all users" ON public.jobs
FOR UPDATE USING (true);

-- Політика для видалення - дозволяємо всім
CREATE POLICY "Enable delete access for all users" ON public.jobs
FOR DELETE USING (true);

-- 3. Перевіряємо, чи RLS увімкнений
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- 4. Перевірка результату
SELECT 
    'RLS Policies for jobs table fixed' as status,
    count(*) as policy_count
FROM pg_policies 
WHERE tablename = 'jobs';