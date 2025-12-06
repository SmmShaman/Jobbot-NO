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
        GOAL: Extract the COMPLETE href URL from the apply button, including ALL query parameters.

        STEP 1: Handle any cookie popup by clicking "Godta" or "Aksepter".

        STEP 2: Find the apply button/link. Look for:
           - "Gå til søknad" (primary - GREEN button, usually on the right side)
           - "Søk på stillingen"
           - "Søk her"

        STEP 3: BEFORE clicking, inspect the button element and extract its href attribute.
                The href contains the FULL external URL with query parameters like:
                https://iss.attract.reachmee.com/jobs/rm?rmpage=apply&rmjob=3415&ref=nav.no

        STEP 4: Report the COMPLETE href URL as 'application_url'.

        CRITICAL RULES:
        - The href attribute MUST include the query string (everything after ?)
        - Example: https://site.com/apply?job=123&source=nav - include ?job=123&source=nav
        - Do NOT report just the domain (https://site.com) - we need the FULL path and query
        - If no href, click the button and report the final browser URL as 'final_browser_url'
        - DO NOT fill any forms!
        """
    else:  # FINN
        navigation_goal = """
        GOAL: Determine if this is FINN Enkel Søknad (internal) or external application, and extract URL if external.

        STEP 1: Handle Schibsted/FINN cookie popup - click "Godta alle" or "Aksepter".

        STEP 2: Look at the TOP RIGHT area of the job listing. Find the apply button.

        STEP 3: CHECK THE BUTTON TEXT FIRST:
           - If button says "Enkel søknad" or "Enkel Søknad":
             → This is FINN INTERNAL form
             → Set is_finn_internal = true
             → DO NOT extract any URL, leave application_url empty
             → STOP HERE, task complete

           - If button says "Søk her" or "Søk her (åpnes i ny fane)":
             → This is EXTERNAL application
             → Extract the href attribute from this button
             → Report as application_url

        STEP 4: For EXTERNAL applications only:
           - The href should point to external site (webcruiter, easycruit, etc.)
           - Include ALL query parameters in the URL
           - If href starts with finn.no - this is WRONG, do not report it

        CRITICAL RULES:
        - "Enkel søknad" = FINN internal, NO URL needed, set is_finn_internal=true
        - "Søk her" = External, extract the EXTERNAL href URL
        - NEVER report finn.no URLs as application_url (except finn.no/job/apply/...)
        - NEVER report search/filter URLs (finn.no/job/search, finn.no/job/fulltime)
        - If mailto: link, extract the email address
        - DO NOT fill any forms!
        """

    # Data extraction schema - prioritize complete href with query params
    data_extraction_schema = {
        "type": "object",
        "properties": {
            "application_url": {
                "type": "string",
                "description": "The COMPLETE href URL from the apply button INCLUDING all query parameters. Example: https://employer.com/apply?job=123&ref=nav.no"
            },
            "final_browser_url": {
                "type": "string",
                "description": "If button has no href, the browser URL after clicking (with all query params)"
            },
            "email_address": {
                "type": "string",
                "description": "If mailto: link, the email address"
            },
            "button_text": {
                "type": "string",
                "description": "The visible text on the apply button"
            },
            "is_finn_internal": {
                "type": "boolean",
                "description": "True if button text is 'Enkel søknad'"
            }
        }
    }

    payload = {
        "url": job_url,
        "webhook_callback_url": None,
        "navigation_goal": navigation_goal,
        "data_extraction_goal": "Extract the COMPLETE href attribute from the apply button, including ALL query parameters (?param=value&...). Report as 'application_url'. If no href exists, click and report 'final_browser_url'.",
        "data_extraction_schema": data_extraction_schema,
        "max_steps": 12,
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
            result = await wait_for_task_completion(client, task_id, headers, job_url=job_url)
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


async def wait_for_task_completion(client: httpx.AsyncClient, task_id: str, headers: dict, timeout_seconds: int = 180, job_url: str = "") -> dict:
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

                # Log raw data for debugging query parameter issues
                log(f"📦 Raw extracted data keys: {list(extracted_data.keys())}")
                for key, val in extracted_data.items():
                    if val:
                        log(f"   {key}: {str(val)[:100]}...")

                # Try multiple field names - prioritize application_url (href attribute)
                final_url = (
                    extracted_data.get("application_url", "") or
                    extracted_data.get("applicationUrl", "") or
                    extracted_data.get("final_browser_url", "") or  # Fallback if no href
                    extracted_data.get("finalBrowserUrl", "") or
                    extracted_data.get("current_page_url", "") or
                    extracted_data.get("currentPageUrl", "") or
                    extracted_data.get("final_url", "") or
                    extracted_data.get("href", "") or
                    ""
                )

                # Validate URL has query parameters
                if final_url:
                    if "?" in final_url:
                        log(f"✅ URL has query parameters: {final_url}")
                    else:
                        log(f"⚠️ URL missing query parameters: {final_url}")
                        # Try to find URL with params in other fields
                        for key, val in extracted_data.items():
                            if isinstance(val, str) and "?" in val and val.startswith("http"):
                                log(f"📎 Found URL with params in '{key}': {val}")
                                final_url = val
                                break
                email_link = (
                    extracted_data.get("email_address", "") or
                    extracted_data.get("emailAddress", "") or
                    extracted_data.get("email_link", "") or
                    extracted_data.get("email", "") or
                    ""
                )
                button_text = (
                    extracted_data.get("button_text", "") or
                    extracted_data.get("buttonText", "") or
                    ""
                )
                is_finn_internal = (
                    extracted_data.get("is_finn_internal", False) or
                    extracted_data.get("isFinnInternal", False) or
                    extracted_data.get("isFinnEnkelSoknad", False)
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
                    # FINN Enkel Søknad - NO external URL needed
                    form_type = "finn_easy"
                    apply_url = None  # Clear any extracted URL
                    log(f"✅ FINN Enkel Søknad detected - no external URL needed")
                elif final_url:
                    # Validate the URL before accepting it
                    if is_valid_apply_url(final_url, job_url):
                        form_type = detect_form_type_from_url(final_url)
                        log(f"✅ Valid external URL: {final_url}")
                    else:
                        log(f"⚠️ Invalid URL rejected: {final_url}")
                        apply_url = None
                        form_type = "unknown"

                log(f"📝 Button text: {button_text}")
                log(f"🏷️ Form type: {form_type}")
                log(f"🔗 Final apply URL: {apply_url}")

                return {
                    "success": True if (apply_url or form_type == "finn_easy") else False,
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


def is_valid_apply_url(url: str, original_job_url: str = "") -> bool:
    """
    Validate that the extracted URL is a valid apply URL, not a search/filter page.
    Returns False for invalid URLs that should be rejected.
    """
    if not url:
        return False

    url_lower = url.lower()

    # Invalid URL patterns - these are NOT apply URLs
    invalid_patterns = [
        'finn.no/job/search',      # Search page
        'finn.no/job/fulltime',    # Filter/listing page (without finnkode)
        'finn.no/job/parttime',    # Filter/listing page
        'finn.no/jobb/',           # Old job listing format
        '/search?',                # Search query
        '/filter?',                # Filter query
        'nav.no/stillinger',       # NAV search page (without specific job)
    ]

    for pattern in invalid_patterns:
        if pattern in url_lower:
            # Exception: if URL has finnkode parameter, it might be valid
            if 'finnkode=' in url_lower:
                continue
            return False

    # Check if it's the same as original job URL (shouldn't extract same URL)
    if original_job_url and url_lower.strip('/') == original_job_url.lower().strip('/'):
        return False

    # Check if it's a finn.no URL that's NOT an apply URL
    if 'finn.no' in url_lower:
        # Only finn.no/job/apply/... is valid
        if '/job/apply/' not in url_lower and 'finnkode=' not in url_lower:
            return False

    return True


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
            # - NOT already detected as finn_easy (those don't need external URL!)
            # - NOT has_enkel_soknad = true
            # - created in last 7 days (to avoid old jobs)
            from datetime import timedelta
            seven_days_ago = (datetime.now() - timedelta(days=7)).isoformat()

            response = supabase.table("jobs").select(
                "id, title, job_url, source, has_enkel_soknad, application_form_type"
            ).is_(
                "external_apply_url", "null"
            ).neq(
                "application_form_type", "finn_easy"
            ).neq(
                "has_enkel_soknad", True
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
                    has_enkel = job.get("has_enkel_soknad", False)
                    form_type = job.get("application_form_type", "")

                    # Skip FINN Easy Apply jobs - they don't need external URL extraction
                    if has_enkel or form_type == "finn_easy":
                        log(f"⏭️ Skipping {title[:30]}... (FINN Easy Apply)")
                        processed_ids.add(job_id)
                        continue

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
                        form_type = result["form_type"]
                        external_url = result.get("external_url")

                        # Update the job based on form type
                        update_data = {
                            "application_form_type": form_type,
                            "has_enkel_soknad": form_type == "finn_easy"
                        }

                        # Only set external_apply_url if we have a valid one
                        # For finn_easy, we DON'T set external_apply_url
                        if external_url and form_type != "finn_easy":
                            update_data["external_apply_url"] = external_url
                            log(f"✅ Updated: {form_type} → {external_url[:60]}...")
                        elif form_type == "finn_easy":
                            # Clear any wrong external_apply_url for finn_easy
                            update_data["external_apply_url"] = None
                            log(f"✅ Updated: FINN Easy Apply (no external URL needed)")
                        else:
                            log(f"⚠️ No valid URL extracted, marking as {form_type}")

                        supabase.table("jobs").update(update_data).eq("id", job_id).execute()
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
