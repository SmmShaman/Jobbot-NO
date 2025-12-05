#!/usr/bin/env python3
"""
FINN Apply Worker - Polls database for pending FINN applications and submits via Skyvern.

This worker runs locally and has access to the local Skyvern instance.
It polls the database for applications with status='sending' and finn_apply=true,
then uses Skyvern to log in to FINN and submit the application.

Usage:
    python finn_apply_worker.py
"""

import asyncio
import os
import json
import httpx
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
SKYVERN_URL = os.getenv("SKYVERN_API_URL", "http://localhost:8000")
SKYVERN_API_KEY = os.getenv("SKYVERN_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://ptrmidlhfdbybxmyovtm.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
FINN_EMAIL = os.getenv("FINN_EMAIL", "")
FINN_PASSWORD = os.getenv("FINN_PASSWORD", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

POLL_INTERVAL = 10  # seconds


def log(msg: str):
    """Simple logging with timestamp."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")


async def send_telegram(chat_id: str, text: str):
    """Send a Telegram message."""
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML"
                },
                timeout=10.0
            )
    except Exception as e:
        log(f"⚠️ Telegram error: {e}")


async def get_pending_finn_applications() -> list:
    """Get applications that need FINN submission."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient() as client:
            # Get applications with status=sending and finn_apply=true in metadata
            response = await client.get(
                f"{SUPABASE_URL}/rest/v1/applications",
                params={
                    "status": "eq.sending",
                    "select": "*,jobs(*)",
                    "order": "created_at.asc",
                    "limit": "5"
                },
                headers=headers,
                timeout=10.0
            )

            if response.status_code != 200:
                log(f"❌ API error: {response.text}")
                return []

            applications = response.json()

            # Filter for FINN apply jobs
            finn_apps = []
            for app in applications:
                metadata = app.get("skyvern_metadata") or {}
                job = app.get("jobs") or {}
                external_url = job.get("external_apply_url", "")

                # Check if this is a FINN Easy Apply
                if "finn.no/job/apply" in external_url:
                    finn_apps.append(app)

            return finn_apps

    except Exception as e:
        log(f"❌ Error fetching applications: {e}")
        return []


async def get_user_telegram_chat(user_id: str) -> str | None:
    """Get user's Telegram chat ID."""
    if not user_id:
        return None

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SUPABASE_URL}/rest/v1/user_settings",
                params={
                    "user_id": f"eq.{user_id}",
                    "select": "telegram_chat_id",
                    "limit": "1"
                },
                headers=headers,
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                if data:
                    return data[0].get("telegram_chat_id")
    except Exception:
        pass

    return None


async def get_active_profile() -> dict:
    """Get active CV profile."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SUPABASE_URL}/rest/v1/cv_profiles",
                params={
                    "is_active": "eq.true",
                    "select": "*",
                    "limit": "1"
                },
                headers=headers,
                timeout=10.0
            )

            if response.status_code == 200:
                data = response.json()
                if data:
                    return data[0]
    except Exception:
        pass

    return {}


async def update_application_status(app_id: str, status: str, metadata: dict = None):
    """Update application status in database."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    update_data = {"status": status}
    if metadata:
        update_data["skyvern_metadata"] = metadata

    try:
        async with httpx.AsyncClient() as client:
            await client.patch(
                f"{SUPABASE_URL}/rest/v1/applications",
                params={"id": f"eq.{app_id}"},
                headers=headers,
                json=update_data,
                timeout=10.0
            )
    except Exception as e:
        log(f"❌ Error updating application: {e}")


async def submit_finn_application(app: dict) -> dict:
    """Submit application to FINN via Skyvern."""
    job = app.get("jobs", {})
    finn_url = job.get("external_apply_url", "")
    cover_letter = app.get("cover_letter_no", "") or app.get("cover_letter_uk", "")

    if not finn_url:
        return {"success": False, "error": "No FINN apply URL"}

    if not FINN_EMAIL or not FINN_PASSWORD:
        return {"success": False, "error": "FINN credentials not configured"}

    # Get profile for form filling
    profile = await get_active_profile()
    profile_data = profile.get("structured_content", {}) or {}
    personal_info = profile_data.get("personalInfo", {}) or profile_data

    contact_info = {
        "name": personal_info.get("name", ""),
        "email": FINN_EMAIL,
        "phone": personal_info.get("phone", "")
    }

    # Build Skyvern task
    totp_webhook_url = f"{SUPABASE_URL}/functions/v1/finn-2fa-webhook"

    navigation_goal = f"""
GOAL: Submit a job application on FINN.no Enkel Søknad.

STEP 1: Navigate to {finn_url}

STEP 2: If prompted to log in:
   - Go to FINN.no login (Schibsted/Vend)
   - Enter email: {FINN_EMAIL}
   - Click "Neste" / "Continue"
   - Enter password (from navigation_payload)
   - Click "Logg inn"
   - If 2FA code is requested, wait for the system to provide it via webhook
   - Enter the 2FA code when received
   - Complete login

STEP 3: Once logged in and on the application page, fill the form:
   - Name field: {contact_info['name']}
   - Email field: {contact_info['email']}
   - Phone field: {contact_info['phone']}
   - Cover letter / Message / Søknadstekst field: Enter the following text:

{cover_letter}

STEP 4: Review the form to ensure all required fields are filled.

STEP 5: Look for and click the "Send søknad" or "Send application" button.

STEP 6: Wait for confirmation that the application was sent.

IMPORTANT:
- Accept any cookie popups
- If there are checkboxes for terms/conditions, check them
- Do NOT close the browser until confirmation is received
"""

    data_extraction_schema = {
        "type": "object",
        "properties": {
            "application_sent": {
                "type": "boolean",
                "description": "True if the application was successfully submitted"
            },
            "confirmation_message": {
                "type": "string",
                "description": "The confirmation message shown after submission"
            },
            "error_message": {
                "type": "string",
                "description": "Any error message if submission failed"
            }
        }
    }

    payload = {
        "url": finn_url,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Determine if the application was successfully submitted.",
        "data_extraction_schema": data_extraction_schema,
        "navigation_payload": {
            "email": FINN_EMAIL,
            "password": FINN_PASSWORD,
            "name": contact_info["name"],
            "phone": contact_info["phone"],
            "cover_letter": cover_letter
        },
        "totp_verification_url": totp_webhook_url,
        "totp_identifier": FINN_EMAIL,
        "max_steps": 35,
        "proxy_location": "RESIDENTIAL"
    }

    headers = {"Content-Type": "application/json"}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    try:
        async with httpx.AsyncClient() as client:
            log(f"🚀 Calling Skyvern for FINN apply: {finn_url}")

            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code != 200:
                return {"success": False, "error": f"Skyvern error: {response.text}"}

            data = response.json()
            task_id = data.get("task_id")

            log(f"✅ Skyvern task created: {task_id}")
            return {"success": True, "task_id": task_id}

    except httpx.ConnectError:
        return {"success": False, "error": "Cannot connect to Skyvern. Is it running?"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def process_application(app: dict):
    """Process a single FINN application."""
    app_id = app.get("id")
    job = app.get("jobs", {})
    job_title = job.get("title", "Unknown")
    user_id = job.get("user_id")

    log(f"📋 Processing: {job_title}")

    # Get user's Telegram for notifications
    chat_id = await get_user_telegram_chat(user_id)

    # Notify start
    if chat_id:
        await send_telegram(chat_id,
            f"🚀 <b>Починаю подачу на FINN</b>\n\n"
            f"📋 {job_title}\n"
            f"⏳ Очікуйте код 2FA на пошту!\n\n"
            f"Коли отримаєте код, надішліть:\n"
            f"<code>/code XXXXXX</code>"
        )

    # Submit to FINN via Skyvern
    result = await submit_finn_application(app)

    if result.get("success"):
        task_id = result.get("task_id")

        # Update application with task info
        await update_application_status(app_id, "sending", {
            "task_id": task_id,
            "source": "finn_worker",
            "finn_apply": True,
            "started_at": datetime.now().isoformat()
        })

        log(f"✅ Task started: {task_id}")

        if chat_id:
            await send_telegram(chat_id,
                f"✅ <b>Skyvern запущено!</b>\n\n"
                f"🔑 Task: <code>{task_id}</code>\n"
                f"🔗 <a href='http://localhost:8080/tasks/{task_id}'>Переглянути в Skyvern</a>\n\n"
                f"⏳ Очікуйте код 2FA!"
            )
    else:
        error = result.get("error", "Unknown error")
        log(f"❌ Failed: {error}")

        # Mark as failed
        await update_application_status(app_id, "failed", {
            "error": error,
            "finn_apply": True,
            "failed_at": datetime.now().isoformat()
        })

        if chat_id:
            await send_telegram(chat_id,
                f"❌ <b>Помилка подачі на FINN</b>\n\n"
                f"📋 {job_title}\n"
                f"⚠️ {error}"
            )


async def check_skyvern_health() -> bool:
    """Check if Skyvern is running."""
    try:
        headers = {"x-api-key": SKYVERN_API_KEY} if SKYVERN_API_KEY else {}
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SKYVERN_URL}/api/v1/tasks",
                headers=headers,
                timeout=5.0
            )
            return response.status_code == 200
    except Exception:
        return False


async def main():
    """Main worker loop."""
    log("🤖 FINN Apply Worker starting...")

    # Check configuration
    if not SUPABASE_KEY:
        log("❌ SUPABASE_SERVICE_KEY not configured!")
        return

    if not FINN_EMAIL or not FINN_PASSWORD:
        log("⚠️ FINN_EMAIL and FINN_PASSWORD not configured!")
        log("   Set them in worker/.env")

    # Check Skyvern
    if not await check_skyvern_health():
        log("❌ Skyvern is not running!")
        log("   Start it with: docker compose up -d")
        return

    log("✅ Skyvern is running")
    log(f"📡 Polling every {POLL_INTERVAL}s for FINN applications...")

    while True:
        try:
            # Get pending applications
            applications = await get_pending_finn_applications()

            if applications:
                log(f"📬 Found {len(applications)} pending FINN application(s)")

                for app in applications:
                    await process_application(app)

        except Exception as e:
            log(f"❌ Worker error: {e}")

        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
