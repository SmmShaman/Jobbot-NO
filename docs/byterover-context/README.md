# ByteRover Context - JobBot Norway

Full project documentation split into topic-based files for efficient ByteRover curation.

**Total**: 12 files, ~51KB

## Structure

### Architecture (3 files)

#### Project Overview
**File:** `architecture/project-overview.md` (3918 chars)
**Contains:**
- Technology stack
- Project structure
- Key conventions
- Development commands

**Code files:** `package.json`, `vite.config.ts`

```bash
brv curate "$(cat architecture/project-overview.md)"
```

#### Database Schema
**File:** `architecture/database-schema.md` (4263 chars)
**Contains:**
- Core tables (jobs, applications, cv_profiles, user_settings)
- Column definitions
- Multi-user RLS policies

**Code files:** `database/setup_jobs.sql`

```bash
brv curate "$(cat architecture/database-schema.md)"
```

#### Edge Functions
**File:** `architecture/edge-functions.md` (2689 chars)
**Contains:**
- Function list with JWT requirements
- Deployment instructions
- Environment variables

**Code files:** `supabase/functions/scheduled-scanner/index.ts`

```bash
brv curate "$(cat architecture/edge-functions.md)" -f supabase/functions/scheduled-scanner/index.ts
```

---

### Features (3 files)

#### Job Management
**File:** `features/job-management.md` (3025 chars)
**Contains:**
- Job sources (FINN, NAV, LinkedIn)
- Workflow states
- AI analysis features
- Form type detection

**Code files:** `components/JobTable.tsx`

```bash
brv curate "$(cat features/job-management.md)" -f components/JobTable.tsx
```

#### FINN Auto-Apply
**File:** `features/finn-auto-apply.md` (7061 chars)
**Contains:**
- Architecture diagram
- Finnkode extraction patterns
- 2FA flow
- Detection priority (CRITICAL!)

**Code files:** `supabase/functions/finn-apply/index.ts`, `worker/auto_apply.py`

```bash
brv curate "$(cat features/finn-auto-apply.md)" -f supabase/functions/finn-apply/index.ts -f worker/auto_apply.py
```

#### Telegram Bot
**File:** `features/telegram-bot.md` (2768 chars)
**Contains:**
- Commands (/start, /link, /scan, /code)
- Linking flow
- Inline buttons
- Multi-user RLS support

**Code files:** `supabase/functions/telegram-bot/index.ts`

```bash
brv curate "$(cat features/telegram-bot.md)" -f supabase/functions/telegram-bot/index.ts
```

---

### Workers (2 files)

#### Skyvern Architecture
**File:** `workers/skyvern-architecture.md` (4845 chars)
**Contains:**
- Two-stage architecture (URL extraction vs form filling)
- Navigation goals for each site
- Best practices

**Code files:** `worker/navigation_goals.py`

```bash
brv curate "$(cat workers/skyvern-architecture.md)" -f worker/navigation_goals.py
```

#### Auto-Apply Worker
**File:** `workers/auto-apply-worker.md` (3725 chars)
**Contains:**
- Worker features
- FINN detection priority
- Multi-user profile isolation
- Environment variables

**Code files:** `worker/auto_apply.py`

```bash
brv curate "$(cat workers/auto-apply-worker.md)" -f worker/auto_apply.py
```

---

### Integrations (1 file)

#### Recruitment Platforms
**File:** `integrations/recruitment-platforms.md` (6722 chars)
**Contains:**
- Supported platforms (Webcruiter, Easycruit, etc.)
- Site registration system
- Registration flow diagram

**Code files:** `worker/register_site.py`

```bash
brv curate "$(cat integrations/recruitment-platforms.md)" -f worker/register_site.py
```

---

### Recent Changes (2 files)

#### January 2026
**File:** `recent-changes/2026-01-changes.md` (4419 chars)
**Contains:**
- Job analysis catch-up phase
- Per-user scan times fix
- Multi-user data isolation
- Telegram bot v13.0

```bash
brv curate "$(cat recent-changes/2026-01-changes.md)"
```

#### December 2025
**File:** `recent-changes/2025-12-changes.md` (3400 chars)
**Contains:**
- Site registration system
- FINN URL format fix
- Application status tracking
- 2FA webhook fix

```bash
brv curate "$(cat recent-changes/2025-12-changes.md)"
```

---

### Debugging (1 file)

#### Known Issues
**File:** `debugging/known-issues.md` (4361 chars)
**Contains:**
- Common debugging issues
- SQL queries for debugging
- Best practices for AI assistants

```bash
brv curate "$(cat debugging/known-issues.md)"
```

---

## Curate All

Run all curations at once:

```bash
cd docs/byterover-context
./curate-all.sh
```

## Query Examples

```bash
brv query "How does FINN auto-apply work?"
brv query "What is the two-stage Skyvern architecture?"
brv query "How to debug FINN detection issues?"
brv query "What are the database schema tables?"
```
