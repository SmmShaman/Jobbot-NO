# Telegram Bot Integration

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot + show statistics + linking instructions |
| `/link XXXXXX` | Link Telegram to account via 6-char code |
| `/scan` | Trigger manual job scan |
| `/report` | Get detailed statistics report |
| `/code XXXXXX` | Submit 2FA verification code |
| `123456` | Submit 2FA code (plain digits, 4-8 chars) |

## Telegram Linking Flow (Multi-User)

1. User opens Settings → Automation in dashboard
2. Clicks "Generate code" to get 6-character code (valid 24h)
3. Sends `/link XXXXXX` to bot
4. Bot verifies code and links chat to user account
5. Notifications now work for that user

**Important**: Auto-linking was removed for security. Each user must link manually.

## Inline Buttons

- **Write Soknad**: Napisati Soknad - Generate cover letter
- **Approve**: Pidtverditi - Approve application
- **View Soknad**: Pokazati Soknad - View cover letter
- **Submit to FINN**: Vidpraviti v {Company} - Submit via Skyvern (after approval)
- **Auto-Apply**: Auto-Apply (Skyvern) - For non-FINN jobs

## Bot Workflow

1. User sends FINN job URL → Bot scrapes & analyzes
2. Bot shows job info + "Write Soknad" button
3. User clicks → Bot generates cover letter
4. Bot shows soknad + "Approve" button
5. User clicks → Status changes to 'approved'
6. Bot shows "Submit to {Company}" button (for FINN Easy only)
7. User clicks → Worker starts, asks for 2FA code
8. User sends plain 6-digit code → Application submitted

## Statistics on /start

```
📊 Статистика:
🏢 Всього вакансій: 252
🆕 Нових за тиждень: 45
🎯 Релевантних (≥50%): 83
✅ Відправлено заявок: 2
📝 В обробці: 5
```

## 2FA Code Handling

- Accepts `/code 123456` format
- Also accepts plain digits `123456` (4-8 chars)
- If no active auth request for plain numbers → silently ignored
- Detection regex: `/^\d{4,8}$/`

## Worker Status Warning

Before submitting applications, bot checks if worker is running:
- Detects stuck 'sending' applications (>2 minutes old)
- Shows warning with instructions if worker not running

```
⚠️ Worker не запущений!
У черзі X заявок (найстаріша: Y хв)

Запусти worker:
cd worker && python auto_apply.py
```

## Multi-User RLS Support

All bot database queries filter by `user_id`:
- `getUserIdFromChat(supabase, chatId)` helper gets user_id from chat_id
- Fixed handlers: view_app_, approve_app_, finn_apply_, auto_apply_
- Statistics now per-user

## Error Handling

- Cover letters truncated to 1500 chars (Telegram limit)
- `functions.invoke` errors checked and logged
- Unlinked users see clear linking instructions
