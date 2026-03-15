# Bug Patterns & Solutions

## Supabase Auth Hanging (Critical, Ongoing)

**Problem**: `supabase.auth.getSession()`, `supabase.auth.signOut()`, and `onAuthStateChange` hang indefinitely.
**Workaround**: Read session from `localStorage` directly using `STORAGE_KEY`. Use `fetchWithTimeout` (5s) for role queries. Sign out by clearing localStorage, not calling supabase.auth.signOut().
**Files**: `contexts/AuthContext.tsx`, `services/supabase.ts`

## Multi-User Data Isolation (Critical, Jan 2026)

**Problem**: Queries without `user_id` filter leak data between users. Service role key bypasses RLS.
**Rule**: EVERY database query in Edge Functions and Python workers MUST include `.eq('user_id', userId)`.
**Affected**: `scheduled-scanner`, `job-analyzer`, `generate_application`, `auto_apply.py`, `api.ts` (getJobs, getTotalCost, getSystemLogs, cv.getProfiles)
**Verification**: Log in as non-admin user; should see $0.00 cost, 0 jobs, empty activity log.

## Edge Function 30-Second Timeout (Jan 2026)

**Problem**: Azure OpenAI analysis takes ~3s per job. With 10+ jobs, Edge Function times out mid-batch.
**Solution**: Delegated analysis to GitHub Actions (`analyze_worker.py`). `scheduled-scanner` only scrapes/inserts/extracts, then triggers `analyze-jobs.yml` via `repository_dispatch`.
**Files**: `supabase/functions/scheduled-scanner/index.ts`, `worker/analyze_worker.py`, `.github/workflows/analyze-jobs.yml`

## FINN URL Format (Critical, Dec 2025)

**Problem**: `finn.no/job/apply/439273812` returns 404.
**Fix**: Use query parameter format: `finn.no/job/apply?adId=439273812`.
**Shadow DOM**: FINN's "Enkel soknad" button is inside Shadow DOM; Skyvern cannot click it. Navigate directly to apply URL instead.

## FINN Detection False Positives (Dec 2025)

**Problem**: Jobs with external "Sok her" button incorrectly flagged as finn_easy.
**Fix**: Check "Sok her" button BEFORE "Enkel soknad" text. If "Sok her" found, it's an external form.
**Priority**: `has_enkel_soknad` > `application_form_type='finn_easy'` > `external_apply_url` contains `finn.no/job/apply`
**Never**: Auto-construct FINN URL for ALL FINN jobs -- only if explicitly marked.

## Finnkode Extraction Patterns

Extract from job URL using multiple patterns (in order):
1. `?finnkode=123456789` or `?adId=123456789`
2. `/job/123456789` or `/job/123456789.html`
3. `/ad/123456789` or `/ad.123456789`
4. `/123456789` (8+ digits at URL end)
5. `/job/fulltime/123456789`

## Telegram Bot RLS Queries (Jan 2026)

**Problem**: Bot queries missing `user_id` filter; RLS blocks data access.
**Symptoms**: "Soknad not found" errors, /start showing 0 stats, wrong user's jobs.
**Fix**: Added `getUserIdFromChat(supabase, chatId)` helper. All handlers now resolve user_id from chat_id first.

## FINN 2FA Webhook Timeout (Jan 2026)

**Problem**: Skyvern HTTP client has 30s timeout, but webhook was polling for 3 minutes.
**Fix**: Webhook returns immediately (code if available, empty `{}` if not). Skyvern's built-in polling (10s intervals, 15min) handles retries.

## Phone Number Format for Norwegian Forms (Jan 2026)

**Problem**: `+47 925 64 334` format breaks FINN forms.
**Fix**: `normalize_phone_for_norway()` strips `+47`, spaces, dashes. Returns 8-digit format: `92564334`.

## Telegram Message Length (Jan 2026)

**Problem**: Soknad generated in DB but not displayed (cover letter exceeds 4096 char Telegram limit).
**Fix**: Truncate cover letters to max 1500 chars each in telegram-bot before sending.

## Profile Field Name Mismatch (Dec 2025)

**Problem**: Python worker uses `name` but TypeScript StructuredProfile uses `fullName`.
**Fix**: Fallback in worker: `personal_info.get('fullName', '') or personal_info.get('name', '')`.

## "Unknown Company" in Job Listings (Dec 2025)

**Problem**: Jobs scraped from search results lack company name.
**Fix**: `extract_job_text` now extracts company via: JSON config > semantic selectors > FINN li>span > meta tags. Only updates if current is "Unknown Company" or empty.

## Per-User Scan Times Ignored (Jan 2026)

**Problem**: GitHub Actions cron sent `forceRun=true`, bypassing individual `scan_time_utc`.
**Fix**: Changed cron to hourly (`0 * * * *`) with `forceRun=false`. Each user's `scan_time_utc` hour checked against current UTC hour.

## Common Debugging Checklist

1. **"test@jobbot.no" in Skyvern**: Worker not reading `.env` -- verify file exists with `FINN_EMAIL`
2. **"Cannot construct FINN apply URL"**: `job_url` lacks finnkode -- check URL in database
3. **"FINN Soknad" button inactive**: `has_enkel_soknad=false` -- rescan job via "Typ podachi" button
4. **404 on FINN apply**: Wrong URL format -- must be `?adId=123456`, not `/job/apply/123456`
5. **Worker not detected**: Check `applications` for stuck `status='sending'` > 2 minutes
6. **Telegram notifications missing**: Verify `telegram_chat_id` in `user_settings`; use `/link CODE` to connect
7. **Edge Function not updating**: Add version log, check GitHub Actions deploy output
8. **Geocoding fails**: Add city to `CITY_COORDS` cache in `JobMap.tsx` (160+ Norwegian cities)

## SQL Debugging Queries

```sql
-- Check FINN Easy jobs
SELECT id, title, job_url, has_enkel_soknad, application_form_type, external_apply_url
FROM jobs WHERE has_enkel_soknad = true ORDER BY created_at DESC LIMIT 10;

-- Check application status
SELECT j.title, j.company, a.status, a.sent_at
FROM jobs j LEFT JOIN applications a ON j.id = a.job_id
WHERE a.status IS NOT NULL ORDER BY a.created_at DESC LIMIT 10;

-- Check 2FA requests
SELECT * FROM finn_auth_requests WHERE status IN ('pending', 'code_requested')
ORDER BY created_at DESC LIMIT 5;

-- Unanalyzed jobs per user
SELECT user_id, COUNT(*) FROM jobs WHERE status != 'ANALYZED' GROUP BY user_id;
```
