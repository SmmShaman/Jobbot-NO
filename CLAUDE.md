# CLAUDE.md - JobBot Norway AI Assistant Guide

## Project Overview

**JobBot Norway** is a job search automation platform for the Norwegian job market with AI-powered job analysis, cover letter generation, and automated application submission.

### Technology Stack
- **Frontend**: React 19.2, TypeScript 5.8, Vite 6.2, TailwindCSS (CDN)
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
- **AI Services**: Azure OpenAI (chat completions)
- **Browser Automation**: Skyvern (local Docker)
- **Integrations**: Telegram Bot API, Web scraping (Cheerio)
- **Deployment**: Netlify (frontend), Supabase (functions)
- **CI/CD**: GitHub Actions

---

## Project Structure

```
/home/user/Jobbot-NO/
├── .github/workflows/
│   ├── deploy-supabase-functions.yml   # Edge function deployment
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
├── worker/                             # Python Skyvern workers
│   ├── auto_apply.py                   # Main application worker
│   ├── extract_apply_url.py            # URL extraction daemon
│   ├── forms/finn_login.py             # FINN login helper
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

### FINN Enkel Søknad Auto-Apply (NEW)
- **Dashboard Button**: "FINN Søknad" button for FINN Easy Apply jobs
- **2FA Flow**: Telegram bot receives 2FA codes via `/code XXXXXX` command
- **Architecture**: Edge Function queues → Local worker polls → Skyvern submits

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
- `has_enkel_soknad`: boolean - FINN Easy Apply detection
- `application_form_type`: finn_easy | external_form | external_registration | unknown
- `external_apply_url`: Direct URL to application form
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

**finn_auth_requests** (NEW)
- `id`, `user_id`, `telegram_chat_id`
- `totp_identifier`: email for 2FA
- `status`: pending | code_requested | code_received | completed | expired | failed
- `verification_code`: 2FA code from user
- `skyvern_task_id`

**recruitment_agencies** (NEW)
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

---

## Python Workers (Local)

### `auto_apply.py` - Main Worker

Polls database every 10 seconds for applications with `status='sending'`.

**Features:**
- FINN Enkel Søknad detection (from `external_apply_url` or `finnkode` in URL)
- Skyvern task submission with 2FA webhook support
- Telegram notifications for progress and 2FA code requests
- Task status monitoring

**Environment (.env):**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
SKYVERN_API_URL=http://localhost:8000
SKYVERN_API_KEY=xxx
FINN_EMAIL=your@email.no
FINN_PASSWORD=xxx
TELEGRAM_BOT_TOKEN=xxx
```

**Run:**
```bash
cd worker
source venv/bin/activate
python auto_apply.py
```

### `extract_apply_url.py` - URL Extractor

Extracts external application URLs using Skyvern.

**Daemon mode:**
```bash
python extract_apply_url.py --daemon
```

---

## FINN Auto-Apply Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD                                │
│  User clicks "FINN Søknad" button on job with Enkel søknad      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FINN-APPLY EDGE FUNCTION                      │
│  - Validates job has finn.no/job/apply URL                       │
│  - Updates application status to 'sending'                       │
│  - Sends Telegram notification                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL WORKER (auto_apply.py)                  │
│  - Polls DB every 10 sec for status='sending'                    │
│  - Detects FINN Easy Apply (external_apply_url or finnkode)      │
│  - Calls Skyvern with 2FA webhook URL                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SKYVERN                                  │
│  - Navigates to FINN apply page                                  │
│  - Logs in with email/password                                   │
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
python auto_apply.py
```

### Deploy Edge Functions
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

### Python Worker (.env)
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
SKYVERN_API_URL
SKYVERN_API_KEY
FINN_EMAIL
FINN_PASSWORD
TELEGRAM_BOT_TOKEN
```

---

## Recent Changes (2025-12-06)

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
- Search URLs (finn.no/job/search) are not valid job URLs

---

## Best Practices for AI Assistants

1. **Authentication**: Never use `supabase.auth.*()` - use direct fetch
2. **Edge Functions**: Deno-based; use `Deno.serve()` pattern
3. **Local Worker**: Can't be called from Edge Functions (localhost not reachable)
4. **FINN Apply**: Always check for `finn.no/job/apply` in URL
5. **Translations**: Add strings to all 3 languages
6. **Types**: All interfaces in `types.ts`
7. **Errors**: Log with prefix + store in `system_logs`

---

## TODO

- [ ] Fix jobs with search URLs instead of job URLs
- [ ] Add async Supabase client for Realtime support
- [ ] Complete Webcruiter/Easycruit form automation
- [ ] Add application success/failure tracking
- [ ] Move hardcoded credentials to environment variables
