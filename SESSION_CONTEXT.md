# JobBot Norway - Session Context

## 📌 Project Overview
**JobBot Norway** is a hybrid automation system for finding and applying to jobs in Norway.
It consists of:
1.  **Frontend:** React + Vite + Tailwind (Hosted on Netlify).
2.  **Backend:** Supabase (Database, Auth, Storage, Edge Functions).
3.  **Local Worker:** Python script running on user's PC.
4.  **Automation Engine:** Skyvern (running in Docker on user's PC).

## 🏗️ Architecture
*   **Cloud (Supabase):** Stores Jobs, Profiles, Applications. Runs Scheduled Scanners via `pg_cron`.
*   **Edge Functions (Deno):**
    *   `job-scraper`: Scrapes FINN.no/NAV.
    *   `extract_job_text`: Extracts clean description using Cheerio.
    *   `job-analyzer`: Uses Azure OpenAI to score relevance against Active Profile.
    *   `generate_application`: Writes Søknad (Cover Letter) using Azure OpenAI.
    *   `telegram-bot`: Handles notifications and user commands (`/scan`, buttons).
    *   `scheduled-scanner`: Orchestrator running on cron.
*   **Local (User PC):**
    *   `worker/auto_apply.py`: Acts as a **Bridge**. Polls Supabase for `sending` tasks -> Triggers local Skyvern API.
    *   `Skyvern (Docker)`: Performs the actual browser automation to fill forms.

## 🔑 Critical Secrets (Environment Variables)
*   **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
*   **Azure OpenAI:** `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` (gpt-5.1-codex-mini / gpt-4o)
*   **Telegram:** `TELEGRAM_BOT_TOKEN`
*   **Skyvern:** `SKYVERN_API_KEY` (for local API auth)

## 🔄 Workflows

### 1. Scan & Analyze Pipeline
`Trigger (Cron/Telegram)` -> `scheduled-scanner` -> `job-scraper` -> `extract_job_text` -> `job-analyzer` -> `Telegram Notification`

### 2. Application Generation
`User clicks "Write Søknad"` -> `generate_application` -> `Azure OpenAI` -> `Save to DB (status: draft)` -> `User Approves (status: approved)`

### 3. Auto-Apply (Skyvern)
`User clicks "Send"` -> `DB status: sending` -> `worker/auto_apply.py` detects change -> `POST http://localhost:8000/api/v1/tasks` -> `Skyvern fills form` -> `worker updates DB (status: manual_review, metadata: task_id)`

## ✅ Current Status (as of Nov 19, 2025)
*   Dashboard allows monitoring jobs, viewing analysis, and editing settings.
*   Telegram bot is fully interactive (Scan, Write App, Approve).
*   "Mini-Skyvern" bridge script is implemented (`worker/auto_apply.py`).
*   Database schemas updated for `cv_profiles`, `applications`, `user_knowledge_base`.
*   **Latest Update:** Added `skyvern_metadata` column to track Skyvern Task IDs and links.

## 📝 Next Steps / Pending Tasks
1.  **Skyvern Tuning:** Test the `auto_apply.py` bridge with real forms to ensure Skyvern maps fields correctly using `user_knowledge_base`.
2.  **Retry Logic:** Ensure failed Skyvern tasks can be retried easily from Dashboard.
3.  **Reporting:** Add weekly email summaries.

## 🛠️ How to Continue
1.  **Frontend:** `npm run dev`
2.  **Worker:** `cd worker && python3 auto_apply.py` (Requires Skyvern Docker running).
3.  **Supabase:** Check Edge Functions logs for server-side errors.