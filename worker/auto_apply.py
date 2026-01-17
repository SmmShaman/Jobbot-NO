import asyncio
import os
import json
import re
import httpx
from datetime import datetime
from urllib.parse import urlparse
from dotenv import load_dotenv
from supabase import create_client, Client
from typing import Optional, Dict, Any

# Import site-specific navigation goals
from navigation_goals import (
    get_navigation_goal,
    detect_site_type,
    get_registration_goal,
    get_application_goal,
    is_site_supported
)

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

# Variant 4: Hybrid Flow (Extract → Match → Confirm → Fill)
# Set to True to use new smart form extraction for external forms
USE_HYBRID_FLOW = os.getenv("USE_HYBRID_FLOW", "true").lower() == "true"

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

if USE_HYBRID_FLOW:
    print("🔬 Hybrid Flow ENABLED (Variant 4: Extract → Match → Confirm → Fill)")

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")


def normalize_phone_for_norway(phone: str) -> str:
    """
    Normalize phone number for Norwegian forms.
    - Remove +47 country code
    - Remove spaces and dashes
    - Keep just 8 digits for Norwegian mobile numbers

    Examples:
    - "+47 925 64 334" -> "92564334"
    - "925 64 334" -> "92564334"
    - "+47-925-64-334" -> "92564334"
    """
    if not phone:
        return ""

    # Remove all non-digit characters
    digits = re.sub(r'\D', '', phone)

    # If starts with 47 and has 10+ digits, remove country code
    if digits.startswith('47') and len(digits) >= 10:
        digits = digits[2:]

    # Norwegian mobile numbers are 8 digits
    return digits


# ============================================
# FLOW ROUTER - Routes to appropriate handler
# based on application_form_type
# ============================================

class FlowRouter:
    """
    Routes job applications to the appropriate flow handler
    based on application_form_type.

    Form Types:
    - finn_easy: FINN Enkel Søknad with 2FA login
    - external_form: Simple one-page external form
    - external_registration: Requires registration first
    - email: Email-based application
    - unknown: Needs classification first
    """

    @staticmethod
    async def route(
        form_type: str,
        app_id: str,
        job_data: dict,
        app_data: dict,
        chat_id: str
    ) -> dict:
        """
        Route to appropriate flow based on form type.

        Returns:
            {"success": bool, "status": str, "message": str, "flow": str}
        """
        await log(f"🔀 FlowRouter: form_type={form_type}")

        # Determine which flow to use
        if form_type == 'finn_easy':
            return await FlowRouter._handle_finn_easy(app_id, job_data, app_data, chat_id)

        elif form_type == 'external_form':
            return await FlowRouter._handle_external_form(app_id, job_data, app_data, chat_id)

        elif form_type == 'external_registration':
            return await FlowRouter._handle_external_registration(app_id, job_data, app_data, chat_id)

        elif form_type == 'email':
            return await FlowRouter._handle_email_application(app_id, job_data, app_data, chat_id)

        else:  # unknown or unrecognized
            return await FlowRouter._handle_unknown(app_id, job_data, app_data, chat_id)

    @staticmethod
    async def _handle_finn_easy(app_id: str, job_data: dict, app_data: dict, chat_id: str) -> dict:
        """Handle FINN Enkel Søknad - uses 2FA login flow."""
        await log("📋 Flow: FINN Enkel Søknad (2FA)")

        # This flow is handled by the existing FINN logic in process_application
        # Return special marker to use existing flow
        return {
            "success": True,
            "status": "use_finn_flow",
            "message": "Routing to FINN Enkel Søknad flow",
            "flow": "finn_easy"
        }

    @staticmethod
    async def _handle_external_form(app_id: str, job_data: dict, app_data: dict, chat_id: str) -> dict:
        """
        Handle simple external form - one page, no registration required.
        Uses Hybrid Flow: Extract → Match → Confirm → Fill
        """
        await log("📋 Flow: External Form (Hybrid)")

        external_url = job_data.get('external_apply_url') or job_data.get('job_url')
        domain = extract_domain(external_url)
        site_type = detect_site_type(domain)

        await log(f"   Site: {domain} (type: {site_type})")
        await log(f"   Supported: {is_site_supported(domain)}")

        # Check if we have credentials for this site
        credentials = await get_site_credentials(domain)
        if credentials:
            await log(f"   ✅ Credentials found for {domain}")

        # Use hybrid flow for extraction and matching
        return {
            "success": True,
            "status": "use_hybrid_flow",
            "message": f"Routing to Hybrid Flow for {site_type}",
            "flow": "external_form",
            "site_type": site_type,
            "credentials": credentials
        }

    @staticmethod
    async def _handle_external_registration(app_id: str, job_data: dict, app_data: dict, chat_id: str) -> dict:
        """
        Handle registration-required forms.
        Flow: Check credentials → Register if needed → Login → Fill form
        """
        await log("📋 Flow: External Registration Required")

        external_url = job_data.get('external_apply_url') or job_data.get('job_url')
        domain = extract_domain(external_url)
        site_type = detect_site_type(domain)

        await log(f"   Site: {domain} (type: {site_type})")

        # Step 1: Check if we have credentials
        credentials = await get_site_credentials(domain)

        if credentials:
            await log(f"   ✅ Credentials found - will login and apply")
            return {
                "success": True,
                "status": "has_credentials",
                "message": f"Will login to {domain} and apply",
                "flow": "external_registration",
                "site_type": site_type,
                "credentials": credentials,
                "needs_registration": False
            }
        else:
            await log(f"   ⚠️ No credentials - need to register first")
            return {
                "success": True,
                "status": "needs_registration",
                "message": f"Need to register on {domain} first",
                "flow": "external_registration",
                "site_type": site_type,
                "credentials": None,
                "needs_registration": True
            }

    @staticmethod
    async def _handle_email_application(app_id: str, job_data: dict, app_data: dict, chat_id: str) -> dict:
        """
        Handle email-based applications.
        Flow: Generate email draft → Notify user → User sends manually
        """
        await log("📋 Flow: Email Application")

        job_title = job_data.get('title', 'Unknown')
        company = job_data.get('company', 'Unknown')
        cover_letter = app_data.get('cover_letter_no', '')

        # Get email address from job description if available
        # For now, notify user to send manually
        await log("   📧 Email applications require manual sending")

        # Send notification to Telegram
        if chat_id and TELEGRAM_BOT_TOKEN:
            message = (
                f"📧 *Заявка через email*\n\n"
                f"🏢 *{company}*\n"
                f"💼 {job_title}\n\n"
                f"Ця вакансія вимагає подачі через email.\n"
                f"Будь ласка, надішли заявку вручну.\n\n"
                f"📝 Søknadsbrev готовий в системі."
            )
            await send_telegram(chat_id, message)

        return {
            "success": True,
            "status": "email_required",
            "message": "Email application - manual sending required",
            "flow": "email"
        }

    @staticmethod
    async def _handle_unknown(app_id: str, job_data: dict, app_data: dict, chat_id: str) -> dict:
        """
        Handle unknown form type - try to classify first.
        """
        await log("📋 Flow: Unknown - will try to classify")

        external_url = job_data.get('external_apply_url') or job_data.get('job_url')

        if not external_url:
            await log("   ❌ No URL available to classify")
            return {
                "success": False,
                "status": "no_url",
                "message": "No application URL available",
                "flow": "unknown"
            }

        domain = extract_domain(external_url)
        site_type = detect_site_type(domain)

        await log(f"   Site detected: {site_type}")

        # Check for known registration-required platforms
        registration_platforms = ['recman', 'cvpartner', 'hrmanager']
        if site_type in registration_platforms:
            await log(f"   → Classifying as external_registration (known platform)")
            return await FlowRouter._handle_external_registration(app_id, job_data, app_data, chat_id)

        # Check if we have credentials (suggests we've registered before)
        credentials = await get_site_credentials(domain)
        if credentials:
            await log(f"   → Has credentials, treating as external_form")
            return {
                "success": True,
                "status": "use_hybrid_flow",
                "message": f"Unknown form type but has credentials for {domain}",
                "flow": "external_form",
                "site_type": site_type,
                "credentials": credentials
            }

        # Default: try hybrid flow
        await log(f"   → Defaulting to hybrid flow")
        return {
            "success": True,
            "status": "use_hybrid_flow",
            "message": f"Unknown form type, using hybrid flow",
            "flow": "external_form",
            "site_type": site_type,
            "credentials": None
        }


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


async def trigger_registration(domain: str, registration_url: str, job_id: str = None, application_id: str = None, user_id: str = None) -> str | None:
    """Trigger registration flow for a site. Returns flow_id or None."""
    try:
        chat_id = await get_telegram_chat_id()
        profile = await get_active_profile_full(user_id)

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


async def trigger_registration_flow(
    domain: str,
    job_id: str,
    app_id: str,
    chat_id: str,
    job_title: str,
    external_url: str,
    user_id: str = None
) -> str | None:
    """
    Wrapper for trigger_registration that also:
    1. Sends Telegram notification about registration
    2. Updates application status
    3. Tracks the registration flow

    Returns flow_id or None
    """
    await log(f"📝 Starting registration flow for {domain}")

    # Update application to waiting for registration
    supabase.table("applications").update({
        "status": "sending",
        "skyvern_metadata": {
            "domain": domain,
            "waiting_for_registration": True
        }
    }).eq("id", app_id).execute()

    # Trigger registration (with user_id for multi-user profile isolation)
    flow_id = await trigger_registration(
        domain=domain,
        registration_url=external_url,
        job_id=job_id,
        application_id=app_id,
        user_id=user_id
    )

    if flow_id:
        # Send Telegram notification
        if chat_id and TELEGRAM_BOT_TOKEN:
            message = (
                f"📝 *Потрібна реєстрація*\n\n"
                f"🏢 Сайт: {domain}\n"
                f"💼 Вакансія: {job_title}\n\n"
                f"Для подачі заявки потрібно створити акаунт.\n"
                f"Зачекай на підтвердження реєстрації."
            )
            await send_telegram(chat_id, message)

        # Update application with registration flow id
        supabase.table("applications").update({
            "skyvern_metadata": {
                "domain": domain,
                "registration_flow_id": flow_id,
                "waiting_for_registration": True
            }
        }).eq("id", app_id).execute()

        return flow_id
    else:
        # Registration failed to start
        supabase.table("applications").update({
            "status": "failed",
            "error_message": f"Failed to start registration on {domain}"
        }).eq("id", app_id).execute()

        if chat_id and TELEGRAM_BOT_TOKEN:
            await send_telegram(
                chat_id,
                f"❌ Не вдалося почати реєстрацію на {domain}"
            )

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


async def get_active_profile_full(user_id: str = None) -> dict:
    """Get full active CV profile including structured_content for a specific user."""
    try:
        query = supabase.table("cv_profiles") \
            .select("*") \
            .eq("is_active", True)
        if user_id:
            query = query.eq("user_id", user_id)
        response = query.limit(1).execute()

        if response.data and len(response.data) > 0:
            return response.data[0]
        return {}
    except:
        return {}


# NOTE: Browser Sessions removed - Skyvern API returns 404 (not supported)


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

async def get_active_profile(user_id: str = None) -> str:
    """Fetches the full text of the currently active CV Profile for a specific user."""
    try:
        query = supabase.table("cv_profiles").select("content").eq("is_active", True)
        if user_id:
            query = query.eq("user_id", user_id)
        response = query.limit(1).execute()
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


# ============================================
# PHASE 1: FORM FIELD EXTRACTION (Variant 4)
# ============================================

async def extract_form_fields(url: str) -> dict:
    """
    PHASE 1 of Variant 4: Extract all form fields from a page using Skyvern.

    Uses data_extraction_schema to discover what fields the form has
    BEFORE attempting to fill it.

    Returns:
        {
            "success": bool,
            "fields": [...],
            "form_url": str,
            "error": str or None
        }
    """
    await log(f"🔍 PHASE 1: Extracting form fields from {url[:50]}...")

    # Schema to extract form field information
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "form_fields": {
                "type": "array",
                "description": "List of ALL form fields visible on the page",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {
                            "type": "string",
                            "description": "The label text of the field (e.g., 'Fornavn', 'E-post', 'Kjønn')"
                        },
                        "field_type": {
                            "type": "string",
                            "enum": ["text", "email", "tel", "date", "select", "radio", "checkbox", "textarea", "file", "password", "number"],
                            "description": "The type of input field"
                        },
                        "required": {
                            "type": "boolean",
                            "description": "True if field is marked as required (has *, required attribute, or 'Påkrevd')"
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "For select/radio fields: list of available options"
                        },
                        "placeholder": {
                            "type": "string",
                            "description": "Placeholder text if any"
                        },
                        "field_name": {
                            "type": "string",
                            "description": "The HTML name or id attribute of the field"
                        }
                    }
                }
            },
            "form_title": {
                "type": "string",
                "description": "Title of the form or page"
            },
            "current_url": {
                "type": "string",
                "description": "The current URL after navigation"
            },
            "requires_login": {
                "type": "boolean",
                "description": "True if page shows login form instead of application form"
            },
            "has_file_upload": {
                "type": "boolean",
                "description": "True if form has CV/resume file upload field"
            }
        }
    }

    navigation_goal = """
GOAL: Navigate to the job application form and EXTRACT all form field information. DO NOT fill any fields.

PHASE 1: COOKIE HANDLING
1. If Cookie Popup appears, click 'Godta alle', 'Accept all', 'Aksepter'.

PHASE 2: FIND APPLICATION FORM
2. Look for buttons: "Søk her", "Søk på stillingen", "Apply", "Send søknad", "Søk nå".
3. Click to navigate to the application form.
4. If redirected to external site (Webcruiter, Easycruit, HR-Manager), stay on that page.

PHASE 3: EXTRACT FORM FIELDS
5. Once on the form page, ANALYZE all visible form fields.
6. For EACH field, identify:
   - Label text (Norwegian or English)
   - Field type (text, email, select, date, file upload, etc.)
   - Whether it's required (marked with *, "Påkrevd", or required attribute)
   - For select/dropdown fields: list all available options
7. DO NOT fill any fields. Only extract information.

IMPORTANT: Extract ALL fields you can see, including:
- Personal info (Navn, E-post, Telefon, Adresse, Postnummer)
- Demographics (Kjønn, Fødselsdato, Alder)
- Education (Utdanningsnivå, Skole)
- Experience (Arbeidserfaring, Stilling)
- Documents (CV, Søknadsbrev, Vedlegg)
- Custom questions (Hvor fikk du høre om stillingen, etc.)
"""

    payload = {
        "url": url,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Extract ALL form fields with their labels, types, required status, and options. This is for analysis - do not fill anything.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 25,  # Fewer steps - just navigation and extraction
        "proxy_location": "RESIDENTIAL"
    }

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log("🚀 Sending extraction task to Skyvern...")
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code != 200:
                await log(f"❌ Skyvern extraction task failed: {response.status_code}")
                return {"success": False, "error": f"HTTP {response.status_code}", "fields": []}

            task_data = response.json()
            task_id = task_data.get('task_id')
            await log(f"📋 Extraction task created: {task_id}")

            # Wait for task completion
            result = await wait_for_extraction_task(task_id)
            return result

        except Exception as e:
            await log(f"❌ Extraction error: {e}")
            return {"success": False, "error": str(e), "fields": []}


async def wait_for_extraction_task(task_id: str, max_wait: int = 300) -> dict:
    """Wait for extraction task to complete and return results."""
    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    start_time = datetime.now()

    async with httpx.AsyncClient() as client:
        while True:
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > max_wait:
                await log(f"⏰ Extraction task timeout after {max_wait}s")
                return {"success": False, "error": "timeout", "fields": []}

            try:
                response = await client.get(
                    f"{SKYVERN_URL}/api/v1/tasks/{task_id}",
                    headers=headers,
                    timeout=10.0
                )

                if response.status_code == 200:
                    data = response.json()
                    status = data.get('status', '')

                    if status == 'completed':
                        extracted = data.get('extracted_information', {})
                        await log(f"✅ Extraction completed!")

                        fields = extracted.get('form_fields', [])
                        await log(f"   Found {len(fields)} form fields")

                        return {
                            "success": True,
                            "fields": fields,
                            "form_title": extracted.get('form_title', ''),
                            "form_url": extracted.get('current_url', ''),
                            "requires_login": extracted.get('requires_login', False),
                            "has_file_upload": extracted.get('has_file_upload', False),
                            "error": None
                        }

                    elif status in ['failed', 'terminated', 'timed_out']:
                        error_msg = data.get('failure_reason', status)
                        await log(f"❌ Extraction failed: {error_msg}")
                        return {"success": False, "error": error_msg, "fields": []}

                    else:
                        # Still running
                        await asyncio.sleep(3)
                else:
                    await asyncio.sleep(3)

            except Exception as e:
                await log(f"⚠️ Error checking extraction status: {e}")
                await asyncio.sleep(3)


# ============================================
# PHASE 2: SMART FIELD MATCHING (Variant 4)
# ============================================

# Mapping of common Norwegian form field labels to profile/KB keys
FIELD_MAPPING = {
    # Personal info - Norwegian
    'fornavn': ['first_name', 'First Name'],
    'etternavn': ['last_name', 'Last Name'],
    'navn': ['full_name', 'name', 'Name'],
    'fullt navn': ['full_name', 'name'],
    'e-post': ['email', 'Email'],
    'e-postadresse': ['email', 'Email'],
    'bekreft e-post': ['email', 'Email'],
    'telefon': ['phone', 'Phone'],
    'mobil': ['phone', 'Phone'],
    'mobilnummer': ['phone', 'Phone'],

    # Personal info - English
    'first name': ['first_name', 'First Name'],
    'last name': ['last_name', 'Last Name'],
    'full name': ['full_name', 'name', 'Name'],
    'name': ['full_name', 'name', 'Name'],
    'email': ['email', 'Email'],
    'e-mail': ['email', 'Email'],
    'email address': ['email', 'Email'],
    'phone': ['phone', 'Phone'],
    'phone number': ['phone', 'Phone'],
    'mobile': ['phone', 'Phone'],
    'cell phone': ['phone', 'Phone'],

    # Address - Norwegian
    'adresse': ['address', 'Address'],
    'gateadresse': ['address', 'Address'],
    'postnummer': ['postal_code', 'Postal Code', 'postalCode'],
    'postnr': ['postal_code', 'Postal Code'],
    'postnr./sted': ['postal_code', 'Postal Code'],
    'poststed': ['city', 'City'],
    'by': ['city', 'City'],
    'sted': ['city', 'City'],
    'land': ['country', 'Country'],

    # Address - English
    'address': ['address', 'Address'],
    'street': ['address', 'Address'],
    'city': ['city', 'City'],
    'postal code': ['postal_code', 'Postal Code'],
    'zip code': ['postal_code', 'Postal Code'],
    'zip': ['postal_code', 'Postal Code'],
    'country': ['country', 'Country'],

    # Demographics - Norwegian
    'kjønn': ['gender', 'Gender', 'Kjønn'],
    'fødselsdato': ['birth_date', 'Birth Date', 'Fødselsdato', 'birthDate'],
    'alder': ['age', 'Age'],

    # Demographics - English
    'gender': ['gender', 'Gender'],
    'date of birth': ['birth_date', 'Birth Date'],
    'birth date': ['birth_date', 'Birth Date'],
    'age': ['age', 'Age'],

    # Education - Norwegian
    'utdanning': ['education_level', 'Education'],
    'utdanningsnivå': ['education_level', 'Education Level'],
    'skole': ['education_school', 'School'],
    'universitet': ['education_school', 'University'],
    'studieretning': ['education_field', 'Field of Study'],

    # Education - English
    'education': ['education_level', 'Education'],
    'degree': ['education_level', 'Education Level'],
    'school': ['education_school', 'School'],
    'university': ['education_school', 'University'],
    'field of study': ['education_field', 'Field of Study'],
    'major': ['education_field', 'Field of Study'],

    # Work - Norwegian
    'stilling': ['current_position', 'Position'],
    'nåværende stilling': ['current_position', 'Current Position'],
    'arbeidsgiver': ['current_company', 'Company'],
    'firma': ['current_company', 'Company'],

    # Work - English
    'position': ['current_position', 'Position'],
    'job title': ['current_position', 'Position'],
    'current position': ['current_position', 'Current Position'],
    'company': ['current_company', 'Company'],
    'employer': ['current_company', 'Company'],

    # Application
    'søknad': ['cover_letter', 'Cover Letter'],
    'søknadstekst': ['cover_letter', 'Cover Letter'],
    'motivasjonsbrev': ['cover_letter', 'Cover Letter'],
    'fortell om deg selv': ['cover_letter', 'Cover Letter'],

    # Documents
    'cv': ['resume_url', 'CV'],
    'legg ved cv': ['resume_url', 'cv_file_path', 'CV'],
    'cv': ['resume_url', 'cv_file_path', 'CV'],
    'last opp cv': ['resume_url', 'cv_file_path', 'CV'],
    'vedlegg': ['resume_url', 'cv_file_path'],

    # Cover letter / Søknadsbrev (from application!)
    'søknadsbrev': ['cover_letter', 'cover_letter_no', 'søknadsbrev'],
    'søknadstekst': ['cover_letter', 'cover_letter_no'],
    'motivasjonsbrev': ['cover_letter', 'cover_letter_no'],
    'cover letter': ['cover_letter', 'cover_letter_no'],
    'message': ['cover_letter', 'cover_letter_no'],
    'melding': ['cover_letter', 'cover_letter_no'],

    # Source
    'hvor fikk du vite': ['job_source', 'Job Source', 'Hvor hørte du om oss'],
    'hvordan hørte': ['job_source', 'Job Source'],
}


async def smart_match_fields(extracted_fields: list, profile: dict, kb_data: dict, app_data: dict = None) -> dict:
    """
    PHASE 2 of Variant 4: Match extracted form fields with available data.

    Args:
        extracted_fields: List of fields from form extraction
        profile: User's CV profile
        kb_data: Knowledge base data
        app_data: Application data (contains cover_letter_no!)

    Returns:
        {
            "matched": [
                {"label": "Fornavn", "value": "Vitalii", "source": "profile"},
                ...
            ],
            "missing": [
                {"label": "Kjønn", "field_type": "select", "options": ["Mann", "Kvinne"]},
                ...
            ],
            "auto_filled": int,  # count of auto-matched fields
            "needs_input": int   # count of fields needing user input
        }
    """
    await log("🔄 PHASE 2: Smart matching fields with profile & KB...")

    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {}) or {}
    address_info = personal_info.get('address', {}) if isinstance(personal_info.get('address'), dict) else {}
    work_exp = structured.get('workExperience', []) or []
    education = structured.get('education', []) or []

    # Build available data dictionary
    available_data = {}

    # From profile - personal info
    full_name = personal_info.get('fullName', '') or personal_info.get('name', '')
    available_data['full_name'] = full_name
    available_data['name'] = full_name
    available_data['first_name'] = full_name.split()[0] if full_name else ''
    available_data['last_name'] = ' '.join(full_name.split()[1:]) if full_name and len(full_name.split()) > 1 else ''
    available_data['email'] = personal_info.get('email', '')
    available_data['phone'] = personal_info.get('phone', '')

    # Address
    available_data['city'] = address_info.get('city', '') or personal_info.get('city', '')
    available_data['postal_code'] = address_info.get('postalCode', '') or personal_info.get('postalCode', '')
    available_data['country'] = address_info.get('country', '') or personal_info.get('country', '') or 'Norge'
    available_data['address'] = address_info.get('street', '') or (personal_info.get('address', '') if isinstance(personal_info.get('address'), str) else '')

    # Work experience
    if work_exp:
        current_job = work_exp[0]
        available_data['current_position'] = current_job.get('position', '') or current_job.get('title', '')
        available_data['current_company'] = current_job.get('company', '')

    # Education
    if education:
        latest_edu = education[0]
        available_data['education_level'] = latest_edu.get('degree', '')
        available_data['education_field'] = latest_edu.get('field', '')
        available_data['education_school'] = latest_edu.get('institution', '')

    # From knowledge base
    for key, value in kb_data.items():
        # Normalize key
        norm_key = key.lower().replace(' ', '_')
        available_data[norm_key] = value
        available_data[key] = value  # Keep original too

    # From application data (søknadsbrev/cover letter!)
    if app_data:
        cover_letter = app_data.get('cover_letter_no', '')
        if cover_letter:
            available_data['cover_letter'] = cover_letter
            available_data['cover_letter_no'] = cover_letter
            available_data['søknadsbrev'] = cover_letter
            await log(f"   📝 Cover letter available ({len(cover_letter)} chars)")

    # CV file - check multiple sources
    cv_url = None

    # 1. Check CV_FILE_URL from environment (direct URL)
    cv_url = os.getenv('CV_FILE_URL', '')

    # 2. Check CV_FILE_PATH from environment (local file)
    if not cv_url:
        cv_file_path = os.getenv('CV_FILE_PATH', '')
        if cv_file_path and os.path.exists(cv_file_path):
            cv_url = cv_file_path

    # 3. Get from profile's source_files (Supabase Storage)
    if not cv_url:
        source_files = profile.get('source_files', []) or []
        if source_files:
            # Priority: Check DEFAULT_CV_FILE env or use "Vitalii Berbeha CV"
            default_cv = os.getenv('DEFAULT_CV_FILE', 'Vitalii Berbeha CV')

            # First, look for the preferred CV file
            for sf in source_files:
                if sf and default_cv.lower() in sf.lower():
                    cv_url = f"{SUPABASE_URL}/storage/v1/object/public/resumes/{sf}"
                    break

            # Fallback: any file with 'cv' in name
            if not cv_url:
                for sf in source_files:
                    if sf and 'cv' in sf.lower():
                        cv_url = f"{SUPABASE_URL}/storage/v1/object/public/resumes/{sf}"
                        break

            # Last resort: first file
            if not cv_url and source_files[0]:
                cv_url = f"{SUPABASE_URL}/storage/v1/object/public/resumes/{source_files[0]}"

    if cv_url:
        available_data['cv_file_path'] = cv_url
        available_data['resume_url'] = cv_url
        await log(f"   📄 CV available: {cv_url[:60]}...")

    # Match fields
    matched = []
    missing = []

    # Keywords for auto-consent checkboxes (privacy, GDPR, etc.)
    consent_keywords = ['personvern', 'samtykker', 'gdpr', 'privacy', 'consent',
                        'retningslinjer', 'vilkår', 'terms', 'aksepterer', 'godtar']

    # Keywords for optional marketing checkboxes (skip these)
    marketing_keywords = ['kontakte meg', 'fremtidige', 'future', 'newsletter',
                          'nyhetsbrev', 'marketing', 'markedsføring', 'jobbmuligheter']

    for field in extracted_fields:
        label = field.get('label', '').strip()
        label_lower = label.lower()
        field_type = field.get('field_type', field.get('type', 'text'))
        required = field.get('required', False)
        options = field.get('options', [])

        # Try to find a match
        found_value = None
        source = None

        # AUTO-CONSENT: Privacy/GDPR checkboxes - always agree
        if field_type == 'checkbox' and any(kw in label_lower for kw in consent_keywords):
            found_value = 'true'
            source = 'auto'
            await log(f"   ✅ Auto-consent: {label[:40]}...")

        # Check direct mapping
        if not found_value:
            for map_key, data_keys in FIELD_MAPPING.items():
                if map_key in label_lower:
                    for dk in data_keys:
                        if dk in available_data and available_data[dk]:
                            found_value = available_data[dk]
                            # Determine source
                            if dk in ['cover_letter', 'cover_letter_no', 'søknadsbrev']:
                                source = 'application'
                            elif dk in ['full_name', 'email', 'phone', 'city', 'postal_code',
                                         'current_position', 'education_level', 'first_name',
                                         'last_name', 'address', 'country']:
                                source = 'profile'
                            elif dk in ['cv_file_path', 'resume_url']:
                                source = 'file'
                            else:
                                source = 'kb'
                            break
                    if found_value:
                        break

        # Check KB directly by label
        if not found_value:
            if label in kb_data:
                found_value = kb_data[label]
                source = 'kb'
            elif label_lower in kb_data:
                found_value = kb_data[label_lower]
                source = 'kb'

        if found_value:
            matched.append({
                "label": label,
                "value": found_value if len(str(found_value)) < 100 else f"{str(found_value)[:100]}...",
                "source": source,
                "field_type": field_type
            })
        else:
            # Skip file uploads if no CV configured (can't upload via API anyway)
            if field_type == 'file':
                await log(f"   ⏭️ Skipping file field (no CV configured): {label}")
                continue

            # Skip optional marketing checkboxes (newsletters, future opportunities)
            if field_type == 'checkbox' and not required and any(kw in label_lower for kw in marketing_keywords):
                await log(f"   ⏭️ Skipping optional marketing: {label[:40]}...")
                continue

            # Field is missing - needs user input
            missing.append({
                "label": label,
                "field_type": field_type,
                "required": required,
                "options": options
            })

    await log(f"   ✅ Matched: {len(matched)} fields")
    await log(f"   ❓ Missing: {len(missing)} fields")

    return {
        "matched": matched,
        "missing": missing,
        "auto_filled": len(matched),
        "needs_input": len(missing)
    }


# ============================================
# PHASE 3: TELEGRAM CONFIRMATION (Variant 4)
# ============================================

async def send_smart_confirmation(
    app_id: str,
    job_id: str,
    job_title: str,
    company: str,
    form_url: str,
    match_result: dict,
    chat_id: str
) -> str | None:
    """
    PHASE 3 of Variant 4: Send smart confirmation to Telegram with REAL form fields.

    Shows user:
    - ✅ Fields that will be auto-filled (from profile/KB)
    - ❓ Fields that need user input (with options for select fields)

    Returns: confirmation_id or None
    """
    await log("📱 PHASE 3: Sending smart confirmation to Telegram...")

    matched = match_result.get('matched', [])
    missing = match_result.get('missing', [])

    # Build message
    domain = extract_domain(form_url) if form_url else "форма"

    message_parts = [
        f"📋 <b>Заявка на {company}</b>",
        f"💼 {job_title[:50]}..." if len(job_title) > 50 else f"💼 {job_title}",
        f"🌐 Форма: <code>{domain}</code>",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "<b>📝 ПОЛЯ ФОРМИ:</b>",
        "",
    ]

    # Combine all fields in one list - matched first, then missing
    all_fields = []

    # Add matched fields with their values
    for field in matched:
        all_fields.append({
            'label': field.get('label', 'Unknown'),
            'value': field.get('value', ''),
            'field_type': field.get('field_type', 'text'),
            'has_value': True,
            'options': field.get('options', [])
        })

    # Add missing fields without values
    for field in missing:
        all_fields.append({
            'label': field.get('label', 'Unknown'),
            'value': None,
            'field_type': field.get('field_type', 'text'),
            'has_value': False,
            'required': field.get('required', False),
            'options': field.get('options', [])
        })

    # Show ALL fields in Q&A format
    for field in all_fields:
        label = field['label']
        value = field['value']
        field_type = field['field_type']
        has_value = field['has_value']

        # Question
        message_parts.append(f"<b>❓ {label}:</b>")

        if has_value and value:
            value_str = str(value)

            # For cover letter - show first 200 chars
            if field_type == 'textarea' or 'cover' in label.lower() or 'søknad' in label.lower() or 'letter' in label.lower() or 'melding' in label.lower() or 'message' in label.lower():
                if len(value_str) > 200:
                    value_str = value_str[:200] + f"... ({len(value_str)} символів)"
            # For other fields - show full value (up to 100 chars)
            elif len(value_str) > 100:
                value_str = value_str[:100] + "..."

            message_parts.append(f"✅ <code>{value_str}</code>")
        else:
            # No value - show what's missing
            if field_type == 'select' and field.get('options'):
                options_str = ", ".join(field['options'][:5])
                if len(field['options']) > 5:
                    options_str += "..."
                message_parts.append(f"⚠️ <i>Не заповнено</i> [{options_str}]")
            elif field_type == 'date':
                message_parts.append(f"⚠️ <i>Не заповнено</i> (дата)")
            elif field_type == 'file':
                message_parts.append(f"⚠️ <i>Не заповнено</i> (файл)")
            else:
                message_parts.append(f"⚠️ <i>Не заповнено</i>")

        message_parts.append("")

    message_parts.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    message_parts.append(f"📊 Заповнено: {len(matched)} | Пусто: {len(missing)}")

    message = "\n".join(message_parts)

    # Create confirmation record with extraction data
    try:
        from datetime import timedelta
        expires_at = (datetime.now() + timedelta(seconds=CONFIRMATION_TIMEOUT_SECONDS)).isoformat()

        confirmation_data = {
            "application_id": app_id,
            "job_id": job_id,
            "telegram_chat_id": chat_id,
            "payload": {
                "matched_fields": matched,
                "missing_fields": missing,
                "form_url": form_url,
                "is_smart_confirmation": True
            },
            "status": "pending",
            "expires_at": expires_at
        }

        response = supabase.table("application_confirmations").insert(confirmation_data).execute()

        if not response.data or len(response.data) == 0:
            await log("❌ Failed to create smart confirmation record")
            return None

        confirmation_id = response.data[0]['id']

        # Build inline keyboard
        keyboard = {
            "inline_keyboard": []
        }

        # If there are missing fields, add buttons for each
        if missing:
            # Add "Answer questions" button
            keyboard["inline_keyboard"].append([
                {"text": "📝 Відповісти на питання", "callback_data": f"smart_answer_{confirmation_id}"}
            ])

        # Confirm/Cancel buttons
        keyboard["inline_keyboard"].append([
            {"text": "✅ Підтвердити", "callback_data": f"smart_confirm_{confirmation_id}"},
            {"text": "❌ Скасувати", "callback_data": f"smart_cancel_{confirmation_id}"}
        ])

        # Send to Telegram
        async with httpx.AsyncClient() as client:
            tg_response = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                    "reply_markup": keyboard
                },
                timeout=10.0
            )

            if tg_response.status_code == 200:
                tg_data = tg_response.json()
                msg_id = tg_data.get('result', {}).get('message_id')

                # Update confirmation with message_id
                supabase.table("application_confirmations").update({
                    "telegram_message_id": str(msg_id)
                }).eq("id", confirmation_id).execute()

                await log(f"📤 Smart confirmation sent: {confirmation_id}")
                return confirmation_id
            else:
                await log(f"❌ Telegram send failed: {tg_response.status_code}")
                return None

    except Exception as e:
        await log(f"❌ Smart confirmation error: {e}")
        return None


async def ask_missing_fields_telegram(
    confirmation_id: str,
    missing_fields: list,
    chat_id: str,
    current_index: int = 0
) -> None:
    """
    Ask user for missing field values one by one via Telegram.

    Sends a message for the current field, waits for response,
    saves to KB, and moves to next field.
    """
    if current_index >= len(missing_fields):
        await log("✅ All missing fields answered")
        return

    field = missing_fields[current_index]
    label = field.get('label', 'Unknown')
    field_type = field.get('field_type', 'text')
    options = field.get('options', [])
    required = field.get('required', False)

    # Build question message
    req_text = " (обов'язкове)" if required else ""
    message = f"❓ <b>{label}</b>{req_text}\n\n"

    keyboard = {"inline_keyboard": []}

    if field_type == 'select' and options:
        message += "Обери варіант:"
        # Add option buttons (max 4 per row)
        row = []
        for i, opt in enumerate(options[:12]):  # Max 12 options
            row.append({
                "text": opt,
                "callback_data": f"field_ans_{confirmation_id}_{current_index}_{i}"
            })
            if len(row) == 2:
                keyboard["inline_keyboard"].append(row)
                row = []
        if row:
            keyboard["inline_keyboard"].append(row)

    elif field_type == 'date':
        message += "Напиши дату у форматі DD.MM.YYYY:"

    elif field_type == 'radio' and options:
        message += "Обери варіант:"
        for i, opt in enumerate(options[:8]):
            keyboard["inline_keyboard"].append([{
                "text": opt,
                "callback_data": f"field_ans_{confirmation_id}_{current_index}_{i}"
            }])

    else:
        message += "Напиши відповідь:"

    # Add skip button if not required
    if not required:
        keyboard["inline_keyboard"].append([{
            "text": "⏭️ Пропустити",
            "callback_data": f"field_skip_{confirmation_id}_{current_index}"
        }])

    # Update confirmation with pending question
    supabase.table("application_confirmations").update({
        "payload": supabase.table("application_confirmations")
            .select("payload")
            .eq("id", confirmation_id)
            .single()
            .execute()
            .data.get('payload', {}) | {
                "pending_field_index": current_index,
                "pending_field_label": label
            }
    }).eq("id", confirmation_id).execute()

    # Send question
    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "reply_markup": keyboard if keyboard["inline_keyboard"] else None
            },
            timeout=10.0
        )


async def save_field_to_kb(label: str, value: str) -> bool:
    """Save a field answer to knowledge base."""
    try:
        # Check if already exists
        existing = supabase.table("user_knowledge_base") \
            .select("id") \
            .eq("question", label) \
            .execute()

        if existing.data:
            # Update existing
            supabase.table("user_knowledge_base").update({
                "answer": value
            }).eq("question", label).execute()
        else:
            # Insert new
            supabase.table("user_knowledge_base").insert({
                "question": label,
                "answer": value,
                "category": "form_field"
            }).execute()

        await log(f"💾 Saved to KB: {label} = {value[:20]}...")
        return True
    except Exception as e:
        await log(f"⚠️ Failed to save to KB: {e}")
        return False


# ============================================
# HYBRID FLOW ORCHESTRATION (Variant 4)
# ============================================

async def process_application_hybrid(
    app_id: str,
    job_data: dict,
    app_data: dict,
    chat_id: str
) -> dict:
    """
    Main orchestrator for Variant 4 hybrid flow.

    Flow:
    1. Extract form fields from URL
    2. Smart match with profile & KB
    3. Send to Telegram for confirmation
    4. Wait for user to fill missing fields
    5. Fill form with complete data

    Returns:
        {"success": bool, "status": str, "message": str}
    """
    job_title = job_data.get('title', 'Unknown')
    company = job_data.get('company', 'Unknown')
    external_url = job_data.get('external_apply_url') or job_data.get('job_url')
    user_id = job_data.get('user_id')

    await log(f"🚀 Starting HYBRID FLOW for: {job_title[:40]}...")

    # Get profile and KB data (filtered by user_id for multi-user isolation)
    profile = await get_active_profile_full(user_id)
    kb_data = await get_knowledge_base_dict()

    # PHASE 1: Extract form fields
    await log("━" * 40)
    extraction_result = await extract_form_fields(external_url)

    if not extraction_result.get('success'):
        error = extraction_result.get('error', 'Unknown error')
        await log(f"❌ Extraction failed: {error}")

        # Fall back to old flow
        await log("⚠️ Falling back to standard flow...")
        return {"success": False, "status": "extraction_failed", "message": error}

    fields = extraction_result.get('fields', [])
    form_url = extraction_result.get('form_url', external_url)

    if not fields:
        await log("⚠️ No fields extracted, falling back to standard flow")
        return {"success": False, "status": "no_fields", "message": "No form fields found"}

    await log(f"📋 Extracted {len(fields)} form fields")

    # PHASE 2: Smart matching
    await log("━" * 40)
    match_result = await smart_match_fields(fields, profile, kb_data, app_data)

    # PHASE 3: Send to Telegram
    await log("━" * 40)
    confirmation_id = await send_smart_confirmation(
        app_id=app_id,
        job_id=job_data.get('id'),
        job_title=job_title,
        company=company,
        form_url=form_url,
        match_result=match_result,
        chat_id=chat_id
    )

    if not confirmation_id:
        return {"success": False, "status": "telegram_failed", "message": "Failed to send confirmation"}

    return {
        "success": True,
        "status": "waiting_confirmation",
        "message": "Smart confirmation sent",
        "confirmation_id": confirmation_id,
        "matched_count": match_result.get('auto_filled', 0),
        "missing_count": match_result.get('needs_input', 0)
    }


async def trigger_skyvern_task_with_credentials(
    job_url: str,
    app_data: dict,
    kb_data: dict,
    profile_text: str,
    resume_url: str,
    credentials: dict = None,
    user_id: str = None
):
    """Sends a task to Skyvern with optional site credentials for login.

    If credentials are provided, includes login step in navigation goal.
    """
    cover_letter = app_data.get('cover_letter_no', 'No cover letter generated.')

    # Get full profile for structured data (filtered by user_id for multi-user isolation)
    profile = await get_active_profile_full(user_id)
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

    await log(f"📋 Payload: {full_name} | {personal_info.get('email', '')} | {personal_info.get('phone', '')}")

    # Add credentials if available
    if credentials:
        candidate_payload["login_email"] = credentials.get('email', '')
        candidate_payload["login_password"] = credentials.get('password', '')

    # 2. BUILD NAVIGATION GOAL - Use site-specific templates
    # Extract domain for site detection
    try:
        parsed_url = urlparse(job_url)
        domain = parsed_url.netloc.lower()
    except:
        domain = "unknown"

    site_type = detect_site_type(domain)
    await log(f"🌐 Site detection: {domain} → {site_type}")

    # Build profile_data for navigation_goals.py
    profile_data = {
        'full_name': full_name,
        'first_name': first_name,
        'last_name': last_name,
        'email': personal_info.get('email', ''),
        'phone': personal_info.get('phone', ''),
        'current_title': current_job.get('title', ''),
        'current_company': current_job.get('company', ''),
        'education_level': latest_education.get('degree', ''),
        'education_field': latest_education.get('field', ''),
        'education_school': latest_education.get('institution', '')
    }

    # Use site-specific navigation goal from navigation_goals.py
    navigation_goal = get_application_goal(
        domain=domain,
        profile_data=profile_data,
        cover_letter=cover_letter,
        credentials=credentials,
        resume_url=resume_url
    )

    await log(f"📋 Using {site_type} navigation template (credentials: {'yes' if credentials else 'no'})")

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


async def trigger_skyvern_task(job_url: str, app_data: dict, kb_data: dict, profile_text: str, resume_url: str, user_id: str = None):
    """Legacy wrapper - sends task without credentials."""
    return await trigger_skyvern_task_with_credentials(
        job_url, app_data, kb_data, profile_text, resume_url, credentials=None, user_id=user_id
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
    """Build the payload that will be submitted to the form.

    Returns ALL fields that will be sent to Skyvern for form filling.
    This is shown to the user in Telegram confirmation.

    IMPORTANT: First uses profile data, then fills gaps from knowledge_base.
    """
    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {})
    address_info = personal_info.get('address', {}) if isinstance(personal_info.get('address'), dict) else {}

    # Work experience - use 'position' field (not 'title')
    work_experience = structured.get('workExperience', []) or []
    current_job = work_experience[0] if work_experience else {}

    # Education
    education = structured.get('education', []) or []
    latest_education = education[0] if education else {}

    cover_letter = app_data.get('cover_letter_no', '') or app_data.get('cover_letter_uk', '')

    full_name = personal_info.get('fullName', '') or personal_info.get('name', '')
    first_name = full_name.split()[0] if full_name else ''
    last_name = ' '.join(full_name.split()[1:]) if full_name and len(full_name.split()) > 1 else ''

    # Get knowledge base for filling gaps
    kb_data = await get_knowledge_base_dict()

    # Build payload from profile first
    city = str(address_info.get('city', '') or personal_info.get('city', '') or '')
    postal_code = str(address_info.get('postalCode', '') or personal_info.get('postalCode', '') or '')
    country = str(address_info.get('country', '') or personal_info.get('country', '') or 'Norge')
    address = str(address_info.get('street', '') or (personal_info.get('address', '') if isinstance(personal_info.get('address'), str) else '') or '')

    # Fill gaps from knowledge_base
    if not postal_code:
        postal_code = kb_data.get('postal_code', '') or kb_data.get('Postal Code', '') or ''
    if not city:
        city = kb_data.get('city', '') or kb_data.get('City', '') or ''
    if not address:
        address = kb_data.get('address', '') or kb_data.get('Address', '') or ''

    return {
        # Personal info
        "full_name": full_name,
        "first_name": first_name,
        "last_name": last_name,
        "email": personal_info.get('email', ''),
        "phone": personal_info.get('phone', ''),

        # Address - from profile + KB fallback
        "city": city,
        "postal_code": postal_code,
        "country": country,
        "address": address,

        # Work experience - note: field is 'position', not 'title'!
        "current_position": current_job.get('position', '') or current_job.get('title', ''),
        "current_company": current_job.get('company', ''),

        # Education
        "education_level": latest_education.get('degree', ''),
        "education_field": latest_education.get('field', ''),
        "education_school": latest_education.get('institution', ''),

        # Cover letter
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

        # Build Telegram message with FULL payload preview
        domain = extract_domain(external_url) if external_url else "невідомий сайт"

        # Build fields list dynamically - show all non-empty fields
        fields_text = ""

        # Personal info section
        fields_text += "<b>👤 Особисті дані:</b>\n"
        if payload.get('full_name'):
            fields_text += f"   Ім'я: <code>{payload['full_name']}</code>\n"
        if payload.get('email'):
            fields_text += f"   Email: <code>{payload['email']}</code>\n"
        if payload.get('phone'):
            fields_text += f"   Телефон: <code>{payload['phone']}</code>\n"

        # Address section
        address_parts = []
        addr = payload.get('address', '')
        if addr and isinstance(addr, str):
            address_parts.append(addr)
        postal = payload.get('postal_code', '')
        if postal and isinstance(postal, str):
            address_parts.append(postal)
        city = payload.get('city', '')
        if city and isinstance(city, str):
            address_parts.append(city)
        country = payload.get('country', '')
        if country and isinstance(country, str) and country != 'Norge':
            address_parts.append(country)

        if address_parts:
            fields_text += f"\n<b>📍 Адреса:</b>\n"
            fields_text += f"   <code>{', '.join(address_parts)}</code>\n"

        # Work experience section
        if payload.get('current_position') or payload.get('current_company'):
            fields_text += f"\n<b>💼 Поточна робота:</b>\n"
            if payload.get('current_position'):
                fields_text += f"   Посада: <code>{payload['current_position']}</code>\n"
            if payload.get('current_company'):
                fields_text += f"   Компанія: <code>{payload['current_company']}</code>\n"

        # Education section
        if payload.get('education_level') or payload.get('education_school'):
            fields_text += f"\n<b>🎓 Освіта:</b>\n"
            if payload.get('education_level'):
                fields_text += f"   Ступінь: <code>{payload['education_level']}</code>\n"
            if payload.get('education_field'):
                fields_text += f"   Спеціальність: <code>{payload['education_field']}</code>\n"
            if payload.get('education_school'):
                fields_text += f"   Заклад: <code>{payload['education_school']}</code>\n"

        message = (
            f"📋 <b>Підтвердження перед відправкою</b>\n\n"
            f"🏢 <b>{job_title}</b>\n"
            f"🏛 {company}\n"
            f"🌐 {domain}\n\n"
            f"{fields_text}\n"
            f"<b>📝 Супровідний лист:</b>\n"
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


async def trigger_finn_apply_task(job_page_url: str, app_data: dict, profile_data: dict):
    """Sends a FINN Enkel Søknad task to Skyvern with 2FA webhook support.

    Args:
        job_page_url: The job page URL to apply to
        app_data: Application data including cover letter
        profile_data: User profile data
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
    raw_phone = personal_info.get('phone', '')
    # Normalize phone for Norwegian forms: remove +47 and spaces
    contact_phone = normalize_phone_for_norway(raw_phone)
    contact_email = personal_info.get('email', '') or FINN_EMAIL

    await log(f"📝 Profile: {contact_name} | {contact_phone} | {contact_email} | letter={len(cover_letter)}ch")

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


async def cancel_skyvern_task(task_id: str) -> bool:
    """Cancel a running Skyvern task.

    Args:
        task_id: The Skyvern task ID to cancel

    Returns:
        True if cancelled successfully, False otherwise
    """
    await log(f"🛑 Cancelling Skyvern task {task_id}...")

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            # Try POST /cancel endpoint first
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks/{task_id}/cancel",
                headers=headers,
                timeout=10.0
            )

            if response.status_code in [200, 204]:
                await log(f"✅ Task {task_id} cancelled successfully")
                return True

            # If POST doesn't work, try DELETE
            response = await client.delete(
                f"{SKYVERN_URL}/api/v1/tasks/{task_id}",
                headers=headers,
                timeout=10.0
            )

            if response.status_code in [200, 204]:
                await log(f"✅ Task {task_id} deleted/cancelled successfully")
                return True

            await log(f"⚠️ Failed to cancel task: {response.status_code} - {response.text}")
            return False

        except Exception as e:
            await log(f"❌ Error cancelling task: {e}")
            return False


async def monitor_task_status(task_id, chat_id: str = None, job_title: str = None, app_id: str = None):
    """Polls Skyvern API and updates Supabase based on result.

    Args:
        task_id: The Skyvern task ID to monitor
        chat_id: Telegram chat ID for notifications (magic link detection)
        job_title: Job title for notifications
        app_id: Application ID for checking user cancellation

    Returns:
        'sent', 'failed', 'manual_review', 'magic_link', or 'cancelled'
    """
    await log(f"⏳ Monitoring Task {task_id}...")

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        while True:
            # Check if user cancelled (status changed back to 'approved')
            if app_id:
                try:
                    app_check = supabase.table("applications").select("status").eq("id", app_id).single().execute()
                    if app_check.data and app_check.data.get("status") == "approved":
                        await log(f"🛑 User cancelled! Application status is 'approved'")
                        await cancel_skyvern_task(task_id)
                        return 'cancelled'
                except Exception as e:
                    await log(f"⚠️ Error checking app status: {e}")

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

async def process_application(app, skip_confirmation: bool = False):
    """Process a single application.

    Args:
        app: Application data from database
        skip_confirmation: If True, skip Telegram confirmation (for retries)
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

    # Consolidated job info log
    form_type_short = 'FINN' if has_enkel_soknad or application_form_type == 'finn_easy' else application_form_type or 'unknown'
    await log(f"📋 Job: {job_title} [{form_type_short}]")

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

    # === FLOW ROUTER ===
    # Route to appropriate flow based on form type
    # This determines HOW to process the application before we start
    if not is_finn_easy and chat_id:
        route_result = await FlowRouter.route(
            form_type=application_form_type or 'unknown',
            app_id=app_id,
            job_data={
                'id': job_id,
                'title': job_title,
                'company': job_company,
                'job_url': job_url,
                'external_apply_url': external_apply_url,
                'application_form_type': application_form_type
            },
            app_data=app,
            chat_id=chat_id
        )

        await log(f"   Flow: {route_result.get('flow')} - {route_result.get('status')}")

        # Handle special flow statuses
        if route_result.get('status') == 'email_required':
            # Email application - already notified user, mark as manual_review
            supabase.table("applications").update({
                "status": "manual_review",
                "error_message": "Email application - manual sending required"
            }).eq("id", app_id).execute()
            return False

        if route_result.get('status') == 'needs_registration':
            # Needs registration - trigger registration flow
            await log("📝 Triggering registration flow...")
            domain = extract_domain(external_apply_url or job_url)
            await trigger_registration_flow(
                domain=domain,
                job_id=job_id,
                app_id=app_id,
                chat_id=chat_id,
                job_title=job_title,
                external_url=external_apply_url or job_url,
                user_id=user_id  # For multi-user profile isolation
            )
            # Registration flow will handle the rest
            return False

        # Store route info for later use
        route_site_type = route_result.get('site_type', 'generic')
        route_credentials = route_result.get('credentials')
    else:
        route_site_type = 'finn' if is_finn_easy else 'generic'
        route_credentials = None

    # === CONFIRMATION FLOW ===
    # Get profile data first (needed for confirmation and form filling)
    # CRITICAL: Filter by user_id to ensure multi-user isolation
    profile_data = {}
    try:
        query = supabase.table("cv_profiles").select("*").eq("is_active", True)
        if user_id:
            query = query.eq("user_id", user_id)
        profile_res = query.limit(1).execute()
        if profile_res.data:
            profile_data = profile_res.data[0]
            # Log profile for verification
            profile_name = profile_data.get('structured_content', {}).get('personalInfo', {}).get('fullName', 'Unknown')
            await log(f"   👤 Profile: {profile_name} (user_id={user_id})")
    except Exception as e:
        await log(f"⚠️ Failed to fetch profile: {e}")

    # === VARIANT 4: HYBRID FLOW ===
    # Use hybrid flow for external forms (not FINN Easy) when:
    # - USE_HYBRID_FLOW is enabled
    # - Not a FINN Easy application
    # - Has external_apply_url or is external form
    # - chat_id is available (needed for Telegram interaction)
    use_hybrid = (
        USE_HYBRID_FLOW and
        not is_finn_easy and
        external_apply_url and
        chat_id and
        not skip_confirmation
    )

    if use_hybrid:
        await log("🔬 Using HYBRID FLOW (Variant 4)")

        # Prepare job data for hybrid flow
        hybrid_job_data = {
            'id': job_id,
            'title': job_title,
            'company': job_company,
            'job_url': job_url,
            'external_apply_url': external_apply_url,
            'application_form_type': application_form_type,
            'user_id': user_id  # For multi-user profile isolation
        }

        # Start hybrid flow
        hybrid_result = await process_application_hybrid(
            app_id=app_id,
            job_data=hybrid_job_data,
            app_data=app,
            chat_id=chat_id
        )

        if not hybrid_result.get('success'):
            # Hybrid flow failed - fall back to standard flow
            await log(f"⚠️ Hybrid flow failed: {hybrid_result.get('message')}")
            await log("⚠️ Falling back to standard confirmation flow...")
            # Continue with standard flow below
        else:
            # Hybrid flow started - wait for smart confirmation
            confirmation_id = hybrid_result.get('confirmation_id')
            await log(f"🔬 Hybrid confirmation sent: {confirmation_id}")

            # Wait for user confirmation (same as standard flow)
            confirmation_result = await wait_for_confirmation(confirmation_id)

            if confirmation_result == 'cancelled':
                await log(f"❌ User cancelled application: {job_title}")
                supabase.table("applications").update({"status": "draft"}).eq("id", app_id).execute()
                return False

            if confirmation_result == 'timeout':
                await log(f"⏰ Confirmation timeout: {job_title}")
                supabase.table("applications").update({"status": "draft"}).eq("id", app_id).execute()
                await send_telegram(chat_id, f"⏰ <b>Час вичерпано</b>\n\n📋 {job_title}\nЗаявка повернута в чернетки.")
                return False

            # User confirmed with smart data!
            await log(f"✅ User confirmed (hybrid), proceeding with submission")

            # Get updated matched fields from confirmation
            try:
                conf_res = supabase.table("application_confirmations").select("payload").eq("id", confirmation_id).single().execute()
                if conf_res.data and conf_res.data.get('payload'):
                    payload = conf_res.data['payload']
                    matched_fields = payload.get('matched_fields', [])
                    await log(f"📋 Got {len(matched_fields)} fields from smart confirmation")

                    # Update profile_data with user-provided answers
                    for field in matched_fields:
                        if field.get('source') == 'user':
                            # Save to KB for future use
                            await save_field_to_kb(field['label'], field['value'])
            except Exception as e:
                await log(f"⚠️ Failed to get smart confirmation data: {e}")

            # Continue to form filling (will use updated KB data)

    # Standard confirmation flow (fallback or non-hybrid)
    if not use_hybrid:
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

        # Use finn_apply_url if available (for NAV→FINN redirects), otherwise job_url
        apply_url_to_use = finn_apply_url or job_url
        task_id = await trigger_finn_apply_task(apply_url_to_use, app, profile_data)

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

            final_status = await monitor_task_status(task_id, chat_id=chat_id, job_title=job_title, app_id=app_id)

            await log(f"💾 FINN task finished: {final_status}")

            # Handle user cancellation
            if final_status == 'cancelled':
                await log(f"🛑 Task cancelled by user")
                return False

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

                # Trigger registration flow (with user_id for multi-user profile isolation)
                flow_id = await trigger_registration(
                    domain=domain,
                    registration_url=apply_url,
                    job_id=job_id,
                    application_id=app_id,
                    user_id=user_id
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
        profile_text = await get_active_profile(user_id)
        resume_url = await get_latest_resume_url()

        task_id = await trigger_skyvern_task_with_credentials(
            apply_url, app, kb_data, profile_text, resume_url, credentials, user_id
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

            final_status = await monitor_task_status(task_id, chat_id=chat_id, job_title=job_title, app_id=app_id)

            await log(f"💾 Updating DB status to: {final_status}")

            # Handle user cancellation
            if final_status == 'cancelled':
                await log(f"🛑 Task cancelled by user")
                return False

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


async def process_finn_applications(applications: list):
    """Process FINN applications one by one."""
    if not applications:
        return

    count = len(applications)
    await log(f"🚀 Processing {count} FINN application(s)")

    for i, app in enumerate(applications):
        if count > 1:
            await log(f"📋 Application {i+1}/{count}")
        await process_application(app)


async def main():
    await log("🌉 Skyvern Bridge started")
    await log("📡 Polling every 10 seconds for new applications...")

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

                # Process FINN applications
                if finn_apps:
                    await process_finn_applications(finn_apps)

                # Process other applications
                for app in other_apps:
                    await process_application(app)

        except Exception as e:
            await log(f"⚠️ Error: {e}")

        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
