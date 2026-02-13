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
import logging
from logging.handlers import RotatingFileHandler
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

# --- FILE LOGGING ---
_file_logger = logging.getLogger("register")
_file_logger.setLevel(logging.INFO)
_log_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.log")
_file_handler = RotatingFileHandler(_log_file, maxBytes=5*1024*1024, backupCount=2, encoding="utf-8")
_file_handler.setFormatter(logging.Formatter("%(asctime)s [REG] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
_file_logger.addHandler(_file_handler)


async def log(msg: str, flow_id: str = None):
    """Log message with timestamp and optional flow ID."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    prefix = f"[{timestamp}]"
    if flow_id:
        prefix += f" [{flow_id[:8]}]"
    print(f"{prefix} {msg}")
    log_msg = f"[{flow_id[:8]}] {msg}" if flow_id else msg
    _file_logger.info(log_msg)


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
# STEP-BY-STEP REPORTING HELPERS
# ============================================

async def fetch_task_steps(client, task_id: str, headers: dict) -> list:
    """Fetch steps from Skyvern task steps API."""
    try:
        response = await client.get(
            f"{SKYVERN_URL}/api/v1/tasks/{task_id}/steps",
            headers=headers,
            timeout=10.0
        )
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                return data
        return []
    except Exception as e:
        await log(f"⚠️ Could not fetch steps: {e}")
        return []


def format_step_report(step: dict, step_num: int, total: int, mask_values: list = None) -> str:
    """Format a single step into a Telegram message. Masks sensitive values like passwords."""
    step_output = step.get("output", {}) or {}
    action_results = step_output.get("action_results", []) or []

    lines = [f"📍 <b>Step {step_num}/{total}</b>"]

    # Show current URL if available
    step_url = step.get("output", {}).get("url", "") if step.get("output") else ""
    if step_url:
        display_url = step_url if len(step_url) <= 50 else step_url[:47] + "..."
        lines.append(f"  🌐 {display_url}")

    if not action_results:
        lines.append("  ⏳ Navigating...")
        return "\n".join(lines)

    for result in action_results:
        action_type = result.get("action_type", "") or result.get("type", "")
        action_type_lower = action_type.lower()

        if action_type_lower in ("input_text", "fill", "send_keys"):
            value = result.get("data", {}).get("text", "") if isinstance(result.get("data"), dict) else ""
            if not value:
                value = result.get("text", "")
            # Mask sensitive values (passwords)
            if mask_values and any(v and v in value for v in mask_values):
                display_val = "••••••••"
            else:
                display_val = value[:40] + "..." if len(value) > 40 else value
            lines.append(f"  ✅ Filled: {display_val}")
        elif action_type_lower in ("click", "select_option"):
            target = result.get("data", {}).get("element", "") if isinstance(result.get("data"), dict) else ""
            if not target:
                target = result.get("element_id", action_type)
            display_target = str(target)[:40]
            lines.append(f"  🖱 Clicked: {display_target}")
        elif action_type_lower == "upload_file":
            lines.append(f"  📎 Uploaded file")
        elif action_type_lower in ("wait", "sleep"):
            pass  # Skip wait actions
        elif action_type_lower:
            lines.append(f"  ▶️ {action_type}")

    msg = "\n".join(lines)
    return msg[:2000]


def format_registration_dashboard(site_name: str, task_id: str,
                                   total_steps: int, filled_fields: list, status: str) -> str:
    """Format the live-updating registration progress dashboard message."""
    if status == "running":
        emoji = "⏳"
    elif status == "completed":
        emoji = "✅"
    else:
        emoji = "❌"

    lines = [
        f"{emoji} <b>Реєстрація: {site_name}</b>",
        f"🔑 Task: <code>{task_id}</code>",
        "",
        f"📊 Progress: Step {total_steps}",
    ]

    if filled_fields:
        lines.append(f"\n📝 <b>Filled ({len(filled_fields)}):</b>")
        for field in filled_fields[-8:]:  # Show last 8 fields
            lines.append(f"  ✅ {field}")
        if len(filled_fields) > 8:
            lines.append(f"  ... and {len(filled_fields) - 8} more")

    msg = "\n".join(lines)
    return msg[:2000]


# ============================================
# KNOWLEDGE BASE & MISSING FIELD HANDLING
# ============================================

# Map of common field names to user-friendly Ukrainian questions
FIELD_QUESTIONS = {
    'postal_code': '📮 Який ваш поштовий індекс?',
    'postalcode': '📮 Який ваш поштовий індекс?',
    'postal code': '📮 Який ваш поштовий індекс?',
    'zip_code': '📮 Який ваш поштовий індекс?',
    'zipcode': '📮 Який ваш поштовий індекс?',
    'address': '🏠 Яка ваша адреса (вулиця, будинок)?',
    'street': '🏠 Яка ваша вулиця та номер будинку?',
    'street_address': '🏠 Яка ваша вулиця та номер будинку?',
    'city': '🏙️ В якому місті ви живете?',
    'country': '🌍 В якій країні ви живете?',
    'birth_date': '🎂 Яка ваша дата народження? (ДД.ММ.РРРР)',
    'birthdate': '🎂 Яка ваша дата народження? (ДД.ММ.РРРР)',
    'date_of_birth': '🎂 Яка ваша дата народження? (ДД.ММ.РРРР)',
    'nationality': '🏳️ Яке ваше громадянство?',
    'gender': '👤 Яка ваша стать? (чоловіча/жіноча)',
    'linkedin': '💼 Яке ваше LinkedIn URL?',
    'linkedin_url': '💼 Яке ваше LinkedIn URL?',
    'website': '🌐 Яке ваше персональне веб-сайт?',
    'salary_expectation': '💰 Яка ваша очікувана зарплата?',
    'notice_period': '📅 Який ваш термін повідомлення про звільнення?',
    'start_date': '📅 Коли ви можете почати працювати?',
    'availability': '📅 Коли ви доступні для початку роботи?',
    'drivers_license': '🚗 Чи є у вас водійські права? Якщо так, які категорії?',
    'work_permit': '📄 Чи є у вас дозвіл на роботу в Норвегії?',
    'education_year': '🎓 Коли ви закінчили навчання? (рік)',
    'graduation_year': '🎓 Рік випуску з навчального закладу?',
}

def parse_missing_field_from_error(error_message: str) -> str | None:
    """Extract field name from Skyvern error message.

    Examples:
    - "Fill the required postal code field" -> "postal_code"
    - "Missing required field: address" -> "address"
    """
    if not error_message:
        return None

    error_lower = error_message.lower()

    # Pattern 1: "required X field"
    import re
    match = re.search(r'required\s+(\w+(?:\s+\w+)?)\s+field', error_lower)
    if match:
        field = match.group(1).strip().replace(' ', '_')
        return field

    # Pattern 2: "missing field: X" or "missing required field: X"
    match = re.search(r'missing(?:\s+required)?\s+field[:\s]+(\w+)', error_lower)
    if match:
        return match.group(1)

    # Pattern 3: Check for known field names in error
    for field_key in FIELD_QUESTIONS.keys():
        if field_key.replace('_', ' ') in error_lower or field_key in error_lower:
            return field_key

    return None


def get_field_question(field_name: str) -> str:
    """Get user-friendly question for a field."""
    field_lower = field_name.lower().replace(' ', '_')

    # Check exact match
    if field_lower in FIELD_QUESTIONS:
        return FIELD_QUESTIONS[field_lower]

    # Check partial match
    for key, question in FIELD_QUESTIONS.items():
        if key in field_lower or field_lower in key:
            return question

    # Generic question
    return f"❓ Будь ласка, введіть значення для поля '{field_name}':"


async def get_knowledge_base() -> dict:
    """Get all user knowledge base entries as dict."""
    try:
        response = supabase.table("user_knowledge_base").select("*").execute()
        kb_data = {}
        for item in response.data:
            # Store with normalized key
            key = item['question'].lower().replace(' ', '_')
            kb_data[key] = item['answer']
            # Also store original key
            kb_data[item['question']] = item['answer']
        return kb_data
    except Exception as e:
        await log(f"⚠️ Failed to fetch knowledge base: {e}")
        return {}


async def save_to_knowledge_base(field_name: str, answer: str, category: str = "form_fields") -> bool:
    """Save a new answer to the knowledge base."""
    try:
        # Get user_id from first user_settings
        user_response = supabase.table("user_settings").select("user_id").limit(1).execute()
        user_id = user_response.data[0]['user_id'] if user_response.data else None

        if not user_id:
            await log("⚠️ No user found for knowledge base")
            return False

        # Check if already exists
        existing = supabase.table("user_knowledge_base") \
            .select("id") \
            .eq("question", field_name) \
            .execute()

        if existing.data:
            # Update existing
            supabase.table("user_knowledge_base") \
                .update({"answer": answer}) \
                .eq("id", existing.data[0]['id']) \
                .execute()
        else:
            # Insert new
            supabase.table("user_knowledge_base").insert({
                "user_id": user_id,
                "question": field_name,
                "answer": answer,
                "category": category
            }).execute()

        await log(f"💾 Saved to knowledge base: {field_name} = {answer}")
        return True
    except Exception as e:
        await log(f"⚠️ Failed to save to knowledge base: {e}")
        return False


async def ask_user_for_field(chat_id: str, flow_id: str, field_name: str, context: str = "") -> str | None:
    """Ask user for a missing field value via Telegram.

    Returns: The user's answer or None if timeout/cancelled
    """
    question = get_field_question(field_name)

    message = (
        f"❓ <b>Потрібна додаткова інформація</b>\n\n"
        f"{question}\n\n"
    )
    if context:
        message += f"📋 Контекст: {context}\n\n"
    message += f"⏱ Відповідь очікується протягом 5 хвилин"

    # Store pending question in database
    try:
        supabase.table("registration_flows").update({
            "pending_question": field_name,
            "status": "waiting_answer"
        }).eq("id", flow_id).execute()
    except Exception as e:
        await log(f"⚠️ Failed to update flow status: {e}")

    # Send message
    await send_telegram(chat_id, message)
    await log(f"❓ Asked user for: {field_name}", flow_id)

    # Wait for answer (poll database)
    start_time = datetime.now()
    while (datetime.now() - start_time).total_seconds() < QUESTION_TIMEOUT_SECONDS:
        await asyncio.sleep(3)

        try:
            flow = supabase.table("registration_flows") \
                .select("pending_question, qa_history, status") \
                .eq("id", flow_id) \
                .single() \
                .execute()

            if flow.data:
                # Check if answer was provided (bot updates qa_history)
                qa_history = flow.data.get('qa_history', []) or []
                if qa_history:
                    # Find answer for this field
                    for qa in reversed(qa_history):
                        if qa.get('question') == field_name and qa.get('answer'):
                            answer = qa['answer']
                            await log(f"✅ Got answer for {field_name}: {answer}", flow_id)

                            # Save to knowledge base for future use
                            await save_to_knowledge_base(field_name, answer)

                            return answer

                # Check if cancelled
                if flow.data.get('status') == 'cancelled':
                    await log(f"❌ User cancelled", flow_id)
                    return None

        except Exception as e:
            await log(f"⚠️ Poll error: {e}")

    await log(f"⏰ Answer timeout for: {field_name}", flow_id)
    return None


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


async def get_active_profile(user_id: str = None) -> dict:
    """Get active CV profile with structured content for a specific user."""
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
    except Exception as e:
        await log(f"⚠️ Failed to fetch profile: {e}")
        return {}


async def get_telegram_chat_id(user_id: str = None) -> str | None:
    """Get Telegram chat ID from user settings for a specific user."""
    try:
        query = supabase.table("user_settings") \
            .select("telegram_chat_id")
        if user_id:
            query = query.eq("user_id", user_id)
        response = query.limit(1).execute()

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
    application_id: str = None,
    user_id: str = None
) -> str | None:
    """Create a new registration flow. Returns flow ID."""
    try:
        chat_id = await get_telegram_chat_id(user_id)
        profile = await get_active_profile(user_id)

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
    """Extract registration-relevant data from CV profile.

    IMPORTANT: This extracts ALL data from the profile structure.
    The profile has nested structures that need to be handled:
    - personalInfo.address is an object {city, country, postalCode, street}
    - workExperience[].position (not title)
    """
    structured = profile.get('structured_content', {}) or {}
    personal_info = structured.get('personalInfo', {}) or {}

    # Handle nested address structure
    address_info = personal_info.get('address', {})
    if isinstance(address_info, dict):
        city = address_info.get('city', '')
        postal_code = address_info.get('postalCode', '')
        country = address_info.get('country', 'Norge')
        street = address_info.get('street', '')
    else:
        # Fallback if address is a string
        city = personal_info.get('city', '')
        postal_code = personal_info.get('postalCode', '')
        country = personal_info.get('country', 'Norge')
        street = str(address_info) if address_info else ''

    # Basic info
    data = {
        "full_name": personal_info.get('fullName', '') or personal_info.get('name', ''),
        "email": personal_info.get('email', ''),
        "phone": personal_info.get('phone', ''),
        "address": street,
        "city": city,
        "postal_code": postal_code,
        "country": country,
        "birth_date": personal_info.get('birthDate', ''),
        "nationality": personal_info.get('nationality', ''),
        "website": personal_info.get('website', ''),
    }

    # Split name
    name_parts = data['full_name'].split(' ', 1)
    data['first_name'] = name_parts[0] if len(name_parts) > 0 else ''
    data['last_name'] = name_parts[1] if len(name_parts) > 1 else ''

    # Work experience - get latest job (position field, not title!)
    work_exp = structured.get('workExperience', []) or []
    if work_exp:
        latest_job = work_exp[0] if isinstance(work_exp, list) else {}
        # Note: field is 'position', not 'title'
        data['current_position'] = latest_job.get('position', '') or latest_job.get('title', '')
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


async def monitor_registration_task(flow_id: str, task_id: str,
                                     chat_id: str = None, site_name: str = None,
                                     mask_values: list = None) -> dict:
    """Monitor Skyvern task and handle intermediate states.

    Args:
        flow_id: Registration flow ID
        task_id: Skyvern task ID
        chat_id: Telegram chat ID for step-by-step reporting
        site_name: Site name for dashboard display
        mask_values: List of sensitive values to mask (e.g. passwords)

    Returns result dict with status and extracted data.
    """
    await log(f"⏳ Monitoring registration task...", flow_id)

    headers = {}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    # Step-by-step reporting state
    seen_step_count = 0
    all_filled_fields = []
    dashboard_msg_id = None

    if chat_id:
        dashboard_text = format_registration_dashboard(
            site_name or "Site", task_id, 0, [], "running"
        )
        dashboard_msg_id = await send_telegram(chat_id, dashboard_text)

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
                        # Final dashboard update
                        if chat_id and dashboard_msg_id:
                            final_text = format_registration_dashboard(
                                site_name or "Site", task_id,
                                seen_step_count, all_filled_fields, "completed"
                            )
                            await edit_telegram_message(chat_id, dashboard_msg_id, final_text)
                        return {
                            "success": True,
                            "status": "completed",
                            "data": extracted
                        }

                    if status in ['failed', 'terminated']:
                        reason = data.get('failure_reason', 'Unknown')
                        await log(f"❌ Registration task failed: {reason}", flow_id)

                        # Final dashboard update (failed)
                        if chat_id and dashboard_msg_id:
                            final_text = format_registration_dashboard(
                                site_name or "Site", task_id,
                                seen_step_count, all_filled_fields, "failed"
                            )
                            await edit_telegram_message(chat_id, dashboard_msg_id, final_text)

                        # Check if this is a missing field error
                        missing_field = parse_missing_field_from_error(reason)
                        if missing_field:
                            await log(f"🔍 Detected missing field: {missing_field}", flow_id)

                            # Return with missing field info for retry
                            return {
                                "success": False,
                                "status": "missing_field",
                                "missing_field": missing_field,
                                "error": reason,
                                "data": extracted
                            }

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
                        # Return first missing field for user input
                        if missing:
                            return {
                                "success": False,
                                "status": "missing_field",
                                "missing_field": missing[0],
                                "all_missing": missing,
                                "data": extracted
                            }

                    # --- Step-by-step reporting ---
                    if chat_id:
                        steps = await fetch_task_steps(client, task_id, headers)
                        if len(steps) > seen_step_count:
                            new_steps = steps[seen_step_count:]
                            for i, step in enumerate(new_steps):
                                step_num = seen_step_count + i + 1
                                report = format_step_report(step, step_num, len(steps), mask_values)

                                # Collect filled fields from this step
                                step_output = step.get("output", {}) or {}
                                for ar in (step_output.get("action_results", []) or []):
                                    at = (ar.get("action_type", "") or ar.get("type", "")).lower()
                                    if at in ("input_text", "fill", "send_keys"):
                                        val = ar.get("data", {}).get("text", "") if isinstance(ar.get("data"), dict) else ""
                                        if not val:
                                            val = ar.get("text", "")
                                        if val:
                                            if mask_values and any(v and v in val for v in mask_values):
                                                all_filled_fields.append("••••••••")
                                            else:
                                                display = val[:40] + "..." if len(val) > 40 else val
                                                all_filled_fields.append(display)

                                await send_telegram(chat_id, report)

                            seen_step_count = len(steps)

                            # Update dashboard
                            if dashboard_msg_id:
                                dashboard_text = format_registration_dashboard(
                                    site_name or "Site", task_id,
                                    seen_step_count, all_filled_fields, "running"
                                )
                                await edit_telegram_message(chat_id, dashboard_msg_id, dashboard_text)

                await asyncio.sleep(5)

            except Exception as e:
                await log(f"⚠️ Monitoring error: {e}", flow_id)
                await asyncio.sleep(5)


# ============================================
# REGISTRATION CONFIRMATION FLOW
# ============================================

REGISTRATION_CONFIRMATION_TIMEOUT = 300  # 5 minutes

async def send_registration_confirmation(
    flow_id: str,
    chat_id: str,
    site_name: str,
    registration_url: str,
    email: str,
    profile_data: dict
) -> str:
    """Send registration confirmation to Telegram with all data.

    Shows ALL fields that will be filled during registration.
    User can Confirm, Cancel, or Edit.

    Returns: 'confirmed', 'cancelled', 'timeout', or 'edited'
    """
    await log(f"📤 Sending registration confirmation to Telegram", flow_id)

    # Build comprehensive message with ALL data
    message = (
        f"📋 <b>Підтвердження реєстрації</b>\n\n"
        f"🏢 Сайт: <b>{site_name}</b>\n"
        f"🔗 {registration_url}\n\n"
        f"<b>━━━ Дані для реєстрації ━━━</b>\n\n"
        f"📧 <b>Email:</b> <code>{email}</code>\n"
        f"👤 <b>Ім'я:</b> <code>{profile_data.get('full_name', '—')}</code>\n"
        f"📱 <b>Телефон:</b> <code>{profile_data.get('phone', '—')}</code>\n"
        f"🏠 <b>Місто:</b> <code>{profile_data.get('city', '—')}</code>\n"
        f"📮 <b>Індекс:</b> <code>{profile_data.get('postal_code', '—')}</code>\n"
        f"🌍 <b>Країна:</b> <code>{profile_data.get('country', 'Norge')}</code>\n\n"
    )

    # Add work experience if available
    if profile_data.get('current_position') or profile_data.get('current_company'):
        message += (
            f"<b>━━━ Досвід роботи ━━━</b>\n\n"
            f"💼 <b>Посада:</b> <code>{profile_data.get('current_position', '—')}</code>\n"
            f"🏛 <b>Компанія:</b> <code>{profile_data.get('current_company', '—')}</code>\n\n"
        )

    # Add education if available
    if profile_data.get('education_level') or profile_data.get('education_school'):
        message += (
            f"<b>━━━ Освіта ━━━</b>\n\n"
            f"🎓 <b>Рівень:</b> <code>{profile_data.get('education_level', '—')}</code>\n"
            f"📚 <b>Напрямок:</b> <code>{profile_data.get('education_field', '—')}</code>\n"
            f"🏫 <b>Заклад:</b> <code>{profile_data.get('education_school', '—')}</code>\n\n"
        )

    # Add languages if available
    languages = profile_data.get('languages', [])
    if languages:
        lang_str = ', '.join(languages[:5])  # Max 5 languages
        message += f"🌐 <b>Мови:</b> <code>{lang_str}</code>\n\n"

    # Add skills if available
    skills = profile_data.get('skills', [])
    if skills:
        skills_str = ', '.join(skills[:10])  # Max 10 skills
        message += f"🛠 <b>Навички:</b> <code>{skills_str}</code>\n\n"

    message += (
        f"<b>━━━━━━━━━━━━━━━━━━━━━━━━</b>\n\n"
        f"⏱ Таймаут: 5 хвилин\n\n"
        f"✅ <b>Підтвердити</b> — почати реєстрацію з цими даними\n"
        f"✏️ <b>Редагувати</b> — змінити дані перед реєстрацією\n"
        f"❌ <b>Скасувати</b> — не реєструватись"
    )

    # Keyboard with Confirm/Edit/Cancel buttons
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Підтвердити", "callback_data": f"reg_confirm_{flow_id}"},
                {"text": "✏️ Редагувати", "callback_data": f"reg_edit_{flow_id}"}
            ],
            [
                {"text": "❌ Скасувати", "callback_data": f"reg_cancel_{flow_id}"}
            ]
        ]
    }

    # Update flow with profile_data and status
    await update_flow_status(
        flow_id,
        "waiting_confirmation",
        profile_data_snapshot=profile_data,
        confirmation_sent_at=datetime.now().isoformat(),
        confirmation_expires_at=(datetime.now() + timedelta(seconds=REGISTRATION_CONFIRMATION_TIMEOUT)).isoformat()
    )

    # Send message
    msg_id = await send_telegram(chat_id, message, keyboard)

    if msg_id:
        await update_flow_status(flow_id, "waiting_confirmation", telegram_message_id=msg_id)

    # Wait for user response (poll database)
    return await wait_for_registration_confirmation(flow_id)


async def wait_for_registration_confirmation(flow_id: str) -> str:
    """Wait for user to confirm, cancel, or edit registration.

    Returns: 'confirmed', 'cancelled', 'timeout', or 'edited'
    """
    await log(f"⏳ Waiting for registration confirmation", flow_id)

    start_time = datetime.now()
    poll_interval = 3  # seconds

    while (datetime.now() - start_time).total_seconds() < REGISTRATION_CONFIRMATION_TIMEOUT:
        await asyncio.sleep(poll_interval)

        try:
            flow = await get_flow(flow_id)
            if flow:
                status = flow.get('status')

                if status == 'confirmed':
                    await log(f"✅ User confirmed registration", flow_id)
                    # Check if there was edited data
                    if flow.get('edited_profile_data'):
                        return 'edited'  # Signal that data was edited
                    return 'confirmed'

                if status == 'cancelled':
                    await log(f"❌ User cancelled registration", flow_id)
                    return 'cancelled'

                # Continue waiting if user is editing
                if status in ['editing', 'editing_field']:
                    # Reset start time while user is actively editing
                    start_time = datetime.now()
                    continue

        except Exception as e:
            await log(f"⚠️ Error checking confirmation: {e}", flow_id)

    # Timeout
    await log(f"⏰ Registration confirmation timeout", flow_id)
    return 'timeout'


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

    # Get user_id from linked application
    user_id = None
    app_id = flow.get('application_id')
    if app_id:
        try:
            app_res = supabase.table("applications").select("user_id").eq("id", app_id).single().execute()
            user_id = app_res.data.get('user_id') if app_res.data else None
        except Exception as e:
            await log(f"⚠️ Failed to get user_id from application: {e}", flow_id)
    if not user_id:
        job_id = flow.get('job_id')
        if job_id:
            try:
                job_res = supabase.table("jobs").select("user_id").eq("id", job_id).single().execute()
                user_id = job_res.data.get('user_id') if job_res.data else None
            except Exception:
                pass

    await log(f"🚀 Starting registration on {site_name}", flow_id)
    await log(f"   URL: {registration_url}", flow_id)
    await log(f"   Email: {email}", flow_id)
    await log(f"   user_id: {user_id or 'UNKNOWN'}", flow_id)

    # Get profile data FIRST (filtered by user_id)
    profile = await get_active_profile(user_id)
    profile_data = extract_profile_data(profile)

    # === CONFIRMATION FLOW ===
    # Send ALL data to Telegram for user confirmation BEFORE starting
    if chat_id:
        confirmation_result = await send_registration_confirmation(
            flow_id=flow_id,
            chat_id=chat_id,
            site_name=site_name,
            registration_url=registration_url,
            email=email,
            profile_data=profile_data
        )

        if confirmation_result == 'cancelled':
            await log(f"❌ User cancelled registration", flow_id)
            await update_flow_status(flow_id, "cancelled")
            return

        if confirmation_result == 'timeout':
            await log(f"⏰ Registration confirmation timeout", flow_id)
            await update_flow_status(flow_id, "failed", error_message="Confirmation timeout")
            return

        # Check if user edited data
        if confirmation_result == 'edited':
            # Reload flow to get edited profile_data
            flow = await get_flow(flow_id)
            if flow and flow.get('edited_profile_data'):
                profile_data = flow.get('edited_profile_data')
                await log(f"📝 Using edited profile data", flow_id)

    # Update status
    await update_flow_status(flow_id, "registering", started_at=datetime.now().isoformat())

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
    result = await monitor_registration_task(
        flow_id, task_id, chat_id=chat_id, site_name=site_name,
        mask_values=[password]
    )

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

            # Re-queue linked application for processing
            app_id = flow.get('application_id')
            if app_id:
                try:
                    supabase.table("applications").update({
                        "status": "sending"
                    }).eq("id", app_id).eq("status", "manual_review").execute()
                    await log(f"📬 Re-queued application {app_id[:8]}", flow_id)
                except Exception as e:
                    await log(f"⚠️ Failed to re-queue application: {e}", flow_id)

            if chat_id:
                await send_telegram(chat_id,
                    f"✅ <b>Реєстрація на {site_name} завершена!</b>\n\n"
                    f"📧 Email: <code>{email}</code>\n"
                    f"🔐 Пароль: <tg-spoiler>{password}</tg-spoiler>\n\n"
                    f"Тепер можна подаватись на вакансії цього сайту автоматично!"
                )
        else:
            await update_flow_status(flow_id, "failed", error_message="Failed to save credentials")

    else:
        # Check if this is a missing field error - we can retry!
        if result.get('status') == 'missing_field':
            missing_field = result.get('missing_field')
            await log(f"❓ Missing field detected: {missing_field}", flow_id)

            if chat_id and missing_field:
                # First check knowledge base
                kb_data = await get_knowledge_base()
                kb_key = missing_field.lower().replace(' ', '_')

                if kb_key in kb_data:
                    # Found in knowledge base - use it!
                    answer = kb_data[kb_key]
                    await log(f"📚 Found in knowledge base: {missing_field} = {answer}", flow_id)
                    profile_data[kb_key] = answer
                    profile_data[missing_field] = answer
                else:
                    # Ask user
                    answer = await ask_user_for_field(
                        chat_id=chat_id,
                        flow_id=flow_id,
                        field_name=missing_field,
                        context=f"Реєстрація на {site_name}"
                    )

                    if answer:
                        profile_data[kb_key] = answer
                        profile_data[missing_field] = answer
                        await log(f"✅ Got answer: {missing_field} = {answer}", flow_id)
                    else:
                        # User didn't respond - fail
                        await update_flow_status(flow_id, "failed", error_message=f"No answer for: {missing_field}")
                        await send_telegram(chat_id,
                            f"⏰ <b>Час вичерпано</b>\n\n"
                            f"Не отримано відповідь на питання: {missing_field}\n"
                            f"Спробуйте знову."
                        )
                        return

                # RETRY with updated data!
                await log(f"🔄 Retrying registration with updated data...", flow_id)
                await update_flow_status(flow_id, "registering")

                task_id = await trigger_registration_task(
                    flow_id, registration_url, profile_data, email, password
                )

                if task_id:
                    await update_flow_status(flow_id, "registering", skyvern_task_id=task_id)
                    retry_result = await monitor_registration_task(
                        flow_id, task_id, chat_id=chat_id, site_name=site_name,
                        mask_values=[password]
                    )

                    if retry_result.get('success'):
                        # Success after retry!
                        extracted = retry_result.get('data', {})
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
                            await log(f"✅ Registration completed after retry!", flow_id)

                            # Re-queue linked application for processing
                            app_id = flow.get('application_id')
                            if app_id:
                                try:
                                    supabase.table("applications").update({
                                        "status": "sending"
                                    }).eq("id", app_id).eq("status", "manual_review").execute()
                                    await log(f"📬 Re-queued application {app_id[:8]}", flow_id)
                                except Exception as e:
                                    await log(f"⚠️ Failed to re-queue application: {e}", flow_id)

                            await send_telegram(chat_id,
                                f"✅ <b>Реєстрація на {site_name} завершена!</b>\n\n"
                                f"📧 Email: <code>{email}</code>\n"
                                f"🔐 Пароль: <tg-spoiler>{password}</tg-spoiler>\n\n"
                                f"Тепер можна подаватись автоматично!"
                            )
                            return
                    else:
                        # Still failing after retry
                        retry_error = retry_result.get('error', 'Retry failed')
                        await log(f"❌ Retry also failed: {retry_error}", flow_id)

        # Final failure
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
