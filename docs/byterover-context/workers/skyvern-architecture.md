# Skyvern Two-Stage Architecture

## CRITICAL CONCEPT

Skyvern operates in **two stages** performing DIFFERENT tasks:

## Stage 1: URL Extraction (`extract_apply_url.py`)

- **When**: Automatically during scanning (daemon mode)
- **What it does**: Finds external_apply_url for jobs
- **For which jobs**: NOT finn_easy (external forms only)
- **Result**: Populates `external_apply_url` in database

```
┌─────────────────────────────────────────────────────────────────┐
│                         STAGE 1 (Auto)                          │
│  extract_apply_url.py --daemon                                  │
│  - Runs during job scanning                                     │
│  - Extracts external URLs for NON-finn_easy jobs                │
│  - Skips finn_easy jobs (they don't need external URL)          │
└─────────────────────────────────────────────────────────────────┘
```

**Daemon mode:**
```bash
python extract_apply_url.py --daemon
```

**URL Validation:**
- Rejects search/filter URLs
- Rejects URLs that aren't direct form links

## Stage 2: Form Filling (`auto_apply.py`)

- **When**: Manual trigger via "FINN Soknad" button
- **What it does**: Fills and submits form on FINN
- **For which jobs**: finn_easy (Enkel Soknad) ONLY
- **Result**: Submitted application

```
┌─────────────────────────────────────────────────────────────────┐
│                         STAGE 2 (Manual)                        │
│  auto_apply.py (polls for status='sending')                     │
│  - Triggered by "FINN Soknad" button click                      │
│  - Constructs finn.no/job/apply?adId={finnkode} URL             │
│  - Logs into FINN with credentials from .env                    │
│  - Fills and submits application form                           │
└─────────────────────────────────────────────────────────────────┘
```

## Navigation Goals (Site-Specific Scripts)

Each job site requires a **different `navigation_goal`** - a text instruction for Skyvern that describes step-by-step what to do on that specific site.

### Stage 1: URL Extraction Navigation Goals

**NAV.no:**
```python
navigation_goal = """
STEP 1: Handle cookie popup
STEP 2: Find "Gå til søknad" button (GREEN, right side)
STEP 3: Extract href BEFORE clicking (includes query params!)
STEP 4: Report complete URL as 'application_url'
"""
```

**FINN.no:**
```python
navigation_goal = """
STEP 1: Handle Schibsted cookie popup
STEP 2: Look at TOP RIGHT for apply button
STEP 3: Check button text:
   - "Enkel søknad" → is_finn_internal=true, NO URL
   - "Søk her" → Extract external href
"""
```

### Stage 2: Form Filling Navigation Goals

**Generic Form (Webcruiter, Easycruit, etc.):**
```python
navigation_goal = """
PHASE 1: UNBLOCK - Accept cookies
PHASE 2: FIND BUTTON - Look TOP RIGHT for blue button
PHASE 3: SCROLL SEARCH - If not found, scroll down
PHASE 4: FILL FORM - Use PAYLOAD data
PHASE 5: FINISH - Complete (do not submit)
"""
```

**FINN Enkel Soknad (with login):**
```python
navigation_goal = f"""
PHASE 1: LOGIN
   - Enter email: {FINN_EMAIL}
   - Click "Neste"
   - Enter password
   - Handle 2FA (auto-provided via webhook)
PHASE 2: APPLICATION FORM
   - Fill Name, Email, Phone, Message
PHASE 3: SUBMIT
   - Check GDPR checkbox
   - Click "Send søknad"
"""
```

**FINN Enkel Soknad (already logged in):**
```python
navigation_goal = """
PHASE 1: APPLICATION FORM (already logged in)
   - Fill form fields
PHASE 2: SUBMIT
"""
```

## Best Practices for Navigation Goals

1. **Be specific about selectors**: "BLUE button at TOP RIGHT" > "find button"
2. **Handle cookies first**: Every Norwegian site has GDPR popups
3. **Include exact button texts**: "Søk her", "Send søknad", "Godta alle"
4. **Preserve query parameters**: URLs like `?job=123&ref=nav` are critical
5. **Don't auto-submit for unknowns**: Generic goals should stop at "form filled"
6. **Add phase markers**: PHASE 1, PHASE 2 help Skyvern track progress

## Adding New Site Support

1. **Identify the platform** - Check URL patterns in `external_apply_url`
2. **Create navigation_goal** - Write step-by-step instructions
3. **Add to worker** - Add condition in `auto_apply.py`
4. **Test manually** - Run single job through Skyvern
5. **Update CLAUDE.md** - Document the new platform
