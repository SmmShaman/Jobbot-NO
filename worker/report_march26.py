from supabase import create_client
import os
from dotenv import load_dotenv
load_dotenv(".env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

apps = sb.table("applications").select("id, user_id, status, created_at, skyvern_metadata, job_id").gte("created_at", "2026-03-26T00:00:00").lte("created_at", "2026-03-27T00:00:00").order("created_at", desc=False).execute()

total = len(apps.data)
vitalii_apps = [a for a in apps.data if (a.get("user_id") or "")[:8] == "f92ee73e"]
natalia_apps = [a for a in apps.data if (a.get("user_id") or "")[:8] == "fa497240"]

statuses = {}
for a in apps.data:
    s = a["status"]
    statuses[s] = statuses.get(s, 0) + 1

print("=" * 60)
print("ZVIT ZA 26 BEREZNYA 2026")
print("=" * 60)
print(f"Vsogo zayavok: {total}")
print(f"  Vitalii: {len(vitalii_apps)}")
print(f"  Natalia: {len(natalia_apps)}")
print()
print("Po statusah:")
for s, cnt in sorted(statuses.items(), key=lambda x: -x[1]):
    print(f"  {s:20} {cnt}")

# Vitalii analysis
wrong_cv = []
correct_sent = []
failed = []
sending = []
manual = []
other_status = []

for a in vitalii_apps:
    status = a["status"]
    meta = a.get("skyvern_metadata") or {}
    resume = meta.get("resume_url", "")
    has_natalia = "Natalia" in resume

    if status == "sent" and not has_natalia:
        correct_sent.append(a)
    elif status == "sent" and has_natalia:
        wrong_cv.append(a)
    elif status == "failed":
        failed.append(a)
    elif status == "sending":
        sending.append(a)
    elif status == "manual_review":
        manual.append(a)
    else:
        other_status.append(a)

print()
print("=" * 60)
print("VITALII - detali:")
print(f"  Podano z NEPRAVYLNYM CV (Natalia): {len(wrong_cv)}")
print(f"  Podano PRAVYLNO (sent, correct CV): {len(correct_sent)}")
print(f"  Failed: {len(failed)}")
print(f"  V cherzi (sending): {len(sending)}")
print(f"  Manual review: {len(manual)}")
print(f"  Inshi: {len(other_status)}")

if correct_sent:
    print()
    print("Uspishno podani z pravylnym CV:")
    for a in correct_sent:
        job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
        j = job.data or {}
        print(f"  OK: {j.get('title', '?')[:50]} @ {j.get('company', '?')[:25]}")

if wrong_cv:
    print()
    print("Podani z NEPRAVYLNYM CV (Natalia zamist Vitalii):")
    for a in wrong_cv:
        job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
        j = job.data or {}
        print(f"  WRONG: {j.get('title', '?')[:50]} @ {j.get('company', '?')[:25]}")

if failed:
    print()
    print(f"Failed ({len(failed)}):")
    for a in failed:
        job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
        j = job.data or {}
        meta = a.get("skyvern_metadata") or {}
        reason = meta.get("failure_reason", meta.get("error_message", "no metadata"))[:50]
        print(f"  FAIL: {j.get('title', '?')[:45]} | {reason}")

if sending:
    print()
    print(f"V cherzi ({len(sending)}):")
    for a in sending:
        job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
        j = job.data or {}
        print(f"  QUEUE: {j.get('title', '?')[:50]} @ {j.get('company', '?')[:25]}")

if manual:
    print()
    print(f"Manual review ({len(manual)}):")
    for a in manual:
        job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
        j = job.data or {}
        print(f"  MANUAL: {j.get('title', '?')[:50]} @ {j.get('company', '?')[:25]}")

print()
print("NATALIA:")
for a in natalia_apps:
    status = a["status"]
    job = sb.table("jobs").select("title, company").eq("id", a["job_id"]).single().execute()
    j = job.data or {}
    print(f"  [{status}] {j.get('title', '?')[:50]}")
