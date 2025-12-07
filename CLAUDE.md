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
- **CI/CD**: GitHub Actions (automatic Edge Functions deploy on merge to main)

---

## Project Structure

```
/home/user/Jobbot-NO/
├── .github/workflows/
│   ├── deploy-supabase-functions.yml   # Edge function deployment (auto on merge)
│   └── scheduled-scan.yml              # Daily job scanning cron
├── supabase/functions/                 # 11 Deno-based Edge Functions
│   ├── admin-actions/                  # User management
│   ├── analyze_profile/                # Resume analysis
│   ├── extract_job_text/               # Web scraping + Enkel søknad detection
│   ├── finn-apply/                     # FINN auto-apply queue handler
│   ├── finn-2fa-webhook/               # Skyvern 2FA code webhook
│   ├── fix-jobs-rls/                   # RLS policy repair utility
│   ├── generate_application/           # Cover letter generation
│   ├── job-analyzer/                   # Job fit analysis
│   ├── job-scraper/                    # Job board scraping
│   │   └── nav-enhancer.ts             # NAV.no specific parsing
│   ├── scheduled-scanner/              # Cron job handler
│   └── telegram-bot/                   # Telegram integration
├── database/                           # SQL migration files
│   ├── add_enkel_soknad_column.sql     # has_enkel_soknad boolean
│   ├── add_application_form_type.sql   # Form type detection
│   ├── add_deadline_column.sql         # Søknadsfrist tracking
│   ├── finn_auth_requests.sql          # 2FA code handling table
│   ├── fix_jobs_rls.sql                # RLS policy fixes
│   ├── setup_jobs.sql                  # Jobs table setup
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
│   ├── DashboardPage.tsx               # Main dashboard
│   ├── JobsPage.tsx                    # Job listings
│   ├── SettingsPage.tsx                # User settings
│   ├── ClientProfilePage.tsx           # CV profile management
│   ├── AdminUsersPage.tsx              # Admin user management
│   └── LoginPage.tsx                   # Authentication
├── components/                         # Reusable UI components
│   ├── JobTable.tsx                    # Job listing with FINN button
│   ├── Sidebar.tsx                     # Navigation sidebar
│   ├── ProfileEditor.tsx               # CV profile editor
│   ├── JobMap.tsx                      # Geographic job visualization
│   ├── MetricCard.tsx                  # Dashboard statistics
│   └── ActivityLog.tsx                 # System activity log
├── services/
│   ├── api.ts                          # API wrapper with fillFinnForm()
│   ├── supabase.ts                     # Supabase client
│   └── translations.ts                 # i18n strings
├── contexts/
│   ├── AuthContext.tsx                 # Authentication state
│   └── LanguageContext.tsx             # Language preferences
├── types.ts                            # TypeScript interfaces
├── App.tsx                             # Main app component
├── index.tsx                           # Entry point
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
- **Cover Letters**: AI-generated Norwegian cover letters with Ukrainian translation
- **Status Tracking**: Draft → Approved → Sending → Manual Review → Sent/Failed
- **FINN Auto-Apply**: Automated submission via Skyvern with 2FA support
- **Form Type Detection**: finn_easy, external_form, external_registration, email

### FINN Enkel Søknad Auto-Apply
- **Dashboard Button**: "FINN Søknad" button for FINN Easy Apply jobs
- **2FA Flow**: Telegram bot receives 2FA codes via `/code XXXXXX` command
- **Architecture**: Edge Function queues → Local worker polls → Skyvern submits
- **Detection Priority**: Button presence first, then "Søk her" button check

### CV Profiles
- **Multiple Profiles**: Users can have multiple CV profiles
- **Resume Upload**: PDF/DOC to Supabase Storage
- **AI Analysis**: Structured extraction (education, experience, skills)
- **Structured Content**: JSON schema with personal info, work experience, skills

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
- `has_enkel_soknad`: boolean - FINN Easy Apply detection (PRIORITY FLAG!)
- `application_form_type`: finn_easy | external_form | external_registration | email | processing | skyvern_failed | unknown
- `external_apply_url`: Direct URL to application form
- `deadline`: Søknadsfrist (application deadline) in ISO format
- `description`: Job description text
- `ai_recommendation`: AI analysis text
- `tasks_summary`: Specific duties list
- `cost_usd`: AI processing cost

**applications**
- `id`, `job_id`, `user_id`
- `cover_letter_no`, `cover_letter_uk`
- `status`: draft | approved | sending | manual_review | sent | failed | rejected
- `skyvern_metadata` (JSONB): task_id, finn_apply flag, source
- `cost_usd`

**cv_profiles**
- `id`, `user_id`, `profile_name`
- `content`: text summary
- `structured_content` (JSONB): detailed profile data (StructuredProfile)
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

**system_logs**
- Event logging for scans, analysis, applications
- Cost tracking per operation

---

## Edge Functions (Supabase)

| Function | Purpose | JWT |
|----------|---------|-----|
| `scheduled-scanner` | Cron: Scrape jobs, run analysis pipeline | No |
| `telegram-bot` | Webhook: Telegram commands, trigger scans | No |
| `finn-apply` | Queue FINN applications for local worker | Yes |
| `finn-2fa-webhook` | Receive 2FA codes from Skyvern | No |
| `fix-jobs-rls` | Utility to repair RLS policies | Yes |
| `job-analyzer` | Analyze job fit, generate aura + radar metrics | Yes |
| `generate_application` | Generate cover letters via Azure OpenAI | Yes |
| `analyze_profile` | Extract & analyze resumes | Yes |
| `extract_job_text` | Scrape job description + detect Enkel søknad | Yes |
| `job-scraper` | Scrape jobs from job boards | Yes |
| `admin-actions` | User management (create, list, delete) | Yes |

**Deploy without JWT**: `telegram-bot`, `scheduled-scanner`, `finn-2fa-webhook`

**IMPORTANT**: Deployment is automatic via GitHub Actions on merge to main!
Manual `supabase functions deploy` is not needed.

---

## Two-Stage Skyvern Architecture

### CRITICAL TO UNDERSTAND:

Skyvern operates in **two stages** performing DIFFERENT tasks:

### Stage 1: URL Extraction (`extract_apply_url.py`)
- **When**: Automatically during scanning (daemon mode)
- **What it does**: Finds external_apply_url for jobs
- **For which jobs**: NOT finn_easy (external forms only)
- **Result**: Populates `external_apply_url` in database

### Stage 2: Form Filling (`auto_apply.py`)
- **When**: Manual trigger via "FINN Søknad" button
- **What it does**: Fills and submits form on FINN
- **For which jobs**: finn_easy (Enkel Søknad) ONLY
- **Result**: Submitted application

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
- Task status monitoring with final status update
- Startup validation for FINN credentials

**FINN Detection Priority (CRITICAL!):**
1. If `external_apply_url` contains `finn.no/job/apply` → use it
2. If `has_enkel_soknad=true` OR `application_form_type='finn_easy'` → construct URL from finnkode
3. **Never auto-construct URL for all FINN jobs** - only if explicitly marked!

**Finnkode Extraction Patterns:**
```python
# Pattern 1: ?finnkode=123456789
# Pattern 2: /job/123456789 or /job/123456789.html
# Pattern 3: /ad/123456789 or /ad.123456789
# Pattern 4: /123456789 (8+ digits at URL end)
# Pattern 5: /job/fulltime/123456789
```

**Environment (.env) - REQUIRED:**
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
SKYVERN_API_URL=http://localhost:8000
SKYVERN_API_KEY=xxx
FINN_EMAIL=your-real-finn-email@example.com   # REAL email!
FINN_PASSWORD=your-real-password               # REAL password!
TELEGRAM_BOT_TOKEN=xxx
```

**Run:**
```bash
cd worker
source venv/bin/activate
python auto_apply.py
```

At startup, worker validates FINN_EMAIL and FINN_PASSWORD presence.
If missing - displays warning.

### `extract_apply_url.py` - URL Extractor (Stage 1)

Extracts external application URLs using Skyvern.
**Skips finn_easy jobs** - they don't need external URL.

**Daemon mode:**
```bash
python extract_apply_url.py --daemon
```

**URL Validation:**
- Rejects search/filter URLs
- Rejects URLs that aren't direct form links

---

## FINN Auto-Apply Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD                                │
│  User clicks "FINN Søknad" button on job with Enkel søknad      │
│  Button active ONLY when: has_enkel_soknad=true OR              │
│                           application_form_type='finn_easy'     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FINN-APPLY EDGE FUNCTION                      │
│  - Checks has_enkel_soknad FIRST (priority!)                    │
│  - Then checks application_form_type === 'finn_easy'            │
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
| `/start` | Initialize bot + show statistics |
| `/scan` | Trigger manual job scan |
| `/report` | Get detailed statistics report |
| `/code XXXXXX` | Submit 2FA verification code |
| `123456` | Submit 2FA code (plain digits, 4-8 chars) |

**Inline Buttons:**
- ✍️ Написати Søknad - Write application
- ✅ Підтвердити - Approve application
- 📂 Показати Søknad - View application
- ⚡ Відправити в {Company} - Submit to FINN (after approval)
- 🚀 Auto-Apply (Skyvern) - For non-FINN jobs

**Bot Workflow:**
1. User sends FINN job URL → Bot scrapes & analyzes
2. Bot shows job info + "✍️ Написати Søknad" button
3. User clicks → Bot generates cover letter
4. Bot shows søknad + "✅ Підтвердити" button
5. User clicks → Status changes to 'approved'
6. Bot shows "⚡ Відправити в {Company}" button (for FINN Easy only)
7. User clicks → Worker starts, asks for 2FA code
8. User sends plain 6-digit code → Application submitted

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
- **Edge Functions:** snake_case with hyphen-dirs (e.g., `finn-apply/index.ts`)
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
**Automatic via GitHub Actions on merge to main!**

Manual deploy (if needed):
```bash
supabase functions deploy finn-apply --project-ref ptrmidlhfdbybxmyovtm
supabase functions deploy finn-2fa-webhook --no-verify-jwt --project-ref ptrmidlhfdbybxmyovtm
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
FINN_EMAIL=your-real-email@example.com    # REQUIRED for FINN!
FINN_PASSWORD=your-real-password           # REQUIRED for FINN!
TELEGRAM_BOT_TOKEN=xxx
```

---

## Recent Changes (2025-12-07)

### FINN Apply URL Format Fix (CRITICAL!)
- **Problem**: Worker was using `finn.no/job/apply/439273812` which returns 404
- **Discovery**: User found correct format is `finn.no/job/apply?adId=439273812` (query parameter!)
- **Solution**: Updated worker to use correct URL format with `?adId=` parameter
- **Shadow DOM Issue**: FINN's "Enkel søknad" button is inside Shadow DOM, Skyvern couldn't click it
- **Workaround**: Navigate directly to apply URL instead of clicking button

### Browser Sessions for Batch Processing (auto_apply.py)
- **Problem**: Each FINN application required separate 2FA login
- **Solution**: Implemented Skyvern Browser Sessions for batch processing
- **New Functions**:
  - `create_browser_session(timeout_minutes=60)` - Creates persistent session
  - `close_browser_session(session_id)` - Closes session
  - `get_browser_session_status(session_id)` - Checks session status
  - `classify_applications(applications)` - Separates FINN from other apps
  - `process_batch_finn_applications(applications)` - Batch processing
- **How it works**:
  - First application → 2FA login → session becomes logged in
  - Subsequent applications → Skip login phase, fill form directly
  - Session timeout: 60 minutes (up to 240 minutes supported)
- **Conditional navigation_goal**: Different instructions for logged-in vs not-logged-in mode

```python
# Worker now supports batch processing
async def main():
    while True:
        applications = fetch_sending_applications()
        finn_apps, other_apps = await classify_applications(applications)
        if finn_apps:
            await process_batch_finn_applications(finn_apps)  # ONE 2FA for all!
        for app in other_apps:
            await process_application(app)
        await asyncio.sleep(10)
```

### Application Status Tracking
- **Problem**: No visual indication of application status in dashboard
- **Solution**: Added application status tracking throughout the system

**New fields in Job interface (types.ts)**:
```typescript
application_status?: 'draft' | 'approved' | 'sending' | 'manual_review' | 'sent' | 'failed' | 'rejected';
application_sent_at?: string;
```

**API changes (api.ts)**:
- `getJobs()` now fetches `applications(id, status, sent_at)` with join
- Maps `application_status` and `application_sent_at` to Job objects

**Visual indicators in JobTable (SØKNAD column)**:
- ✅ - Відправлено (sent) - green badge
- ⏳ - Надсилається (sending) - yellow, animated
- ❌ - Помилка (failed) - red badge
- ✓ - Затверджено (approved) - blue badge
- 📝 - Чернетка (draft) - gray badge

### Duplicate Submission Blocking
- **Problem**: User could accidentally submit same application twice
- **Solution**: Block submissions for jobs with `application_status = 'sent'` or `'sending'`
- **Implementation**:
  - `isApplicationSent(job)` helper function in JobTable
  - FINN Søknad button shows "Відправлено" (disabled) for sent jobs
  - Alert message when user tries to submit duplicate
  - Same blocking in Telegram bot `finn_apply_` handler

### Map Filter for Sent Applications (DashboardPage.tsx)
- **New filter**: "Відправлені заявки" button in map controls
- **Filter state**: `mapShowOnlySent` - shows only jobs with `application_status === 'sent'`
- **Visual distinction in JobMap**:
  - Sent applications: radius 8px, dark green border (#166534)
  - Regular jobs: radius 6px, white border
  - Application status badge in tooltip popup

### Telegram Bot Improvements (v9.0)
- **Statistics on /start**:
  ```
  📊 Статистика:
  🏢 Всього вакансій: 252
  🆕 Нових за тиждень: 45
  🎯 Релевантних (≥50%): 83
  ✅ Відправлено заявок: 2
  📝 В обробці: 5
  ```

- **2FA code without /code prefix**:
  - Now accepts plain 4-8 digit codes (e.g., just `123456`)
  - Old format `/code 123456` still works
  - If no active auth request for plain numbers → silently ignored
  - Detection: `/^\d{4,8}$/` regex

- **Improved approval message**:
  - Shows job title and company name
  - Button text: "⚡ Відправити в {CompanyName}"

- **FINN Easy detection priority** (consistent across all handlers):
  ```typescript
  const isFinnEasy = job.has_enkel_soknad ||
                     job.application_form_type === 'finn_easy' ||
                     job.external_apply_url?.includes('finn.no/job/apply');
  ```

### Company Name Extraction Fix
- **Problem**: Jobs scraped from search results sometimes had "Unknown Company"
- **Solution**: Added company extraction to `extract_job_text/index.ts`
- **Extraction Methods** (in priority order):
  1. JSON config data: `"company_name","value":["Company Name"]`
  2. Semantic selectors: `dt:contains("Arbeidsgiver") + dd`, etc.
  3. FINN li>span structure: `<li>Arbeidsgiver<span>Company</span></li>`
  4. Meta tags: `og:site_name`, `author`
- **Update Logic**: Only updates if current company is "Unknown Company" or empty
- Function returns `company` field in response

### Deadline (Snarest/ASAP) Support
- Added `isAsapDeadline()` helper for Norwegian ASAP terms
- ASAP terms: snarest, fortløpende, løpende, straks, umiddelbart
- Returns estimated date (today + 14 days) with `~` prefix
- Frontend shows amber styling and ⚡ icon for estimated deadlines

### FINN Deadline Extraction Fix
- **Problem**: Deadline showing posting date instead of application deadline
- **Solution**: Added FINN-specific li>span selector (Method 0)
- Pattern: `<li>Frist<span>16.01.2026</span></li>`
- Removed generic `time[datetime]` selector that caught posting date

### FINN Enkel Søknad Detection Improvements
- **Button Priority**: Now checks "Søk her" button BEFORE "Enkel søknad" text
  - If "Søk her" button found → external form (NOT finn_easy)
  - Only if no "Søk her" button → check for "Enkel søknad"
- Prevents false positives from external form redirects
- Updated `extract_job_text/index.ts` with improved detection logic

### External Form Detection
- Jobs with "Søk her" button now correctly marked as external forms
- External URLs extracted from button href attribute
- Form type detection from external page content

### Worker Validation
- Added explicit validation: `is_finn_easy = finn_apply_url is not None AND (has_enkel_soknad OR application_form_type == 'finn_easy')`
- Prevents false positives from incorrectly detected external forms
- Better logging of detection flow

### RLS Fix Utility
- Added `fix-jobs-rls` Edge Function for repairing RLS policies
- Corresponding SQL in `database/fix_jobs_rls.sql`

### Previous Changes (2025-12-06)

#### FINN URL Extraction Improvements
- Added multi-pattern finnkode extraction:
  - Pattern 1: `?finnkode=123456789` (query parameter)
  - Pattern 2: `/job/123456789` (path-based)
  - Pattern 3: `/ad/123456789` (old format)
  - Pattern 4: `/123456789` (URL end, 8+ digits)
  - Pattern 5: `/job/fulltime/123456789`
- Updated `finn-apply/index.ts` with all patterns
- Added `extract_finnkode()` helper in `auto_apply.py`

#### URL Validation
- Added validation in `extract_job_text/index.ts` to reject search URLs
- Prevents incorrect `has_enkel_soknad` detection on search pages
- Invalid patterns: `finn.no/job/search`, `/search?`, `/filter?`

#### Worker Improvements
- Added startup validation for FINN_EMAIL and FINN_PASSWORD
- Added `.env.example` with all required variables
- Priority logic: check `has_enkel_soknad` BEFORE `external_apply_url`

---

## Known Issues

### Supabase Client
- `supabase.auth.*()` methods hang - use direct fetch
- Realtime requires async client - using polling instead
- Data queries work but slow (~1-1.5s)

### FINN Detection
- Jobs scraped before update may lack `external_apply_url`
- Worker extracts `finnkode` from `job_url` as fallback
- **"Søk her" vs "Enkel søknad"**: If job has external "Søk her" button, it's NOT finn_easy
- `extract_job_text` now checks button priority

### Common Debugging Issues
1. **"test@jobbot.no" in Skyvern**: Worker not reading .env → verify .env exists with FINN_EMAIL
2. **"Cannot construct FINN apply URL"**: job_url doesn't contain finnkode → check URL in database
3. **Incorrect has_enkel_soknad**: Job created from search URL → delete and rescan
4. **"FINN Søknad" button inactive**: has_enkel_soknad=false → check application_form_type
5. **External form shown as finn_easy**: "Søk her" button not detected → rescan job
6. **"Unknown Company" showing**: Rescan the job to trigger company extraction from job page
7. **404 on FINN apply page**: Wrong URL format → must be `?adId=123456` not `/job/apply/123456`
8. **Shadow DOM click fails**: Don't try to click button → navigate directly to apply URL
9. **Browser session not working**: Check Skyvern API version, session_id should start with `pbs_`
10. **2FA code not accepted**: Check `finn_auth_requests` table for status = 'pending' or 'code_requested'

### Debugging Browser Sessions
```bash
# Check active sessions
curl http://localhost:8000/api/v1/browser-sessions -H "x-api-key: YOUR_KEY"

# Close a session manually
curl -X POST http://localhost:8000/api/v1/browser-sessions/{session_id}/close -H "x-api-key: YOUR_KEY"
```

### Debugging Application Status
```sql
-- Check application status for a job
SELECT j.title, j.company, a.status, a.sent_at, a.created_at
FROM jobs j
LEFT JOIN applications a ON j.id = a.job_id
WHERE j.has_enkel_soknad = true
ORDER BY a.created_at DESC
LIMIT 10;

-- Find jobs with sent applications
SELECT j.title, j.company, a.status
FROM jobs j
JOIN applications a ON j.id = a.job_id
WHERE a.status = 'sent';
```

---

## Best Practices for AI Assistants

1. **Authentication**: Never use `supabase.auth.*()` - use direct fetch
2. **Edge Functions**: Deno-based; use `Deno.serve()` pattern
3. **Local Worker**: Can't be called from Edge Functions (localhost not reachable)
4. **FINN Apply Detection Priority**:
   - FIRST check `has_enkel_soknad`
   - THEN check `application_form_type === 'finn_easy'`
   - LAST check `external_apply_url` contains `finn.no/job/apply`
   - **NEVER** auto-construct URL for all FINN jobs
5. **Finnkode Extraction**: Use multiple patterns (query, path, URL end)
6. **URL Validation**: Always reject search/filter URLs before processing
7. **Translations**: Add strings to all 3 languages (en, no, uk)
8. **Types**: All interfaces in `types.ts`
9. **Errors**: Log with prefix + store in `system_logs`
10. **Deployment**: Use GitHub Actions, not manual `supabase functions deploy`

---

## Debugging FINN Søknad

### Check job in database:
```sql
SELECT id, title, job_url, external_apply_url,
       has_enkel_soknad, application_form_type
FROM jobs
WHERE has_enkel_soknad = true
ORDER BY created_at DESC
LIMIT 10;
```

### Valid job_url should look like:
- `https://www.finn.no/job/fulltime/ad.html?finnkode=123456789`
- `https://www.finn.no/job/fulltime/ad/123456789`

### INVALID (search URL):
- `https://www.finn.no/job/search?industry=65&location=...`
- `https://www.finn.no/job/fulltime?occupation=...`

### Clean up incorrect data:
```sql
-- Delete jobs with search URLs
DELETE FROM jobs
WHERE job_url LIKE '%finn.no/job/search%';

-- Clear external_apply_url for finn_easy if incorrect
UPDATE jobs
SET external_apply_url = NULL
WHERE has_enkel_soknad = true
  AND external_apply_url NOT LIKE '%finn.no/job/apply%';

-- Reset jobs with incorrect form type
UPDATE jobs
SET has_enkel_soknad = false, application_form_type = 'unknown'
WHERE external_apply_url LIKE '%webcruiter%'
   OR external_apply_url LIKE '%jobylon%';
```

### Check RLS policies:
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'jobs';
```

---

## TypeScript Interfaces (types.ts)

Key interfaces for reference:

```typescript
interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: 'FINN' | 'LINKEDIN' | 'NAV';
  status: JobStatus;
  matchScore?: number;
  description?: string;
  ai_recommendation?: string;
  tasks_summary?: string;
  application_id?: string;  // Link to application if exists
  application_status?: 'draft' | 'approved' | 'sending' | 'manual_review' | 'sent' | 'failed' | 'rejected';  // NEW!
  application_sent_at?: string;  // NEW! When sent
  cost_usd?: number;
  has_enkel_soknad?: boolean;
  application_form_type?: 'finn_easy' | 'external_form' | 'external_registration' | 'email' | 'processing' | 'skyvern_failed' | 'unknown';
  external_apply_url?: string;
  deadline?: string;
  aura?: Aura;
  radarData?: RadarMetric[];
}

interface Application {
  id: string;
  job_id: string;
  cover_letter_no: string;
  cover_letter_uk?: string;
  status: 'draft' | 'approved' | 'sending' | 'manual_review' | 'sent' | 'failed' | 'rejected';
  skyvern_metadata?: { task_id?: string; finn_apply?: boolean; source?: string; };
  sent_at?: string;  // Timestamp when sent
}

interface StructuredProfile {
  personalInfo: { fullName: string; email: string; phone: string; };
  workExperience: WorkExperience[];
  education: Education[];
  technicalSkills: TechnicalSkills;
  languages: LanguageSkill[];
}
```

---

## TODO

### Completed (2025-12-07)
- [x] Fix jobs with search URLs instead of job URLs (added validation)
- [x] Add multi-pattern finnkode extraction
- [x] Add startup validation for FINN credentials
- [x] Improve "Søk her" vs "Enkel søknad" button detection
- [x] Add RLS fix utility function
- [x] Fix FINN Apply URL format (`?adId=` not path-based)
- [x] Add Browser Sessions for batch FINN applications
- [x] Add application status tracking in dashboard
- [x] Add duplicate submission blocking
- [x] Add sent applications map filter
- [x] Add statistics to Telegram /start command
- [x] Allow 2FA code input without /code prefix

### In Progress
- [ ] Complete Webcruiter/Easycruit form automation
- [ ] Add retry logic for failed Skyvern tasks

### Planned
- [ ] Add async Supabase client for Realtime support
- [ ] Add job_url validation during scraping (prevent search URLs)
- [ ] Add multi-platform support in batch processing (NAV, Webcruiter)
- [ ] Add application analytics dashboard
- [ ] Implement session persistence across worker restarts
