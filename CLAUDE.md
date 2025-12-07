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

- [x] Fix jobs with search URLs instead of job URLs (added validation)
- [x] Add multi-pattern finnkode extraction
- [x] Add startup validation for FINN credentials
- [x] Improve "Søk her" vs "Enkel søknad" button detection
- [x] Add RLS fix utility function
- [ ] Add async Supabase client for Realtime support
- [ ] Complete Webcruiter/Easycruit form automation
- [ ] Add application success/failure tracking
- [ ] Add retry logic for failed Skyvern tasks
- [ ] Add job_url validation during scraping (prevent search URLs)
