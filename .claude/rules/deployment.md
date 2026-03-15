# Deployment & CI/CD

## Automatic Deployment (Primary)

Edge Functions deploy automatically via GitHub Actions on merge to main when files in `supabase/functions/**` change.

**Workflow**: `.github/workflows/deploy-supabase-functions.yml`

Three functions deploy without JWT verification (called externally):
- `telegram-bot` (Telegram webhook)
- `scheduled-scanner` (GitHub Actions cron)
- `finn-2fa-webhook` (Skyvern callback)

All others deploy with JWT verification (called from authenticated frontend).

## Manual Edge Function Deploy

```bash
# From project root (not from supabase/ subdirectory)
supabase functions deploy <function-name> --project-ref ptrmidlhfdbybxmyovtm

# No-JWT functions
supabase functions deploy telegram-bot --no-verify-jwt --project-ref ptrmidlhfdbybxmyovtm
supabase functions deploy scheduled-scanner --no-verify-jwt --project-ref ptrmidlhfdbybxmyovtm
supabase functions deploy finn-2fa-webhook --no-verify-jwt --project-ref ptrmidlhfdbybxmyovtm
```

## Frontend Deployment

Frontend is on Netlify. Build with `npm run build`, output in `dist/`.

## GitHub Actions Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Deploy Functions | `deploy-supabase-functions.yml` | Push to main (supabase/functions/**) | Auto-deploy all Edge Functions |
| Scheduled Scan | `scheduled-scan.yml` | Hourly cron (`0 * * * *`) | Trigger scheduled-scanner per user's scan_time_utc |
| Analyze Jobs | `analyze-jobs.yml` | `repository_dispatch` or manual | Run analyze_worker.py (60-min timeout) |

### Scheduled Scan Details

- Runs every hour at :00
- Calls `scheduled-scanner` Edge Function with `forceRun=false`
- Edge Function checks each user's `scan_time_utc` hour against current UTC hour
- Only matching users are processed
- Manual `workflow_dispatch` supports `force_run=true` to scan all users immediately

### Analyze Jobs Details

- Triggered by `scheduled-scanner` via GitHub API `repository_dispatch` with type `analyze-jobs`
- Requires `GITHUB_PAT` secret in Supabase Edge Functions (for triggering)
- Accepts optional `limit` and `user_id` parameters
- Python script with no timeout limits (GitHub Actions default 60 min)

## Required Secrets

### GitHub Actions Secrets
| Secret | Used By |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | deploy-supabase-functions (CLI auth) |
| `SUPABASE_URL` | analyze-jobs, scheduled-scan |
| `SUPABASE_SERVICE_KEY` | analyze-jobs |
| `SUPABASE_SERVICE_ROLE_KEY` | scheduled-scan |
| `AZURE_OPENAI_ENDPOINT` | analyze-jobs |
| `AZURE_OPENAI_API_KEY` | analyze-jobs |
| `AZURE_OPENAI_DEPLOYMENT` | analyze-jobs |
| `TELEGRAM_BOT_TOKEN` | analyze-jobs |

### Supabase Edge Function Secrets
| Secret | Used By |
|--------|---------|
| `SUPABASE_URL` | All functions |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions |
| `AZURE_OPENAI_ENDPOINT` | job-analyzer, generate_application, analyze_profile |
| `AZURE_OPENAI_API_KEY` | Same |
| `AZURE_OPENAI_DEPLOYMENT` | Same |
| `TELEGRAM_BOT_TOKEN` | telegram-bot, scheduled-scanner |
| `GITHUB_PAT` | scheduled-scanner (triggers analyze-jobs workflow) |

## Database Migrations

SQL files live in `database/` (NOT `supabase/migrations/`). Applied manually via:
- Supabase Dashboard SQL editor
- Management API: `POST /v1/projects/ptrmidlhfdbybxmyovtm/database/query`
- Edge Function `db-admin` (direct SQL execution)

## Supabase Project

- **Project ref**: `ptrmidlhfdbybxmyovtm`
- **URL**: `https://ptrmidlhfdbybxmyovtm.supabase.co`
- **Region**: (check Supabase dashboard)

## Local Worker Setup

The Python worker runs on user's PC (not deployed to cloud).

```bash
cd worker
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with real FINN_EMAIL, FINN_PASSWORD, SKYVERN_API_KEY, etc.

# Start Skyvern Docker first
# Then:
python auto_apply.py          # Form filling (polls every 10s)
python extract_apply_url.py --daemon  # URL extraction
python register_site.py       # Site registration daemon
```

## Verification

- Edge Function updated: Add version log `console.log('Function vYYYY-MM-DD started')` and check Supabase Function Logs
- GitHub Actions: Check Actions tab for workflow runs
- Worker running: Check `worker_heartbeat` table or Telegram bot warning ("Worker not running")
