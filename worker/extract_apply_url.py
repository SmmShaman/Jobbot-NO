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
import re
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
        GOAL: Click the apply button and extract the URL of the application page. DO NOT fill any forms.

        STEP 1: Handle any cookie popup by clicking "Godta" or "Aksepter".

        STEP 2: Find the apply button. Look for:
           - "Gå til søknad" (primary - green button)
           - "Søk på stillingen"
           - "Søk her"

        STEP 3: Click the apply button ONCE.

        STEP 4: STOP IMMEDIATELY after the page loads. Record the current URL.

        CRITICAL RULES:
        - After clicking the apply button and landing on the new page, STOP.
        - Do NOT click any more buttons.
        - Do NOT fill any form fields.
        - Do NOT type anything.
        - Just record the URL of the page you landed on and complete the task.
        - If you see a form, that's fine - just note the URL and stop.
        - If you see an email link (mailto:), extract the email address.
        """
    else:  # FINN
        navigation_goal = """
        GOAL: Click the apply button and extract the URL of the application page. DO NOT fill any forms.

        STEP 1: Handle any cookie popup by clicking "Godta alle".

        STEP 2: Find the apply button in the TOP RIGHT area. Look for:
           - "Søk her" (blue button)
           - "Søk her (åpnes i en ny fane)"
           - "Enkel søknad" (note: this is FINN internal form)

        STEP 3: Click the apply button ONCE.

        STEP 4: STOP IMMEDIATELY after the page loads. Record the current URL.

        CRITICAL RULES:
        - After clicking the apply button and landing on the new page, STOP.
        - Do NOT click any more buttons.
        - Do NOT fill any form fields.
        - Do NOT type anything.
        - Just record the URL of the page you landed on and complete the task.
        - If the button said "Enkel søknad", note that it's FINN internal form.
        - If you see an email link (mailto:), extract the email address.
        """

    # Data extraction schema - we want the final URL or email
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "final_url": {
                "type": "string",
                "description": "The URL of the page after clicking the apply button. If no URL, use empty string."
            },
            "email_link": {
                "type": "string",
                "description": "If the application is via email (mailto: link), extract the email address"
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
        }
    }

    payload = {
        "url": job_url,
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Extract the URL of the application page after clicking the apply button. If there's no form but an email link (mailto:), extract the email address. Also note if this is FINN's internal 'Enkel søknad' form.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 10,  # Only need: cookie popup + find button + click + extract URL
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


async def wait_for_task_completion(client: httpx.AsyncClient, task_id: str, headers: dict, timeout_seconds: int = 180) -> dict:
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
                # Log raw response for debugging
                log(f"📦 Raw extracted_information: {data.get('extracted_information')}")
                log(f"📦 Response keys: {list(data.keys())}")

                # Check request data for URLs
                request_data = data.get("request", {}) or {}
                log(f"📦 Request URL (start): {request_data.get('url', 'N/A')}")

                # Try to find final URL from recording_url (might contain domain info)
                recording_url = data.get("recording_url", "")
                if recording_url:
                    log(f"🎬 Recording URL: {recording_url}")

                # Try to find final URL from screenshot URL or other fields
                screenshot_url = data.get("screenshot_url", "")
                if screenshot_url:
                    log(f"📸 Screenshot URL: {screenshot_url}")

                # Check action_screenshot_urls for navigation clues
                action_screenshots = data.get("action_screenshot_urls", []) or []
                if action_screenshots:
                    log(f"📸 Action screenshots count: {len(action_screenshots)}")
                    # Last screenshot might be from final page
                    if len(action_screenshots) > 0:
                        last_screenshot = action_screenshots[-1]
                        log(f"📸 Last action screenshot: {last_screenshot[:100] if last_screenshot else 'N/A'}...")

                extracted_data = data.get("extracted_information", {}) or {}

                # Try multiple field names (Skyvern may use different naming)
                final_url = (
                    extracted_data.get("final_url", "") or
                    extracted_data.get("applicationPageUrl", "") or
                    extracted_data.get("application_page_url", "") or
                    ""
                )
                email_link = (
                    extracted_data.get("email_link", "") or
                    extracted_data.get("emailAddress", "") or
                    extracted_data.get("email_address", "") or
                    ""
                )
                button_text = (
                    extracted_data.get("button_text", "") or
                    extracted_data.get("buttonText", "") or
                    ""
                )
                is_finn_internal = (
                    extracted_data.get("is_finn_internal", False) or
                    extracted_data.get("isFinnEnkelSoknad", False) or
                    extracted_data.get("is_finn_enkel_soknad", False)
                )

                # Also try to get URL from task steps API
                if not final_url:
                    try:
                        # Fetch task steps to find navigation URLs
                        steps_response = await client.get(
                            f"{SKYVERN_URL}/api/v1/tasks/{task_id}/steps",
                            headers=headers,
                            timeout=10.0
                        )
                        if steps_response.status_code == 200:
                            steps_data = steps_response.json()
                            log(f"📋 Steps count: {len(steps_data) if isinstance(steps_data, list) else 'N/A'}")

                            # Look through steps for navigation or click actions
                            if isinstance(steps_data, list):
                                for step in reversed(steps_data):
                                    step_output = step.get("output", {}) or {}
                                    action_results = step_output.get("action_results", []) or []

                                    for result in action_results:
                                        # Check if there's a URL in the result
                                        result_data = result.get("data", {}) or {}
                                        if isinstance(result_data, dict):
                                            step_url = result_data.get("url", "")
                                            if step_url and step_url.startswith("http") and "nav.no" not in step_url and "finn.no" not in step_url:
                                                final_url = step_url
                                                log(f"📍 Found URL from step result: {final_url}")
                                                break

                                    if final_url:
                                        break
                    except Exception as e:
                        log(f"⚠️ Could not fetch steps: {e}")

                # Determine form type and apply URL
                form_type = "unknown"
                apply_url = final_url

                if email_link:
                    # Application is via email
                    form_type = "email"
                    apply_url = f"mailto:{email_link}" if not email_link.startswith("mailto:") else email_link
                    log(f"📧 Email application: {email_link}")
                elif is_finn_internal or (button_text and "enkel søknad" in button_text.lower()):
                    form_type = "finn_easy"
                elif final_url:
                    # Check if it's a known recruitment site
                    form_type = detect_form_type_from_url(final_url)

                log(f"✅ Extracted URL: {apply_url}")
                log(f"📝 Button text: {button_text}")
                log(f"🏷️ Form type: {form_type}")

                return {
                    "success": True,
                    "external_url": apply_url,
                    "email": email_link if email_link else None,
                    "button_text": button_text,
                    "form_type": form_type,
                    "task_id": task_id
                }

            elif status in ["failed", "terminated"]:
                failure_reason = data.get("failure_reason", "Unknown error")

                # Even terminated tasks might have extracted useful data
                extracted_data = data.get("extracted_information", {}) or {}
                email_link = extracted_data.get("email_link", "") or ""
                final_url = extracted_data.get("final_url", "") or ""

                # Check if we found email in the failure reason (Skyvern sometimes reports this way)
                if "email" in failure_reason.lower() and "@" in failure_reason:
                    # Extract email from failure reason
                    email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', failure_reason)
                    if email_match:
                        email_link = email_match.group(0)
                        log(f"📧 Found email in termination reason: {email_link}")
                        return {
                            "success": True,
                            "external_url": f"mailto:{email_link}",
                            "email": email_link,
                            "button_text": "",
                            "form_type": "email",
                            "task_id": task_id
                        }

                # If we have extracted data, try to use it
                if email_link or final_url:
                    form_type = "email" if email_link else detect_form_type_from_url(final_url)
                    apply_url = f"mailto:{email_link}" if email_link else final_url
                    return {
                        "success": True,
                        "external_url": apply_url,
                        "email": email_link if email_link else None,
                        "button_text": extracted_data.get("button_text", ""),
                        "form_type": form_type,
                        "task_id": task_id
                    }

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
    Polls for jobs where external_apply_url is NULL.
    """
    from supabase import create_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        log("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required for daemon mode")
        return

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    log("🚀 URL Extractor Daemon started")
    log(f"📡 Skyvern API: {SKYVERN_URL}")
    log("👀 Watching for jobs without external_apply_url...")

    processed_ids = set()  # Track processed jobs to avoid re-processing

    while True:
        try:
            # Look for jobs that need URL extraction:
            # - external_apply_url is NULL
            # - has a job_url
            # - created in last 7 days (to avoid old jobs)
            from datetime import timedelta
            seven_days_ago = (datetime.now() - timedelta(days=7)).isoformat()

            response = supabase.table("jobs").select(
                "id, title, job_url, source"
            ).is_(
                "external_apply_url", "null"
            ).gte(
                "created_at", seven_days_ago
            ).order(
                "created_at", desc=True
            ).limit(10).execute()

            jobs = response.data or []

            # Filter out already processed jobs
            new_jobs = [j for j in jobs if j["id"] not in processed_ids]

            if new_jobs:
                log(f"📬 Found {len(new_jobs)} jobs needing URL extraction")

                for job in new_jobs:
                    job_id = job["id"]
                    job_url = job.get("job_url")
                    source = job.get("source", "FINN")
                    title = job.get("title", "Unknown")[:50]

                    if not job_url:
                        log(f"⚠️ Job {job_id} has no URL, skipping")
                        processed_ids.add(job_id)
                        continue

                    log(f"🔍 Processing: {title}")
                    log(f"   URL: {job_url}")

                    # Mark as processing
                    supabase.table("jobs").update({
                        "application_form_type": "processing"
                    }).eq("id", job_id).execute()

                    result = await extract_apply_url_skyvern(job_url, source)

                    if result["success"]:
                        # Update the job with extracted URL
                        update_data = {
                            "external_apply_url": result["external_url"],
                            "application_form_type": result["form_type"],
                            "has_enkel_soknad": result["form_type"] == "finn_easy"
                        }
                        supabase.table("jobs").update(update_data).eq("id", job_id).execute()

                        log(f"✅ Updated: {result['form_type']} → {result['external_url'][:60]}...")
                    else:
                        # Mark as failed
                        supabase.table("jobs").update({
                            "application_form_type": "skyvern_failed"
                        }).eq("id", job_id).execute()

                        log(f"❌ Failed: {result.get('error', 'Unknown error')}")

                    # Mark as processed
                    processed_ids.add(job_id)

                    # Small delay between jobs to not overload Skyvern
                    await asyncio.sleep(2)

            else:
                # No new jobs, wait longer
                log("💤 No new jobs, waiting...")

        except Exception as e:
            log(f"⚠️ Daemon error: {e}")
            import traceback
            traceback.print_exc()

        # Poll every 30 seconds
        await asyncio.sleep(30)


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
