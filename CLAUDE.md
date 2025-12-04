# CLAUDE.md - AI Assistant Guide for JobBot Norway

This file contains critical information for AI assistants working on this codebase.

## Project Overview

**JobBot Norway** is a job search automation platform for the Norwegian job market with AI-powered job analysis, cover letter generation, and application tracking.

### Technology Stack
- **Frontend**: React 19.2, TypeScript 5.8, Vite 6.2, TailwindCSS (CDN)
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
- **AI Services**: Azure OpenAI (chat completions)
- **Integrations**: Telegram Bot API, Web scraping (Cheerio)
- **Deployment**: Netlify (frontend), Supabase (functions)
- **CI/CD**: GitHub Actions

---

## CRITICAL: Supabase JS Client Issue

### Problem
The `@supabase/supabase-js` client **hangs indefinitely** on certain operations:
- `supabase.auth.getSession()` - hangs
- `supabase.auth.signInWithPassword()` - hangs
- `supabase.from('table').select()` - works but slow (~1-1.5 seconds)

### Root Cause
Unknown. Direct `fetch()` to the same Supabase endpoints works fine (~400-600ms).

### Solution Implemented
All authentication operations bypass the Supabase JS client and use direct `fetch()`:

1. **Login** (`pages/LoginPage.tsx`):
   - Uses direct `fetch()` to `/auth/v1/token?grant_type=password`
   - Stores session in localStorage manually

2. **Session Check** (`contexts/AuthContext.tsx`):
   - Reads session directly from localStorage
   - Does NOT call `supabase.auth.getSession()`
   - Uses direct `fetch()` for `fetchUserRole()`

3. **Sign Out** (`contexts/AuthContext.tsx`):
   - Does NOT call `supabase.auth.signOut()`
   - Simply clears localStorage and React state

### Important Constants
```typescript
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const STORAGE_KEY = 'sb-ptrmidlhfdbybxmyovtm-auth-token';
```

---

## Project Structure

```
/home/user/Jobbot-NO/
├── .github/workflows/
│   ├── deploy-supabase-functions.yml   # Edge function deployment
│   └── scheduled-scan.yml              # Daily job scanning cron
├── supabase/functions/                 # 8 Deno-based Edge Functions
│   ├── admin-actions/                  # User management
│   ├── analyze_profile/                # Resume analysis
│   ├── extract_job_text/               # Web scraping
│   ├── generate_application/           # Cover letter generation
│   ├── job-analyzer/                   # Job fit analysis
│   ├── job-scraper/                    # Job board scraping
│   ├── scheduled-scanner/              # Cron job handler
│   └── telegram-bot/                   # Telegram integration
├── database/                           # SQL migration files
├── worker/                             # Python auto-apply worker
├── pages/                              # React page components
│   ├── DashboardPage.tsx               # Main dashboard with metrics
│   ├── JobsPage.tsx                    # Job listings & management
│   ├── SettingsPage.tsx                # User configuration
│   ├── LoginPage.tsx                   # Authentication
│   ├── ClientProfilePage.tsx           # User profile & stats
│   └── AdminUsersPage.tsx              # Admin user management
├── components/                         # Reusable UI components
│   ├── JobTable.tsx                    # Job listing table (766 lines)
│   ├── JobMap.tsx                      # Geographic visualization
│   ├── ProfileEditor.tsx               # CV profile editor
│   ├── ActivityLog.tsx                 # Event history
│   ├── Sidebar.tsx                     # Navigation
│   └── MetricCard.tsx                  # Stat cards
├── services/
│   ├── api.ts                          # API wrapper (581 lines)
│   ├── supabase.ts                     # Supabase client
│   └── translations.ts                 # i18n (EN, NO, UK)
├── contexts/
│   ├── AuthContext.tsx                 # Auth state management
│   └── LanguageContext.tsx             # Language state
├── App.tsx                             # Root component
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

### Application System
- **Cover Letters**: AI-generated Norwegian cover letters
- **Status Tracking**: Draft → Approved → Sending → Sent/Failed
- **Cost Tracking**: Per-job AI processing costs

### CV Profiles
- **Multiple Profiles**: Users can have multiple CV profiles
- **Resume Upload**: PDF/DOC to Supabase Storage
- **AI Analysis**: Structured extraction (education, experience, skills)

### Automation
- **Scheduled Scanning**: Daily at 11:00 UTC via GitHub Actions
- **Telegram Bot**: Commands for manual triggers and notifications
- **Auto-apply**: Python worker for automated applications (experimental)

### Internationalization
- **Languages**: English, Norwegian, Ukrainian
- **Full Coverage**: All UI strings translated in `services/translations.ts`

---

## Database Schema

### Core Tables

**jobs**
- `id`, `title`, `company`, `location`, `url`, `source` (FINN/LINKEDIN/NAV)
- `status`: NEW | ANALYZED | APPLIED | REJECTED | INTERVIEW | SENT
- `analysis_metadata` (JSONB): aura, radar metrics, score
- `cost_usd`: AI processing cost

**applications**
- `id`, `job_id`, `user_id`
- `cover_letter_no`, `cover_letter_uk`
- `status`: draft | approved | sending | manual_review | sent | failed | rejected
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

**system_logs**
- Event tracking with `event_type`, `status`, `tokens_used`, `cost_usd`
- Types: SCAN, PROFILE_GEN, APPLICATION_GEN, MANUAL_TRIGGER

---

## Edge Functions (Supabase)

| Function | Purpose |
|----------|---------|
| `scheduled-scanner` | Cron: Scrape jobs, run analysis pipeline |
| `telegram-bot` | Webhook: Telegram commands, trigger scans |
| `job-analyzer` | Analyze job fit, generate aura + radar metrics |
| `generate_application` | Generate cover letters via Azure OpenAI |
| `analyze_profile` | Extract & analyze resumes |
| `extract_job_text` | Scrape job description from URL |
| `job-scraper` | Scrape jobs from job boards |
| `admin-actions` | User management (create, list, delete) |

**Note**: `telegram-bot` and `scheduled-scanner` are deployed with `--no-verify-jwt` for webhook/cron access.

---

## CI/CD Workflows

### `deploy-supabase-functions.yml`
- **Trigger**: Push to main (when `supabase/functions/**` changed) + manual
- **Action**: Deploy all 8 Edge Functions

### `scheduled-scan.yml`
- **Trigger**: Daily at 11:00 UTC (12:00 Norway time) + manual
- **Action**: POST to `/functions/v1/scheduled-scanner` with SERVICE_ROLE_KEY

---

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment
- Supabase credentials are hardcoded (MVP approach)
- Netlify build: `npm ci && npm run build`
- Publish directory: `dist/`

---

## Auth Flow

```
1. User visits site
2. AuthContext checks localStorage for session
3. If valid session found:
   - Fetch user role via direct fetch
   - Show Dashboard
4. If no session:
   - Show LoginPage
5. On login:
   - Direct fetch to /auth/v1/token
   - Store response in localStorage
   - Reload page
6. On logout:
   - Clear localStorage
   - Clear React state
   - Show LoginPage
```

---

## Debugging

### Console Logging Prefixes
- `[Supabase]` - Supabase client operations
- `[Auth]` - Authentication flow
- `[Login]` - Login operations
- `[Realtime]` - Realtime subscriptions

### Common Issues

1. **"Loading your workspace..." stuck forever**
   - Cause: Supabase client hanging
   - Fix: Ensure auth uses direct fetch, not Supabase client

2. **Logout not working**
   - Cause: `supabase.auth.signOut()` hanging
   - Fix: Use direct localStorage clear

3. **Data not loading**
   - Supabase client for data queries is slow but works
   - Consider direct fetch for latency-critical operations

4. **Scheduled scan not running**
   - Check GitHub Actions workflow status
   - Verify SERVICE_ROLE_KEY secret is set

---

## AI Cost Tracking

### Azure OpenAI Pricing (Configured)
```typescript
const PRICE_PER_1M_INPUT = 2.50;   // USD
const PRICE_PER_1M_OUTPUT = 10.00; // USD
```

Costs tracked per:
- Job analysis
- Cover letter generation
- Resume analysis
- Stored in: `job.cost_usd`, `application.cost_usd`, `system_logs.cost_usd`

---

## Recent Changes (2025-12-04)

1. **Scan Statistics**: Added date display and 'Show all' buttons for scan results
2. **Cron Schedule**: Changed to run once per day at 11:00 UTC (12:00 Norway)
3. **Telegram Notifications**: Enhanced with detailed job info and action buttons
4. **Job Analysis**: Action buttons for jobs with score >= 50
5. **Scheduled Scanner**: Improved with forceRun logic and time validation

---

## Best Practices for AI Assistants

1. **Authentication**: Never use `supabase.auth.*()` methods - use direct fetch
2. **Data Queries**: Supabase client works but is slow; consider direct fetch for critical paths
3. **Edge Functions**: Deno-based; use `Deno.serve()` pattern
4. **Translations**: Add new strings to all 3 languages in `translations.ts`
5. **Types**: All interfaces defined in `types.ts`
6. **State**: React hooks + Context only (no Redux/Zustand)
7. **Styling**: TailwindCSS utility classes
8. **Errors**: Log to console with prefix + store in `system_logs` for production

---

## TODO

- [ ] Consider replacing all Supabase client calls with direct fetch
- [ ] Remove debug tests from `services/supabase.ts` in production
- [ ] Implement token refresh mechanism
- [ ] Fix recharts width/height warnings
- [ ] Move hardcoded credentials to environment variables
- [ ] Complete Python auto-apply worker implementation
