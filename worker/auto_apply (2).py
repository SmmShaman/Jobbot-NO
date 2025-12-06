
import asyncio
import os
import json
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

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing API Keys in .env file")
    exit(1)

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}")

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
    
    # Get Job URL
    job_res = supabase.table("jobs").select("url").eq("id", job_id).single().execute()
    job_url = job_res.data.get('url')
    
    if not job_url:
        await log(f"❌ Job URL not found for App ID {app_id}")
        supabase.table("applications").update({"status": "failed"}).eq("id", app_id).execute()
        return

    kb_data = await get_knowledge_base_dict()
    profile_text = await get_active_profile()
    resume_url = await get_latest_resume_url()
    
    await log(f"📄 Processing App {app_id} -> {job_url}")

    task_id = await trigger_skyvern_task(job_url, app, kb_data, profile_text, resume_url)
    
    if task_id:
        skyvern_meta = {
            "task_id": task_id,
            "resume_url": resume_url,
            "started_at": datetime.now().isoformat()
        }
        
        supabase.table("applications").update({
            "status": "manual_review", # Changed to manual_review initially to indicate processing
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

async def main_loop():
    await log("🌉 Skyvern Bridge started (v6.4 - Top Right Priority). Waiting...")
    
    while True:
        try:
            response = supabase.table("applications").select("*").eq("status", "sending").execute()
            tasks = response.data
            
            if tasks:
                await log(f"📬 Found {len(tasks)} pending applications.")
                for app in tasks:
                    await process_application(app)
            
        except Exception as e:
            await log(f"⚠️ Loop Error: {e}")
        
        await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(main_loop())
