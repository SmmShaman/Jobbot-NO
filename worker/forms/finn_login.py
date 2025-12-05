#!/usr/bin/env python3
"""
FINN.no Login with Skyvern and 2FA via Telegram

This script handles authentication to FINN.no using Skyvern browser automation.
When 2FA is required, it uses a webhook to request the code via Telegram.

Usage:
    python finn_login.py --email user@example.com
    python finn_login.py --test  (test connection only)
"""

import asyncio
import sys
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
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# FINN credentials (stored in Skyvern Credentials or here)
FINN_EMAIL = os.getenv("FINN_EMAIL", "")
FINN_PASSWORD = os.getenv("FINN_PASSWORD", "")


def log(msg: str):
    """Simple logging with timestamp."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")


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


async def finn_login(email: str, password: str) -> dict:
    """
    Login to FINN.no using Skyvern with 2FA webhook support.

    Args:
        email: FINN account email
        password: FINN account password

    Returns:
        dict with success status and session info
    """

    # Build the webhook URL for 2FA
    totp_webhook_url = f"{SUPABASE_URL}/functions/v1/finn-2fa-webhook"

    navigation_goal = """
    GOAL: Log in to FINN.no with email and password. Handle 2FA if prompted.

    STEP 1: Go to https://www.finn.no/

    STEP 2: Click "Logg inn" button (usually top right corner)

    STEP 3: You will be redirected to Schibsted login page.
            Enter the email address in the email field.
            Click "Neste" or "Continue".

    STEP 4: Enter the password in the password field.
            Click "Logg inn" or "Sign in".

    STEP 5: If 2FA verification is requested:
            - A code will be sent to email/SMS
            - The system will automatically get the code via webhook
            - Enter the code when received
            - Click verify/confirm

    STEP 6: Wait for redirect back to FINN.no
            Verify you are logged in (look for profile icon or name)

    IMPORTANT:
    - Handle any cookie popups by accepting
    - If login fails, report the error message
    - Do NOT proceed to any job applications - just login
    """

    data_extraction_schema = {
        "type": "object",
        "properties": {
            "login_success": {
                "type": "boolean",
                "description": "True if successfully logged in to FINN"
            },
            "user_name": {
                "type": "string",
                "description": "The logged-in user's name if visible"
            },
            "error_message": {
                "type": "string",
                "description": "Any error message shown during login"
            },
            "required_2fa": {
                "type": "boolean",
                "description": "True if 2FA verification was required"
            }
        }
    }

    payload = {
        "url": "https://www.finn.no/",
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Determine if login was successful. Report any errors.",
        "data_extraction_schema": data_extraction_schema,
        "navigation_payload": {
            "email": email,
            "password": password
        },
        "totp_verification_url": totp_webhook_url,
        "totp_identifier": email,
        "max_steps": 25,
        "proxy_location": "RESIDENTIAL"
    }

    headers = {"Content-Type": "application/json"}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    try:
        async with httpx.AsyncClient() as client:
            log(f"🚀 Starting FINN login for: {email}")
            log(f"🔗 2FA Webhook: {totp_webhook_url}")

            # Create task
            response = await client.post(
                f"{SKYVERN_URL}/api/v1/tasks",
                json=payload,
                headers=headers,
                timeout=30.0
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Skyvern API error: {response.text}"
                }

            task_data = response.json()
            task_id = task_data.get("task_id")
            log(f"✅ Task created: {task_id}")

            # Poll for completion (longer timeout for 2FA)
            result = await wait_for_login_completion(client, task_id, headers, timeout_seconds=360)
            return result

    except httpx.ConnectError:
        return {
            "success": False,
            "error": "Cannot connect to Skyvern. Is it running?"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


async def wait_for_login_completion(client: httpx.AsyncClient, task_id: str, headers: dict, timeout_seconds: int = 360) -> dict:
    """Poll Skyvern task status until completion."""
    start_time = datetime.now()

    while True:
        elapsed = (datetime.now() - start_time).total_seconds()
        if elapsed > timeout_seconds:
            return {
                "success": False,
                "error": f"Task timed out after {timeout_seconds}s"
            }

        try:
            response = await client.get(
                f"{SKYVERN_URL}/api/v1/tasks/{task_id}",
                headers=headers,
                timeout=10.0
            )

            if response.status_code != 200:
                await asyncio.sleep(5)
                continue

            data = response.json()
            status = data.get("status", "").lower()

            log(f"⏳ Task status: {status} ({int(elapsed)}s)")

            if status == "completed":
                extracted_data = data.get("extracted_information", {}) or {}
                log(f"📦 Extracted: {extracted_data}")

                login_success = extracted_data.get("login_success", False)
                user_name = extracted_data.get("user_name", "")
                error_message = extracted_data.get("error_message", "")
                required_2fa = extracted_data.get("required_2fa", False)

                if login_success:
                    log(f"✅ Login successful! User: {user_name}")
                else:
                    log(f"❌ Login failed: {error_message}")

                return {
                    "success": login_success,
                    "user_name": user_name,
                    "error": error_message if not login_success else None,
                    "required_2fa": required_2fa,
                    "task_id": task_id
                }

            elif status in ["failed", "terminated"]:
                failure_reason = data.get("failure_reason", "Unknown error")
                log(f"❌ Task {status}: {failure_reason}")
                return {
                    "success": False,
                    "error": failure_reason,
                    "task_id": task_id
                }

            # Still running
            await asyncio.sleep(5)

        except Exception as e:
            log(f"⚠️ Poll error: {e}")
            await asyncio.sleep(5)


async def main():
    """Main entry point."""

    # Check Skyvern
    if not await check_skyvern_health():
        log("❌ Skyvern is not running!")
        log("   Start it with: docker compose up -d")
        return

    log("✅ Skyvern is running")

    # Parse arguments
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python finn_login.py --email user@example.com")
        print("  python finn_login.py --test")
        return

    if sys.argv[1] == "--test":
        log("✅ Connection test passed")
        return

    if sys.argv[1] == "--email" and len(sys.argv) > 2:
        email = sys.argv[2]
        password = FINN_PASSWORD

        if not password:
            log("❌ FINN_PASSWORD not set in .env")
            return

        result = await finn_login(email, password)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        # Use default from .env
        if not FINN_EMAIL or not FINN_PASSWORD:
            log("❌ FINN_EMAIL and FINN_PASSWORD must be set in .env")
            return

        result = await finn_login(FINN_EMAIL, FINN_PASSWORD)
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
