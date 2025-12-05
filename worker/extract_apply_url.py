#!/usr/bin/env python3
"""
Skyvern-based URL Extractor for Job Applications
Clicks on "Søk her" (FINN) or "Gå til søknad" (NAV) buttons
and extracts the final external application URL.

Usage:
    python extract_apply_url.py <job_url>
    python extract_apply_url.py --daemon  (listens for jobs in DB)
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

# --- CONFIGURATION ---
SKYVERN_URL = os.getenv("SKYVERN_API_URL", "http://localhost:8000")
SKYVERN_API_KEY = os.getenv("SKYVERN_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def log(msg: str):
    """Simple logging with timestamp."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")


async def check_skyvern_health() -> bool:
    """Check if Skyvern is running by calling the tasks endpoint with auth."""
    try:
        headers = {}
        if SKYVERN_API_KEY:
            headers["x-api-key"] = SKYVERN_API_KEY

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SKYVERN_URL}/api/v1/tasks",
                headers=headers,
                timeout=5.0
            )
            return response.status_code == 200
    except Exception:
        return False


async def extract_apply_url_skyvern(job_url: str, source: str = "FINN") -> dict:
    """
    Uses Skyvern to click on apply button and extract the final URL.

    Args:
        job_url: The job listing URL (FINN.no or NAV.no)
        source: "FINN" or "NAV"

    Returns:
        dict with keys: success, external_url, form_type, error
    """

    # Define navigation goal based on source
    if source == "NAV" or "nav.no" in job_url.lower():
        navigation_goal = """
        GOAL: Find and click the apply button to reveal the external application URL.

        PHASE 1: HANDLE POPUPS
        1. If any cookie/consent popup appears, click "Godta" or "Aksepter".

        PHASE 2: FIND APPLY BUTTON
        2. Look for a button or link with text:
           - "Gå til søknad" (primary)
           - "Søk på stillingen"
           - "Søk her"
           - "Søk nå"
        3. The button is usually GREEN or BLUE, located in the job details area.

        PHASE 3: CLICK AND WAIT
        4. Click the button.
        5. Wait for page navigation or new tab.
        6. Record the final URL you land on.

        IMPORTANT: Do NOT fill any forms. Just navigate to the application page.
        """
    else:  # FINN
        navigation_goal = """
        GOAL: Find and click the "Søk her" button to reveal the external application URL.

        PHASE 1: HANDLE POPUPS
        1. If Schibsted/FINN cookie popup appears, click "Godta alle" or "Jeg forstår".

        PHASE 2: FIND APPLY BUTTON
        2. Look at the TOP RIGHT area or sidebar for a BLUE button.
        3. Button text variations:
           - "Søk her" (most common)
           - "Søk her (åpnes i en ny fane)"
           - "Søk på stillingen"
           - "Send søknad"
        4. If text says "Enkel søknad" - this is FINN's internal form, note it.

        PHASE 3: CLICK AND WAIT
        5. Click the apply button.
        6. Wait for redirect or new page to load.
        7. Record the final URL.

        IMPORTANT: Do NOT fill any forms. Just navigate to get the URL.
        """

    # Data extraction schema - we want the final URL
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "final_url": {
                "type": "string",
                "description": "The URL of the page after clicking the apply button"
            },
            "button_text": {
                "type": "string",
                "description": "The text on the apply button that was clicked"
            },
            "is_finn_internal": {
                "type": "boolean",
                "description": "True if the button was 'Enkel søknad' (FINN internal form)"
            },
            "page_title": {
                "type": "string",
                "description": "The title of the application page"
            }
        },
        "required": ["final_url"]
    }

    payload = {
        "url": job_url,
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Extract the URL of the application page after clicking the apply button. Also note if this is FINN's internal 'Enkel søknad' form.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 30,  # Fewer steps needed - just clicking one button
        "proxy_location": "RESIDENTIAL"
    }

    headers = {"Content-Type": "application/json"}
    if SKYVERN_API_KEY:
        headers["x-api-key"] = SKYVERN_API_KEY

    try:
        async with httpx.AsyncClient() as client:
            log(f"🚀 Sending task to Skyvern for: {job_url}")

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

            # Poll for completion
            result = await wait_for_task_completion(client, task_id, headers)
            return result

    except httpx.ConnectError:
        return {
            "success": False,
            "error": "Cannot connect to Skyvern. Is it running on localhost:8000?"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


async def wait_for_task_completion(client: httpx.AsyncClient, task_id: str, headers: dict, timeout_seconds: int = 120) -> dict:
    """
    Polls Skyvern task status until completion.
    """
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
                await asyncio.sleep(3)
                continue

            data = response.json()
            status = data.get("status", "").lower()

            log(f"⏳ Task status: {status}")

            if status == "completed":
                extracted_data = data.get("extracted_information", {})
                final_url = extracted_data.get("final_url", "")
                button_text = extracted_data.get("button_text", "")
                is_finn_internal = extracted_data.get("is_finn_internal", False)

                # Determine form type
                form_type = "unknown"
                if is_finn_internal or "enkel søknad" in button_text.lower():
                    form_type = "finn_easy"
                elif final_url:
                    # Check if it's a known recruitment site
                    form_type = detect_form_type_from_url(final_url)

                log(f"✅ Extracted URL: {final_url}")
                log(f"📝 Button text: {button_text}")
                log(f"🏷️ Form type: {form_type}")

                return {
                    "success": True,
                    "external_url": final_url,
                    "button_text": button_text,
                    "form_type": form_type,
                    "task_id": task_id
                }

            elif status in ["failed", "terminated"]:
                failure_reason = data.get("failure_reason", "Unknown error")
                return {
                    "success": False,
                    "error": f"Task {status}: {failure_reason}",
                    "task_id": task_id
                }

            # Still running, wait and retry
            await asyncio.sleep(3)

        except Exception as e:
            log(f"⚠️ Poll error: {e}")
            await asyncio.sleep(3)


def detect_form_type_from_url(url: str) -> str:
    """
    Detect form type based on the domain of the external URL.
    """
    url_lower = url.lower()

    # Known recruitment systems that typically require registration
    registration_domains = [
        "webcruiter", "easycruit", "teamtailor", "lever.co",
        "greenhouse", "workday", "smartrecruiters", "linkedin"
    ]

    # Known systems that usually have direct forms
    form_domains = [
        "jobylon", "recman", "cvpartner", "talenttech"
    ]

    for domain in registration_domains:
        if domain in url_lower:
            return "external_registration"

    for domain in form_domains:
        if domain in url_lower:
            return "external_form"

    return "external_form"  # Default to form if we got a URL


async def daemon_mode():
    """
    Runs as a daemon, listening for jobs in the database that need URL extraction.
    Jobs are marked in a queue table.
    """
    from supabase import create_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        log("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required for daemon mode")
        return

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    log("🌉 URL Extractor Daemon started. Listening for jobs...")

    while True:
        try:
            # Look for jobs that need URL extraction
            # (You can create a separate queue table or use a job status)
            response = supabase.table("jobs").select("id, job_url, source").eq(
                "application_form_type", "pending_skyvern"
            ).limit(5).execute()

            jobs = response.data

            if jobs:
                log(f"📬 Found {len(jobs)} jobs needing URL extraction")

                for job in jobs:
                    job_id = job["id"]
                    job_url = job["job_url"]
                    source = job.get("source", "FINN")

                    result = await extract_apply_url_skyvern(job_url, source)

                    if result["success"]:
                        # Update the job with extracted URL
                        supabase.table("jobs").update({
                            "external_apply_url": result["external_url"],
                            "application_form_type": result["form_type"],
                            "has_enkel_soknad": result["form_type"] == "finn_easy"
                        }).eq("id", job_id).execute()

                        log(f"✅ Updated job {job_id}: {result['form_type']}")
                    else:
                        # Mark as failed or unknown
                        supabase.table("jobs").update({
                            "application_form_type": "unknown"
                        }).eq("id", job_id).execute()

                        log(f"❌ Failed for job {job_id}: {result['error']}")

        except Exception as e:
            log(f"⚠️ Daemon error: {e}")

        await asyncio.sleep(5)


async def main():
    """Main entry point."""

    # Check Skyvern health first
    if not await check_skyvern_health():
        log("❌ Skyvern is not running!")
        log("   Start it with: docker compose up -d")
        log("   Or: skyvern quickstart")
        return

    log("✅ Skyvern is running")

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python extract_apply_url.py <job_url>")
        print("  python extract_apply_url.py --daemon")
        return

    arg = sys.argv[1]

    if arg == "--daemon":
        await daemon_mode()
    else:
        # Single URL extraction
        job_url = arg
        source = "NAV" if "nav.no" in job_url.lower() else "FINN"

        log(f"🔍 Extracting apply URL from: {job_url}")
        result = await extract_apply_url_skyvern(job_url, source)

        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
