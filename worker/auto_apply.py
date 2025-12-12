import asyncio
import os
import json
import re
import httpx
from datetime import datetime
from urllib.parse import urlparse
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


# ============================================
# SITE CREDENTIALS MANAGEMENT
# ============================================

def extract_domain(url: str) -> str:
    """Extract domain from URL (e.g., 'webcruiter.no' from 'https://www.webcruiter.no/...')."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except:
        return url


async def get_site_credentials(domain: str) -> dict | None:
    """Check if credentials exist for a site domain.

    Returns credentials for active sites or magic_link status for sites
    that require manual login.
    """
    try:
        response = supabase.table("site_credentials") \
            .select("*") \
            .eq("site_domain", domain) \
            .in_("status", ["active", "magic_link"]) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            creds = response.data[0]
            if creds.get('status') == 'magic_link':
                await log(f"🔗 Found magic_link record for {domain}")
            else:
                await log(f"✅ Found credentials for {domain}")
            return creds
        return None
    except Exception as e:
        await log(f"⚠️ Failed to check credentials for {domain}: {e}")
        return None


async def check_credentials_for_url(url: str) -> tuple:
    """Check if we have credentials for the URL's domain.

    Returns: (has_credentials: bool, credentials: dict | None, domain: str)

    Note: has_credentials is True only for active credentials, not magic_link.
    The credentials dict is still returned for magic_link sites so caller
    can check auth_type and handle accordingly.
    """
    domain = extract_domain(url)
    creds = await get_site_credentials(domain)
    # Only consider as "has credentials" if status is active (not magic_link)
    has_active_creds = creds is not None and creds.get('status') == 'active'
    return (has_active_creds, creds, domain)


async def mark_site_as_magic_link(domain: str):
    """Mark a site as using magic link authentication in site_credentials."""
    try:
        # Check if record exists
        response = supabase.table("site_credentials") \
            .select("id") \
            .eq("site_domain", domain) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            # Update existing record
            supabase.table("site_credentials").update({
                "auth_type": "magic_link",
                "status": "magic_link",
                "notes": "Site uses magic link authentication - manual login required"
            }).eq("site_domain", domain).execute()
            await log(f"📝 Updated {domain} as magic_link site")
        else:
            # Create new record
            supabase.table("site_credentials").insert({
                "site_domain": domain,
                "auth_type": "magic_link",
                "status": "magic_link",
                "email": "",
                "password": "",
                "notes": "Site uses magic link authentication - manual login required"
            }).execute()
            await log(f"📝 Created magic_link record for {domain}")
    except Exception as e:
        await log(f"⚠️ Failed to mark {domain} as magic_link: {e}")


async def trigger_registration(domain: str, registration_url: str, job_id: str = None, application_id: str = None) -> str | None:
    """Trigger registration flow for a site. Returns flow_id or None."""
    try:
        chat_id = await get_telegram_chat_id()
        profile = await get_active_profile_full()

        # Get email for registration
        email = os.getenv("DEFAULT_REGISTRATION_EMAIL", "")
        if not email:
            structured = profile.get('structured_content', {}) or {}
            personal_info = structured.get('personalInfo', {})
            email = personal_info.get('email', '')

        if not email:
            await log(f"❌ No email available for registration on {domain}")
            return None

        # Generate password
        import secrets
        import string
        password_chars = string.ascii_letters + string.digits + "!@#$%^&*"
        password = ''.join(secrets.choice(password_chars) for _ in range(16))

        from datetime import timedelta
        data = {
            "site_domain": domain,
            "site_name": domain.split('.')[0].capitalize(),
            "registration_url": registration_url,
            "job_id": job_id,
            "application_id": application_id,
            "status": "pending",
            "registration_email": email,
            "generated_password": password,
            "telegram_chat_id": chat_id,
            "expires_at": (datetime.now() + timedelta(minutes=30)).isoformat()
        }

        response = supabase.table("registration_flows").insert(data).execute()

        if response.data and len(response.data) > 0:
            flow_id = response.data[0]['id']
            await log(f"📝 Registration flow created: {flow_id}")
            return flow_id
        return None
    except Exception as e:
        await log(f"❌ Failed to create registration flow: {e}")
        return None


async def get_telegram_chat_id() -> str | None:
    """Get Telegram chat ID from user settings."""
    try:
        response = supabase.table("user_settings") \
            .select("telegram_chat_id") \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return response.data[0].get('telegram_chat_id')
        return None
    except:
        return None


async def get_active_profile_full() -> dict:
    """Get full active CV profile including structured_content."""
    try:
        response = supabase.table("cv_profiles") \
            .select("*") \
            .eq("is_active", True) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return response.data[0]
        return {}
    except:
        return {}


# ============================================
# BROWSER SESSION MANAGEMENT
# ============================================

async def create_browser_session(timeout_minutes: int = 60) -> str | None:
    """Create a persistent browser session for batch processing.

    Returns browser_session_id (starts with 'pbs_') or None on failure.
    """
    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🌐 Creating browser session (timeout={timeout_minutes}min)...")
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/browser-sessions",
                json={"timeout": timeout_minutes},
                headers=headers,
                timeout=30.0
            )

            if response.status_code in [200, 201]:
                data = response.json()
                session_id = data.get('browser_session_id')
                await log(f"✅ Browser session created: {session_id}")
                return session_id
            else:
                await log(f"⚠️ Failed to create browser session: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            await log(f"❌ Browser session creation error: {e}")
            return None


async def close_browser_session(session_id: str) -> bool:
    """Close a browser session."""
    if not session_id:
        return False

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🔒 Closing browser session: {session_id}")
            # Try POST to close endpoint
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/browser-sessions/{session_id}/close",
                headers=headers,
                timeout=30.0
            )

            if response.status_code in [200, 204]:
                await log(f"✅ Browser session closed")
                return True
            else:
                # Try DELETE as fallback
                response = await client.delete(
                    f"{SKYVERN_URL}/api/v1/browser-sessions/{session_id}",
                    headers=headers,
                    timeout=30.0
                )
                if response.status_code in [200, 204]:
                    await log(f"✅ Browser session closed (DELETE)")
                    return True
                await log(f"⚠️ Failed to close session: {response.status_code}")
                return False
        except Exception as e:
            await log(f"⚠️ Browser session close error: {e}")
            return False


async def get_browser_session_status(session_id: str) -> dict | None:
    """Get browser session status."""
    if not session_id:
        return None

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{SKYVERN_URL}/api/v1/browser-sessions/{session_id}",
                headers=headers,
                timeout=10.0
            )
            if response.status_code == 200:
                return response.json()
            return None
        except:
            return None


def extract_finnkode(url: str) -> str | None:
    """Extract finnkode from FINN URL using multiple patterns."""
    if not url or 'finn.no' not in url:
        return None

    # Pattern 0: Query parameter adId format - ?adId=123456789 (used in /job/apply URLs)
    match = re.search(r'[?&]adId=(\d+)', url)
    if match:
        return match.group(1)

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

async def trigger_skyvern_task_with_credentials(
    job_url: str,
    app_data: dict,
    kb_data: dict,
    profile_text: str,
    resume_url: str,
    credentials: dict = None
):
    """Sends a task to Skyvern with optional site credentials for login.

    If credentials are provided, includes login step in navigation goal.
    """
    cover_letter = app_data.get('cover_letter_no', 'No cover letter generated.')

    # Get full profile for structured data
    profile = await get_active_profile_full()
    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {})

    # Extract work experience
    work_experience = structured.get('workExperience', [])
    current_job = work_experience[0] if work_experience else {}

    # Extract education
    education = structured.get('education', [])
    latest_education = education[0] if education else {}

    # 1. BUILD PAYLOAD - Start fresh, don't use kb_data for personal info
    # Filter out personal info keys from kb_data to avoid fake data
    fake_keys = {
        'First Name', 'Last Name', 'Email', 'Phone', 'Name',
        'first_name', 'last_name', 'email', 'phone', 'name',
        'LinkedIn URL', 'Notice Period', 'Salary Expectation',
        'Address', 'City', 'Postal Code', 'Country'
    }
    filtered_kb_data = {k: v for k, v in kb_data.items() if k not in fake_keys}

    # Start with filtered kb_data (only non-personal fields)
    candidate_payload = filtered_kb_data.copy()

    # Add REAL profile data
    full_name = personal_info.get('fullName', '') or personal_info.get('name', '')
    first_name = full_name.split()[0] if full_name else ''
    last_name = ' '.join(full_name.split()[1:]) if full_name and len(full_name.split()) > 1 else ''

    candidate_payload["full_name"] = full_name
    candidate_payload["First Name"] = first_name
    candidate_payload["Last Name"] = last_name
    candidate_payload["first_name"] = first_name
    candidate_payload["last_name"] = last_name
    candidate_payload["name"] = full_name
    candidate_payload["email"] = personal_info.get('email', '')
    candidate_payload["Email"] = personal_info.get('email', '')
    candidate_payload["phone"] = personal_info.get('phone', '')
    candidate_payload["Phone"] = personal_info.get('phone', '')

    # Add address info from profile
    candidate_payload["city"] = personal_info.get('city', '')
    candidate_payload["City"] = personal_info.get('city', '')
    candidate_payload["postal_code"] = personal_info.get('postalCode', '')
    candidate_payload["Postal Code"] = personal_info.get('postalCode', '')
    candidate_payload["country"] = personal_info.get('country', 'Norge')
    candidate_payload["Country"] = personal_info.get('country', 'Norge')
    candidate_payload["address"] = personal_info.get('address', '')
    candidate_payload["Address"] = personal_info.get('address', '')

    # Add work experience
    candidate_payload["current_position"] = current_job.get('position', '')
    candidate_payload["current_company"] = current_job.get('company', '')

    # Add education
    candidate_payload["education_level"] = latest_education.get('degree', '')
    candidate_payload["education_field"] = latest_education.get('field', '')
    candidate_payload["education_school"] = latest_education.get('institution', '')

    # Add cover letter and resume
    candidate_payload["cover_letter"] = cover_letter
    candidate_payload["resume_url"] = resume_url
    candidate_payload["professional_summary"] = profile_text[:2000]

    await log(f"📋 Payload built from REAL profile data:")
    await log(f"   Name: {full_name}")
    await log(f"   Email: {personal_info.get('email', '')}")
    await log(f"   Phone: {personal_info.get('phone', '')}")

    # Add credentials if available
    if credentials:
        candidate_payload["login_email"] = credentials.get('email', '')
        candidate_payload["login_password"] = credentials.get('password', '')

    # 2. BUILD NAVIGATION GOAL
    if credentials:
        # WITH LOGIN - site requires authentication
        navigation_goal = f"""
GOAL: Log into the recruitment site and fill out the job application form.

PHASE 1: COOKIE/POPUP HANDLING
1. If a Cookie Popup appears, click 'Godta alle', 'Accept all', 'Aksepter', or 'Jeg forstår'.
2. Close any welcome modals.

PHASE 2: LOGIN
3. Look for "Logg inn", "Login", "Sign in" link/button.
4. Click to go to login page if not already there.
5. Enter email: {credentials.get('email', '')}
6. Enter password from navigation_payload (login_password)
7. Click "Logg inn", "Login", or "Sign in" button.
8. Wait for login to complete.

PHASE 3: FIND APPLICATION FORM
9. After login, navigate to the job application.
10. Look at TOP RIGHT for buttons: "Søk her", "Søk på stillingen", "Apply", "Send søknad".
11. Click the apply button.

PHASE 4: FILL FORM
12. Fill all form fields using PAYLOAD data:
    - Name/Navn: Use 'full_name'
    - Email/E-post: Use 'email'
    - Phone/Telefon: Use 'phone'
    - Message/Søknadstekst/Motivasjon: Use 'cover_letter'
13. Upload CV from 'resume_url' if file upload field exists.

PHASE 5: SUBMIT
14. Check any required checkboxes (GDPR, terms).
15. Click "Send søknad", "Submit", or "Søk" button.
16. Wait for confirmation.
"""
    else:
        # WITHOUT LOGIN - direct form filling
        navigation_goal = """
GOAL: Find the job application form and fill it out.

PHASE 1: UNBLOCK
1. If a Cookie Popup appears, click 'Godta alle', 'Aksepter' or 'Jeg forstår' immediately.

PHASE 2: FIND BUTTON (DO NOT SCROLL YET)
2. Look at the TOP RIGHT area or Sidebar. Find a BLUE button.
3. Text variations: "Søk her", "Søk på stillingen", "Apply", "Send søknad".
4. Click it if found.

PHASE 3: SCROLL SEARCH (Fallback)
5. If NOT found at top, SCROLL DOWN slowly.
6. Look for links/buttons: "Gå til annonsen", "Se hele annonsen".

PHASE 4: FILL FORM
7. Once on the form page (might redirect to Webcruiter/Easycruit):
8. Use the PAYLOAD data to fill fields:
   - Name/Navn: Use 'full_name'
   - Email/E-post: Use 'email'
   - Phone/Telefon: Use 'phone'
   - Message/Søknadstekst: Use 'cover_letter'
9. Upload CV from 'resume_url' if asked.

PHASE 5: SUBMIT
10. Check required checkboxes (GDPR, terms).
11. Click "Send søknad" or "Submit" button.
"""

    # Data extraction schema - includes magic link detection
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "application_submitted": {"type": "boolean", "description": "True if application was submitted successfully"},
            "login_successful": {"type": "boolean", "description": "True if login was successful (if applicable)"},
            "requires_registration": {"type": "boolean", "description": "True if site requires creating an account first"},
            "magic_link_sent": {"type": "boolean", "description": "True if site uses magic link login (email verification link instead of password). Look for messages like 'check your email', 'login link sent', 'verify your email', 'Kontroller e-posten din'"},
            "magic_link_email": {"type": "string", "description": "The email address where magic link was sent (if magic_link_sent is true)"},
            "error_message": {"type": "string", "description": "Any error message encountered"}
        }
    }

    payload = {
        "url": job_url,
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "navigation_payload": candidate_payload,
        "data_extraction_goal": "Determine: 1) Was application submitted? 2) Was login successful? 3) Does site use MAGIC LINK login (sends email link instead of password)? Look for messages like 'check your email', 'Kontroller e-posten', 'login link sent'.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 70 if credentials else 60,
        "proxy_location": "RESIDENTIAL"
    }

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY
        await log(f"🔑 Using API Key: {SKYVERN_API_KEY[:5]}...")

    async with httpx.AsyncClient() as client:
        try:
            mode = "WITH credentials" if credentials else "WITHOUT credentials"
            await log(f"🚀 Sending task to Skyvern ({mode})...")
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


async def trigger_skyvern_task(job_url: str, app_data: dict, kb_data: dict, profile_text: str, resume_url: str):
    """Legacy wrapper - sends task without credentials."""
    return await trigger_skyvern_task_with_credentials(
        job_url, app_data, kb_data, profile_text, resume_url, credentials=None
    )


async def send_telegram(chat_id: str, text: str, reply_markup: dict = None):
    """Send a Telegram notification."""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return None
    try:
        async with httpx.AsyncClient() as client:
            payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
            if reply_markup:
                payload["reply_markup"] = reply_markup
            response = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json=payload,
                timeout=10.0
            )
            if response.status_code == 200:
                data = response.json()
                return data.get('result', {}).get('message_id')
            return None
    except Exception as e:
        await log(f"⚠️ Telegram error: {e}")
        return None


# ============================================
# CONFIRMATION FLOW BEFORE SUBMISSION
# ============================================

CONFIRMATION_TIMEOUT_SECONDS = 300  # 5 minutes

async def build_form_payload(app_data: dict, profile: dict) -> dict:
    """Build the payload that will be submitted to the form."""
    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {})

    cover_letter = app_data.get('cover_letter_no', '') or app_data.get('cover_letter_uk', '')

    return {
        "full_name": personal_info.get('fullName', '') or personal_info.get('name', ''),
        "email": personal_info.get('email', ''),
        "phone": personal_info.get('phone', ''),
        "cover_letter": cover_letter,
        "cover_letter_preview": cover_letter[:500] + "..." if len(cover_letter) > 500 else cover_letter
    }


async def create_confirmation_request(
    app_id: str,
    job_id: str,
    job_title: str,
    company: str,
    external_url: str,
    payload: dict,
    chat_id: str
) -> str | None:
    """Create confirmation request and send to Telegram.

    Returns: confirmation_id or None
    """
    try:
        from datetime import timedelta

        # Create confirmation record
        expires_at = (datetime.now() + timedelta(seconds=CONFIRMATION_TIMEOUT_SECONDS)).isoformat()

        confirmation_data = {
            "application_id": app_id,
            "job_id": job_id,
            "telegram_chat_id": chat_id,
            "payload": payload,
            "status": "pending",
            "expires_at": expires_at
        }

        response = supabase.table("application_confirmations").insert(confirmation_data).execute()

        if not response.data or len(response.data) == 0:
            await log("❌ Failed to create confirmation record")
            return None

        confirmation_id = response.data[0]['id']

        # Build Telegram message with payload preview
        domain = extract_domain(external_url) if external_url else "невідомий сайт"

        message = (
            f"📋 <b>Підтвердження перед відправкою</b>\n\n"
            f"🏢 <b>{job_title}</b>\n"
            f"🏛 {company}\n"
            f"🌐 {domain}\n\n"
            f"<b>Дані для форми:</b>\n"
            f"👤 Ім'я: <code>{payload.get('full_name', '—')}</code>\n"
            f"📧 Email: <code>{payload.get('email', '—')}</code>\n"
            f"📱 Телефон: <code>{payload.get('phone', '—')}</code>\n\n"
            f"<b>Супровідний лист:</b>\n"
            f"<blockquote>{payload.get('cover_letter_preview', '—')}</blockquote>\n\n"
            f"⏱ Таймаут: 5 хвилин"
        )

        # Inline keyboard with confirm/cancel buttons
        keyboard = {
            "inline_keyboard": [[
                {"text": "✅ Підтвердити", "callback_data": f"confirm_apply_{confirmation_id}"},
                {"text": "❌ Скасувати", "callback_data": f"cancel_apply_{confirmation_id}"}
            ]]
        }

        # Send message
        message_id = await send_telegram(chat_id, message, keyboard)

        if message_id:
            # Update confirmation with message_id for potential editing
            supabase.table("application_confirmations").update({
                "telegram_message_id": str(message_id)
            }).eq("id", confirmation_id).execute()

        await log(f"📤 Confirmation request sent: {confirmation_id}")
        return confirmation_id

    except Exception as e:
        await log(f"❌ Failed to create confirmation: {e}")
        return None


async def wait_for_confirmation(confirmation_id: str) -> str:
    """Wait for user to confirm or cancel, or timeout.

    Returns: 'confirmed', 'cancelled', or 'timeout'
    """
    await log(f"⏳ Waiting for confirmation: {confirmation_id}")

    start_time = datetime.now()
    poll_interval = 3  # seconds

    while True:
        try:
            response = supabase.table("application_confirmations") \
                .select("status, expires_at") \
                .eq("id", confirmation_id) \
                .single() \
                .execute()

            if response.data:
                status = response.data.get('status')
                expires_at = response.data.get('expires_at')

                # Check if user responded
                if status == 'confirmed':
                    await log(f"✅ User confirmed: {confirmation_id}")
                    return 'confirmed'
                elif status == 'cancelled':
                    await log(f"❌ User cancelled: {confirmation_id}")
                    return 'cancelled'

                # Check timeout
                if expires_at:
                    from datetime import timezone
                    expires = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                    now = datetime.now(timezone.utc)
                    if now > expires:
                        await log(f"⏰ Confirmation timeout: {confirmation_id}")
                        # Update status to timeout
                        supabase.table("application_confirmations").update({
                            "status": "timeout"
                        }).eq("id", confirmation_id).execute()
                        return 'timeout'

            await asyncio.sleep(poll_interval)

        except Exception as e:
            await log(f"⚠️ Confirmation check error: {e}")
            await asyncio.sleep(poll_interval)


async def update_confirmation_submitted(confirmation_id: str):
    """Mark confirmation as submitted after Skyvern completes."""
    try:
        supabase.table("application_confirmations").update({
            "status": "submitted",
            "submitted_at": datetime.now().isoformat()
        }).eq("id", confirmation_id).execute()
    except Exception as e:
        await log(f"⚠️ Failed to update confirmation status: {e}")


async def wait_for_registration_completion(flow_id: str, chat_id: str = None, max_wait_seconds: int = 1800) -> bool:
    """Wait for registration flow to complete.

    Args:
        flow_id: The registration flow ID to monitor
        chat_id: Telegram chat ID for notifications
        max_wait_seconds: Maximum time to wait (default 30 min)

    Returns:
        True if registration completed successfully, False otherwise
    """
    await log(f"⏳ Waiting for registration flow: {flow_id}")

    start_time = datetime.now()
    poll_interval = 10  # seconds

    while True:
        try:
            # Check elapsed time
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > max_wait_seconds:
                await log(f"⏰ Registration timeout after {elapsed:.0f}s")
                return False

            # Check flow status
            response = supabase.table("registration_flows") \
                .select("status, error_message") \
                .eq("id", flow_id) \
                .single() \
                .execute()

            if response.data:
                status = response.data.get('status')
                error = response.data.get('error_message')

                if status == 'completed':
                    await log(f"✅ Registration flow completed!")
                    return True

                if status == 'failed':
                    await log(f"❌ Registration flow failed: {error or 'Unknown error'}")
                    return False

                if status == 'cancelled':
                    await log(f"❌ Registration flow cancelled")
                    return False

                # Still in progress
                await log(f"   Registration status: {status} (waiting...)")

            await asyncio.sleep(poll_interval)

        except Exception as e:
            await log(f"⚠️ Error checking registration status: {e}")
            await asyncio.sleep(poll_interval)


async def trigger_finn_apply_task(job_page_url: str, app_data: dict, profile_data: dict, browser_session_id: str = None, is_logged_in: bool = False):
    """Sends a FINN Enkel Søknad task to Skyvern with 2FA webhook support.

    Args:
        job_page_url: The job page URL to apply to
        app_data: Application data including cover letter
        profile_data: User profile data
        browser_session_id: Optional browser session ID for batch processing
        is_logged_in: If True, skip login phase (already logged in from previous task)
    """

    if not FINN_EMAIL or not FINN_PASSWORD:
        await log("❌ FINN_EMAIL and FINN_PASSWORD not configured in .env")
        return None

    cover_letter = app_data.get('cover_letter_no', '') or app_data.get('cover_letter_uk', '')

    # Extract contact info from profile
    structured = profile_data.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {}) or structured
    # Note: TypeScript interface uses 'fullName', not 'name'
    contact_name = personal_info.get('fullName', '') or personal_info.get('name', '')
    contact_phone = personal_info.get('phone', '')
    contact_email = personal_info.get('email', '') or FINN_EMAIL

    await log(f"📝 Profile data for form:")
    await log(f"   Name: {contact_name}")
    await log(f"   Phone: {contact_phone}")
    await log(f"   Email: {contact_email}")
    await log(f"   Cover letter length: {len(cover_letter)} chars")

    # Extract finnkode from job URL for apply URL
    finnkode = extract_finnkode(job_page_url)
    if not finnkode:
        await log(f"❌ Cannot extract finnkode from URL: {job_page_url}")
        return None

    await log(f"📋 Extracted finnkode: {finnkode}")

    # 2FA webhook URL
    totp_webhook_url = f"{SUPABASE_URL}/functions/v1/finn-2fa-webhook"

    # Direct apply URL - bypasses Shadow DOM button issue!
    apply_url = f"https://www.finn.no/job/apply?adId={finnkode}"
    await log(f"📋 Direct apply URL: {apply_url}")

    # Different navigation goal if already logged in (batch mode)
    if is_logged_in:
        await log(f"🔄 Using logged-in mode (browser session active)")
        navigation_goal = f"""
GOAL: Submit job application on FINN.no Enkel Søknad.
NOTE: You are already logged in from a previous task in this session.

PHASE 1: APPLICATION FORM
   - Accept any cookie popup if it appears (click "Godta alle")
   - You should see the application form directly. Fill it:
   - Name/Navn: {contact_name}
   - Email/E-post: {FINN_EMAIL}
   - Phone/Telefon: {contact_phone}
   - Message/Søknadstekst/Melding:

{cover_letter}

PHASE 2: SUBMIT
   - Check any required checkboxes (GDPR, terms)
   - Click "Send søknad" or "Send" button
   - Wait for confirmation message
"""
    else:
        navigation_goal = f"""
GOAL: Submit job application on FINN.no Enkel Søknad.

PHASE 1: LOGIN (you will be redirected to login first)
   - Accept any cookie popup (click "Godta alle")
   - Enter email: {FINN_EMAIL}
   - Click "Neste" or "Continue"
   - Enter password from navigation_payload
   - Click "Logg inn"
   - If 2FA verification code is requested, wait - it will be provided automatically
   - Enter the 2FA code when it appears
   - Complete login

PHASE 2: APPLICATION FORM
   After login, you should see the application form. Fill it:
   - Name/Navn: {contact_name}
   - Email/E-post: {FINN_EMAIL}
   - Phone/Telefon: {contact_phone}
   - Message/Søknadstekst/Melding:

{cover_letter}

PHASE 3: SUBMIT
   - Check any required checkboxes (GDPR, terms)
   - Click "Send søknad" or "Send" button
   - Wait for confirmation message
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
        "url": apply_url,  # Direct apply URL: finn.no/job/apply?adId={finnkode}
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

    # Add browser session ID if provided (for batch processing)
    if browser_session_id:
        payload["browser_session_id"] = browser_session_id
        await log(f"🔗 Using browser session: {browser_session_id}")

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🚀 Sending FINN task to Skyvern: {apply_url}")
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


async def monitor_task_status(task_id, chat_id: str = None, job_title: str = None):
    """Polls Skyvern API and updates Supabase based on result.

    Args:
        task_id: The Skyvern task ID to monitor
        chat_id: Telegram chat ID for notifications (magic link detection)
        job_title: Job title for notifications

    Returns:
        'sent', 'failed', 'manual_review', or 'magic_link'
    """
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
                    extracted_data = data.get('extracted_information', {}) or {}

                    # Check for magic link detection
                    if extracted_data.get('magic_link_sent'):
                        magic_email = extracted_data.get('magic_link_email', 'your email')
                        await log(f"🔗 Magic link detected! Email sent to: {magic_email}")

                        # Notify user via Telegram
                        if chat_id:
                            await send_telegram(chat_id,
                                f"🔗 <b>Magic Link Login!</b>\n\n"
                                f"📋 {job_title or 'Job'}\n\n"
                                f"📧 Посилання для входу надіслано на:\n"
                                f"<code>{magic_email}</code>\n\n"
                                f"<b>Що робити:</b>\n"
                                f"1️⃣ Перевірте пошту\n"
                                f"2️⃣ Натисніть на посилання для входу\n"
                                f"3️⃣ Після входу подайте заявку вручну\n\n"
                                f"⚠️ Цей сайт НЕ підтримує автоматичну подачу через пароль."
                            )

                        return 'magic_link'

                    if status == 'completed':
                        await log("✅ Skyvern finished: COMPLETED")

                        # Check if application was actually submitted
                        if extracted_data.get('application_submitted') == False:
                            await log("⚠️ Task completed but application was NOT submitted")
                            return 'manual_review'

                        return 'sent'

                    if status in ['failed', 'terminated']:
                        reason = data.get('failure_reason', 'Unknown')
                        await log(f"❌ Skyvern failed: {status}. Reason: {reason}")

                        # Check if failure was due to magic link
                        reason_lower = str(reason).lower()
                        is_magic_link = (
                            # Check for common magic link patterns
                            ('check email' in reason_lower and 'link' in reason_lower) or
                            ('email' in reason_lower and 'login link' in reason_lower) or
                            ('post-login' in reason_lower and 'email' in reason_lower) or
                            ('magic link' in reason_lower) or
                            ('email link' in reason_lower) or
                            # Original condition
                            ('email' in reason_lower and ('link' in reason_lower or 'verification' in reason_lower))
                        )

                        await log(f"   🔍 Magic link check: {is_magic_link} (chat_id={chat_id})")

                        if is_magic_link:
                            await log(f"🔗 Magic link detected from failure reason!")
                            if chat_id:
                                try:
                                    await send_telegram(str(chat_id),
                                        f"🔗 <b>Magic Link Login!</b>\n\n"
                                        f"📋 {job_title or 'Job'}\n\n"
                                        f"⚠️ Сайт використовує Magic Link автентифікацію.\n\n"
                                        f"<b>Що робити:</b>\n"
                                        f"1️⃣ Перевірте пошту (включно зі спамом)\n"
                                        f"2️⃣ Натисніть на посилання для входу\n"
                                        f"3️⃣ Після входу подайте заявку вручну\n\n"
                                        f"ℹ️ Цей сайт НЕ підтримує автоматичну подачу через пароль."
                                    )
                                    await log(f"📱 Telegram notification sent to {chat_id}")
                                except Exception as e:
                                    await log(f"⚠️ Failed to send Telegram: {e}")
                            return 'magic_link'

                        if 'manual' in reason_lower:
                            return 'manual_review'
                        return 'failed'

                await asyncio.sleep(10)

            except Exception as e:
                await log(f"⚠️ Monitoring Error: {e}")
                await asyncio.sleep(10)

async def process_application(app, browser_session_id: str = None, is_logged_in: bool = False, skip_confirmation: bool = False):
    """Process a single application.

    Args:
        app: Application data from database
        browser_session_id: Optional browser session for batch processing
        is_logged_in: If True, skip login (already logged in from previous task)
        skip_confirmation: If True, skip Telegram confirmation (for retries)

    Returns:
        True if successfully submitted (for batch tracking)
    """
    app_id = app['id']
    job_id = app['job_id']

    # Get Job data (including external_apply_url and has_enkel_soknad for FINN check)
    job_res = supabase.table("jobs").select("job_url, external_apply_url, title, company, user_id, has_enkel_soknad, application_form_type").eq("id", job_id).single().execute()
    job_data = job_res.data
    job_url = job_data.get('job_url')
    external_apply_url = job_data.get('external_apply_url', '')
    job_title = job_data.get('title', 'Unknown Job')
    job_company = job_data.get('company', 'Unknown Company')
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
    # Cases:
    # 1. Direct FINN job (job_url contains finn.no) with has_enkel_soknad or finn_easy
    # 2. NAV/other job that redirects to FINN (external_apply_url contains finn.no/job/apply)

    is_finn_easy = False
    finn_apply_url = None  # The URL to use for FINN apply

    # Case 1: Direct FINN job
    if job_url and 'finn.no' in job_url:
        if has_enkel_soknad or application_form_type == 'finn_easy':
            is_finn_easy = True
            finn_apply_url = job_url
            await log(f"   ✓ FINN Enkel Søknad detected (direct FINN job)")

    # Case 2: NAV or other platform job with FINN external apply URL
    if not is_finn_easy and external_apply_url and 'finn.no/job/apply' in external_apply_url:
        is_finn_easy = True
        finn_apply_url = external_apply_url
        await log(f"   ✓ FINN Enkel Søknad detected (NAV→FINN redirect)")

    # Case 3: Has finn_easy markers but URL not detected yet - check external_apply_url
    if not is_finn_easy and (has_enkel_soknad or application_form_type == 'finn_easy'):
        if external_apply_url and 'finn.no' in external_apply_url:
            is_finn_easy = True
            finn_apply_url = external_apply_url
            await log(f"   ✓ FINN Enkel Søknad detected (from external_apply_url)")

    await log(f"   is_finn_easy: {is_finn_easy}")
    if finn_apply_url:
        await log(f"   finn_apply_url: {finn_apply_url}")

    # Get user's Telegram chat ID for notifications
    chat_id = None
    if user_id:
        try:
            settings_res = supabase.table("user_settings").select("telegram_chat_id").eq("user_id", user_id).single().execute()
            chat_id = settings_res.data.get('telegram_chat_id') if settings_res.data else None
            await log(f"   telegram_chat_id: {chat_id or 'NOT SET'}")
        except Exception as e:
            await log(f"   ⚠️ Failed to get telegram_chat_id: {e}")
    else:
        await log(f"   ⚠️ No user_id for job - cannot send Telegram notifications")

    # === CONFIRMATION FLOW ===
    # Get profile data first (needed for confirmation and form filling)
    profile_data = {}
    try:
        profile_res = supabase.table("cv_profiles").select("*").eq("is_active", True).limit(1).execute()
        if profile_res.data:
            profile_data = profile_res.data[0]
    except:
        pass

    # Build form payload for confirmation
    form_payload = await build_form_payload(app, profile_data)

    # Send confirmation request if chat_id available and not skipping
    confirmation_id = None
    if chat_id and not skip_confirmation:
        apply_url = external_apply_url or job_url
        confirmation_id = await create_confirmation_request(
            app_id=app_id,
            job_id=job_id,
            job_title=job_title,
            company=job_company,
            external_url=apply_url,
            payload=form_payload,
            chat_id=chat_id
        )

        if confirmation_id:
            # Wait for user confirmation
            confirmation_result = await wait_for_confirmation(confirmation_id)

            if confirmation_result == 'cancelled':
                await log(f"❌ User cancelled application: {job_title}")
                supabase.table("applications").update({"status": "draft"}).eq("id", app_id).execute()
                await send_telegram(chat_id, f"❌ <b>Заявку скасовано</b>\n\n📋 {job_title}")
                return False

            if confirmation_result == 'timeout':
                await log(f"⏰ Confirmation timeout: {job_title}")
                supabase.table("applications").update({"status": "draft"}).eq("id", app_id).execute()
                await send_telegram(chat_id, f"⏰ <b>Час вичерпано</b>\n\n📋 {job_title}\nЗаявка повернута в чернетки.")
                return False

            # User confirmed - proceed!
            await log(f"✅ User confirmed, proceeding with submission")
        else:
            await log(f"⚠️ Failed to create confirmation, proceeding without it")

    if is_finn_easy:
        # === FINN ENKEL SØKNAD FLOW ===
        await log(f"⚡ FINN Enkel Søknad detected: {job_title}")

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
        # Only needed for first login (not in batch mode after already logged in)
        if chat_id and FINN_EMAIL and not is_logged_in:
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

        # Use finn_apply_url if available (for NAV→FINN redirects), otherwise job_url
        apply_url_to_use = finn_apply_url or job_url
        task_id = await trigger_finn_apply_task(
            apply_url_to_use, app, profile_data,
            browser_session_id=browser_session_id,
            is_logged_in=is_logged_in
        )

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

            final_status = await monitor_task_status(task_id, chat_id=chat_id, job_title=job_title)

            await log(f"💾 FINN task finished: {final_status}")

            # Handle magic link detection
            if final_status == 'magic_link':
                supabase.table("applications").update({"status": "manual_review"}).eq("id", app_id).execute()
                return False

            supabase.table("applications").update({"status": final_status}).eq("id", app_id).execute()

            # Update confirmation status if exists
            if confirmation_id and final_status == 'sent':
                await update_confirmation_submitted(confirmation_id)

            if chat_id and final_status == 'sent':
                await send_telegram(chat_id, f"✅ <b>Заявку відправлено!</b>\n\n📋 {job_title}")
            return final_status == 'sent'
        else:
            await log("💾 FINN task failed to start")
            supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
            if chat_id:
                await send_telegram(chat_id, f"❌ <b>Помилка запуску FINN</b>\n\n📋 {job_title}")
            return False

    else:
        # === STANDARD FORM FLOW (with credentials check) ===
        await log(f"📄 Processing standard form: {job_title}")

        # Determine which URL to use for credential check
        apply_url = external_apply_url or job_url

        # Check if we have credentials for this site
        has_creds, credentials, domain = await check_credentials_for_url(apply_url)

        # Check if site uses magic link authentication
        if credentials and credentials.get('auth_type') == 'magic_link':
            await log(f"🔗 Site {domain} uses magic link authentication - skipping")
            if chat_id:
                await send_telegram(str(chat_id),
                    f"🔗 <b>Magic Link сайт!</b>\n\n"
                    f"📋 {job_title}\n\n"
                    f"⚠️ Сайт <b>{domain}</b> використовує Magic Link.\n"
                    f"Автоматична подача неможлива.\n\n"
                    f"Подайте заявку вручну через сайт."
                )
            supabase.table("applications").update({"status": "manual_review"}).eq("id", app_id).execute()
            return False

        if has_creds:
            await log(f"🔐 Using saved credentials for {domain}")
            if chat_id:
                await send_telegram(chat_id,
                    f"🔐 <b>Знайдено збережений логін для {domain}</b>\n\n"
                    f"📋 {job_title}\n"
                    f"⏳ Заповнюю форму з авторизацією..."
                )
        else:
            await log(f"⚠️ No credentials for {domain}")

            # Check if this is an external_registration type that needs account
            if application_form_type == 'external_registration':
                await log(f"📝 Site requires registration - triggering registration flow")

                if chat_id:
                    await send_telegram(chat_id,
                        f"🔐 <b>Потрібна реєстрація на {domain}</b>\n\n"
                        f"📋 {job_title}\n"
                        f"⏳ Запускаю процес реєстрації...\n\n"
                        f"Слідкуйте за повідомленнями - можливо знадобиться ваша допомога!"
                    )

                # Trigger registration flow
                flow_id = await trigger_registration(
                    domain=domain,
                    registration_url=apply_url,
                    job_id=job_id,
                    application_id=app_id
                )

                if flow_id:
                    # Update application to wait for registration
                    supabase.table("applications").update({
                        "status": "manual_review",
                        "skyvern_metadata": {
                            "registration_flow_id": flow_id,
                            "waiting_for_registration": True,
                            "domain": domain
                        }
                    }).eq("id", app_id).execute()

                    await log(f"⏳ Waiting for registration to complete: {flow_id}")

                    # Wait for registration to complete (poll every 10 seconds, max 30 min)
                    registration_completed = await wait_for_registration_completion(flow_id, chat_id, max_wait_seconds=1800)

                    if registration_completed:
                        await log(f"✅ Registration completed! Continuing with application...")
                        # Fetch newly created credentials
                        credentials = await get_site_credentials(domain)
                        if credentials:
                            has_creds = True
                            await log(f"🔐 Got new credentials for {domain}")
                            if chat_id:
                                await send_telegram(chat_id,
                                    f"✅ <b>Реєстрація завершена!</b>\n\n"
                                    f"🔐 Тепер заповнюю форму з авторизацією...\n"
                                    f"📋 {job_title}"
                                )
                        else:
                            await log(f"⚠️ Registration completed but credentials not found")
                            has_creds = False
                    else:
                        await log(f"❌ Registration failed or timed out")
                        supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
                        if chat_id:
                            await send_telegram(chat_id,
                                f"❌ <b>Реєстрація не завершилась</b>\n\n"
                                f"📋 {job_title}\n"
                                f"Спробуйте зареєструватись вручну."
                            )
                        return False
                else:
                    await log(f"❌ Failed to start registration flow")
                    supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
                    return False

        # Proceed with form filling
        kb_data = await get_knowledge_base_dict()
        profile_text = await get_active_profile()
        resume_url = await get_latest_resume_url()

        task_id = await trigger_skyvern_task_with_credentials(
            apply_url, app, kb_data, profile_text, resume_url, credentials
        )

        if task_id:
            skyvern_meta = {
                "task_id": task_id,
                "resume_url": resume_url,
                "started_at": datetime.now().isoformat(),
                "with_credentials": has_creds,
                "domain": domain
            }

            supabase.table("applications").update({
                "status": "manual_review",
                "skyvern_metadata": skyvern_meta,
                "sent_at": datetime.now().isoformat()
            }).eq("id", app_id).execute()

            if chat_id:
                await send_telegram(chat_id,
                    f"🚀 <b>Skyvern запущено!</b>\n\n"
                    f"📋 {job_title}\n"
                    f"🔑 Task: <code>{task_id}</code>\n"
                    f"{'🔐 З авторизацією' if has_creds else '📝 Без авторизації'}"
                )

            final_status = await monitor_task_status(task_id, chat_id=chat_id, job_title=job_title)

            await log(f"💾 Updating DB status to: {final_status}")

            # Handle magic link detection
            if final_status == 'magic_link':
                await log(f"🔗 Marking {domain} as magic_link site")
                await mark_site_as_magic_link(domain)
                supabase.table("applications").update({"status": "manual_review"}).eq("id", app_id).execute()
                return False

            supabase.table("applications").update({
                "status": final_status
            }).eq("id", app_id).execute()

            # Update confirmation status if exists
            if confirmation_id and final_status == 'sent':
                await update_confirmation_submitted(confirmation_id)

            if chat_id and final_status == 'sent':
                await send_telegram(str(chat_id), f"✅ <b>Заявку відправлено!</b>\n\n📋 {job_title}")

            return final_status == 'sent'

        else:
            await log("💾 Updating DB status to: failed")
            supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()

            if chat_id:
                await send_telegram(chat_id, f"❌ <b>Помилка запуску Skyvern</b>\n\n📋 {job_title}")

            return False

async def classify_applications(applications: list) -> tuple:
    """Classify applications into FINN Enkel Søknad and others.

    Returns: (finn_apps, other_apps)
    """
    finn_apps = []
    other_apps = []

    for app in applications:
        job_id = app['job_id']
        try:
            job_res = supabase.table("jobs").select(
                "job_url, external_apply_url, has_enkel_soknad, application_form_type"
            ).eq("id", job_id).single().execute()

            if job_res.data:
                job_url = job_res.data.get('job_url', '')
                external_apply_url = job_res.data.get('external_apply_url', '')
                has_enkel_soknad = job_res.data.get('has_enkel_soknad', False)
                form_type = job_res.data.get('application_form_type', '')

                # Check if FINN Enkel Søknad - 3 cases:
                # 1. Direct FINN job with finn_easy markers
                # 2. NAV/other job with FINN external_apply_url
                # 3. Has finn_easy markers with FINN in external_apply_url
                is_finn = False

                if job_url and 'finn.no' in job_url and (has_enkel_soknad or form_type == 'finn_easy'):
                    is_finn = True
                elif external_apply_url and 'finn.no/job/apply' in external_apply_url:
                    is_finn = True
                elif (has_enkel_soknad or form_type == 'finn_easy') and external_apply_url and 'finn.no' in external_apply_url:
                    is_finn = True

                if is_finn:
                    finn_apps.append(app)
                else:
                    other_apps.append(app)
            else:
                other_apps.append(app)
        except:
            other_apps.append(app)

    return finn_apps, other_apps


async def process_batch_finn_applications(applications: list):
    """Process multiple FINN applications in a single browser session.

    Only requires one 2FA login for all applications.
    """
    if not applications:
        return

    count = len(applications)
    await log(f"🚀 Starting BATCH processing for {count} FINN application(s)")

    # Create browser session for batch processing
    browser_session_id = await create_browser_session(timeout_minutes=60)

    if not browser_session_id:
        await log("⚠️ Failed to create browser session, falling back to individual processing")
        for app in applications:
            await process_application(app)
        return

    try:
        is_logged_in = False

        for i, app in enumerate(applications):
            await log(f"📋 Processing application {i+1}/{count}")

            success = await process_application(
                app,
                browser_session_id=browser_session_id,
                is_logged_in=is_logged_in
            )

            # After first successful application, mark as logged in
            if success and not is_logged_in:
                is_logged_in = True
                await log(f"✅ Login successful, subsequent applications will skip 2FA")

    finally:
        # Always close the browser session
        await close_browser_session(browser_session_id)
        await log(f"🏁 BATCH processing completed for {count} application(s)")


async def main():
    await log("🌉 Skyvern Bridge started (with Browser Sessions support)")
    await log("📡 Polling every 10 seconds for new applications...")
    await log("💡 Multiple FINN applications will be processed in a single session (one 2FA)")

    while True:
        try:
            response = supabase.table("applications").select("*").eq("status", "sending").execute()

            if response.data:
                count = len(response.data)
                await log(f"📬 Found {count} application(s) to process")

                # Classify applications
                finn_apps, other_apps = await classify_applications(response.data)

                # Log classification results
                if finn_apps:
                    await log(f"   🔵 FINN Enkel Søknad: {len(finn_apps)}")
                if other_apps:
                    await log(f"   ⚪ Other platforms: {len(other_apps)}")

                # Process FINN applications in batch (single browser session)
                if finn_apps:
                    if len(finn_apps) > 1:
                        await log(f"🎯 BATCH MODE: Processing {len(finn_apps)} FINN apps with ONE 2FA login")
                    await process_batch_finn_applications(finn_apps)

                # Process other applications individually
                for app in other_apps:
                    await process_application(app)

        except Exception as e:
            await log(f"⚠️ Error: {e}")

        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
