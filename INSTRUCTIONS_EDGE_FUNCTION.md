
# Як розгорнути Edge Function (analyze_profile)

Оскільки я (AI в браузері) не маю доступу до терміналу з встановленим Supabase CLI, тобі потрібно зробити цей крок вручну.

### Крок 1: Встановити змінні середовища в Supabase
Зайди в [Supabase Dashboard -> Settings -> Edge Functions](https://supabase.com/dashboard/project/ptrmidlhfdbybxmyovtm/settings/functions) і додай ці змінні:

- `GEMINI_API_KEY`: Твій ключ від Google Gemini API

### Крок 2: Розгорнути функцію через Термінальний Claude
Запусти локальну сесію Claude (якщо ще не запущена) і попроси його:

```text
"Будь ласка, розгорни Supabase Edge Function. 
Код знаходиться в папці `supabase/functions/analyze_profile`.
Виконай: supabase functions deploy analyze_profile --no-verify-jwt"
```

Або виконай вручну в терміналі:
```bash
supabase functions deploy analyze_profile --no-verify-jwt
```
