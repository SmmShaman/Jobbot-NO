# Supabase Edge Functions

## Function List

| Function | Purpose | JWT Required |
|----------|---------|--------------|
| `scheduled-scanner` | Cron: Scrape jobs, run analysis pipeline | No |
| `telegram-bot` | Webhook: Telegram commands, trigger scans | No |
| `finn-apply` | Queue FINN applications for local worker | Yes |
| `finn-2fa-webhook` | Receive 2FA codes from Skyvern | No |
| `fix-jobs-rls` | Utility to repair RLS policies | Yes |
| `job-analyzer` | Analyze job fit, generate aura + radar metrics | Yes |
| `generate_application` | Generate cover letters via Azure OpenAI | Yes |
| `analyze_profile` | Extract & analyze resumes | Yes |
| `extract_job_text` | Scrape job description + detect Enkel soknad | Yes |
| `job-scraper` | Scrape jobs from job boards | Yes |
| `admin-actions` | User management (create, list, delete) | Yes |
| `registration-webhook` | Site registration Q&A webhook | No |

## Deployment

**IMPORTANT**: Deployment is automatic via GitHub Actions on merge to main!
Manual `supabase functions deploy` is not needed.

Functions without JWT verification:
- `telegram-bot`
- `scheduled-scanner`
- `finn-2fa-webhook`
- `registration-webhook`

Manual deploy (if needed):
```bash
supabase functions deploy finn-apply --project-ref ptrmidlhfdbybxmyovtm
supabase functions deploy finn-2fa-webhook --no-verify-jwt --project-ref ptrmidlhfdbybxmyovtm
```

## Environment Variables

### Edge Functions (.env in Supabase)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
TELEGRAM_BOT_TOKEN
```

## Key Edge Function Details

### scheduled-scanner
- Runs hourly via GitHub Actions cron
- Respects per-user `scan_time_utc` setting
- Calls `extract_job_text` for each new job
- Runs job analysis with 25s timeout per call
- Has catch-up phase for missed jobs (max 10)

### extract_job_text
- Scrapes job description from URL
- Detects FINN Enkel Soknad (has_enkel_soknad)
- Extracts deadline, company, contact info
- URL validation: rejects search/filter URLs

### job-analyzer
- Requires `userId` parameter
- Returns relevance score (0-100)
- Generates aura and radar metrics
- Respects user's language preference

### generate_application
- Generates Norwegian cover letter
- Optionally generates Ukrainian translation
- Requires `user_id` for profile lookup
- Truncates to 1500 chars for Telegram

## Best Practices for Edge Functions

1. **Authentication**: Never use `supabase.auth.*()` - use direct fetch
2. **Deno Pattern**: Use `Deno.serve()`
3. **Timeout**: Edge Functions have 30s limit
4. **Multi-user**: Always filter by `user_id`
5. **Error logging**: Log with prefix + store in `system_logs`
