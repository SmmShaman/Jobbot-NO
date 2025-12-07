#!/usr/bin/env python3
"""
Script to fix jobs with "Unknown Company" by calling extract_job_text Edge Function.
"""

import os
import requests
import time
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Помилка: SUPABASE_URL або SUPABASE_SERVICE_KEY не знайдено в .env")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def fix_unknown_companies():
    # Отримати всі вакансії з Unknown Company
    print("🔍 Шукаю вакансії з 'Unknown Company'...\n")

    result = supabase.table('jobs').select('id, title, job_url, company').or_(
        'company.eq.Unknown Company,company.eq.Unknown,company.is.null,company.eq.'
    ).execute()

    jobs = result.data

    if not jobs:
        print("✅ Всі вакансії вже мають назви компаній!")
        return

    print(f"📋 Знайдено {len(jobs)} вакансій для оновлення:\n")

    for i, job in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] {job['title']}")
        print(f"    URL: {job['job_url']}")
        print(f"    Поточна компанія: {job['company'] or 'null'}")

        # Викликати Edge Function
        try:
            response = requests.post(
                f"{SUPABASE_URL}/functions/v1/extract_job_text",
                headers={
                    'Authorization': f"Bearer {SUPABASE_KEY}",
                    'Content-Type': 'application/json'
                },
                json={'job_id': job['id'], 'url': job['job_url']},
                timeout=30
            )

            if response.ok:
                data = response.json()
                new_company = data.get('company')
                if new_company:
                    print(f"    ✅ Нова компанія: {new_company}")
                else:
                    print(f"    ⚠️ Компанію не вдалося витягти")
            else:
                print(f"    ❌ Помилка: {response.status_code} - {response.text[:100]}")

        except requests.exceptions.Timeout:
            print(f"    ❌ Timeout - спробуйте ще раз")
        except Exception as e:
            print(f"    ❌ Помилка: {e}")

        print()

        # Невелика пауза між запитами
        if i < len(jobs):
            time.sleep(1)

    print("=" * 50)
    print("✅ Готово! Перевірте результати в базі даних.")

if __name__ == "__main__":
    fix_unknown_companies()
