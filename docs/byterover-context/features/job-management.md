# Job Management Features

## Job Sources

JobBot scrapes jobs from three Norwegian job boards:
- **FINN.no** - Main Norwegian job portal
- **NAV.no** (Arbeidsplassen) - Government job board
- **LinkedIn** - Professional network

## Job Workflow

```
NEW → ANALYZED → APPLIED → INTERVIEW → SENT/REJECTED
```

### Status Meanings
- **NEW**: Just scraped, no analysis yet
- **ANALYZED**: AI analysis complete, has relevance score
- **APPLIED**: Application created (draft or approved)
- **INTERVIEW**: Interview scheduled
- **SENT**: Application submitted
- **REJECTED**: Application rejected or job closed

## AI Analysis

Each job gets AI-powered analysis:

### Relevance Score (0-100)
- Based on match between job requirements and user's CV profile
- Uses Azure OpenAI chat completions
- Score stored in `analysis_metadata.score`

### Aura Detection
- Categorizes job "vibe" (e.g., "Dynamic Tech", "Stable Corporate")
- Generates emoji and color for visual display
- Stored in `analysis_metadata.aura`

### Radar Metrics
- Multi-axis chart data (skills match, experience, location, etc.)
- Stored in `analysis_metadata.radar`

### AI Recommendation
- Text analysis explaining fit/mismatch
- Stored in `ai_recommendation` field

## Deadline Tracking

### Soknadsfrist (Application Deadline)
- Extracted from job page during scraping
- Stored in `deadline` field (ISO format)
- Expired deadlines highlighted in red
- ASAP terms (snarest, fortlopende) estimated as today + 14 days

### ASAP Detection
Norwegian ASAP terms detected:
- snarest
- fortlopende
- lopende
- straks
- umiddelbart

## Form Type Detection

Jobs are categorized by application method:

| Type | Description |
|------|-------------|
| `finn_easy` | FINN Enkel Soknad (internal form) |
| `external_form` | External application form |
| `external_registration` | Requires site registration |
| `email` | Email application |
| `processing` | Currently being processed |
| `skyvern_failed` | Skyvern extraction failed |
| `unknown` | Not yet determined |

## Enkel Soknad Detection

**Priority-based detection in `extract_job_text`:**

1. Check for "Sok her" button (external form indicator)
2. If no "Sok her", check for "Enkel soknad" text
3. Check for FINN apply URL pattern in NAV redirects

```typescript
// Detection priority
const isFinnEasy = job.has_enkel_soknad ||
                   job.application_form_type === 'finn_easy' ||
                   job.external_apply_url?.includes('finn.no/job/apply');
```

## Map Visualization

### JobMap Component
- Interactive geographic visualization
- Uses Nominatim for geocoding
- 162 Norwegian cities in local cache
- Handles compound locations ("Oslo-Asker", "Bergen / Stavanger")

### Filters
- Show all jobs
- Show only sent applications
- Filter by date range

## Rescan Feature

"Tip podachi" button in toolbar allows rescanning selected jobs:
- Calls `extract_job_text` for each selected job
- Updates company name, deadline, form type
- Useful for jobs scraped before detection improvements
