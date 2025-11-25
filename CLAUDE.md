# CLAUDE.md - JobBot Norway AI Assistant Guide

## Project Overview

**JobBot Norway** is an automated job search and application platform targeting the Norwegian job market (FINN.no, NAV.no). It's a hybrid distributed system combining cloud services with local automation.

**Tech Stack:**
- **Frontend:** React 19 + Vite + Tailwind CSS (CDN)
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Real-time subscriptions)
- **Serverless:** Deno-based Edge Functions
- **AI Engine:** Azure OpenAI API (gpt-4o/gpt-4-turbo)
- **Local Automation:** Python worker + Skyvern Docker (browser automation)
- **Communication:** Telegram Bot for notifications and commands
- **Hosting:** Netlify (auto-deploy from GitHub)

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
│                                     │  - admin-actions        │  │
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
├── index.tsx                  # React entry point (renders to #root)
├── index.html                 # HTML template with Vite entry point
├── types.ts                   # Global TypeScript interfaces & enums
├── tsconfig.json              # TypeScript config (ES2022, JSX React)
├── vite.config.ts             # Vite build config (port 3000)
├── package.json               # Dependencies (React 19, Supabase, etc.)
├── package-lock.json          # Lockfile (required for Netlify CI)
├── CLAUDE.md                  # This file - AI assistant guide
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
├── supabase/functions/        # Edge Functions source (8 in repo)
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
│   └── (20+ migration files)  # Schema evolution history
│
└── worker/                    # Local Python automation
    ├── auto_apply.py          # Polls DB → triggers Skyvern API
    └── requirements.txt       # Python dependencies
```

## Build & Deployment

### Vite Configuration

**index.html** structure:
```html
<head>
  <script src="https://cdn.tailwindcss.com"></script>  <!-- Tailwind CDN -->
  <link href="leaflet.css" />                           <!-- Map styles -->
  <script src="leaflet.js"></script>                    <!-- Map library -->
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/index.tsx"></script>      <!-- Vite entry point -->
</body>
```

**Build output:** `dist/` folder with bundled assets (~840KB JS)

### Netlify Deployment

- **Repository:** `github.com/SmmShaman/Jobbot-NO`
- **Build command:** `npm ci && npm run build`
- **Publish directory:** `dist`
- **Auto-deploy:** Enabled for production branch

**Required files for Netlify:**
- `package-lock.json` (for `npm ci`)
- `index.html` with `<script type="module" src="/index.tsx">`

## Development Commands

```bash
# Frontend Development
npm install          # Install dependencies (generates package-lock.json)
npm run dev          # Start Vite dev server (http://localhost:3000)
npm run build        # Production build → dist/
npm run preview      # Preview production build

# Local Worker
cd worker
pip install -r requirements.txt
python3 auto_apply.py   # Requires Skyvern Docker running

# Edge Function Deployment
supabase functions deploy <function-name> --no-verify-jwt
# Example: supabase functions deploy job-analyzer --no-verify-jwt
```

## Edge Functions Status

### In Repository (8 functions):
| Function | Purpose |
|----------|---------|
| `job-scraper` | Scrapes FINN.no & NAV.no |
| `extract_job_text` | Extracts job descriptions |
| `job-analyzer` | AI relevance scoring with Aura/Radar |
| `generate_application` | Generates cover letters |
| `analyze_profile` | Parses resumes to JSON |
| `scheduled-scanner` | Cron orchestrator |
| `telegram-bot` | Telegram webhook handler |
| `admin-actions` | User CRUD operations |

### Deployed in Supabase (14 functions):
**WARNING: 6 functions exist only in Supabase, code not in repo!**

| Function | In Repo | Notes |
|----------|---------|-------|
| `ai-evaluator` | NO | Legacy/unknown |
| `telegram-notify` | NO | Legacy notification |
| `revise-application` | NO | Application revision |
| `extract-text` | NO | Old version of extract_job_text |
| `pdf-parser` | NO | PDF processing |
| `generate-application` | NO | Old version (dash naming) |

**TODO:** Either delete legacy functions from Supabase or recover code to repo.

### Known Code Duplication Issues

1. **Text extraction logic** duplicated in 3 places:
   - `extract_job_text/index.ts`
   - `scheduled-scanner/index.ts` (`extractTextFromUrl()`)
   - `telegram-bot/index.ts` (inline Cheerio)

2. **Azure OpenAI call pattern** duplicated in 4 places

3. **Pricing constants** (`$2.50/1M input`, `$10/1M output`) in 4 files

4. **Language map** (`uk→Ukrainian`, etc.) in 2 files

## Key Conventions

### TypeScript & React

1. **Interfaces over Types:** Use `interface` for object shapes in `types.ts`
2. **Functional Components:** All components are functional with hooks
3. **Context for State:** Use React Context (AuthContext, LanguageContext) for global state
4. **Path Aliases:** Use `@/` prefix for imports (configured in tsconfig.json)

### Code Style

- **Component Files:** PascalCase (e.g., `JobTable.tsx`, `DashboardPage.tsx`)
- **Service Files:** camelCase (e.g., `api.ts`, `supabase.ts`)
- **Edge Functions:** Mixed naming (prefer snake_case: `extract_job_text/`)
- **Icons:** Use Lucide React icons exclusively
- **Styling:** Tailwind CSS utility classes (CDN in production)

### Database

- **Table naming:** snake_case (e.g., `cv_profiles`, `user_settings`)
- **JSONB fields:** Used for complex nested data (e.g., `analysis_metadata`, `structured_content`)
- **RLS Policies:** Currently permissive (single-user/admin-managed mode)
- **Timestamps:** `created_at` with `DEFAULT NOW()`

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
- **Commands:** `/start`, `/scan`, `/report`
- **Inline buttons:** Write app, approve, send, view details

### Skyvern (Local)
- **API:** `http://localhost:8000/api/v1/tasks`
- **Purpose:** Browser automation for form submission
- **Requires:** Docker running on user's PC

### Job Sources
- **FINN.no:** HTML scraping with Cheerio
- **NAV.no:** API + HTML scraping (arbeidsplassen.nav.no)

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

### Netlify (Frontend)
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

### Local Worker
```
SUPABASE_URL
SUPABASE_KEY
SKYVERN_API_KEY
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
5. **Update this CLAUDE.md file!**

### Modifying Database Schema

1. Create migration file in `database/` directory
2. Run SQL in Supabase SQL editor
3. Update TypeScript types in `types.ts` if needed
4. Update API calls in `services/api.ts`

## Gotchas & Tips

1. **package-lock.json:** Required for Netlify CI (`npm ci`). Always commit it.
2. **index.html entry point:** Must have `<script type="module" src="/index.tsx">` for Vite build
3. **Tailwind CDN:** Using CDN version (warning in console is expected)
4. **Supabase Client:** The public anon key is hardcoded in `services/supabase.ts`
5. **RLS Policies:** Currently permissive - all authenticated users see all data
6. **Edge Functions sync:** 14 deployed vs 8 in repo - needs cleanup
7. **Leaflet Map:** Z-index fixes in `index.html` prevent sidebar overlap
8. **Aura/Radar:** Job culture detection (Toxic/Growth/Balanced/Chill/Grind)

## Language Support

Three languages supported throughout the UI:
- **English (en):** Full coverage
- **Norwegian (no):** Full coverage
- **Ukrainian (uk):** Full coverage (default)

Cover letters are generated in Norwegian with Ukrainian translation.
