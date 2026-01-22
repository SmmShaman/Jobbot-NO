# Database Schema

## Core Tables

### jobs
Main table for job listings scraped from FINN, LinkedIn, NAV.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner (multi-user isolation) |
| `title` | TEXT | Job title |
| `company` | TEXT | Company name |
| `location` | TEXT | Job location |
| `job_url` | TEXT | Original job URL |
| `source` | ENUM | FINN / LINKEDIN / NAV |
| `status` | ENUM | NEW / ANALYZED / APPLIED / REJECTED / INTERVIEW / SENT |
| `description` | TEXT | Job description |
| `ai_recommendation` | TEXT | AI analysis text |
| `tasks_summary` | TEXT | Specific duties list |
| `analysis_metadata` | JSONB | aura, radar metrics, score |
| `has_enkel_soknad` | BOOLEAN | FINN Easy Apply detection (PRIORITY FLAG!) |
| `application_form_type` | ENUM | finn_easy / external_form / external_registration / email / processing / skyvern_failed / unknown |
| `external_apply_url` | TEXT | Direct URL to application form |
| `deadline` | TEXT | Application deadline (ISO format) |
| `cost_usd` | DECIMAL | AI processing cost |

### applications
Cover letters and application status tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `job_id` | UUID | FK to jobs |
| `user_id` | UUID | Owner |
| `cover_letter_no` | TEXT | Norwegian cover letter |
| `cover_letter_uk` | TEXT | Ukrainian translation |
| `status` | ENUM | draft / approved / sending / manual_review / sent / failed / rejected |
| `skyvern_metadata` | JSONB | task_id, finn_apply flag, source |
| `sent_at` | TIMESTAMP | When application was sent |
| `cost_usd` | DECIMAL | AI generation cost |

### cv_profiles
User CV profiles with structured content.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner |
| `profile_name` | TEXT | Profile display name |
| `content` | TEXT | Legacy text summary |
| `structured_content` | JSONB | StructuredProfile data |
| `raw_resume_text` | TEXT | Original extracted text |
| `is_active` | BOOLEAN | Currently active profile |
| `source_files` | TEXT[] | Uploaded file references |
| `source_type` | ENUM | 'generated' / 'edited' |
| `parent_profile_id` | UUID | Reference to original (for edited) |

### user_settings
Per-user configuration and preferences.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner |
| `telegram_chat_id` | TEXT | Linked Telegram chat |
| `telegram_link_code` | TEXT | 6-char linking code |
| `finn_search_urls` | TEXT[] | FINN search URLs to scan |
| `application_prompt` | TEXT | Custom AI prompt |
| `ui_language` | TEXT | Interface language |
| `is_auto_scan_enabled` | BOOLEAN | Auto-scan enabled |
| `scan_time_utc` | TEXT | Scheduled scan time |
| `role` | ENUM | admin / user |

### finn_auth_requests
2FA code handling for FINN login.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner |
| `telegram_chat_id` | TEXT | For notifications |
| `totp_identifier` | TEXT | Email for 2FA |
| `status` | ENUM | pending / code_requested / code_received / completed / expired / failed |
| `verification_code` | TEXT | 2FA code from user |
| `skyvern_task_id` | TEXT | Associated Skyvern task |

### system_logs
Event logging for cost tracking and debugging.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner (multi-user isolation) |
| `event_type` | ENUM | SCAN / PROFILE_GEN / APPLICATION_GEN / MANUAL_TRIGGER |
| `status` | ENUM | SUCCESS / FAILED |
| `message` | TEXT | Log message |
| `details` | JSONB | Additional data |
| `tokens_used` | INTEGER | AI tokens consumed |
| `cost_usd` | DECIMAL | Operation cost |
| `source` | ENUM | TELEGRAM / WEB_DASHBOARD / CRON |

## Multi-User RLS

**CRITICAL**: All queries must include `user_id` filter:
- API queries filter by current user
- Edge Functions filter by passed `user_id`
- Worker uses service key (bypasses RLS) - **must filter in code**

```sql
-- Example RLS policy
CREATE POLICY "Users see own jobs" ON jobs
  FOR SELECT USING (auth.uid() = user_id);
```
