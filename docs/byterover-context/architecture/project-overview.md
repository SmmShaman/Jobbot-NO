# JobBot Norway - Project Overview

**JobBot Norway** is a job search automation platform for the Norwegian job market with AI-powered job analysis, cover letter generation, and automated application submission.

## Technology Stack

- **Frontend**: React 19.2, TypeScript 5.8, Vite 6.2, TailwindCSS (CDN)
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
- **AI Services**: Azure OpenAI (chat completions)
- **Browser Automation**: Skyvern (local Docker)
- **Integrations**: Telegram Bot API, Web scraping (Cheerio)
- **Deployment**: Netlify (frontend), Supabase (functions via GitHub Actions)
- **CI/CD**: GitHub Actions (automatic Edge Functions deploy on merge to main)

## Project Structure

```
/home/user/Jobbot-NO/
├── .github/workflows/
│   ├── deploy-supabase-functions.yml   # Edge function deployment (auto on merge)
│   └── scheduled-scan.yml              # Daily job scanning cron
├── supabase/functions/                 # 12 Deno-based Edge Functions
│   ├── admin-actions/                  # User management
│   ├── analyze_profile/                # Resume analysis
│   ├── extract_job_text/               # Web scraping + Enkel soknad detection
│   ├── finn-apply/                     # FINN auto-apply queue handler
│   ├── finn-2fa-webhook/               # Skyvern 2FA code webhook
│   ├── fix-jobs-rls/                   # RLS policy repair utility
│   ├── generate_application/           # Cover letter generation
│   ├── job-analyzer/                   # Job fit analysis
│   ├── job-scraper/                    # Job board scraping
│   ├── registration-webhook/           # Site registration Q&A webhook
│   ├── scheduled-scanner/              # Cron job handler
│   └── telegram-bot/                   # Telegram integration (v12.0)
├── database/                           # SQL migration files
├── worker/                             # Python Skyvern workers (LOCAL ONLY!)
│   ├── auto_apply.py                   # Main application worker (Stage 2)
│   ├── extract_apply_url.py            # URL extraction daemon (Stage 1)
│   ├── register_site.py                # Site registration worker
│   └── navigation_goals.py             # Site-specific Skyvern goals
├── pages/                              # React page components
├── components/                         # Reusable UI components
├── services/                           # API, Supabase, translations
├── contexts/                           # React Context providers
├── types.ts                            # TypeScript interfaces
└── vite.config.ts                      # Build configuration
```

## Key Conventions

### TypeScript & React
- **Interfaces over Types:** Use `interface` for object shapes in `types.ts`
- **Functional Components:** All components are functional with hooks
- **Context for State:** Use React Context (AuthContext, LanguageContext)
- **Path Aliases:** Use `@/` prefix for imports

### Code Style
- **Component Files:** PascalCase (e.g., `JobTable.tsx`)
- **Service Files:** camelCase (e.g., `api.ts`)
- **Edge Functions:** snake_case with hyphen-dirs (e.g., `finn-apply/index.ts`)
- **Icons:** Lucide React icons exclusively
- **Styling:** Tailwind CSS utility classes

### Database
- **Table naming:** snake_case
- **JSONB fields:** For complex nested data
- **RLS Policies:** Per-user isolation with `user_id` filter

## Development Commands

### Frontend
```bash
npm install
npm run dev
npm run build
```

### Worker
```bash
cd worker
source venv/bin/activate
python auto_apply.py
```

### Edge Functions Deployment
**Automatic via GitHub Actions on merge to main!**

Manual deploy (if needed):
```bash
supabase functions deploy finn-apply --project-ref ptrmidlhfdbybxmyovtm
```
