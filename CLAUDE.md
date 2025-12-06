# CLAUDE.md - JobBot Norway AI Assistant Guide

## Project Overview

**JobBot Norway** is a job search automation platform for the Norwegian job market with AI-powered job analysis, cover letter generation, and automated application submission.

### Technology Stack
- **Frontend**: React 19.2, TypeScript 5.8, Vite 6.2, TailwindCSS (CDN)
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
- **AI Services**: Azure OpenAI (chat completions)
- **Browser Automation**: Skyvern (local Docker)
- **Integrations**: Telegram Bot API, Web scraping (Cheerio)
- **Deployment**: Netlify (frontend), Supabase (functions via GitHub Actions)
- **CI/CD**: GitHub Actions (автоматичний деплой Edge Functions при мерджі в main)

---

## Project Structure

```
/home/user/Jobbot-NO/
├── .github/workflows/
│   ├── deploy-supabase-functions.yml   # Edge function deployment (auto on merge)
│   └── scheduled-scan.yml              # Daily job scanning cron
├── supabase/functions/                 # 10 Deno-based Edge Functions
│   ├── admin-actions/                  # User management
│   ├── analyze_profile/                # Resume analysis
│   ├── extract_job_text/               # Web scraping + Enkel søknad detection
│   ├── finn-apply/                     # FINN auto-apply queue handler
│   ├── finn-2fa-webhook/               # Skyvern 2FA code webhook
│   ├── generate_application/           # Cover letter generation
│   ├── job-analyzer/                   # Job fit analysis
│   ├── job-scraper/                    # Job board scraping
│   ├── scheduled-scanner/              # Cron job handler
│   └── telegram-bot/                   # Telegram integration
├── database/                           # SQL migration files
│   ├── add_enkel_soknad_column.sql     # has_enkel_soknad boolean
│   ├── add_application_form_type.sql   # Form type detection
│   ├── add_deadline_column.sql         # Søknadsfrist tracking
│   ├── finn_auth_requests.sql          # 2FA code handling table
│   └── ...
├── worker/                             # Python Skyvern workers (LOCAL ONLY!)
│   ├── auto_apply.py                   # Main application worker (Stage 2)
│   ├── extract_apply_url.py            # URL extraction daemon (Stage 1)
│   ├── forms/finn_login.py             # FINN login helper
│   ├── .env                            # Local secrets (NOT in git!)
│   ├── .env.example                    # Template for .env
│   ├── requirements.txt
│   └── README.md
├── pages/                              # React page components
├── components/                         # Reusable UI components
│   ├── JobTable.tsx                    # Job listing with FINN button
│   └── ...
├── services/
│   ├── api.ts                          # API wrapper with fillFinnForm()
│   └── ...
├── types.ts                            # TypeScript interfaces
└── vite.config.ts                      # Build configuration
```

---

## Key Features

### Job Management
- **Scraping**: Automated scraping from FINN, LinkedIn, NAV
- **Analysis**: AI-powered relevance scoring (0-100), aura detection, radar charts
- **Tracking**: Status workflow: NEW → ANALYZED → APPLIED → INTERVIEW → SENT/REJECTED
- **Map View**: Interactive geographic job visualization
- **Deadline Tracking**: Søknadsfrist (application deadline) with expired highlighting
- **Enkel Søknad Detection**: Automatic detection of FINN Easy Apply jobs

### Application System
- **Cover Letters**: AI-generated Norwegian cover letters
- **Status Tracking**: Draft → Approved → Sending → Manual Review → Sent/Failed
- **FINN Auto-Apply**: Automated submission via Skyvern with 2FA support
- **Form Type Detection**: finn_easy, external_form, external_registration

### FINN Enkel Søknad Auto-Apply
- **Dashboard Button**: "FINN Søknad" button for FINN Easy Apply jobs
- **2FA Flow**: Telegram bot receives 2FA codes via `/code XXXXXX` command
- **Architecture**: Edge Function queues → Local worker polls → Skyvern submits
- **ВАЖЛИВО**: Це ОСНОВНА робоча функція автоматизації, не тестова!

### CV Profiles
- **Multiple Profiles**: Users can have multiple CV profiles
- **Resume Upload**: PDF/DOC to Supabase Storage
- **AI Analysis**: Structured extraction (education, experience, skills)

### Automation
- **Scheduled Scanning**: Daily at 11:00 UTC via GitHub Actions
- **Telegram Bot**: Commands for manual triggers and notifications
- **Auto-apply Worker**: Python worker for Skyvern automation

---

## Database Schema

### Core Tables

**jobs**
- `id`, `title`, `company`, `location`, `job_url`, `source` (FINN/LINKEDIN/NAV)
- `status`: NEW | ANALYZED | APPLIED | REJECTED | INTERVIEW | SENT
- `analysis_metadata` (JSONB): aura, radar metrics, score
- `has_enkel_soknad`: boolean - FINN Easy Apply detection (ПРІОРИТЕТ!)
- `application_form_type`: finn_easy | external_form | external_registration | unknown
- `external_apply_url`: Direct URL to application form (може бути некоректним!)
- `deadline`: Søknadsfrist (application deadline)
- `cost_usd`: AI processing cost

**applications**
- `id`, `job_id`, `user_id`
- `cover_letter_no`, `cover_letter_uk`
- `status`: draft | approved | sending | manual_review | sent | failed | rejected
- `skyvern_metadata` (JSONB): task_id, finn_apply flag
- `cost_usd`

**cv_profiles**
- `id`, `user_id`, `profile_name`
- `content`: text summary
- `structured_content` (JSONB): detailed profile data
- `is_active`, `source_files`

**user_settings**
- `id`, `user_id`
- `telegram_chat_id`, `finn_search_urls[]`
- `application_prompt`, `profile_gen_prompt`, `job_analysis_prompt`
- `ui_language`, `preferred_analysis_language`
- `is_auto_scan_enabled`, `scan_time_utc`
- `role`: admin | user

**finn_auth_requests**
- `id`, `user_id`, `telegram_chat_id`
- `totp_identifier`: email for 2FA
- `status`: pending | code_requested | code_received | completed | expired | failed
- `verification_code`: 2FA code from user
- `skyvern_task_id`

**recruitment_agencies**
- `domain`, `name`, `form_type`: form | registration | unknown
- Cached agency data for form type detection

---

## Edge Functions (Supabase)

| Function | Purpose | JWT |
|----------|---------|-----|
| `scheduled-scanner` | Cron: Scrape jobs, run analysis pipeline | No |
| `telegram-bot` | Webhook: Telegram commands, trigger scans | No |
| `finn-apply` | Queue FINN applications for local worker | Yes |
| `finn-2fa-webhook` | Receive 2FA codes from Skyvern | No |
| `job-analyzer` | Analyze job fit, generate aura + radar metrics | Yes |
| `generate_application` | Generate cover letters via Azure OpenAI | Yes |
| `analyze_profile` | Extract & analyze resumes | Yes |
| `extract_job_text` | Scrape job description + detect Enkel søknad | Yes |
| `job-scraper` | Scrape jobs from job boards | Yes |
| `admin-actions` | User management (create, list, delete) | Yes |

**Deploy without JWT**: `telegram-bot`, `scheduled-scanner`, `finn-2fa-webhook`

**ВАЖЛИВО**: Деплой відбувається автоматично через GitHub Actions при мерджі в main!
Не потрібно вручну запускати `supabase functions deploy`.

---

## Two-Stage Skyvern Architecture

### КРИТИЧНО ВАЖЛИВО РОЗУМІТИ:

Skyvern працює в **двох етапах**, які виконують РІЗНІ задачі:

### Stage 1: URL Extraction (`extract_apply_url.py`)
- **Коли**: Автоматично під час сканування (daemon mode)
- **Що робить**: Знаходить external_apply_url для вакансій
- **Для яких вакансій**: НЕ finn_easy (зовнішні форми)
- **Результат**: Заповнює `external_apply_url` в базі

### Stage 2: Form Filling (`auto_apply.py`)
- **Коли**: Ручний тригер через кнопку "FINN Søknad"
- **Що робить**: Заповнює та відправляє форму на FINN
- **Для яких вакансій**: finn_easy (Enkel Søknad)
- **Результат**: Відправлена заявка

```
┌─────────────────────────────────────────────────────────────────┐
│                         STAGE 1 (Auto)                          │
│  extract_apply_url.py --daemon                                  │
│  - Runs during job scanning                                     │
│  - Extracts external URLs for NON-finn_easy jobs                │
│  - Skips finn_easy jobs (they don't need external URL)          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         STAGE 2 (Manual)                        │
│  auto_apply.py (polls for status='sending')                     │
│  - Triggered by "FINN Søknad" button click                      │
│  - Constructs finn.no/job/apply/{finnkode} URL                  │
│  - Logs into FINN with credentials from .env                    │
│  - Fills and submits application form                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Python Workers (Local)

### `auto_apply.py` - Main Worker (Stage 2)

Polls database every 10 seconds for applications with `status='sending'`.

**Features:**
- FINN Enkel Søknad detection with priority logic
- Multi-pattern finnkode extraction (query param, path, URL end)
- Skyvern task submission with 2FA webhook support
- Telegram notifications for progress and 2FA code requests
- Task status monitoring
- Startup validation for FINN credentials

**FINN URL Detection Priority (ВАЖЛИВО!):**
1. Якщо `has_enkel_soknad=true` → конструюємо URL з finnkode (ігноруємо external_apply_url!)
2. Якщо `external_apply_url` містить `finn.no/job/apply` → використовуємо його
3. Інакше → витягуємо finnkode з job_url

**Finnkode Extraction Patterns:**
```python
# Pattern 1: ?finnkode=123456789
# Pattern 2: /ad/123456789 or /ad.123456789
# Pattern 3: /123456789 (8+ digits at URL end)
```

**Environment (.env) - ОБОВ'ЯЗКОВО:**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
SKYVERN_API_URL=http://localhost:8000
SKYVERN_API_KEY=xxx
FINN_EMAIL=your-real-finn-email@example.com   # РЕАЛЬНИЙ email!
FINN_PASSWORD=your-real-password               # РЕАЛЬНИЙ пароль!
TELEGRAM_BOT_TOKEN=xxx
```

**Run:**
```bash
cd worker
source venv/bin/activate
python auto_apply.py
```

При старті воркер перевіряє наявність FINN_EMAIL та FINN_PASSWORD.
Якщо відсутні - виводить попередження.

### `extract_apply_url.py` - URL Extractor (Stage 1)

Extracts external application URLs using Skyvern.
**Пропускає finn_easy вакансії** - їм не потрібен external URL.

**Daemon mode:**
```bash
python extract_apply_url.py --daemon
```

**URL Validation:**
- Відхиляє search/filter URLs
- Відхиляє URLs що не є прямими посиланнями на форму

---

## FINN Auto-Apply Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD                                │
│  User clicks "FINN Søknad" button on job with Enkel søknad      │
│  Button active ONLY when: has_enkel_soknad=true                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FINN-APPLY EDGE FUNCTION                      │
│  - Checks has_enkel_soknad FIRST (пріоритет!)                   │
│  - Extracts finnkode using multiple patterns                     │
│  - Constructs finn.no/job/apply/{finnkode} URL                   │
│  - Updates application status to 'sending'                       │
│  - Sends Telegram notification                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL WORKER (auto_apply.py)                  │
│  - Polls DB every 10 sec for status='sending'                    │
│  - Uses same finnkode extraction logic                           │
│  - Reads FINN_EMAIL & FINN_PASSWORD from .env                    │
│  - Calls Skyvern with 2FA webhook URL                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SKYVERN                                  │
│  - Navigates to FINN apply page                                  │
│  - Logs in with FINN_EMAIL/FINN_PASSWORD                         │
│  - When 2FA needed → calls finn-2fa-webhook                      │
│  - Fills form with cover letter                                  │
│  - Submits application                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌──────────────────────┐              ┌──────────────────────┐
│  FINN-2FA-WEBHOOK    │              │   TELEGRAM BOT       │
│  Polls for code in   │◄────────────►│   User sends:        │
│  finn_auth_requests  │              │   /code 123456       │
└──────────────────────┘              └──────────────────────┘
```

---

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot |
| `/scan` | Trigger manual job scan |
| `/report` | Get statistics report |
| `/code XXXXXX` | Submit 2FA verification code |

**Inline Buttons:**
- Write application (Написати)
- Approve application (Затвердити)
- Send application (Відправити)
- Submit to FINN (FINN подати)
- View details

---

## Key Conventions

### TypeScript & React
- **Interfaces over Types:** Use `interface` for object shapes in `types.ts`
- **Functional Components:** All components are functional with hooks
- **Context for State:** Use React Context (AuthContext, LanguageContext)
- **Path Aliases:** Use `@/` prefix for imports

### Code Style
- **Component Files:** PascalCase (e.g., `JobTable.tsx`)
- **Service Files:** camelCase (e.g., `api.ts`)
- **Edge Functions:** snake_case preferred
- **Icons:** Lucide React icons exclusively
- **Styling:** Tailwind CSS utility classes

### Database
- **Table naming:** snake_case
- **JSONB fields:** For complex nested data
- **RLS Policies:** Permissive (single-user mode)

---

## Development

### Frontend
```bash
npm install
npm run dev
npm run build
```

### Worker
```bash
cd worker
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env from template
cp .env.example .env
# Edit .env with REAL credentials!

python auto_apply.py
```

### Deploy Edge Functions
**Автоматично через GitHub Actions при мерджі в main!**

Ручний деплой (якщо потрібно):
```bash
supabase functions deploy finn-apply --project-ref xxx
supabase functions deploy finn-2fa-webhook --no-verify-jwt --project-ref xxx
```

---

## Environment Variables

### Supabase Edge Functions
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
TELEGRAM_BOT_TOKEN
```

### Python Worker (.env) - MUST BE CONFIGURED!
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
SKYVERN_API_URL=http://localhost:8000
SKYVERN_API_KEY=xxx
FINN_EMAIL=your-real-email@example.com    # ОБОВ'ЯЗКОВО для FINN!
FINN_PASSWORD=your-real-password           # ОБОВ'ЯЗКОВО для FINN!
TELEGRAM_BOT_TOKEN=xxx
```

---

## Recent Changes (2025-12-06)

### FINN URL Extraction Improvements
- Added multi-pattern finnkode extraction:
  - Pattern 1: `?finnkode=123456789` (query parameter)
  - Pattern 2: `/ad/123456789` (path-based)
  - Pattern 3: `/123456789` (URL end, 8+ digits)
- Updated `finn-apply/index.ts` with all patterns
- Added `extract_finnkode()` helper in `auto_apply.py`

### URL Validation
- Added validation in `extract_job_text/index.ts` to reject search URLs
- Prevents incorrect `has_enkel_soknad` detection on search pages
- Invalid patterns: `finn.no/job/search`, `/search?`, `/filter?`

### Worker Improvements
- Added startup validation for FINN_EMAIL and FINN_PASSWORD
- Added `.env.example` with all required variables
- Priority logic: check `has_enkel_soknad` BEFORE `external_apply_url`

### FINN Auto-Apply System
- Added `finn-apply` Edge Function for queuing applications
- Added `finn-2fa-webhook` for Skyvern 2FA code handling
- Added `/code` command to Telegram bot
- Integrated FINN flow into `auto_apply.py` worker
- Added `finn_auth_requests` table for 2FA tracking

### Job Detection Improvements
- Added `has_enkel_soknad` column and detection
- Added `application_form_type` column (finn_easy, external_form, etc.)
- Added `external_apply_url` for direct apply links
- Added `deadline` (søknadsfrist) tracking
- Created `recruitment_agencies` table for form type detection

### UI Improvements
- Added "FINN Søknad" button in JobTable (active only for FINN Easy Apply)
- Added URL extraction status indicator
- Added clickable apply links in Подача column
- Added deadline display with expired job highlighting
- Added score slider filter

### Worker Architecture
- Changed from Realtime to polling (sync client limitation)
- Added finnkode extraction from job_url when external_apply_url missing
- Added detailed logging for FINN detection flow

---

## Known Issues

### Supabase Client
- `supabase.auth.*()` methods hang - use direct fetch
- Realtime requires async client - using polling instead
- Data queries work but slow (~1-1.5s)

### FINN Detection
- Jobs scraped before update may lack `external_apply_url`
- Worker extracts `finnkode` from `job_url` as fallback
- **Search URLs проблема**: Якщо job_url містить search URL замість job URL, finnkode не буде знайдено
- `extract_job_text` тепер відхиляє search URLs

### Common Debugging Issues
1. **"test@jobbot.no" в Skyvern**: Worker не читає .env файл → перевірте що .env існує і містить FINN_EMAIL
2. **"Cannot construct FINN apply URL"**: job_url не містить finnkode → перевірте URL в базі
3. **Неправильний has_enkel_soknad**: Вакансія створена з search URL → видаліть і перескануйте
4. **Кнопка "FINN Søknad" неактивна**: has_enkel_soknad=false → перевірте application_form_type

---

## Best Practices for AI Assistants

1. **Authentication**: Never use `supabase.auth.*()` - use direct fetch
2. **Edge Functions**: Deno-based; use `Deno.serve()` pattern
3. **Local Worker**: Can't be called from Edge Functions (localhost not reachable)
4. **FINN Apply Detection Priority**:
   - FIRST check `has_enkel_soknad`
   - THEN check `application_form_type === 'finn_easy'`
   - LAST check `external_apply_url` contains `finn.no/job/apply`
5. **Finnkode Extraction**: Use multiple patterns (query, path, URL end)
6. **URL Validation**: Always reject search/filter URLs before processing
7. **Translations**: Add strings to all 3 languages
8. **Types**: All interfaces in `types.ts`
9. **Errors**: Log with prefix + store in `system_logs`
10. **Deployment**: Use GitHub Actions, not manual `supabase functions deploy`

---

## Debugging FINN Søknad

### Перевірка вакансії в базі:
```sql
SELECT id, title, job_url, external_apply_url,
       has_enkel_soknad, application_form_type
FROM jobs
WHERE has_enkel_soknad = true
ORDER BY created_at DESC
LIMIT 10;
```

### Валідний job_url повинен виглядати так:
- `https://www.finn.no/job/fulltime/ad.html?finnkode=123456789`
- `https://www.finn.no/job/fulltime/ad/123456789`

### НЕВАЛІДНИЙ (search URL):
- `https://www.finn.no/job/search?industry=65&location=...`
- `https://www.finn.no/job/fulltime?occupation=...`

### Очистка некоректних даних:
```sql
-- Видалити вакансії з search URLs
DELETE FROM jobs
WHERE job_url LIKE '%finn.no/job/search%';

-- Очистити external_apply_url для finn_easy
UPDATE jobs
SET external_apply_url = NULL
WHERE has_enkel_soknad = true
  AND external_apply_url NOT LIKE '%finn.no/job/apply%';
```

---

## TODO

- [x] Fix jobs with search URLs instead of job URLs (added validation)
- [x] Add multi-pattern finnkode extraction
- [x] Add startup validation for FINN credentials
- [ ] Add async Supabase client for Realtime support
- [ ] Complete Webcruiter/Easycruit form automation
- [ ] Add application success/failure tracking
- [ ] Add retry logic for failed Skyvern tasks
- [ ] Add job_url validation during scraping (prevent search URLs)
