# Architecture

## System Overview

JobBot Norway is a hybrid system: cloud-hosted frontend + backend with a local Python worker for browser automation.

```
┌─────────────────────────────────────┐
│  Frontend (React/Vite on Netlify)   │
│  ├── Auth via localStorage          │
│  ├── Direct REST calls to Supabase  │
│  └── api.ts wraps all DB operations │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│  Supabase (ptrmidlhfdbybxmyovtm)   │
│  ├── PostgreSQL + RLS              │
│  ├── 14 Edge Functions (Deno)      │
│  └── Auth (email/password)         │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐   ┌──────────────────────┐
│  GitHub Actions                     │   │  Local Worker (PC)   │
│  ├── scheduled-scan.yml (hourly)    │   │  ├── auto_apply.py   │
│  ├── analyze-jobs.yml (on dispatch) │   │  ├── Skyvern Docker  │
│  └── deploy-supabase-functions.yml  │   │  └── Polls DB every  │
└─────────────────────────────────────┘   │      10 seconds      │
                                          └──────────────────────┘
```

## Frontend Architecture

- **No router**: Single-page app with `useState('dashboard')` page switching in `App.tsx`
- **Auth guard**: `if (!user) return <LoginPage />`; session from localStorage, NOT `supabase.auth.getSession()`
- **Auth workaround**: Supabase JS client auth methods hang indefinitely; all auth done via direct REST fetch with 5s timeout (see `AuthContext.tsx`)
- **Role-based access**: `user_settings.role` field; admin gets extra nav item
- **Context providers**: `AuthProvider` > `LanguageProvider` > `MainLayout`
- **Mobile**: Bottom nav bar for small screens, desktop gets collapsible sidebar

## Edge Functions (Deno)

All use `serve()` from `https://deno.land/std@0.168.0/http/server.ts` and `createClient` from supabase-js.

**No-JWT functions** (called externally): `telegram-bot`, `scheduled-scanner`, `finn-2fa-webhook`
**JWT functions** (called from frontend): everything else

**30-second timeout constraint** is the main architectural driver:
- `scheduled-scanner` only does scraping + insertion + detail extraction, then dispatches `analyze-jobs` workflow via GitHub API
- Heavy AI work (analysis of 10+ jobs) runs in `worker/analyze_worker.py` as a GitHub Actions job with 60-min timeout

## Worker Architecture (Python, Local)

Runs on user's PC with Skyvern Docker container. Cannot be called from Edge Functions (localhost unreachable from cloud).

**Two-stage Skyvern design:**
1. `extract_apply_url.py` (daemon): Finds external application URLs for non-FINN jobs
2. `auto_apply.py` (daemon): Polls for `applications.status='sending'`, submits forms

**Navigation goals** (`navigation_goals.py`): Site-specific text instructions for Skyvern describing exact steps per platform (cookie handling, button locations, field mapping).

## Multi-User Isolation

**Critical pattern**: Service role key bypasses RLS, so ALL queries in Edge Functions and workers MUST include `.eq('user_id', userId)`.

```
scheduled-scanner:
  for each user with auto_scan_enabled:
    -> get USER's active profile
    -> get USER's finn_search_urls
    -> scrape jobs -> save with user_id
    -> trigger analysis for USER
    -> send notifications to USER's telegram
```

## Database Design

- **RLS**: Enabled on all tables, permissive policies per user
- **JSONB**: `analysis_metadata` (aura, radar, score), `skyvern_metadata` (task_id), `structured_content` (full CV)
- **Migrations**: In `database/` directory (not `supabase/migrations/`), applied manually or via Management API
- **Key relationships**: `applications.job_id -> jobs.id`, `jobs.user_id -> auth.users.id`, `cv_profiles.parent_profile_id -> cv_profiles.id`

## CI/CD

- **deploy-supabase-functions.yml**: On push to `main` with changes in `supabase/functions/**`; deploys all functions (telegram-bot/scheduled-scanner/finn-2fa-webhook without JWT, rest with JWT)
- **scheduled-scan.yml**: Hourly cron, calls `scheduled-scanner` Edge Function with `forceRun=false`; each user's `scan_time_utc` hour is respected
- **analyze-jobs.yml**: Triggered via `repository_dispatch` from scheduled-scanner, or manually; runs `analyze_worker.py`

## Key API Patterns (services/api.ts)

- Location extraction: `extractLocation()` scans text for Norwegian postal codes, city names from 160+ cached cities
- All CRUD operations go through `supabase.from('table')` with RLS (user's JWT)
- `fillFinnForm()`: Creates application record with `status='sending'`, triggers local worker
- Dashboard stats: `getJobs()` joins with `applications` to get status per job

## Telegram Bot (telegram-bot/index.ts, 147K)

Largest single file. Handles:
- Commands: `/start`, `/scan`, `/report`, `/link XXXXXX`, `/code XXXXXX`
- Inline buttons: write/view/approve applications, FINN submit, auto-apply
- URL pipeline: user sends job URL -> scrape -> analyze -> show result
- 2FA flow: bot receives code -> stores in `finn_auth_requests` -> webhook returns to Skyvern
- Registration Q&A: Skyvern asks questions during site registration -> relayed via Telegram
