# CLAUDE.md - JobBot Norway AI Assistant Guide

## Project Overview

**JobBot Norway** is an automated job search and application platform targeting the Norwegian job market (FINN.no, NAV.no). It's a hybrid distributed system combining cloud services with local automation.

**Tech Stack:**
- **Frontend:** React 19 + Vite + Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Real-time subscriptions)
- **Serverless:** Deno-based Edge Functions
- **AI Engine:** Azure OpenAI API (gpt-4o/gpt-4-turbo)
- **Local Automation:** Python worker + Skyvern Docker (browser automation)
- **Communication:** Telegram Bot for notifications and commands

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLOUD (Supabase)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  PostgreSQL │  │   Storage   │  │     Edge Functions      │  │
│  │   (jobs,    │  │  (resumes)  │  │  - job-scraper          │  │
│  │ applications│  │             │  │  - extract_job_text     │  │
│  │  profiles)  │  │             │  │  - job-analyzer         │  │
│  └─────────────┘  └─────────────┘  │  - generate_application │  │
│                                     │  - analyze_profile      │  │
│                                     │  - scheduled-scanner    │  │
│                                     │  - telegram-bot         │  │
│                                     └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LOCAL (User's PC)                           │
│  ┌─────────────────────┐        ┌─────────────────────────┐     │
│  │  worker/auto_apply.py│ ─────▶│   Skyvern (Docker)      │     │
│  │  (Bridge Script)     │        │  (Browser Automation)   │     │
│  └─────────────────────┘        └─────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
Jobbot-NO/
├── App.tsx                    # Main app router with sidebar navigation
├── index.tsx                  # React entry point
├── index.html                 # HTML template with CDN imports
├── types.ts                   # Global TypeScript interfaces & enums
├── tsconfig.json              # TypeScript config (ES2022, JSX React)
├── vite.config.ts             # Vite build config (port 3000)
├── package.json               # Dependencies (React 19, Supabase, etc.)
│
├── components/                # Reusable UI components
│   ├── ActivityLog.tsx        # System logs display
│   ├── Sidebar.tsx            # Navigation sidebar
│   ├── JobTable.tsx           # Main jobs table with filters & actions
│   ├── JobMap.tsx             # Leaflet interactive map
│   ├── MetricCard.tsx         # Dashboard KPI cards
│   └── ProfileEditor.tsx      # Structured CV JSON editor
│
├── pages/                     # Route pages
│   ├── DashboardPage.tsx      # Overview with charts, cost tracking, map
│   ├── JobsPage.tsx           # Jobs list & management
│   ├── SettingsPage.tsx       # Multi-tab settings (6 tabs)
│   ├── ClientProfilePage.tsx  # User account & statistics
│   ├── LoginPage.tsx          # Supabase authentication
│   └── AdminUsersPage.tsx     # Admin user management
│
├── contexts/                  # React Context state management
│   ├── AuthContext.tsx        # Auth state & role management
│   └── LanguageContext.tsx    # Multi-language support (EN/NO/UK)
│
├── services/                  # API & utilities
│   ├── supabase.ts            # Supabase client initialization
│   ├── api.ts                 # Main API layer (850+ lines)
│   ├── translations.ts        # i18n strings (EN/NO/UK)
│   └── mockData.ts            # Placeholder data (deprecated)
│
├── supabase/functions/        # Edge Functions (Deno TypeScript)
│   ├── job-scraper/           # Scrapes FINN.no & NAV.no
│   ├── extract_job_text/      # Extracts clean job descriptions
│   ├── job-analyzer/          # AI relevance scoring (Aura, Radar)
│   ├── generate_application/  # Generates Norwegian cover letters
│   ├── analyze_profile/       # Parses resume uploads to JSON
│   ├── scheduled-scanner/     # Orchestrator for cron pipeline
│   ├── telegram-bot/          # Telegram commands & notifications
│   └── admin-actions/         # User CRUD operations
│
├── database/                  # SQL migrations & schema files
│   ├── cv_profiles.sql        # CV profiles table
│   ├── setup_applications.sql # Applications table
│   ├── setup_automation.txt   # user_settings & pg_cron
│   ├── setup_knowledge_base.txt # Q&A pairs for form filling
│   ├── create_system_logs.txt # Audit trail table
│   └── (20+ migration files)  # Schema evolution history
│
├── worker/                    # Local Python automation
│   ├── auto_apply.py          # Polls DB → triggers Skyvern API
│   └── requirements.txt       # Python dependencies
│
└── docs/                      # Documentation
    ├── SESSION_CONTEXT.md     # Architecture & workflow details
    └── INSTRUCTIONS_EDGE_FUNCTION.md  # Deployment guide
```

## Development Commands

```bash
# Frontend Development
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:3000)
npm run build        # Production build
npm run preview      # Preview production build

# Local Worker
cd worker
pip install -r requirements.txt
python3 auto_apply.py   # Requires Skyvern Docker running

# Edge Function Deployment
supabase functions deploy <function-name> --no-verify-jwt
# Example: supabase functions deploy job-analyzer --no-verify-jwt
```

## Key Conventions

### TypeScript & React

1. **Interfaces over Types:** Use `interface` for object shapes in `types.ts`
2. **Functional Components:** All components are functional with hooks
3. **Context for State:** Use React Context (AuthContext, LanguageContext) for global state
4. **Path Aliases:** Use `@/` prefix for imports (configured in tsconfig.json)

### Code Style

- **Component Files:** PascalCase (e.g., `JobTable.tsx`, `DashboardPage.tsx`)
- **Service Files:** camelCase (e.g., `api.ts`, `supabase.ts`)
- **Edge Functions:** snake_case directories (e.g., `job-scraper/`, `extract_job_text/`)
- **Icons:** Use Lucide React icons exclusively
- **Styling:** Tailwind CSS utility classes (no separate CSS files)

### Database

- **Table naming:** snake_case (e.g., `cv_profiles`, `user_settings`)
- **JSONB fields:** Used for complex nested data (e.g., `analysis_metadata`, `structured_content`)
- **RLS Policies:** Currently permissive (single-user/admin-managed mode)
- **Timestamps:** `created_at` with `DEFAULT NOW()`

### Edge Functions

- **Runtime:** Deno with TypeScript
- **CORS:** All functions include CORS headers for OPTIONS preflight
- **Auth:** Most use `--no-verify-jwt` for public access
- **Error Handling:** Return JSON with `error` field on failure

## Key Files Reference

### Core Type Definitions (`types.ts`)

```typescript
// Job status workflow
enum JobStatus {
  NEW = 'NEW',
  ANALYZED = 'ANALYZED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  INTERVIEW = 'INTERVIEW',
  SENT = 'SENT'
}

// Application status workflow
// draft → approved → sending → manual_review → sent/failed

// Key interfaces: Job, Application, CVProfile, UserSettings, SystemLog
```

### API Service (`services/api.ts`)

Main functions:
- `getJobs()` - Fetch all jobs with location parsing
- `subscribeToChanges()` - Real-time DB listeners
- `uploadResume()` / `extractResumeText()` - Resume handling
- `generateApplication()` - Create cover letters
- `approveApplication()` / `sendApplication()` - Application workflow
- `triggerManualScan()` - Run scheduled-scanner manually
- `getTotalCost()` - Aggregate cost tracking

### Edge Function Entry Points

| Function | Purpose | Key Inputs |
|----------|---------|------------|
| `job-scraper` | Scrape job listings | `search_urls[]`, `source` |
| `extract_job_text` | Clean description extraction | `job_id`, `url` |
| `job-analyzer` | AI relevance scoring | `job_ids[]`, CV profile |
| `generate_application` | Cover letter generation | `job_id`, `user_id` |
| `analyze_profile` | Resume parsing | `file_paths[]` or `raw_text` |
| `scheduled-scanner` | Pipeline orchestrator | `user_id`, trigger source |
| `telegram-bot` | Bot webhook handler | Telegram update payload |

## Database Schema

### Core Tables

**jobs**
- Primary job listings table
- Fields: `id`, `job_url`, `title`, `company`, `location`, `description`, `source`, `status`, `relevance_score`, `ai_recommendation`, `tasks_summary`, `analysis_metadata` (JSONB), `cost_usd`

**applications**
- Generated cover letters
- Fields: `id`, `job_id`, `user_id`, `cover_letter_no`, `cover_letter_uk`, `status`, `skyvern_metadata` (JSONB)
- Status values: `draft`, `approved`, `sending`, `manual_review`, `sent`, `failed`

**cv_profiles**
- Resume storage with structured JSON
- Fields: `id`, `user_id`, `profile_name`, `content` (text), `structured_content` (JSONB), `is_active`

**user_settings**
- User preferences and automation config
- Fields: `finn_search_urls[]`, `is_auto_scan_enabled`, `scan_time_utc`, `ui_language`, custom prompts, `role`

**user_knowledge_base**
- Q&A pairs for Skyvern form filling
- Fields: `question`, `answer`, `category`

**system_logs**
- Audit trail with cost tracking
- Fields: `event_type`, `status`, `message`, `tokens_used`, `cost_usd`, `source`

## External Integrations

### Azure OpenAI
- **Endpoint:** Environment variable `AZURE_OPENAI_ENDPOINT`
- **Models:** gpt-4o, gpt-4-turbo (configurable)
- **Pricing:** $2.50/1M input tokens, $10.00/1M output tokens
- **Uses:** Job analysis, profile parsing, cover letter generation

### Telegram Bot
- **Token:** Environment variable `TELEGRAM_BOT_TOKEN`
- **Commands:** `/start`, `/scan`, `/menu`
- **Inline buttons:** Write app, approve, send, view details

### Skyvern (Local)
- **API:** `http://localhost:8000/api/v1/tasks`
- **Purpose:** Browser automation for form submission
- **Requires:** Docker running on user's PC

### Job Sources
- **FINN.no:** HTML scraping with Cheerio
- **NAV.no:** API + HTML scraping (arbeidsplassen.nav.no)

## Common Tasks

### Adding a New Page

1. Create component in `pages/NewPage.tsx`
2. Add route in `App.tsx` router
3. Add navigation item in `components/Sidebar.tsx`
4. Add translations in `services/translations.ts`

### Adding a New Edge Function

1. Create directory: `supabase/functions/function-name/`
2. Create `index.ts` with Deno serve handler
3. Include CORS headers for OPTIONS
4. Deploy: `supabase functions deploy function-name --no-verify-jwt`

### Modifying Database Schema

1. Create migration file in `database/` directory
2. Run SQL in Supabase SQL editor
3. Update TypeScript types in `types.ts` if needed
4. Update API calls in `services/api.ts`

### Adding Translations

1. Edit `services/translations.ts`
2. Add keys to all three language objects (en, no, uk)
3. Use `useLanguage()` hook: `const { t } = useLanguage()`
4. Access translations: `t('section.key')`

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

### Local Worker
```
SUPABASE_URL
SUPABASE_KEY
SKYVERN_API_KEY
```

### Frontend (Vite)
```
VITE_GEMINI_API_KEY (deprecated)
```

## Important Workflows

### 1. Job Scan Pipeline
```
Trigger (Cron/Telegram/Manual)
  → scheduled-scanner
  → job-scraper (FINN/NAV)
  → extract_job_text
  → job-analyzer (Azure OpenAI)
  → Telegram notification
```

### 2. Application Generation
```
User clicks "Write Soknad"
  → generate_application
  → Azure OpenAI
  → Save to DB (status: draft)
  → User approves (status: approved)
```

### 3. Auto-Apply with Skyvern
```
User clicks "Send"
  → DB status: sending
  → worker/auto_apply.py detects
  → POST to Skyvern API
  → Browser automation
  → Update status: manual_review/sent
```

## Testing Guidelines

- **No formal test suite currently implemented**
- **Manual testing:** Use the Dashboard UI to verify functionality
- **Edge function testing:** Check Supabase Function Logs
- **Worker testing:** Run `auto_apply.py` with Skyvern Docker

## Gotchas & Tips

1. **Supabase Client:** The public anon key is hardcoded in `services/supabase.ts` - this is intentional for client-side auth
2. **RLS Policies:** Currently permissive - all authenticated users see all data
3. **Cost Tracking:** Costs are calculated from token usage in edge functions
4. **Location Parsing:** Complex regex logic in `services/api.ts` handles Norwegian addresses
5. **Real-time Updates:** Uses Supabase subscriptions - changes reflect instantly in UI
6. **Leaflet Map:** Z-index fixes in `index.html` prevent sidebar overlap
7. **Aura/Radar:** "Cyberpunk" features - job culture detection (Toxic/Growth/Balanced/Chill/Grind)

## Language Support

Three languages supported throughout the UI:
- **English (en):** Full coverage
- **Norwegian (no):** Full coverage
- **Ukrainian (uk):** Full coverage (default)

Cover letters are generated in Norwegian with Ukrainian translation.

## Deployment

- **Frontend:** Netlify (automatic from git push)
- **Edge Functions:** Manual deployment via Supabase CLI
- **Database:** Supabase PostgreSQL (managed)
- **Worker:** Runs locally on user's PC
