# FINN Enkel Soknad Auto-Apply System

## Overview

Automated application submission for FINN "Enkel soknad" (Easy Apply) jobs using Skyvern browser automation with 2FA support via Telegram.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD                                │
│  User clicks "FINN Soknad" button on job with Enkel soknad      │
│  Button active ONLY when: has_enkel_soknad=true OR              │
│                           application_form_type='finn_easy'     │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FINN-APPLY EDGE FUNCTION                      │
│  - Checks has_enkel_soknad FIRST (priority!)                    │
│  - Then checks application_form_type === 'finn_easy'            │
│  - Extracts finnkode using multiple patterns                     │
│  - Constructs finn.no/job/apply?adId={finnkode} URL             │
│  - Updates application status to 'sending'                       │
│  - Sends Telegram notification                                   │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL WORKER (auto_apply.py)                  │
│  - Polls DB every 10 sec for status='sending'                    │
│  - Uses same finnkode extraction logic                           │
│  - Reads FINN_EMAIL & FINN_PASSWORD from .env                    │
│  - Calls Skyvern with 2FA webhook URL                            │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SKYVERN                                  │
│  - Navigates to FINN apply page                                  │
│  - Logs in with FINN_EMAIL/FINN_PASSWORD                         │
│  - When 2FA needed → calls finn-2fa-webhook                      │
│  - Fills form with cover letter                                  │
│  - Submits application                                           │
└───────────────────────────────────────┬─────────────────────────┘
                                        │
          ┌─────────────────────────────┴─────────────────────────┐
          ▼                                                       ▼
┌──────────────────────┐                            ┌──────────────────────┐
│  FINN-2FA-WEBHOOK    │                            │   TELEGRAM BOT       │
│  Polls for code in   │◄──────────────────────────►│   User sends:        │
│  finn_auth_requests  │                            │   /code 123456       │
└──────────────────────┘                            └──────────────────────┘
```

## Finnkode Extraction Patterns

Worker extracts finnkode from job_url using multiple patterns:

```python
# Pattern 0: ?adId=123456789 (query parameter - FINN apply URL)
# Pattern 1: ?finnkode=123456789 (query parameter)
# Pattern 2: /job/123456789 or /job/123456789.html
# Pattern 3: /ad/123456789 or /ad.123456789
# Pattern 4: /123456789 (8+ digits at URL end)
# Pattern 5: /job/fulltime/123456789
```

## FINN URL Format

**CRITICAL**: Use `?adId=` query parameter format!

- **Correct**: `https://www.finn.no/job/apply?adId=439273812`
- **Wrong**: `https://www.finn.no/job/apply/439273812` (returns 404!)

## Detection Priority (CRITICAL!)

1. If `external_apply_url` contains `finn.no/job/apply` → use it directly
2. If `has_enkel_soknad=true` OR `application_form_type='finn_easy'` → construct URL from finnkode
3. **Never auto-construct URL for all FINN jobs** - only if explicitly marked!

## 2FA Flow

1. Skyvern starts FINN login
2. FINN requests 2FA code via email
3. Skyvern calls `finn-2fa-webhook` (POST)
4. Webhook creates `finn_auth_requests` record with status `code_requested`
5. Telegram bot notifies user "Enter 2FA code"
6. User sends `/code 123456` or just `123456`
7. Bot updates `finn_auth_requests` with code, status `code_received`
8. Skyvern polls webhook, gets code
9. Skyvern enters code, continues application

### 2FA Webhook Behavior

- Returns immediately (Skyvern has 30s timeout)
- If code available → returns `{ verification_code: "123456" }`
- If no code → returns `{}`
- Skyvern's built-in polling handles retries (10s intervals, 15min total)

## Application Status Flow

```
draft → approved → sending → sent/failed
```

### Status Meanings
- **draft**: Cover letter generated, not approved
- **approved**: User approved cover letter
- **sending**: In Skyvern queue, worker processing
- **sent**: Successfully submitted
- **failed**: Skyvern task failed
- **manual_review**: Needs manual intervention

## Duplicate Submission Blocking

- Check `application_status` before submitting
- Block if `status = 'sent'` or `status = 'sending'`
- UI shows "Vidpravleno" (disabled) for sent jobs
- Telegram bot also blocks duplicates

## Environment Requirements

```bash
# worker/.env
FINN_EMAIL=your-real-email@example.com   # REQUIRED!
FINN_PASSWORD=your-real-password          # REQUIRED!
```

Worker validates these at startup and shows warning if missing.
