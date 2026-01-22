# External Recruitment Platforms

## Supported Platforms

Jobs may redirect to these external systems (detected in `external_apply_url`):

| Platform | Domain Patterns | Form Type |
|----------|----------------|-----------|
| Webcruiter | webcruiter.com, webcruiter.no | external_form |
| Easycruit | easycruit.com | external_form |
| ReachMee | reachmee.com, attract.reachmee.com | external_form |
| Teamtailor | teamtailor.com | external_form |
| Lever | lever.co | external_form |
| Jobylon | jobylon.com | external_form |
| Recman | recman.no | external_registration |
| CvPartner | cvpartner.com | external_registration |
| TalentTech | talenttech.io | external_form |

## Site Registration System (v11.0)

Complete system for automatic registration on recruitment sites with Telegram integration.

### Database Tables

**site_credentials:**
- Stores login/password for recruitment sites per user

**registration_flows:**
- Tracks registration process status
- States: pending, in_progress, verification_needed, completed, failed

**registration_questions:**
- Q&A history during registration

### Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: auto_apply.py receives application for external form    │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Check site_credentials for domain                       │
│         Has credentials? → Use them for login + fill form       │
│         No credentials? → Check if external_registration        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ (no credentials + external_registration)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Trigger registration flow                               │
│         - Generate secure password                              │
│         - Get email from profile                                │
│         - Create registration_flows record                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: register_site.py starts Skyvern task                    │
│         - Uses site-specific navigation_goal from templates     │
│         - Fills form with profile data                          │
│         - If missing info → asks via Telegram                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Verification (if required)                              │
│         - Email code → Telegram: "Enter code from email"        │
│         - SMS code → Telegram: "Enter code from SMS"            │
│         - Link click → Telegram: "Click the link"               │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Save credentials to site_credentials                    │
│         - Ready for future applications on this site            │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Files

- `worker/register_site.py` - Registration worker (Skyvern-based)
- `worker/navigation_goals.py` - Site-specific navigation templates
- `supabase/functions/registration-webhook/` - Q&A webhook for Telegram

### Telegram Bot Callbacks

- `regq_*` - Registration questions
- `reg_confirm_*` - Confirm registration
- `reg_cancel_*` - Cancel registration
- Text answers for pending questions
- Verification codes (email/SMS)

### Timeouts

- Question response: 5 minutes
- Verification code: 5 minutes
- Overall registration: 30 minutes

### Usage

```bash
# Daemon mode (polls for pending registrations)
python register_site.py

# Manual registration
python register_site.py --site https://company.webcruiter.no/register
```

## Adding New Platform Support

1. **Identify the platform** - Check URL patterns in `external_apply_url`
2. **Create navigation_goal** - Write step-by-step instructions:
   - Cookie handling (each site has different popup)
   - Form location (where is the apply button?)
   - Field selectors (Name, Email, Phone, CV upload)
   - Submit button text and behavior
3. **Add to worker** - Add condition in `auto_apply.py`:
   ```python
   if 'newplatform.com' in external_apply_url:
       navigation_goal = """
       STEP 1: Handle cookies...
       STEP 2: Find application form...
       """
   ```
4. **Test manually** - Run single job through Skyvern to validate
5. **Update CLAUDE.md** - Document the new platform
