# Recent Changes - December 2025

## 2025-12-10

### Scheduled Scanner Now Extracts Job Details
- **Problem**: Jobs showed "Unknown Company", no deadline, no form type
- **Solution**: Added `extract_job_text` call for each new job during scanning
- **What it extracts**: Company, deadline, has_enkel_soknad, form_type, external_apply_url
- **File**: `supabase/functions/scheduled-scanner/index.ts`

### Site Registration System (v11.0)
- Complete system for automatic registration on recruitment sites
- **Tables**: `site_credentials`, `registration_flows`, `registration_questions`
- **Workers**: `register_site.py`, `navigation_goals.py`
- **Webhook**: `registration-webhook/`

## 2025-12-09

### Telegram Bot Auto-Link (v10.0)
- Bot auto-links chat_id on `/start` (later replaced with code-based linking)
- **File**: `telegram-bot/index.ts`

### Dashboard Application Status Filter
- New filter: "Status" with Sent, Written, No application options
- **File**: `components/JobTable.tsx`

## 2025-12-08

### NAV Jobs with FINN Redirect Detection
- **Problem**: NAV jobs redirecting to FINN weren't detected
- **Solution**: Detection in `extract_job_text` and `auto_apply.py`
- Checks `applicationUrl` in NAV page JSON for `finn.no/job/apply`

### Profile Versioning System
- **New columns**: `source_type`, `parent_profile_id`, `raw_resume_text`
- Tracks 'generated' vs 'edited' profiles
- **File**: `cv_profiles` table

## 2025-12-07

### FINN Apply URL Format Fix (CRITICAL!)
- **Problem**: Wrong URL format returned 404
- **Discovery**: Correct format is `?adId=123456` (query parameter!)
- **Shadow DOM Issue**: Can't click button → navigate directly to URL
- **File**: `worker/auto_apply.py`

### Application Status Tracking
- Added `application_status`, `application_sent_at` to Job interface
- Visual indicators in SOKNAD column
- Duplicate submission blocking
- **Files**: `types.ts`, `api.ts`, `JobTable.tsx`

### Map Filter for Sent Applications
- "Sent applications" button in map controls
- Visual distinction: larger radius, dark green border
- **File**: `pages/DashboardPage.tsx`

### Telegram Bot Improvements (v9.0)
- Statistics on /start
- 2FA code without /code prefix (plain digits accepted)
- Improved approval messages
- **File**: `telegram-bot/index.ts`

### FINN Enkel Soknad Detection Improvements
- **Button Priority**: Check "Sok her" BEFORE "Enkel soknad"
- If "Sok her" found → external form (NOT finn_easy)
- **File**: `extract_job_text/index.ts`

## 2025-12-06

### FINN URL Extraction Improvements
- Multi-pattern finnkode extraction (5 patterns)
- URL validation: reject search/filter URLs
- Startup validation for FINN credentials
- **Files**: `finn-apply/index.ts`, `auto_apply.py`

## 2025-12-03

### FINN 2FA Webhook Fix (v3.0)
- **Problem**: Skyvern has 30s timeout, webhook polled for 3 minutes
- **Solution**: Return immediately, let Skyvern poll
- **File**: `finn-2fa-webhook/index.ts`

### Phone Number Normalization
- Removes +47 prefix and spaces
- Returns 8-digit Norwegian format
- **File**: `worker/auto_apply.py`

### Geocoding Improvements
- Added 17 Innlandet towns to cache (162 total)
- Handles hyphenated/slash-separated locations
- **File**: `components/JobMap.tsx`

### Contact Info Extraction
- New feature in `extract_job_text`
- Extracts contact person name, phone, email, title
- **File**: `supabase/functions/extract_job_text/index.ts`
