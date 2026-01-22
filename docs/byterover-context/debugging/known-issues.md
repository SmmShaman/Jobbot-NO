# Known Issues & Debugging

## Supabase Client Issues

- `supabase.auth.*()` methods hang - use direct fetch instead
- Realtime requires async client - using polling instead
- Data queries work but slow (~1-1.5s)

## FINN Detection Issues

- Jobs scraped before update may lack `external_apply_url`
- Worker extracts `finnkode` from `job_url` as fallback
- **"Sok her" vs "Enkel soknad"**: If job has external "Sok her" button, it's NOT finn_easy
- `extract_job_text` now checks button priority

## Common Debugging Issues

| # | Issue | Cause | Solution |
|---|-------|-------|----------|
| 1 | "test@jobbot.no" in Skyvern | Worker not reading .env | Verify .env exists with FINN_EMAIL |
| 2 | "Cannot construct FINN apply URL" | job_url doesn't contain finnkode | Check URL in database |
| 3 | Incorrect has_enkel_soknad | Job created from search URL | Delete and rescan |
| 4 | "FINN Soknad" button inactive | has_enkel_soknad=false | Check application_form_type |
| 5 | External form shown as finn_easy | "Sok her" button not detected | Rescan job |
| 6 | "Unknown Company" showing | Company not extracted | Rescan the job |
| 7 | 404 on FINN apply page | Wrong URL format | Use `?adId=123456` not `/job/apply/123456` |
| 8 | Shadow DOM click fails | FINN uses Shadow DOM | Navigate directly to apply URL |
| 9 | Browser session not working | Check Skyvern API version | session_id should start with `pbs_` |
| 10 | 2FA code not accepted | Wrong request status | Check `finn_auth_requests` for 'pending' or 'code_requested' |
| 11 | Telegram notifications not working | Chat not linked | Send `/start` or check `telegram_chat_id` |

## Debugging SQL Queries

### Check job in database
```sql
SELECT id, title, job_url, external_apply_url,
       has_enkel_soknad, application_form_type
FROM jobs
WHERE has_enkel_soknad = true
ORDER BY created_at DESC
LIMIT 10;
```

### Valid job_url examples
- `https://www.finn.no/job/fulltime/ad.html?finnkode=123456789`
- `https://www.finn.no/job/fulltime/ad/123456789`

### INVALID (search URL)
- `https://www.finn.no/job/search?industry=65&location=...`
- `https://www.finn.no/job/fulltime?occupation=...`

### Clean up incorrect data
```sql
-- Delete jobs with search URLs
DELETE FROM jobs
WHERE job_url LIKE '%finn.no/job/search%';

-- Clear external_apply_url for finn_easy if incorrect
UPDATE jobs
SET external_apply_url = NULL
WHERE has_enkel_soknad = true
  AND external_apply_url NOT LIKE '%finn.no/job/apply%';

-- Reset jobs with incorrect form type
UPDATE jobs
SET has_enkel_soknad = false, application_form_type = 'unknown'
WHERE external_apply_url LIKE '%webcruiter%'
   OR external_apply_url LIKE '%jobylon%';
```

### Check application status
```sql
SELECT j.title, j.company, a.status, a.sent_at, a.created_at
FROM jobs j
LEFT JOIN applications a ON j.id = a.job_id
WHERE j.has_enkel_soknad = true
ORDER BY a.created_at DESC
LIMIT 10;

-- Find jobs with sent applications
SELECT j.title, j.company, a.status
FROM jobs j
JOIN applications a ON j.id = a.job_id
WHERE a.status = 'sent';
```

### Check RLS policies
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'jobs';
```

## Browser Sessions Debugging

```bash
# Check active sessions
curl http://localhost:8000/api/v1/browser-sessions -H "x-api-key: YOUR_KEY"

# Close a session manually
curl -X POST http://localhost:8000/api/v1/browser-sessions/{session_id}/close \
  -H "x-api-key: YOUR_KEY"
```

## Best Practices for AI Assistants

1. **Authentication**: Never use `supabase.auth.*()` - use direct fetch
2. **Edge Functions**: Deno-based; use `Deno.serve()` pattern
3. **Local Worker**: Can't be called from Edge Functions (localhost not reachable)
4. **FINN Apply Detection Priority**:
   - FIRST check `has_enkel_soknad`
   - THEN check `application_form_type === 'finn_easy'`
   - LAST check `external_apply_url` contains `finn.no/job/apply`
   - **NEVER** auto-construct URL for all FINN jobs
5. **Finnkode Extraction**: Use multiple patterns (query, path, URL end)
6. **URL Validation**: Always reject search/filter URLs before processing
7. **Translations**: Add strings to all 3 languages (en, no, uk)
8. **Types**: All interfaces in `types.ts`
9. **Errors**: Log with prefix + store in `system_logs`
10. **Deployment**: Use GitHub Actions, not manual `supabase functions deploy`
