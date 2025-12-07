import asyncio
import os
import json
import re
import httpx
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# --- CONFIGURATION ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SKYVERN_URL = os.getenv("SKYVERN_API_URL", "http://localhost:8000")
SKYVERN_API_KEY = os.getenv("SKYVERN_API_KEY", "")
FINN_EMAIL = os.getenv("FINN_EMAIL", "")
FINN_PASSWORD = os.getenv("FINN_PASSWORD", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file")
    exit(1)

# Validate FINN credentials at startup
if not FINN_EMAIL or not FINN_PASSWORD:
    print("⚠️  WARNING: FINN_EMAIL and/or FINN_PASSWORD not set in .env")
    print("   FINN Enkel Søknad will NOT work without these credentials!")
    print("   Add to worker/.env:")
    print("   FINN_EMAIL=your-email@example.com")
    print("   FINN_PASSWORD=your-password")
    print("")
else:
    print(f"✅ FINN credentials configured for: {FINN_EMAIL}")

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")


def extract_finnkode(url: str) -> str | None:
    """Extract finnkode from FINN URL using multiple patterns."""
    if not url or 'finn.no' not in url:
        return None

    # Pattern 1: Query parameter format - ?finnkode=123456789 or &finnkode=123456789
    match = re.search(r'[?&]finnkode=(\d+)', url)
    if match:
        return match.group(1)

    # Pattern 2: Path-based format - /job/123456789 or /job/123456789.html
    match = re.search(r'/job/(\d{8,})(?:\.html|\?|$)', url)
    if match:
        return match.group(1)

    # Pattern 3: Old format - /ad/123456789 or /ad.html?finnkode=...
    match = re.search(r'/ad[/.](\d{8,})(?:\?|$)', url)
    if match:
        return match.group(1)

    # Pattern 4: Just a number at the end of URL path (8+ digits)
    match = re.search(r'/(\d{8,})(?:\?|$)', url)
    if match:
        return match.group(1)

    # Pattern 5: In path like /job/fulltime/123456789 or /job/parttime/123456789
    match = re.search(r'/job/[^/]+/(\d{8,})(?:\?|$)', url)
    if match:
        return match.group(1)

    return None

async def get_knowledge_base_dict() -> dict:
    """Fetches user knowledge base as a clean dictionary."""
    try:
        response = supabase.table("user_knowledge_base").select("*").execute()
        kb_data = {}
        for item in response.data:
            kb_data[item['question']] = item['answer']
        return kb_data
    except Exception as e:
        await log(f"⚠️ Failed to fetch KB: {e}")
        return {}

async def get_active_profile() -> str:
    """Fetches the full text of the currently active CV Profile."""
    try:
        response = supabase.table("cv_profiles").select("content").eq("is_active", True).limit(1).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['content']
        return "No active profile found."
    except Exception as e:
        await log(f"⚠️ Failed to fetch Active Profile: {e}")
        return ""

async def get_latest_resume_url() -> str:
    """Generates a signed URL for the most recent resume PDF."""
    try:
        # Safe bucket retrieval to avoid 'from' keyword conflict
        storage_bucket = getattr(supabase.storage, "from_")('resumes')
        if not storage_bucket:
             storage_bucket = getattr(supabase.storage, "from")('resumes')

        files = storage_bucket.list()
        if not files:
            return "No resume file found."

        # Robust sort handling missing created_at
        files.sort(key=lambda x: x.get('created_at', '') or '', reverse=True)
        latest_file = files[0]['name']

        # Create signed URL valid for 1 hour
        res = storage_bucket.create_signed_url(latest_file, 3600)

        if res and 'signedUrl' in res:
             return res['signedUrl']
        elif res and isinstance(res, str):
             return res

        return "Error generating resume URL"
    except Exception as e:
        await log(f"⚠️ Failed to get resume URL: {e}")
        return "Resume URL generation failed"

async def trigger_skyvern_task(job_url: str, app_data: dict, kb_data: dict, profile_text: str, resume_url: str):
    """Sends a task to Skyvern with v6.4 Top-Right Priority Strategy."""

    cover_letter = app_data.get('cover_letter_no', 'No cover letter generated.')

    # 1. FLATTEN PAYLOAD (Best for Skyvern mapping)
    candidate_payload = kb_data.copy()
    candidate_payload["cover_letter"] = cover_letter
    candidate_payload["resume_url"] = resume_url
    candidate_payload["professional_summary"] = profile_text[:2000]

    # 2. NAVIGATION GOAL v6.4 (Fix for FINN.no layout)
    # Key Change: Look at Top Right BEFORE scrolling.
    navigation_goal = """
    GOAL: Find the job application form and fill it out.

    PHASE 1: UNBLOCK
    1. If a Cookie Popup appears (Schibsted/FINN), click 'Godta alle', 'Aksepter' or 'Jeg forstår' immediately.

    PHASE 2: FIND BUTTON (DO NOT SCROLL YET)
    2. Look at the TOP RIGHT area or Sidebar. Find a BLUE button.
    3. Text variations: "Søk her", "Søk på stillingen", "Apply", "Send søknad".
    4. Click it if found.

    PHASE 3: SCROLL SEARCH (Fallback)
    5. If NOT found at top, SCROLL DOWN slowly.
    6. Look for links/buttons: "Gå til annonsen", "Se hele annonsen".

    PHASE 4: FILL FORM
    7. Once on the form page (might redirect to Webcruiter/Easycruit):
    8. Use the PAYLOAD data to fill fields.
    9. Upload CV from 'resume_url' if asked.

    PHASE 5: FINISH
    10. COMPLETE when form is filled (do not submit).
    """

    payload = {
        "url": job_url,
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "navigation_payload": candidate_payload,
        "data_extraction_goal": None,
        "max_steps": 60,
        "proxy_location": "RESIDENTIAL"
    }

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY
        await log(f"🔑 Using API Key: {SKYVERN_API_KEY[:5]}...")

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🚀 Sending task to Skyvern ({SKYVERN_URL})...")
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code == 200:
                task_data = response.json()
                task_id = task_data.get('task_id')
                await log(f"✅ Skyvern Task Started! ID: {task_id}")
                return task_id
            else:
                await log(f"❌ Skyvern API Error: {response.text}")
                return None
        except Exception as e:
            await log(f"❌ Connection Failed: Is Skyvern running? Error: {e}")
            return None


async def send_telegram(chat_id: str, text: str):
    """Send a Telegram notification."""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
                timeout=10.0
            )
    except Exception as e:
        await log(f"⚠️ Telegram error: {e}")


async def trigger_finn_apply_task(job_page_url: str, app_data: dict, profile_data: dict):
    """Sends a FINN Enkel Søknad task to Skyvern with 2FA webhook support.

    Strategy: Login FIRST at finn.no/auth/login, then navigate to job page.
    The "Enkel søknad" button uses Shadow DOM which Skyvern can't access directly.
    """

    if not FINN_EMAIL or not FINN_PASSWORD:
        await log("❌ FINN_EMAIL and FINN_PASSWORD not configured in .env")
        return None

    cover_letter = app_data.get('cover_letter_no', '') or app_data.get('cover_letter_uk', '')

    # Extract contact info from profile
    structured = profile_data.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {}) or structured
    contact_name = personal_info.get('name', '')
    contact_phone = personal_info.get('phone', '')

    # Extract finnkode from job URL for apply URL
    finnkode = extract_finnkode(job_page_url)
    if not finnkode:
        await log(f"❌ Cannot extract finnkode from URL: {job_page_url}")
        return None

    await log(f"📋 Extracted finnkode: {finnkode}")

    # 2FA webhook URL
    totp_webhook_url = f"{SUPABASE_URL}/functions/v1/finn-2fa-webhook"

    navigation_goal = f"""
GOAL: Apply to job on FINN.no using "Enkel søknad" (Easy Apply).

PHASE 1: JOB PAGE
   - You are on the job listing page: {job_page_url}
   - Wait for page to fully load (5 seconds)
   - If cookie popup appears, click "Godta alle" to dismiss
   - Find the blue "Enkel søknad" button - it's on the RIGHT side of the page
   - The button has blue background (#0063FB) and white text
   - Click the "Enkel søknad" button using JavaScript if normal click fails
   - This will redirect you to login

PHASE 2: LOGIN (Schibsted/Vend)
   - You will see a login form
   - Enter email: {FINN_EMAIL}
   - Click "Neste" or "Continue"
   - Enter password from navigation_payload
   - Click "Logg inn"
   - If 2FA code is requested, wait - the system provides it automatically via webhook
   - Enter the verification code when prompted
   - Complete login - you'll be redirected to the application form

PHASE 3: FILL APPLICATION FORM
   - Name/Navn: {contact_name}
   - Email/E-post: {FINN_EMAIL}
   - Phone/Telefon: {contact_phone}
   - Message/Søknadstekst/Melding:

{cover_letter}

PHASE 4: SUBMIT
   - Check any required checkboxes
   - Click "Send søknad" button
   - Wait for confirmation

CRITICAL: The "Enkel søknad" button may be in Shadow DOM. If click fails, try:
1. Wait longer for page load
2. Use JavaScript: document.querySelector('button').click()
3. Look for alternative selectors
"""

    data_extraction_schema = {
        "type": "object",
        "properties": {
            "application_sent": {"type": "boolean", "description": "True if submitted"},
            "confirmation_message": {"type": "string"},
            "error_message": {"type": "string"}
        }
    }

    payload = {
        "url": job_page_url,  # Start at JOB PAGE, click "Enkel søknad" button
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Determine if application was submitted.",
        "data_extraction_schema": data_extraction_schema,
        "navigation_payload": {
            "email": FINN_EMAIL,
            "password": FINN_PASSWORD,
            "name": contact_name,
            "phone": contact_phone,
            "cover_letter": cover_letter
        },
        "totp_verification_url": totp_webhook_url,
        "totp_identifier": FINN_EMAIL,
        "totp_timeout_seconds": 180,  # 3 minutes to enter 2FA code
        "max_steps": 50,  # More steps for complex flow
        "max_retries_per_step": 8,  # More retries for dynamic pages
        "wait_before_action_ms": 2000,  # Wait 2 seconds before each action for page to load
        "proxy_location": "RESIDENTIAL"
    }

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🚀 Sending FINN task to Skyvern: {job_page_url}")
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code == 200:
                task_data = response.json()
                task_id = task_data.get('task_id')
                await log(f"✅ FINN Skyvern Task Started! ID: {task_id}")
                return task_id
            else:
                await log(f"❌ Skyvern API Error: {response.text}")
                return None
        except Exception as e:
            await log(f"❌ Connection Failed: {e}")
            return None


async def monitor_task_status(task_id):
    """Polls Skyvern API and updates Supabase based on result."""
    await log(f"⏳ Monitoring Task {task_id}...")

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        while True:
            try:
                response = await client.get(
                    f"{SKYVERN_URL}/api/v1/tasks/{task_id}",
                    headers=headers,
                    timeout=10.0
                )

                if response.status_code == 200:
                    data = response.json()
                    status = data.get('status')

                    if status == 'completed':
                        await log("✅ Skyvern finished: COMPLETED")
                        return 'sent'

                    if status in ['failed', 'terminated']:
                        reason = data.get('failure_reason', 'Unknown')
                        await log(f"❌ Skyvern failed: {status}. Reason: {reason}")
                        if 'manual' in str(reason).lower():
                            return 'manual_review'
                        return 'failed'

                await asyncio.sleep(10)

            except Exception as e:
                await log(f"⚠️ Monitoring Error: {e}")
                await asyncio.sleep(10)

async def process_application(app):
    app_id = app['id']
    job_id = app['job_id']

    # Get Job data (including external_apply_url and has_enkel_soknad for FINN check)
    job_res = supabase.table("jobs").select("job_url, external_apply_url, title, user_id, has_enkel_soknad, application_form_type").eq("id", job_id).single().execute()
    job_data = job_res.data
    job_url = job_data.get('job_url')
    external_apply_url = job_data.get('external_apply_url', '')
    job_title = job_data.get('title', 'Unknown Job')
    user_id = job_data.get('user_id')
    has_enkel_soknad = job_data.get('has_enkel_soknad', False)
    application_form_type = job_data.get('application_form_type', '')

    await log(f"📋 Job: {job_title}")
    await log(f"   job_url: {job_url}")
    await log(f"   external_apply_url: {external_apply_url}")
    await log(f"   has_enkel_soknad: {has_enkel_soknad}")
    await log(f"   application_form_type: {application_form_type}")

    if not job_url and not external_apply_url:
        await log(f"❌ No URL found for App ID {app_id}")
        supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
        return

    # Check if this is a FINN Enkel Søknad
    # IMPORTANT: We navigate to the JOB PAGE and click "Enkel søknad" button
    # DO NOT construct /job/apply/ URLs - they don't exist!

    is_finn_easy = False

    if job_url and 'finn.no' in job_url:
        # Check if explicitly marked as FINN Easy Apply
        if has_enkel_soknad or application_form_type == 'finn_easy':
            is_finn_easy = True
            await log(f"   ✓ FINN Enkel Søknad detected (will click button on job page)")

    await log(f"   is_finn_easy: {is_finn_easy}")

    # Get user's Telegram chat ID for notifications
    chat_id = None
    if user_id:
        try:
            settings_res = supabase.table("user_settings").select("telegram_chat_id").eq("user_id", user_id).single().execute()
            chat_id = settings_res.data.get('telegram_chat_id') if settings_res.data else None
        except:
            pass

    if is_finn_easy:
        # === FINN ENKEL SØKNAD FLOW ===
        await log(f"⚡ FINN Enkel Søknad detected: {job_title}")

        # Get active CV profile for contact info
        profile_data = {}
        try:
            profile_res = supabase.table("cv_profiles").select("*").eq("is_active", True).limit(1).execute()
            if profile_res.data:
                profile_data = profile_res.data[0]
        except:
            pass

        # Notify user via Telegram
        if chat_id:
            await send_telegram(chat_id,
                f"🚀 <b>Починаю подачу на FINN</b>\n\n"
                f"📋 {job_title}\n"
                f"⏳ Очікуйте код 2FA на пошту!\n\n"
                f"Коли отримаєте код, надішліть:\n"
                f"<code>/code XXXXXX</code>"
            )

        # PRE-CREATE finn_auth_requests record so webhook can find the user
        # This is critical because webhook looks up by totp_identifier (FINN_EMAIL)
        if chat_id and FINN_EMAIL:
            try:
                # Set expiration to 10 minutes from now
                from datetime import timedelta
                expires_at = (datetime.now() + timedelta(minutes=10)).isoformat()

                await log(f"📝 Pre-creating auth request for {FINN_EMAIL}")
                supabase.table("finn_auth_requests").insert({
                    "telegram_chat_id": chat_id,
                    "user_id": user_id,
                    "totp_identifier": FINN_EMAIL,
                    "status": "pending",
                    "expires_at": expires_at
                }).execute()
            except Exception as e:
                await log(f"⚠️ Failed to pre-create auth request: {e}")

        task_id = await trigger_finn_apply_task(job_url, app, profile_data)  # Use job page URL!

        if task_id:
            skyvern_meta = {
                "task_id": task_id,
                "finn_apply": True,
                "source": "worker",
                "started_at": datetime.now().isoformat()
            }

            supabase.table("applications").update({
                "status": "manual_review",
                "skyvern_metadata": skyvern_meta,
                "sent_at": datetime.now().isoformat()
            }).eq("id", app_id).execute()

            if chat_id:
                await send_telegram(chat_id,
                    f"✅ <b>Skyvern запущено!</b>\n\n"
                    f"🔑 Task: <code>{task_id}</code>\n"
                    f"🔗 <a href='http://localhost:8080/tasks/{task_id}'>Переглянути</a>\n\n"
                    f"⏳ Очікуйте код 2FA!"
                )

            final_status = await monitor_task_status(task_id)

            await log(f"💾 FINN task finished: {final_status}")
            supabase.table("applications").update({"status": final_status}).eq("id", app_id).execute()

            if chat_id and final_status == 'sent':
                await send_telegram(chat_id, f"✅ <b>Заявку відправлено!</b>\n\n📋 {job_title}")
        else:
            await log("💾 FINN task failed to start")
            supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
            if chat_id:
                await send_telegram(chat_id, f"❌ <b>Помилка запуску FINN</b>\n\n📋 {job_title}")

    else:
        # === STANDARD FORM FLOW (existing logic) ===
        await log(f"📄 Processing standard form: {job_title}")

        kb_data = await get_knowledge_base_dict()
        profile_text = await get_active_profile()
        resume_url = await get_latest_resume_url()

        task_id = await trigger_skyvern_task(job_url, app, kb_data, profile_text, resume_url)

        if task_id:
            skyvern_meta = {
                "task_id": task_id,
                "resume_url": resume_url,
                "started_at": datetime.now().isoformat()
            }

            supabase.table("applications").update({
                "status": "manual_review",
                "skyvern_metadata": skyvern_meta,
                "sent_at": datetime.now().isoformat()
            }).eq("id", app_id).execute()

            final_status = await monitor_task_status(task_id)

            await log(f"💾 Updating DB status to: {final_status}")
            supabase.table("applications").update({
                "status": final_status
            }).eq("id", app_id).execute()

        else:
            await log("💾 Updating DB status to: failed")
            supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()

async def main():
    await log("🌉 Skyvern Bridge started. Waiting for requests...")
    await log("📡 Polling every 10 seconds for new applications...")

    while True:
        try:
            response = supabase.table("applications").select("*").eq("status", "sending").execute()

            if response.data:
                await log(f"📬 Found {len(response.data)} application(s) to process")
                for app in response.data:
                    await process_application(app)

        except Exception as e:
            await log(f"⚠️ Error: {e}")

        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
