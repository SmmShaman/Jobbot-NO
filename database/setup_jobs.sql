-- Створення таблиці jobs з правильними RLS політиками

-- 1. Створюємо таблицю jobs
create table if not exists public.jobs (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  company text not null,
  location text,
  job_url text unique,
  source text,
  description text,
  status text default 'NEW',
  relevance_score integer,
  ai_recommendation text,
  tasks_summary text,
  application_id uuid references public.applications(id),
  cost_usd numeric default 0,
  analysis_metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Вмикаємо RLS
alter table public.jobs enable row level security;

-- 3. Створюємо політики доступу
-- Дозволяємо читати всім
create policy "Enable read access for all users" on public.jobs for select using (true);

-- Дозволяємо вставку всім
create policy "Enable insert access for all users" on public.jobs for insert with check (true);

-- Дозволяємо оновлення всім
create policy "Enable update access for all users" on public.jobs for update using (true);

-- Дозволяємо видалення всім
create policy "Enable delete access for all users" on public.jobs for delete using (true);

-- 4. Додаємо індекси для оптимізації
create index if not exists idx_jobs_status on public.jobs(status);
create index if not exists idx_jobs_source on public.jobs(source);
create index if not exists idx_jobs_created_at on public.jobs(created_at);
create index if not exists idx_jobs_job_url on public.jobs(job_url);

-- 5. Додаємо тригер для оновлення updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger handle_jobs_updated_at
  before update on public.jobs
  for each row execute procedure public.handle_updated_at();