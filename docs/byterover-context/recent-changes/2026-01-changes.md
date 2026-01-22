# Recent Changes - January 2026

## 2026-01-21

### Job Analysis Catch-Up Phase & Timeout Protection
- **Problem**: Not all jobs were analyzed during scheduled scans for some users
- **Root causes**:
  1. Azure OpenAI API errors (429 rate limit, 503, timeouts) caused jobs to be skipped
  2. No timeout on Azure API fetch calls - could hang indefinitely
  3. Jobs missed in previous scans were not retried
  4. Supabase Edge Function 30-second timeout could interrupt mid-batch

- **Solution**:
  1. **AbortController timeout (25s)** - Added to all `analyzeJobRelevance()` calls
  2. **Catch-up phase** - After main scan, queries ALL unanalyzed jobs for user and retries
  3. **Improved error messages** - "Timeout (25s)" for AbortError

- **Code** (`scheduled-scanner/index.ts:417-499`):
  ```typescript
  // After URL loop, find missed jobs
  const { data: missedJobs } = await supabase.from('jobs')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'ANALYZED')
      .not('description', 'is', null)
      .limit(10);  // Limit to avoid Edge Function timeout
  ```

- **Limits**: 25s timeout per API call, max 10 jobs per catch-up phase
- **File**: `supabase/functions/scheduled-scanner/index.ts`

### GitHub Actions Cron Fix - Per-User Scan Times
- **Problem**: All users scanned at 11:00 UTC, ignoring individual `scan_time_utc`
- **Root cause**: GitHub Actions workflow always sent `forceRun: true`
- **Solution**:
  1. Changed cron from `'0 11 * * *'` to `'0 * * * *'` (every hour)
  2. Changed `FORCE_RUN="true"` to `FORCE_RUN="false"` for cron runs
  3. Now each user's `scan_time_utc` is respected
- **File**: `.github/workflows/scheduled-scan.yml`

### Manual "Mark as Sent" Button
- **Feature**: Button to manually mark applications as sent
- **API**: `api.markAsSent(appId)` sets status='sent', sent_at, source='manual'
- **UI**: Green button "Vidpravleno vruchnu" next to "Send Skyvern"
- **Files**: `services/api.ts`, `components/JobTable.tsx`

## 2026-01-20

### Telegram Bot Multi-User RLS Support (v13.0)
- **Problem**: Bot queries missing `user_id` filter, RLS blocking data access
- **Solution**: Added `user_id` filtering to ALL database queries
- **New helper**: `getUserIdFromChat(supabase, chatId)`
- **Handlers fixed**: view_app_, approve_app_, finn_apply_, auto_apply_, show_last_scan, show_hot_scan, /start, /report
- **File**: `supabase/functions/telegram-bot/index.ts`

### Worker Status Check Before Auto-Apply (v13.1)
- **Feature**: Bot warns if worker not running when submitting
- **Logic**: If 'sending' applications >2 minutes old → worker not running
- **File**: `supabase/functions/telegram-bot/index.ts`

### Better Error Handling in write_app_ (v13.3)
- Added try-catch wrapper
- Check `invokeError` from functions.invoke()
- Truncate cover letters to 1500 chars
- **File**: `supabase/functions/telegram-bot/index.ts`

## 2026-01-17

### Date Range Picker Calendar for JobTable
- **Feature**: Interactive calendar picker replacing text inputs
- **New component**: `components/DateRangePicker.tsx`
- **Dependencies**: `react-day-picker`, `date-fns`
- **Quick select**: Today, 3 days, Week
- **Files**: `DateRangePicker.tsx`, `JobTable.tsx`, `translations.ts`

### Multi-User Data Isolation Fix (CRITICAL)
- **Problem**: New users could see admin's data
- **Solution**: Added `user_id` filtering throughout:
  - Database: Added `user_id` column to `system_logs`
  - API: `getJobs()`, `getTotalCost()`, `getSystemLogs()`, `cv.getProfiles()`
  - Edge Functions: Per-user system_logs with `user_id`
- **Files**: Multiple

### Skyvern Worker Multi-User Profile Isolation (CRITICAL)
- **Problem**: Worker used FIRST active profile for ALL users
- **Solution**: Added `user_id` parameter to all profile-fetching functions
- **File**: `worker/auto_apply.py`

## 2026-01-16

### Telegram Link Code for Multi-User Support (v12.0)
- **Problem**: Auto-linking linked to random user
- **Solution**: Code-based linking system
- **New columns**: `telegram_link_code`, `telegram_link_code_expires_at`
- **New command**: `/link XXXXXX`
- **Files**: `user_settings` table, `api.ts`, `SettingsPage.tsx`, `telegram-bot/index.ts`

### Multi-User Profile Isolation Fix (CRITICAL)
- **Problem**: Scheduled scanner used FIRST profile for ALL users
- **Solution**: Complete multi-user isolation in Edge Functions
- **Files**: `scheduled-scanner`, `job-analyzer`, `generate_application`
