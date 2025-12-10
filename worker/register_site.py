#!/usr/bin/env python3
"""
register_site.py - Automated Registration on Recruitment Sites

This worker handles registration on recruitment platforms (Webcruiter, Easycruit, etc.)
when credentials don't exist in the database.

Flow:
1. Check if credentials exist for the site domain
2. If yes → use them for login
3. If no → start registration flow:
   - Generate secure password
   - Fill form with profile data
   - Ask user via Telegram for missing information
   - Handle email/SMS verification
   - Save credentials on completion

Usage:
    python register_site.py                    # Start daemon
    python register_site.py --site domain.com  # Register on specific site
"""

import asyncio
import os
import json
import re
import secrets
import string
import httpx
from datetime import datetime, timedelta
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
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
DEFAULT_EMAIL = os.getenv("DEFAULT_REGISTRATION_EMAIL", "")  # Email for registrations

# Timeouts
QUESTION_TIMEOUT_SECONDS = 300  # 5 minutes
VERIFICATION_TIMEOUT_SECONDS = 300  # 5 minutes

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file")
    exit(1)

if not DEFAULT_EMAIL:
    print("⚠️  WARNING: DEFAULT_REGISTRATION_EMAIL not set in .env")
    print("   Will use email from active profile for registrations.")

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


async def log(msg: str, flow_id: str = None):
    """Log message with timestamp and optional flow ID."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    prefix = f"[{timestamp}]"
    if flow_id:
        prefix += f" [{flow_id[:8]}]"
    print(f"{prefix} {msg}")


# ============================================
# PASSWORD GENERATION
# ============================================

def generate_secure_password(length: int = 16) -> str:
    """Generate a secure password meeting common requirements.

    Requirements met:
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 digit
    - At least 1 special character
    - Length of 16 characters by default
    """
    # Character sets
    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    special = "!@#$%^&*"  # Safe special chars (avoid problematic ones)

    # Ensure at least one of each required type
    password = [
        secrets.choice(lowercase),
        secrets.choice(uppercase),
        secrets.choice(digits),
        secrets.choice(special),
    ]

    # Fill the rest randomly from all characters
    all_chars = lowercase + uppercase + digits + special
    password += [secrets.choice(all_chars) for _ in range(length - 4)]

    # Shuffle to avoid predictable pattern
    password_list = list(password)
    secrets.SystemRandom().shuffle(password_list)

    return ''.join(password_list)


# ============================================
# DOMAIN EXTRACTION
# ============================================

def extract_domain(url: str) -> str:
    """Extract domain from URL (e.g., 'webcruiter.no' from 'https://www.webcruiter.no/...')."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove 'www.' prefix
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except:
        return url


def get_site_name(domain: str) -> str:
    """Get human-readable site name from domain."""
    site_names = {
        'webcruiter.no': 'Webcruiter',
        'webcruiter.com': 'Webcruiter',
        'easycruit.com': 'Easycruit',
        'reachmee.com': 'ReachMee',
        'attract.reachmee.com': 'ReachMee',
        'jobylon.com': 'Jobylon',
        'teamtailor.com': 'Teamtailor',
        'lever.co': 'Lever',
        'recman.no': 'Recman',
        'cvpartner.com': 'CV Partner',
        'talenttech.io': 'TalentTech',
        'varbi.com': 'Varbi',
        'hrmanager.no': 'HR Manager',
    }
    return site_names.get(domain, domain.split('.')[0].capitalize())


# ============================================
# TELEGRAM NOTIFICATIONS
# ============================================

async def send_telegram(chat_id: str, text: str, reply_markup: dict = None) -> int | None:
    """Send a Telegram message. Returns message_id on success."""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        await log(f"⚠️ Cannot send Telegram: token={bool(TELEGRAM_BOT_TOKEN)}, chat_id={chat_id}")
        return None

    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
            if reply_markup:
                payload["reply_markup"] = json.dumps(reply_markup)

            response = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json=payload,
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                return data.get('result', {}).get('message_id')
            else:
                await log(f"⚠️ Telegram API error: {response.text}")
                return None
    except Exception as e:
        await log(f"⚠️ Telegram error: {e}")
        return None


async def edit_telegram_message(chat_id: str, message_id: int, text: str, reply_markup: dict = None):
    """Edit an existing Telegram message."""
    if not TELEGRAM_BOT_TOKEN or not chat_id or not message_id:
        return

    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "parse_mode": "HTML"
            }
            if reply_markup:
                payload["reply_markup"] = json.dumps(reply_markup)

            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/editMessageText",
                json=payload,
                timeout=10.0
            )
    except Exception as e:
        await log(f"⚠️ Telegram edit error: {e}")


# ============================================
# DATABASE OPERATIONS
# ============================================

async def get_site_credentials(domain: str) -> dict | None:
    """Check if credentials exist for a site domain."""
    try:
        response = supabase.table("site_credentials") \
            .select("*") \
            .eq("site_domain", domain) \
            .eq("status", "active") \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return response.data[0]
        return None
    except Exception as e:
        await log(f"⚠️ Failed to check credentials: {e}")
        return None


async def save_site_credentials(
    domain: str,
    email: str,
    password: str,
    site_name: str = None,
    registration_data: dict = None,
    skyvern_credential_id: str = None
) -> str | None:
    """Save credentials to database. Returns credential ID."""
    try:
        data = {
            "site_domain": domain,
            "site_name": site_name or get_site_name(domain),
            "email": email,
            "password": password,
            "status": "active",
            "registration_data": registration_data or {},
            "verified_at": datetime.now().isoformat()
        }

        if skyvern_credential_id:
            data["skyvern_credential_id"] = skyvern_credential_id

        response = supabase.table("site_credentials").insert(data).execute()

        if response.data and len(response.data) > 0:
            return response.data[0]['id']
        return None
    except Exception as e:
        await log(f"❌ Failed to save credentials: {e}")
        return None


async def get_active_profile() -> dict:
    """Get active CV profile with structured content."""
    try:
        response = supabase.table("cv_profiles") \
            .select("*") \
            .eq("is_active", True) \
            .limit(1) \
            .execute()

        if response.data and len(response.data) > 0:
            return response.data[0]
        return {}
    except Exception as e:
        await log(f"⚠️ Failed to fetch profile: {e}")
        return {}


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
    except Exception as e:
        await log(f"⚠️ Failed to get chat_id: {e}")
        return None


# ============================================
# REGISTRATION FLOW MANAGEMENT
# ============================================

async def create_registration_flow(
    site_domain: str,
    registration_url: str,
    job_id: str = None,
    application_id: str = None
) -> str | None:
    """Create a new registration flow. Returns flow ID."""
    try:
        chat_id = await get_telegram_chat_id()
        profile = await get_active_profile()

        # Get email for registration
        email = DEFAULT_EMAIL
        if not email:
            structured = profile.get('structured_content', {}) or {}
            personal_info = structured.get('personalInfo', {})
            email = personal_info.get('email', '')

        if not email:
            await log("❌ No email available for registration")
            return None

        # Generate password
        password = generate_secure_password()

        data = {
            "site_domain": site_domain,
            "site_name": get_site_name(site_domain),
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
            return response.data[0]['id']
        return None
    except Exception as e:
        await log(f"❌ Failed to create registration flow: {e}")
        return None


async def update_flow_status(flow_id: str, status: str, **kwargs):
    """Update registration flow status and optional fields."""
    try:
        data = {"status": status}
        data.update(kwargs)

        supabase.table("registration_flows") \
            .update(data) \
            .eq("id", flow_id) \
            .execute()
    except Exception as e:
        await log(f"⚠️ Failed to update flow: {e}", flow_id)


async def get_flow(flow_id: str) -> dict | None:
    """Get registration flow by ID."""
    try:
        response = supabase.table("registration_flows") \
            .select("*") \
            .eq("id", flow_id) \
            .single() \
            .execute()
        return response.data
    except:
        return None


# ============================================
# QUESTION HANDLING
# ============================================

async def ask_user_question(
    flow_id: str,
    field_name: str,
    question_text: str,
    field_type: str = "text",
    options: list = None
) -> str | None:
    """Ask user a question via Telegram and wait for answer.

    Returns the answer or None on timeout.
    """
    flow = await get_flow(flow_id)
    if not flow:
        return None

    chat_id = flow.get('telegram_chat_id')
    site_name = flow.get('site_name', 'сайті')

    # Create question record
    question_data = {
        "flow_id": flow_id,
        "field_name": field_name,
        "field_type": field_type,
        "question_text": question_text,
        "options": options,
        "status": "pending",
        "timeout_at": (datetime.now() + timedelta(seconds=QUESTION_TIMEOUT_SECONDS)).isoformat()
    }

    try:
        q_response = supabase.table("registration_questions").insert(question_data).execute()
        question_id = q_response.data[0]['id'] if q_response.data else None
    except Exception as e:
        await log(f"⚠️ Failed to create question: {e}", flow_id)
        return None

    # Build Telegram message
    message = f"❓ <b>Питання при реєстрації на {site_name}</b>\n\n"
    message += f"📝 {question_text}\n\n"

    reply_markup = None
    if options and len(options) > 0:
        message += "Оберіть варіант або введіть свій:\n"
        for i, opt in enumerate(options[:10], 1):  # Max 10 options
            message += f"  {i}. {opt}\n"

        # Create inline keyboard for options
        buttons = []
        for i, opt in enumerate(options[:5], 1):  # Max 5 buttons
            buttons.append({
                "text": f"{i}. {opt[:20]}",
                "callback_data": f"regq_{question_id}_{i}"
            })
        reply_markup = {"inline_keyboard": [buttons]}
    else:
        message += "Введіть відповідь текстом:"

    # Update flow status
    await update_flow_status(flow_id, "waiting_for_user", pending_question={
        "question_id": question_id,
        "field_name": field_name,
        "question_text": question_text,
        "asked_at": datetime.now().isoformat()
    })

    # Send Telegram message
    msg_id = await send_telegram(chat_id, message, reply_markup)
    if msg_id:
        supabase.table("registration_questions") \
            .update({"telegram_message_id": msg_id}) \
            .eq("id", question_id) \
            .execute()

    # Wait for answer (poll database)
    start_time = datetime.now()
    while (datetime.now() - start_time).seconds < QUESTION_TIMEOUT_SECONDS:
        await asyncio.sleep(3)  # Poll every 3 seconds

        try:
            q_res = supabase.table("registration_questions") \
                .select("status, answer") \
                .eq("id", question_id) \
                .single() \
                .execute()

            if q_res.data:
                status = q_res.data.get('status')
                if status == 'answered':
                    answer = q_res.data.get('answer')
                    await log(f"✅ Got answer for {field_name}: {answer[:50]}...", flow_id)

                    # Update flow
                    await update_flow_status(flow_id, "registering", pending_question=None)

                    # Add to Q&A history
                    flow = await get_flow(flow_id)
                    qa_history = flow.get('qa_history', []) or []
                    qa_history.append({
                        "question": question_text,
                        "answer": answer,
                        "field_name": field_name,
                        "answered_at": datetime.now().isoformat()
                    })
                    await update_flow_status(flow_id, "registering", qa_history=qa_history)

                    return answer
                elif status in ['skipped', 'timeout']:
                    await log(f"⚠️ Question {status} for {field_name}", flow_id)
                    return None
        except:
            pass

    # Timeout
    await log(f"⏱️ Question timeout for {field_name}", flow_id)
    supabase.table("registration_questions") \
        .update({"status": "timeout"}) \
        .eq("id", question_id) \
        .execute()

    if chat_id:
        await send_telegram(chat_id, f"⏱️ Час вийшов для питання про {field_name}")

    return None


async def ask_verification_code(
    flow_id: str,
    verification_type: str,
    identifier: str = None
) -> str | None:
    """Ask user for verification code (email/SMS).

    Returns the code or None on timeout.
    """
    flow = await get_flow(flow_id)
    if not flow:
        return None

    chat_id = flow.get('telegram_chat_id')
    site_name = flow.get('site_name', 'сайт')

    # Update flow
    await update_flow_status(
        flow_id,
        f"{verification_type}_verification",
        verification_type=verification_type,
        verification_requested_at=datetime.now().isoformat(),
        verification_expires_at=(datetime.now() + timedelta(seconds=VERIFICATION_TIMEOUT_SECONDS)).isoformat()
    )

    # Build message based on type
    if verification_type == "email_code":
        message = (
            f"📧 <b>Підтвердження email на {site_name}</b>\n\n"
            f"На вашу пошту {identifier or 'було'} надіслано код підтвердження.\n\n"
            f"Введіть код з листа:"
        )
    elif verification_type == "sms_code":
        message = (
            f"📱 <b>Підтвердження телефону на {site_name}</b>\n\n"
            f"На номер {identifier or 'ваш телефон'} надіслано SMS з кодом.\n\n"
            f"Введіть код з SMS:"
        )
    elif verification_type == "email_link":
        message = (
            f"🔗 <b>Підтвердження email на {site_name}</b>\n\n"
            f"На вашу пошту надіслано лінк для підтвердження.\n\n"
            f"<b>Перейдіть за лінком</b> і потім напишіть <code>готово</code>"
        )
    else:
        message = (
            f"🔐 <b>Підтвердження на {site_name}</b>\n\n"
            f"Потрібна верифікація. Введіть код або напишіть <code>готово</code>:"
        )

    await send_telegram(chat_id, message)

    # Wait for code (poll database or Telegram)
    start_time = datetime.now()
    while (datetime.now() - start_time).seconds < VERIFICATION_TIMEOUT_SECONDS:
        await asyncio.sleep(3)

        # Check if code was submitted
        flow = await get_flow(flow_id)
        if flow:
            code = flow.get('verification_code')
            if code:
                await log(f"✅ Got verification code: {code}", flow_id)
                return code

    await log(f"⏱️ Verification timeout", flow_id)
    if chat_id:
        await send_telegram(chat_id, f"⏱️ Час верифікації вийшов на {site_name}")

    return None


# ============================================
# PROFILE DATA EXTRACTION
# ============================================

def extract_profile_data(profile: dict) -> dict:
    """Extract registration-relevant data from CV profile."""
    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {}) or {}

    # Basic info
    data = {
        "full_name": personal_info.get('fullName', '') or personal_info.get('name', ''),
        "email": personal_info.get('email', ''),
        "phone": personal_info.get('phone', ''),
        "address": personal_info.get('address', ''),
        "city": personal_info.get('city', ''),
        "postal_code": personal_info.get('postalCode', ''),
        "country": personal_info.get('country', 'Norge'),
        "birth_date": personal_info.get('birthDate', ''),
        "nationality": personal_info.get('nationality', ''),
    }

    # Split name
    name_parts = data['full_name'].split(' ', 1)
    data['first_name'] = name_parts[0] if len(name_parts) > 0 else ''
    data['last_name'] = name_parts[1] if len(name_parts) > 1 else ''

    # Work experience summary
    work_exp = structured.get('workExperience', []) or []
    if work_exp:
        latest_job = work_exp[0] if isinstance(work_exp, list) else {}
        data['current_position'] = latest_job.get('title', '')
        data['current_company'] = latest_job.get('company', '')

    # Education
    education = structured.get('education', []) or []
    if education:
        latest_edu = education[0] if isinstance(education, list) else {}
        data['education_level'] = latest_edu.get('degree', '')
        data['education_field'] = latest_edu.get('field', '')
        data['education_school'] = latest_edu.get('institution', '')

    # Languages
    languages = structured.get('languages', []) or []
    data['languages'] = [lang.get('language', '') for lang in languages if isinstance(lang, dict)]

    # Skills
    skills = structured.get('technicalSkills', {}) or {}
    all_skills = []
    for category in skills.values():
        if isinstance(category, list):
            all_skills.extend(category)
    data['skills'] = all_skills[:20]  # Top 20 skills

    return data


# ============================================
# SKYVERN INTEGRATION
# ============================================

async def add_credential_to_skyvern(domain: str, email: str, password: str) -> str | None:
    """Add credentials to Skyvern's credential store.

    Returns credential_id on success.
    """
    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    payload = {
        "name": f"{get_site_name(domain)} Login",
        "url": f"https://{domain}",
        "username": email,
        "password": password,
        "description": f"Auto-registered on {datetime.now().strftime('%Y-%m-%d')}"
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/credentials/passwords",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code in [200, 201]:
                data = response.json()
                return data.get('credential_id') or data.get('id')
            else:
                await log(f"⚠️ Failed to add Skyvern credential: {response.text}")
                return None
        except Exception as e:
            await log(f"⚠️ Skyvern credential error: {e}")
            return None


async def trigger_registration_task(
    flow_id: str,
    registration_url: str,
    profile_data: dict,
    email: str,
    password: str
) -> str | None:
    """Start Skyvern registration task.

    Returns task_id on success.
    """
    flow = await get_flow(flow_id)
    if not flow:
        return None

    site_domain = flow.get('site_domain', '')
    site_name = flow.get('site_name', 'сайт')

    # Build navigation goal based on site
    navigation_goal = build_registration_goal(site_domain, profile_data, email, password)

    # Data extraction schema - we want to know what fields were filled
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "registration_successful": {
                "type": "boolean",
                "description": "True if registration completed successfully"
            },
            "needs_email_verification": {
                "type": "boolean",
                "description": "True if email verification is required"
            },
            "needs_sms_verification": {
                "type": "boolean",
                "description": "True if SMS/phone verification is required"
            },
            "error_message": {
                "type": "string",
                "description": "Error message if registration failed"
            },
            "missing_fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of required fields that couldn't be filled"
            },
            "filled_fields": {
                "type": "object",
                "description": "All fields that were filled with their values"
            }
        }
    }

    payload = {
        "url": registration_url,
        "navigation_goal": navigation_goal,
        "navigation_payload": {
            **profile_data,
            "email": email,
            "password": password,
            "confirm_password": password
        },
        "data_extraction_goal": "Determine registration status, any verification needs, and fields that were filled.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 80,  # Registrations can be multi-page
        "max_retries_per_step": 5,
        "wait_before_action_ms": 1500,
        "proxy_location": "RESIDENTIAL"
    }

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    async with httpx.AsyncClient() as client:
        try:
            await log(f"🚀 Starting registration task on {site_name}...", flow_id)
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code == 200:
                task_data = response.json()
                task_id = task_data.get('task_id')
                await log(f"✅ Registration task started: {task_id}", flow_id)
                return task_id
            else:
                await log(f"❌ Skyvern error: {response.text}", flow_id)
                return None
        except Exception as e:
            await log(f"❌ Connection failed: {e}", flow_id)
            return None


def build_registration_goal(domain: str, profile_data: dict, email: str, password: str) -> str:
    """Build site-specific navigation goal for registration."""

    # Common registration steps
    base_goal = f"""
GOAL: Complete user registration on this recruitment platform.

IMPORTANT RULES:
1. If you encounter a field that you cannot fill from the provided data, STOP and report it as a missing field.
2. DO NOT guess or make up information.
3. If registration requires multiple pages, continue through all of them.
4. Accept any cookie/GDPR popups first.

REGISTRATION DATA TO USE:
- Email: {email}
- Password: {password}
- Full Name: {profile_data.get('full_name', '')}
- First Name: {profile_data.get('first_name', '')}
- Last Name: {profile_data.get('last_name', '')}
- Phone: {profile_data.get('phone', '')}
- Address: {profile_data.get('address', '')}
- City: {profile_data.get('city', '')}
- Postal Code: {profile_data.get('postal_code', '')}
- Country: {profile_data.get('country', 'Norge')}

PHASES:

PHASE 1: COOKIE/POPUP HANDLING
- Click "Godta alle", "Accept all", "Aksepter" if cookie popup appears
- Close any welcome modals

PHASE 2: FIND REGISTRATION FORM
- Look for "Register", "Sign up", "Opprett konto", "Registrer deg"
- If on login page, look for "Create account" or similar link
- Click to navigate to registration form
"""

    # Site-specific additions
    if 'webcruiter' in domain:
        base_goal += """
SITE-SPECIFIC (Webcruiter):
- Registration button may say "Opprett bruker" or "Ny bruker"
- Look for "Registrer deg som arbeidssøker"
- May have separate fields for first/last name
- Phone field may require country code (+47)
"""
    elif 'easycruit' in domain:
        base_goal += """
SITE-SPECIFIC (Easycruit):
- Look for "Create profile" or "Opprett profil"
- May redirect to company-specific subdomain
- Some fields may be optional (skip if not in data)
"""
    elif 'jobylon' in domain:
        base_goal += """
SITE-SPECIFIC (Jobylon):
- Modern interface, look for "Sign up" button
- May have social login options - ignore them, use email
- Single-page registration form usually
"""
    elif 'teamtailor' in domain:
        base_goal += """
SITE-SPECIFIC (Teamtailor):
- Look for "Create account" in top navigation
- May have candidate portal registration
- LinkedIn import option - skip, use manual entry
"""

    base_goal += f"""

PHASE 3: FILL REGISTRATION FORM
- Fill all visible required fields (marked with *)
- For dropdowns, select the most appropriate option
- For country field, select "Norge" or "Norway"
- Accept terms and conditions checkbox

PHASE 4: SUBMIT
- Click "Register", "Submit", "Opprett", "Registrer"
- Wait for confirmation or next step

PHASE 5: VERIFICATION CHECK
- Check if email verification is required
- Check if phone verification is required
- Report any verification requirements

COMPLETION:
- Report success=true if account created
- Report any verification requirements
- Report all fields that were successfully filled
"""

    return base_goal


async def monitor_registration_task(flow_id: str, task_id: str) -> dict:
    """Monitor Skyvern task and handle intermediate states.

    Returns result dict with status and extracted data.
    """
    await log(f"⏳ Monitoring registration task...", flow_id)

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
                    extracted = data.get('extracted_information', {}) or {}

                    if status == 'completed':
                        await log(f"✅ Registration task completed", flow_id)
                        return {
                            "success": True,
                            "status": "completed",
                            "data": extracted
                        }

                    if status in ['failed', 'terminated']:
                        reason = data.get('failure_reason', 'Unknown')
                        await log(f"❌ Registration task failed: {reason}", flow_id)
                        return {
                            "success": False,
                            "status": status,
                            "error": reason,
                            "data": extracted
                        }

                    # Check for missing fields that need user input
                    if extracted.get('missing_fields'):
                        missing = extracted.get('missing_fields', [])
                        await log(f"⚠️ Missing fields detected: {missing}", flow_id)
                        # This would need to pause and ask user
                        # For now, continue and let task handle it

                await asyncio.sleep(5)

            except Exception as e:
                await log(f"⚠️ Monitoring error: {e}", flow_id)
                await asyncio.sleep(5)


# ============================================
# MAIN REGISTRATION FLOW
# ============================================

async def process_registration(flow_id: str):
    """Process a registration flow from start to finish."""
    flow = await get_flow(flow_id)
    if not flow:
        await log(f"❌ Flow not found: {flow_id}")
        return

    site_domain = flow.get('site_domain')
    site_name = flow.get('site_name', site_domain)
    registration_url = flow.get('registration_url')
    email = flow.get('registration_email')
    password = flow.get('generated_password')
    chat_id = flow.get('telegram_chat_id')

    await log(f"🚀 Starting registration on {site_name}", flow_id)
    await log(f"   URL: {registration_url}", flow_id)
    await log(f"   Email: {email}", flow_id)

    # Notify user
    if chat_id:
        await send_telegram(chat_id,
            f"🔄 <b>Починаю реєстрацію на {site_name}</b>\n\n"
            f"📧 Email: {email}\n"
            f"🔗 {registration_url}\n\n"
            f"Якщо потрібна додаткова інформація - я запитаю."
        )

    # Update status
    await update_flow_status(flow_id, "registering", started_at=datetime.now().isoformat())

    # Get profile data
    profile = await get_active_profile()
    profile_data = extract_profile_data(profile)

    # Start Skyvern task
    task_id = await trigger_registration_task(
        flow_id, registration_url, profile_data, email, password
    )

    if not task_id:
        await update_flow_status(flow_id, "failed", error_message="Failed to start Skyvern task")
        if chat_id:
            await send_telegram(chat_id, f"❌ Не вдалося запустити реєстрацію на {site_name}")
        return

    await update_flow_status(flow_id, "registering", skyvern_task_id=task_id)

    # Monitor task
    result = await monitor_registration_task(flow_id, task_id)

    if result.get('success'):
        extracted = result.get('data', {})

        # Check if verification needed
        if extracted.get('needs_email_verification'):
            await log(f"📧 Email verification required", flow_id)
            code = await ask_verification_code(flow_id, "email_code", email)
            if code:
                # TODO: Submit verification code via another Skyvern task
                pass

        if extracted.get('needs_sms_verification'):
            await log(f"📱 SMS verification required", flow_id)
            phone = profile_data.get('phone')
            code = await ask_verification_code(flow_id, "sms_code", phone)
            if code:
                # TODO: Submit verification code via another Skyvern task
                pass

        # Save credentials
        skyvern_cred_id = await add_credential_to_skyvern(site_domain, email, password)

        cred_id = await save_site_credentials(
            domain=site_domain,
            email=email,
            password=password,
            site_name=site_name,
            registration_data=extracted.get('filled_fields', {}),
            skyvern_credential_id=skyvern_cred_id
        )

        if cred_id:
            await update_flow_status(flow_id, "completed", completed_at=datetime.now().isoformat())
            await log(f"✅ Registration completed! Credential ID: {cred_id}", flow_id)

            if chat_id:
                await send_telegram(chat_id,
                    f"✅ <b>Реєстрація на {site_name} завершена!</b>\n\n"
                    f"📧 Email: {email}\n"
                    f"🔐 Пароль збережено в базі\n\n"
                    f"Тепер можна подаватись на вакансії цього сайту автоматично!"
                )
        else:
            await update_flow_status(flow_id, "failed", error_message="Failed to save credentials")

    else:
        error = result.get('error', 'Unknown error')
        await update_flow_status(flow_id, "failed", error_message=error)

        if chat_id:
            await send_telegram(chat_id,
                f"❌ <b>Помилка реєстрації на {site_name}</b>\n\n"
                f"Причина: {error}\n\n"
                f"Спробуйте зареєструватись вручну."
            )


# ============================================
# PUBLIC API
# ============================================

async def check_and_register(url: str, job_id: str = None, application_id: str = None) -> dict:
    """Check if credentials exist for URL domain, register if not.

    Returns:
        {
            "has_credentials": bool,
            "credentials": {...} or None,
            "registration_started": bool,
            "flow_id": str or None
        }
    """
    domain = extract_domain(url)
    await log(f"🔍 Checking credentials for {domain}")

    # Check existing credentials
    creds = await get_site_credentials(domain)

    if creds:
        await log(f"✅ Found existing credentials for {domain}")
        return {
            "has_credentials": True,
            "credentials": creds,
            "registration_started": False,
            "flow_id": None
        }

    # No credentials - start registration
    await log(f"📝 No credentials found, starting registration for {domain}")

    flow_id = await create_registration_flow(
        site_domain=domain,
        registration_url=url,
        job_id=job_id,
        application_id=application_id
    )

    if flow_id:
        # Start registration in background
        asyncio.create_task(process_registration(flow_id))

        return {
            "has_credentials": False,
            "credentials": None,
            "registration_started": True,
            "flow_id": flow_id
        }

    return {
        "has_credentials": False,
        "credentials": None,
        "registration_started": False,
        "flow_id": None
    }


# ============================================
# DAEMON MODE
# ============================================

async def process_pending_flows():
    """Process any pending registration flows."""
    try:
        response = supabase.table("registration_flows") \
            .select("*") \
            .in_("status", ["pending", "registering"]) \
            .execute()

        if response.data:
            for flow in response.data:
                flow_id = flow['id']
                status = flow['status']

                if status == 'pending':
                    await log(f"📋 Found pending flow", flow_id)
                    asyncio.create_task(process_registration(flow_id))

    except Exception as e:
        await log(f"⚠️ Error checking flows: {e}")


async def main():
    """Main daemon loop."""
    await log("🌉 Registration Worker started")
    await log("📡 Polling for registration flows...")

    while True:
        try:
            await process_pending_flows()
        except Exception as e:
            await log(f"⚠️ Error: {e}")

        await asyncio.sleep(10)


# ============================================
# CLI ENTRY POINT
# ============================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--site":
        # Manual registration mode
        if len(sys.argv) < 3:
            print("Usage: python register_site.py --site <url>")
            exit(1)

        url = sys.argv[2]
        print(f"Starting registration for: {url}")

        async def manual_register():
            result = await check_and_register(url)
            print(f"Result: {json.dumps(result, indent=2, default=str)}")

            if result.get('registration_started'):
                print("Registration started. Waiting for completion...")
                # Wait for the background task
                await asyncio.sleep(300)  # 5 minutes max

        asyncio.run(manual_register())
    else:
        # Daemon mode
        asyncio.run(main())
