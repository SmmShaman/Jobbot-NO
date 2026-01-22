# Auto-Apply Worker (auto_apply.py)

## Overview

Python worker that polls database for applications with `status='sending'` and submits them via Skyvern browser automation.

## Location

```
worker/auto_apply.py
```

## Running

```bash
cd worker
source venv/bin/activate
python auto_apply.py
```

## Features

- FINN Enkel Soknad detection with priority logic
- Multi-pattern finnkode extraction
- Skyvern task submission with 2FA webhook support
- Telegram notifications for progress and 2FA code requests
- Task status monitoring with final status update
- Startup validation for FINN credentials
- Multi-user profile isolation

## FINN Detection Priority (CRITICAL!)

```python
# 1. If external_apply_url contains finn.no/job/apply → use it
if external_apply_url and 'finn.no/job/apply' in external_apply_url:
    is_finn_easy = True
    finn_apply_url = external_apply_url

# 2. If has_enkel_soknad=true OR application_form_type='finn_easy' → construct URL
elif has_enkel_soknad or application_form_type == 'finn_easy':
    finnkode = extract_finnkode(job_url)
    finn_apply_url = f"https://www.finn.no/job/apply?adId={finnkode}"

# 3. Never auto-construct URL for all FINN jobs!
```

## Finnkode Extraction

```python
def extract_finnkode(url):
    patterns = [
        r'[?&]adId=(\d+)',          # ?adId=123456789
        r'[?&]finnkode=(\d+)',      # ?finnkode=123456789
        r'/job/(\d{8,})',           # /job/123456789
        r'/ad[./](\d+)',            # /ad/123456789
        r'/(\d{8,})(?:\?|$|\.html)', # URL end
        r'/job/fulltime/(\d+)',     # /job/fulltime/123456789
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None
```

## Environment Variables (.env)

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
SKYVERN_API_URL=http://localhost:8000
SKYVERN_API_KEY=xxx
FINN_EMAIL=your-real-finn-email@example.com   # REQUIRED!
FINN_PASSWORD=your-real-password               # REQUIRED!
TELEGRAM_BOT_TOKEN=xxx
```

Worker validates FINN_EMAIL and FINN_PASSWORD at startup.

## Multi-User Profile Isolation (CRITICAL!)

Worker uses `SUPABASE_SERVICE_KEY` which bypasses RLS. Profile queries MUST filter by `user_id`:

```python
def get_active_profile(user_id):
    response = supabase.table('cv_profiles') \
        .select('*') \
        .eq('is_active', True) \
        .eq('user_id', user_id) \  # CRITICAL!
        .limit(1) \
        .execute()
    return response.data[0] if response.data else None
```

Without this, Worker would use first profile for ALL users!

## Phone Number Normalization

Norwegian forms expect 8-digit format:

```python
def normalize_phone_for_norway(phone):
    # Remove +47 prefix and spaces
    phone = phone.replace('+47', '').replace(' ', '').replace('-', '')
    return phone  # Returns e.g. "92564334"
```

## Key Functions

| Function | Description |
|----------|-------------|
| `get_active_profile(user_id)` | Get user's active CV profile |
| `extract_finnkode(url)` | Extract FINN job code from URL |
| `trigger_finn_apply_task()` | Submit Skyvern task for FINN |
| `send_telegram_notification()` | Notify user via Telegram |
| `process_application()` | Main processing loop entry |
| `normalize_phone_for_norway()` | Format phone for forms |

## Telegram Notifications

Worker sends updates to user's linked Telegram chat:
- Application started
- 2FA code needed
- Application submitted
- Error occurred

## Debugging

```python
# Logging format
print(f"📝 Profile: {name} | {phone} | {email} | letter={len(cover_letter)}ch")
print(f"Processing job for user_id={user_id}")
print(f"👤 Profile: {full_name} (user_id={profile_user_id})")
```
