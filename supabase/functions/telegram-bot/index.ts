import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("🤖 [TelegramBot] v15.0 - /apply command for batch FINN Easy submissions");

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
console.log(`🤖 [TelegramBot] BOT_TOKEN exists: ${!!BOT_TOKEN}`);

// --- HELPER: Format Application Form Type ---
function formatFormType(job: any): string {
  const formType = job.application_form_type;
  const externalUrl = job.external_apply_url;

  if (!formType && !externalUrl) {
    return "❓ <i>Тип подачі: невідомо</i>";
  }

  let emoji = "🔗";
  let label = "Зовнішня форма";

  switch (formType) {
    case 'finn_easy':
      emoji = "⚡";
      label = "FINN Enkel søknad";
      break;
    case 'external_form':
      emoji = "📝";
      label = "Зовнішня форма";
      break;
    case 'external_registration':
      emoji = "🔐";
      label = "Потрібна реєстрація";
      break;
    case 'email':
      emoji = "📧";
      label = "Email";
      break;
    case 'processing':
      emoji = "⏳";
      label = "Обробляється...";
      break;
    case 'skyvern_failed':
      emoji = "⚠️";
      label = "Не вдалося визначити";
      break;
    default:
      emoji = "❓";
      label = "Невідомо";
  }

  let result = `${emoji} <b>Подача:</b> ${label}`;

  if (externalUrl) {
    // Truncate long URLs for display
    const displayUrl = externalUrl.length > 40
      ? externalUrl.substring(0, 40) + "..."
      : externalUrl;
    result += `\n🔗 <a href="${externalUrl}">${displayUrl}</a>`;
  }

  return result;
}

// --- HELPER: Get user_id from chat_id (for multi-user RLS) ---
async function getUserIdFromChat(supabase: any, chatId: number | string): Promise<string | null> {
    const { data } = await supabase
        .from('user_settings')
        .select('user_id')
        .eq('telegram_chat_id', chatId.toString())
        .single();
    return data?.user_id || null;
}

// --- HELPER: Check if worker is running (no stuck 'sending' applications) ---
async function checkWorkerRunning(supabase: any, userId: string): Promise<{ isRunning: boolean; stuckCount: number; oldestMinutes: number }> {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: stuckApps } = await supabase
        .from('applications')
        .select('id, updated_at')
        .eq('user_id', userId)
        .eq('status', 'sending')
        .lt('updated_at', twoMinutesAgo)
        .order('updated_at', { ascending: true });

    if (!stuckApps || stuckApps.length === 0) {
        return { isRunning: true, stuckCount: 0, oldestMinutes: 0 };
    }

    const oldestTime = new Date(stuckApps[0].updated_at).getTime();
    const oldestMinutes = Math.round((Date.now() - oldestTime) / 60000);

    return { isRunning: false, stuckCount: stuckApps.length, oldestMinutes };
}

// --- HELPER: Check if user is admin ---
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
    const { data } = await supabase
        .from('user_settings')
        .select('role')
        .eq('user_id', userId)
        .single();
    return data?.role === 'admin';
}

// --- HELPER: Format time ago in Ukrainian ---
function formatAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'щойно';
    if (mins < 60) return `${mins} хв тому`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} год тому`;
    const days = Math.floor(hours / 24);
    return `${days} дн тому`;
}

// --- HELPER: Format uptime duration ---
function formatUptime(startDate: Date): string {
    const diffMs = Date.now() - startDate.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}хв`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) return remMins > 0 ? `${hours}г ${remMins}хв` : `${hours}г`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}д ${remHours}г` : `${days}д`;
}

// --- HELPER: Send Message ---
async function sendTelegram(chatId: string, text: string, replyMarkup?: any) {
  console.log(`📤 [TG] Sending to ${chatId}: ${text.substring(0, 50)}...`);

  if (!BOT_TOKEN) {
    console.error("❌ [TG] BOT_TOKEN is missing! Cannot send message.");
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const markup = replyMarkup || { remove_keyboard: true };

  const body: any = { 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: markup
  };

  try {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const responseText = await res.text();
    if (!res.ok) {
      console.error(`❌ [TG] Send Error (${res.status}):`, responseText);
    } else {
      console.log(`✅ [TG] Message sent successfully to ${chatId}`);
    }
  } catch (e) {
    console.error("❌ [TG] Network Error:", e);
  }
}

// --- HELPER: Answer Callback ---
async function answerCallback(callbackId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

// --- HEAVY LOGIC (Running in Background) ---
async function runBackgroundJob(update: any) {
    console.log(`🔄 [TG] runBackgroundJob started with update:`, JSON.stringify(update).substring(0, 200));

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ [TG] Supabase credentials missing!");
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // --- 1. HANDLE CALLBACK BUTTONS (Inline) ---
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const data = cb.data;

            // WRITE APPLICATION
            if (data.startsWith('write_app_')) {
                const jobId = data.split('write_app_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                await sendTelegram(chatId, "⏳ <b>Пишу Søknad...</b>\n(Це може зайняти до 30 сек)");

                try {
                    const { data: genResult, error: invokeError } = await supabase.functions.invoke('generate_application', {
                        body: { job_id: jobId, user_id: userId }
                    });

                    console.log(`[TG] generate_application result:`, JSON.stringify(genResult)?.substring(0, 200));

                    if (invokeError) {
                        console.error(`[TG] generate_application invoke error:`, invokeError);
                        await sendTelegram(chatId, `❌ Помилка виклику: ${invokeError.message || 'Unknown'}`);
                        return;
                    }

                    if (!genResult?.success) {
                        await sendTelegram(chatId, `❌ Помилка: ${genResult?.message || 'Unknown'}`);
                        return;
                    }

                    const app = genResult.application;

                    // Truncate long cover letters for Telegram (4096 char limit)
                    const maxLen = 1500;
                    const coverNo = app.cover_letter_no?.length > maxLen
                        ? app.cover_letter_no.substring(0, maxLen) + '...'
                        : app.cover_letter_no;
                    const coverUk = app.cover_letter_uk?.length > maxLen
                        ? app.cover_letter_uk.substring(0, maxLen) + '...'
                        : (app.cover_letter_uk || '...');

                    const msg = `✅ <b>Søknad готовий!</b>\n\n` +
                                `🇳🇴 <b>Norsk:</b>\n<tg-spoiler>${coverNo}</tg-spoiler>\n\n` +
                                `🇺🇦 <b>Переклад:</b>\n<tg-spoiler>${coverUk}</tg-spoiler>`;

                    const kb = { inline_keyboard: [[
                        { text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` }
                    ]]};

                    await sendTelegram(chatId, msg, kb);
                } catch (err: any) {
                    console.error(`[TG] write_app_ exception:`, err);
                    await sendTelegram(chatId, `❌ Виняток: ${err.message || 'Unknown error'}`);
                }
            }

            // SUBMIT TO FINN (Enkel Søknad)
            if (data.startsWith('finn_apply_')) {
                const appId = data.split('finn_apply_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Check if worker is running
                const workerStatus = await checkWorkerRunning(supabase, userId);
                if (!workerStatus.isRunning) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Worker не запущений!</b>\n\n` +
                        `У черзі ${workerStatus.stuckCount} заявок (найстаріша: ${workerStatus.oldestMinutes} хв)\n\n` +
                        `<b>Запусти worker:</b>\n` +
                        `<code>cd worker && python auto_apply.py</code>\n\n` +
                        `Після запуску натисни кнопку ще раз.`
                    );
                    return;
                }

                // Get application with job info
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(*)')
                    .eq('id', appId)
                    .eq('user_id', userId)
                    .single();

                if (!app || !app.jobs) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                const isFinnEasy = app.jobs?.has_enkel_soknad ||
                                   app.jobs?.application_form_type === 'finn_easy' ||
                                   app.jobs?.external_apply_url?.includes('finn.no/job/apply');

                if (!isFinnEasy) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Автозаповнення недоступне</b>\n\n` +
                        `Ця вакансія використовує зовнішню форму:\n` +
                        `🔗 <a href="${app.jobs.external_apply_url || app.jobs.job_url}">Відкрити форму</a>\n\n` +
                        `📝 Заповніть заявку вручну.`
                    );
                    return;
                }

                // Check if already sent (block duplicates)
                if (app.status === 'sent' || app.status === 'sending') {
                    await sendTelegram(chatId,
                        `⚠️ <b>Заявку вже відправлено!</b>\n\n` +
                        `📋 ${app.jobs.title}\n` +
                        `🏢 ${app.jobs.company}\n\n` +
                        `Повторна відправка заблокована.`
                    );
                    return;
                }

                await sendTelegram(chatId, "🚀 <b>Запускаю подачу на FINN...</b>\n\n⏳ Це може зайняти 2-5 хвилин.\n🔐 Очікуйте запит на 2FA код!");

                // Call finn-apply edge function
                const { data: result, error } = await supabase.functions.invoke('finn-apply', {
                    body: { jobId: app.jobs.id, applicationId: appId }
                });

                if (error || !result?.success) {
                    await sendTelegram(chatId, `❌ Помилка: ${result?.message || error?.message || 'Unknown'}`);
                    return;
                }

                await sendTelegram(chatId,
                    `✅ <b>Заявка в черзі на обробку!</b>\n\n` +
                    `📋 ${app.jobs.title}\n` +
                    `🏢 ${app.jobs.company}\n\n` +
                    `⏳ Коли отримаєте код на пошту/SMS, надішліть:\n` +
                    `<code>/code XXXXXX</code>`
                );
            }

            // CANCEL TASK - CONFIRMATION REQUEST
            if (data.startsWith('cancel_confirm_')) {
                const appId = data.split('cancel_confirm_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Get application info
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(title, company)')
                    .eq('id', appId)
                    .eq('user_id', userId)
                    .single();

                if (!app) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                if (app.status !== 'sending') {
                    await sendTelegram(chatId,
                        `⚠️ Заявку вже не можна зупинити.\n` +
                        `Поточний статус: ${app.status}`
                    );
                    return;
                }

                await sendTelegram(chatId,
                    `⚠️ <b>Зупинити задачу?</b>\n\n` +
                    `📋 ${app.jobs?.title || 'Unknown'}\n` +
                    `🏢 ${app.jobs?.company || 'Unknown'}\n\n` +
                    `Статус буде скинуто до "approved".`,
                    {
                        inline_keyboard: [[
                            { text: "✅ Так, зупинити", callback_data: `cancel_task_${appId}` },
                            { text: "❌ Ні", callback_data: `cancel_no_${appId}` }
                        ]]
                    }
                );
            }

            // CANCEL TASK - ACTUAL CANCELLATION
            if (data.startsWith('cancel_task_')) {
                const appId = data.split('cancel_task_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Get application with task_id
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(title, company)')
                    .eq('id', appId)
                    .eq('user_id', userId)
                    .single();

                if (!app) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                if (app.status !== 'sending') {
                    await sendTelegram(chatId, `⚠️ Статус вже змінено: ${app.status}`);
                    return;
                }

                const taskId = app.skyvern_metadata?.task_id;

                // Update status to 'approved' (worker will detect and cancel Skyvern task)
                const { error: updateError } = await supabase
                    .from('applications')
                    .update({
                        status: 'approved',
                        skyvern_metadata: {
                            ...app.skyvern_metadata,
                            cancelled_at: new Date().toISOString(),
                            cancelled_task_id: taskId
                        }
                    })
                    .eq('id', appId)
                    .eq('user_id', userId);

                if (updateError) {
                    await sendTelegram(chatId, `❌ Помилка: ${updateError.message}`);
                    return;
                }

                await sendTelegram(chatId,
                    `✅ <b>Задачу зупинено!</b>\n\n` +
                    `📋 ${app.jobs?.title || 'Unknown'}\n` +
                    `🏢 ${app.jobs?.company || 'Unknown'}\n\n` +
                    `Статус повернено до "approved".\n` +
                    `Можете спробувати ще раз пізніше.`
                );
            }

            // CANCEL - USER DECLINED
            if (data.startsWith('cancel_no_')) {
                await sendTelegram(chatId, "👍 Задачу продовжено.");
            }

            // BATCH APPLY - CONFIRM
            if (data === 'batch_apply_confirm') {
                const userId = await getUserIdFromChat(supabase, chatId);
                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Check if worker is running
                const workerStatus = await checkWorkerRunning(supabase, userId);
                if (!workerStatus.isRunning && workerStatus.stuckCount > 0) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Worker не запущений!</b>\n\n` +
                        `У черзі ${workerStatus.stuckCount} заявок (найстаріша: ${workerStatus.oldestMinutes} хв)\n\n` +
                        `<b>Запусти worker:</b>\n` +
                        `<code>cd ~/Jobbot-NO && ./worker/start.sh</code>\n\n` +
                        `Після запуску надішли /apply all ще раз.`
                    );
                    return;
                }

                await sendTelegram(chatId, "⏳ <b>Масова подача розпочата...</b>\nЦе може зайняти кілька хвилин.");

                // Today's date at midnight UTC
                const todayStart = new Date();
                todayStart.setUTCHours(0, 0, 0, 0);
                const todayISO = todayStart.toISOString();

                // Re-query today's hot FINN Easy jobs (fresh data to avoid race conditions)
                const { data: finnJobs } = await supabase
                    .from('jobs')
                    .select('id, title, company, relevance_score, job_url')
                    .eq('user_id', userId)
                    .eq('has_enkel_soknad', true)
                    .gte('relevance_score', 50)
                    .gte('created_at', todayISO)
                    .order('relevance_score', { ascending: false })
                    .limit(15);

                if (!finnJobs || finnJobs.length === 0) {
                    await sendTelegram(chatId, "ℹ️ Сьогодні немає нових FINN Easy вакансій для подачі.");
                    return;
                }

                // Get existing applications for these jobs
                const jobIds = finnJobs.map((j: any) => j.id);
                const { data: existingApps } = await supabase
                    .from('applications')
                    .select('id, job_id, status')
                    .eq('user_id', userId)
                    .in('job_id', jobIds);

                const appByJobId: Record<string, any> = {};
                for (const app of (existingApps || [])) {
                    appByJobId[app.job_id] = app;
                }

                // Classify jobs
                const needCoverLetter: any[] = []; // No application yet
                const readyToSend: any[] = [];     // approved status
                const skipped: any[] = [];          // sent/sending

                for (const job of finnJobs) {
                    const app = appByJobId[job.id];
                    if (!app) {
                        needCoverLetter.push(job);
                    } else if (app.status === 'approved') {
                        readyToSend.push({ ...job, appId: app.id });
                    } else if (app.status === 'draft') {
                        readyToSend.push({ ...job, appId: app.id, needApprove: true });
                    } else {
                        skipped.push(job); // sent, sending, failed
                    }
                }

                if (needCoverLetter.length === 0 && readyToSend.length === 0) {
                    await sendTelegram(chatId, "✅ Всі FINN Easy вакансії вже оброблені!");
                    return;
                }

                let generated = 0;
                let queued = 0;
                let errors = 0;
                const MAX_GENERATE = 6; // Timeout protection

                // Phase 1: Generate cover letters (max 6)
                const toGenerate = needCoverLetter.slice(0, MAX_GENERATE);
                const skippedGen = needCoverLetter.length - toGenerate.length;

                for (const job of toGenerate) {
                    try {
                        await sendTelegram(chatId, `✍️ Генерую søknad: <b>${job.title}</b> (${job.company})`);

                        const { data: genResult, error: invokeError } = await supabase.functions.invoke('generate_application', {
                            body: { job_id: job.id, user_id: userId }
                        });

                        if (invokeError || !genResult?.success) {
                            console.error(`[TG] batch generate error for ${job.id}:`, invokeError || genResult?.message);
                            errors++;
                            continue;
                        }

                        const appId = genResult.application?.id;
                        if (!appId) {
                            errors++;
                            continue;
                        }

                        generated++;

                        // Auto-approve
                        await supabase.from('applications').update({ status: 'approved' }).eq('id', appId);

                        // Submit to FINN
                        const { error: finnError } = await supabase.functions.invoke('finn-apply', {
                            body: { jobId: job.id, applicationId: appId }
                        });

                        if (!finnError) {
                            queued++;
                        } else {
                            console.error(`[TG] batch finn-apply error for ${job.id}:`, finnError);
                            errors++;
                        }
                    } catch (err: any) {
                        console.error(`[TG] batch exception for ${job.id}:`, err);
                        errors++;
                    }
                }

                // Phase 2: Submit ready applications
                for (const job of readyToSend) {
                    try {
                        // Auto-approve drafts
                        if (job.needApprove) {
                            await supabase.from('applications').update({ status: 'approved' }).eq('id', job.appId);
                        }

                        const { error: finnError } = await supabase.functions.invoke('finn-apply', {
                            body: { jobId: job.id, applicationId: job.appId }
                        });

                        if (!finnError) {
                            queued++;
                        } else {
                            console.error(`[TG] batch finn-apply error for ${job.id}:`, finnError);
                            errors++;
                        }
                    } catch (err: any) {
                        console.error(`[TG] batch ready exception for ${job.id}:`, err);
                        errors++;
                    }
                }

                // Final report
                let report = `✅ <b>Масова подача завершена!</b>\n\n`;
                if (generated > 0) report += `✍️ Згенеровано søknader: ${generated}\n`;
                if (queued > 0) report += `⚡ Відправлено в чергу: ${queued}\n`;
                if (errors > 0) report += `❌ Помилки: ${errors}\n`;
                if (skippedGen > 0) report += `⏭ Пропущено (ліміт): ${skippedGen} — надішли /apply all ще раз\n`;
                report += `\n⏳ Worker обробить заявки по 1-5 хвилин кожну.\n🔐 Очікуйте запити на 2FA коди!`;

                await sendTelegram(chatId, report);
                return;
            }

            // BATCH APPLY - CANCEL
            if (data === 'batch_apply_cancel') {
                await sendTelegram(chatId, "❌ Масову подачу скасовано.");
                return;
            }

            // VIEW EXISTING APPLICATION
            if (data.startsWith('view_app_')) {
                const appId = data.split('view_app_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Get application with job info to check form type
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(id, title, company, external_apply_url, job_url, has_enkel_soknad, application_form_type)')
                    .eq('id', appId)
                    .eq('user_id', userId)
                    .single();

                if (app) {
                    let statusText = "📝 Draft";
                    const buttons: any[] = [];
                    // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                    const isFinnEasy = app.jobs?.has_enkel_soknad ||
                                       app.jobs?.application_form_type === 'finn_easy' ||
                                       app.jobs?.external_apply_url?.includes('finn.no/job/apply');

                    if (app.status === 'approved') {
                        statusText = "✅ Approved (Ready to Send)";
                        if (isFinnEasy) {
                            buttons.push({ text: "⚡ Подати на FINN", callback_data: `finn_apply_${app.id}` });
                        } else {
                            buttons.push({ text: "🚀 Auto-Apply (Skyvern)", callback_data: `auto_apply_${app.id}` });
                        }
                    } else if (app.status === 'sending') {
                        statusText = "🚀 Sending...";
                        buttons.push({ text: "🛑 Зупинити", callback_data: `cancel_confirm_${app.id}` });
                    } else if (app.status === 'manual_review') {
                        statusText = "⚠️ Check Task (Skyvern Done)";
                        buttons.push({ text: "🔄 Retry", callback_data: isFinnEasy ? `finn_apply_${app.id}` : `auto_apply_${app.id}` });
                    } else if (app.status === 'sent') {
                        statusText = "📬 Sent to Employer";
                    } else if (app.status === 'failed') {
                        statusText = "❌ Failed to Send";
                        buttons.push({ text: "🚀 Retry", callback_data: isFinnEasy ? `finn_apply_${app.id}` : `auto_apply_${app.id}` });
                    } else {
                        // Draft
                        statusText = "📝 Draft";
                        buttons.push({ text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` });
                    }

                    // Add form type info to message
                    let formInfo = "";
                    if (isFinnEasy) {
                        formInfo = "\n⚡ <i>FINN Enkel Søknad (авто)</i>";
                    } else if (app.jobs?.external_apply_url) {
                        formInfo = `\n📝 <i>Зовнішня форма (вручну)</i>\n🔗 <a href="${app.jobs.external_apply_url}">Відкрити форму</a>`;
                    }

                    const msg = `📂 <b>Ваш Søknad</b>\nСтатус: <b>${statusText}</b>${formInfo}\n\n` +
                                `🇳🇴 <b>Norsk:</b>\n<tg-spoiler>${app.cover_letter_no}</tg-spoiler>\n\n` +
                                `🇺🇦 <b>Переклад:</b>\n<tg-spoiler>${app.cover_letter_uk || '...'}</tg-spoiler>`;

                    await sendTelegram(chatId, msg, { inline_keyboard: [buttons] });
                } else {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                }
            }

            // APPROVE APPLICATION
            if (data.startsWith('approve_app_')) {
                const appId = data.split('approve_app_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                try {
                    // Get application with job to check form type AND get company/title
                    const { data: app } = await supabase
                        .from('applications')
                        .select('*, jobs(id, title, company, external_apply_url, job_url, has_enkel_soknad, application_form_type)')
                        .eq('id', appId)
                        .eq('user_id', userId)
                        .single();

                    const { error } = await supabase.from('applications').update({
                        status: 'approved',
                        approved_at: new Date().toISOString(),
                        skyvern_metadata: { source: 'telegram' }
                    }).eq('id', appId).eq('user_id', userId);

                    if (error) {
                        console.error("Approve DB Error:", error);
                        await sendTelegram(chatId, `❌ <b>Помилка оновлення бази!</b>\n\nДеталі: ${error.message}`);
                        return;
                    }

                    // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                    const isFinnEasy = app?.jobs?.has_enkel_soknad ||
                                       app?.jobs?.application_form_type === 'finn_easy' ||
                                       app?.jobs?.external_apply_url?.includes('finn.no/job/apply');

                    const jobTitle = app?.jobs?.title || 'Вакансія';
                    const companyName = app?.jobs?.company || 'Компанія';

                    let msg = `✅ <b>Søknad підтверджено!</b>\n\n` +
                              `📋 <b>${jobTitle}</b>\n` +
                              `🏢 ${companyName}\n\n`;
                    let kb;

                    if (isFinnEasy) {
                        msg += `⚡ <b>FINN Enkel Søknad доступний!</b>\nНатисніть щоб відправити заявку автоматично:`;
                        kb = { inline_keyboard: [[
                            { text: `⚡ Відправити в ${companyName}`, callback_data: `finn_apply_${appId}` }
                        ]]};
                    } else if (app?.jobs?.external_apply_url) {
                        msg += `📝 Зовнішня форма:\n🔗 <a href="${app.jobs.external_apply_url}">Відкрити форму</a>\n\nАбо запустіть автозаповнення:`;
                        kb = { inline_keyboard: [[
                            { text: "🚀 Auto-Apply (Skyvern)", callback_data: `auto_apply_${appId}` }
                        ]]};
                    } else {
                        msg += "Бажаєте запустити автоматичну подачу через Skyvern?";
                        kb = { inline_keyboard: [[
                            { text: "🚀 Запустити (Auto-Apply)", callback_data: `auto_apply_${appId}` }
                        ]]};
                    }

                    await sendTelegram(chatId, msg, kb);
                } catch (e: any) {
                    console.error("Approve Exception:", e);
                    await sendTelegram(chatId, `❌ Критична помилка: ${e.message}`);
                }
            }

            // AUTO-APPLY (External forms via Skyvern)
            if (data.startsWith('auto_apply_')) {
                const appId = data.split('auto_apply_')[1];
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                // Check if worker is running
                const workerStatus = await checkWorkerRunning(supabase, userId);
                if (!workerStatus.isRunning) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Worker не запущений!</b>\n\n` +
                        `У черзі ${workerStatus.stuckCount} заявок (найстаріша: ${workerStatus.oldestMinutes} хв)\n\n` +
                        `<b>Запусти worker:</b>\n` +
                        `<code>cd worker && python auto_apply.py</code>\n\n` +
                        `Після запуску натисни кнопку ще раз.`
                    );
                    return;
                }

                // Get application with job info
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(id, title, company, external_apply_url, application_form_type)')
                    .eq('id', appId)
                    .eq('user_id', userId)
                    .single();

                if (!app || !app.jobs) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                // Check if already sent (block duplicates)
                if (app.status === 'sent' || app.status === 'sending') {
                    await sendTelegram(chatId,
                        `⚠️ <b>Заявку вже відправлено!</b>\n\n` +
                        `📋 ${app.jobs.title}\n` +
                        `🏢 ${app.jobs.company}\n\n` +
                        `Повторна відправка заблокована.`
                    );
                    return;
                }

                // Update status to sending
                await supabase.from('applications').update({ status: 'sending' }).eq('id', appId).eq('user_id', userId);

                // Build informative message based on form type
                const isRegistration = app.jobs.application_form_type === 'external_registration';
                let domain = '';
                try {
                    domain = new URL(app.jobs.external_apply_url || '').hostname;
                } catch { domain = 'зовнішній сайт'; }

                let infoMsg = `🚀 <b>Auto-Apply запущено!</b>\n\n` +
                    `📋 ${app.jobs.title}\n` +
                    `🏢 ${app.jobs.company}\n` +
                    `🌐 ${domain}\n\n`;

                if (isRegistration) {
                    infoMsg += `🔐 <b>Тип:</b> Потрібна реєстрація\n\n` +
                        `Система перевірить чи є акаунт.\n` +
                        `Якщо ні — зареєструється автоматично.\n` +
                        `⚠️ <i>Можливо будуть запитання в цьому чаті!</i>\n\n`;
                } else {
                    infoMsg += `📝 <b>Тип:</b> Зовнішня форма\n\n` +
                        `Skyvern заповнить та відправить форму.\n\n`;
                }

                infoMsg += `⏳ Обробка може зайняти 1-5 хвилин.\n` +
                    `Переконайтесь що <code>auto_apply.py</code> запущений!`;

                await sendTelegram(chatId, infoMsg);
            }

            // CONFIRM APPLICATION (before Skyvern submission)
            if (data.startsWith('confirm_apply_')) {
                const confirmationId = data.split('confirm_apply_')[1];
                console.log(`✅ [TG] Confirming application: ${confirmationId}`);

                try {
                    // Update confirmation status
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'confirmed',
                            confirmed_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    if (error) {
                        console.error('Confirm error:', error);
                        await sendTelegram(chatId, "⚠️ Помилка підтвердження. Можливо час вже вичерпано.");
                        return;
                    }

                    await sendTelegram(chatId,
                        `✅ <b>Підтверджено!</b>\n\n` +
                        `⏳ Skyvern зараз заповнить та відправить форму.\n` +
                        `Слідкуйте за повідомленнями...`
                    );
                } catch (e: any) {
                    console.error('Confirm exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // CANCEL APPLICATION
            if (data.startsWith('cancel_apply_')) {
                const confirmationId = data.split('cancel_apply_')[1];
                console.log(`❌ [TG] Cancelling application: ${confirmationId}`);

                try {
                    // Update confirmation status
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'cancelled',
                            cancelled_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    if (error) {
                        console.error('Cancel error:', error);
                        await sendTelegram(chatId, "⚠️ Помилка скасування.");
                        return;
                    }

                    await sendTelegram(chatId,
                        `❌ <b>Заявку скасовано</b>\n\n` +
                        `Заявка повернута в чернетки. Ви можете відправити її пізніше.`
                    );
                } catch (e: any) {
                    console.error('Cancel exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // ============================================
            // SMART CONFIRMATION (Variant 4) HANDLERS
            // ============================================

            // SMART CONFIRM - User confirms the auto-filled data
            if (data.startsWith('smart_confirm_')) {
                const confirmationId = data.split('smart_confirm_')[1];
                console.log(`✅ [TG] Smart confirm: ${confirmationId}`);

                try {
                    // Get confirmation with payload
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('*')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf) {
                        await sendTelegram(chatId, "⚠️ Підтвердження не знайдено або вже оброблено.");
                        return;
                    }

                    const payload = conf.payload || {};
                    const missingFields = payload.missing_fields || [];

                    // Check if there are required missing fields
                    const requiredMissing = missingFields.filter((f: any) => f.required);
                    if (requiredMissing.length > 0) {
                        const fieldNames = requiredMissing.map((f: any) => f.label).join(', ');
                        await sendTelegram(chatId,
                            `⚠️ <b>Не можу підтвердити!</b>\n\n` +
                            `Є обов'язкові поля без відповідей:\n` +
                            `❗ ${fieldNames}\n\n` +
                            `Натисніть "📝 Відповісти на питання" щоб заповнити.`
                        );
                        return;
                    }

                    // Update confirmation status
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'confirmed',
                            confirmed_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    if (error) {
                        console.error('Smart confirm error:', error);
                        await sendTelegram(chatId, "⚠️ Помилка підтвердження. Можливо час вже вичерпано.");
                        return;
                    }

                    const matchedCount = (payload.matched_fields || []).length;
                    await sendTelegram(chatId,
                        `✅ <b>Підтверджено!</b>\n\n` +
                        `📋 Буде заповнено ${matchedCount} полів\n` +
                        `⏳ Skyvern зараз заповнить форму...\n\n` +
                        `Слідкуйте за повідомленнями...`
                    );
                } catch (e: any) {
                    console.error('Smart confirm exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // SMART ANSWER - User wants to answer missing questions
            if (data.startsWith('smart_answer_')) {
                const confirmationId = data.split('smart_answer_')[1];
                console.log(`📝 [TG] Smart answer: ${confirmationId}`);

                try {
                    // Get confirmation with payload
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('*')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf || !conf.payload) {
                        await sendTelegram(chatId, "⚠️ Підтвердження не знайдено.");
                        return;
                    }

                    const payload = conf.payload;
                    const missingFields = payload.missing_fields || [];

                    if (missingFields.length === 0) {
                        await sendTelegram(chatId, "✅ Всі поля вже заповнені!");
                        return;
                    }

                    // Start asking questions - first field
                    const field = missingFields[0];
                    const label = field.label || 'Unknown';
                    const fieldType = field.field_type || 'text';
                    const options = field.options || [];
                    const required = field.required;

                    // Update confirmation with pending field index
                    await supabase
                        .from('application_confirmations')
                        .update({
                            payload: { ...payload, pending_field_index: 0, pending_field_label: label }
                        })
                        .eq('id', confirmationId);

                    // Build question message
                    const reqText = required ? " ⚠️ (обов'язкове)" : "";
                    let message = `❓ <b>${label}</b>${reqText}\n\n`;

                    const keyboard: any = { inline_keyboard: [] };

                    if ((fieldType === 'select' || fieldType === 'radio') && options.length > 0) {
                        message += "Обери варіант:";
                        // Add option buttons (max 2 per row)
                        let row: any[] = [];
                        for (let i = 0; i < Math.min(options.length, 12); i++) {
                            row.push({
                                text: options[i],
                                callback_data: `field_ans_${confirmationId}_0_${i}`
                            });
                            if (row.length === 2) {
                                keyboard.inline_keyboard.push(row);
                                row = [];
                            }
                        }
                        if (row.length > 0) {
                            keyboard.inline_keyboard.push(row);
                        }
                    } else if (fieldType === 'date') {
                        message += "Напиши дату у форматі DD.MM.YYYY:";
                    } else {
                        message += "Напиши відповідь:";
                    }

                    // Add skip button if not required
                    if (!required) {
                        keyboard.inline_keyboard.push([{
                            text: "⏭️ Пропустити",
                            callback_data: `field_skip_${confirmationId}_0`
                        }]);
                    }

                    await sendTelegram(chatId, message, keyboard.inline_keyboard.length > 0 ? keyboard : undefined);
                } catch (e: any) {
                    console.error('Smart answer exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // SMART CANCEL - User cancels
            if (data.startsWith('smart_cancel_')) {
                const confirmationId = data.split('smart_cancel_')[1];
                console.log(`❌ [TG] Smart cancel: ${confirmationId}`);

                try {
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'cancelled',
                            cancelled_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId);

                    if (error) {
                        console.error('Smart cancel error:', error);
                    }

                    await sendTelegram(chatId,
                        `❌ <b>Заявку скасовано</b>\n\n` +
                        `Ви можете подати заявку пізніше.`
                    );
                } catch (e: any) {
                    console.error('Smart cancel exception:', e);
                }
            }

            // FIELD ANSWER - User selects an option for a missing field
            if (data.startsWith('field_ans_')) {
                // Format: field_ans_{confirmationId}_{fieldIndex}_{optionIndex}
                const parts = data.split('_');
                const confirmationId = parts[2];
                const fieldIndex = parseInt(parts[3]);
                const optionIndex = parseInt(parts[4]);

                console.log(`📝 [TG] Field answer: conf=${confirmationId}, field=${fieldIndex}, opt=${optionIndex}`);

                try {
                    // Get confirmation
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('*')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf || !conf.payload) {
                        await sendTelegram(chatId, "⚠️ Підтвердження не знайдено.");
                        return;
                    }

                    const payload = conf.payload;
                    const missingFields = payload.missing_fields || [];
                    const field = missingFields[fieldIndex];

                    if (!field) {
                        await sendTelegram(chatId, "⚠️ Поле не знайдено.");
                        return;
                    }

                    const options = field.options || [];
                    const answer = options[optionIndex] || `Option ${optionIndex + 1}`;
                    const label = field.label;

                    // Save answer to knowledge base
                    const { error: kbError } = await supabase
                        .from('user_knowledge_base')
                        .upsert({
                            question: label,
                            answer: answer,
                            category: 'form_field'
                        }, { onConflict: 'question' });

                    if (kbError) {
                        console.error('KB save error:', kbError);
                    }

                    // Move field from missing to matched
                    const matchedFields = payload.matched_fields || [];
                    matchedFields.push({
                        label: label,
                        value: answer,
                        source: 'user'
                    });

                    // Remove from missing
                    missingFields.splice(fieldIndex, 1);

                    // Update payload
                    const newPayload = {
                        ...payload,
                        matched_fields: matchedFields,
                        missing_fields: missingFields
                    };

                    await supabase
                        .from('application_confirmations')
                        .update({ payload: newPayload })
                        .eq('id', confirmationId);

                    // Ask next question or finish
                    if (missingFields.length > 0) {
                        await sendTelegram(chatId, `✅ <b>${label}:</b> ${answer}\n\n⏳ Наступне питання...`);

                        // Ask next field
                        const nextField = missingFields[0];
                        const nextLabel = nextField.label || 'Unknown';
                        const nextType = nextField.field_type || 'text';
                        const nextOptions = nextField.options || [];
                        const nextRequired = nextField.required;

                        const reqText = nextRequired ? " ⚠️ (обов'язкове)" : "";
                        let message = `❓ <b>${nextLabel}</b>${reqText}\n\n`;

                        const keyboard: any = { inline_keyboard: [] };

                        if ((nextType === 'select' || nextType === 'radio') && nextOptions.length > 0) {
                            message += "Обери варіант:";
                            let row: any[] = [];
                            for (let i = 0; i < Math.min(nextOptions.length, 12); i++) {
                                row.push({
                                    text: nextOptions[i],
                                    callback_data: `field_ans_${confirmationId}_0_${i}`
                                });
                                if (row.length === 2) {
                                    keyboard.inline_keyboard.push(row);
                                    row = [];
                                }
                            }
                            if (row.length > 0) {
                                keyboard.inline_keyboard.push(row);
                            }
                        } else if (nextType === 'date') {
                            message += "Напиши дату у форматі DD.MM.YYYY:";
                        } else {
                            message += "Напиши відповідь:";
                        }

                        if (!nextRequired) {
                            keyboard.inline_keyboard.push([{
                                text: "⏭️ Пропустити",
                                callback_data: `field_skip_${confirmationId}_0`
                            }]);
                        }

                        await sendTelegram(chatId, message, keyboard.inline_keyboard.length > 0 ? keyboard : undefined);
                    } else {
                        // All fields answered
                        await sendTelegram(chatId,
                            `✅ <b>Всі питання відповіджено!</b>\n\n` +
                            `📋 Всього полів: ${matchedFields.length}\n\n` +
                            `Тепер можете підтвердити заявку:`,
                            { inline_keyboard: [[
                                { text: "✅ Підтвердити", callback_data: `smart_confirm_${confirmationId}` }
                            ]]}
                        );
                    }
                } catch (e: any) {
                    console.error('Field answer exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // FIELD SKIP - User skips a non-required field
            if (data.startsWith('field_skip_')) {
                // Format: field_skip_{confirmationId}_{fieldIndex}
                const parts = data.split('_');
                const confirmationId = parts[2];
                const fieldIndex = parseInt(parts[3]);

                console.log(`⏭️ [TG] Field skip: conf=${confirmationId}, field=${fieldIndex}`);

                try {
                    // Get confirmation
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('*')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf || !conf.payload) {
                        await sendTelegram(chatId, "⚠️ Підтвердження не знайдено.");
                        return;
                    }

                    const payload = conf.payload;
                    const missingFields = payload.missing_fields || [];

                    // Remove skipped field
                    missingFields.splice(fieldIndex, 1);

                    // Update payload
                    const newPayload = {
                        ...payload,
                        missing_fields: missingFields
                    };

                    await supabase
                        .from('application_confirmations')
                        .update({ payload: newPayload })
                        .eq('id', confirmationId);

                    // Ask next question or finish
                    if (missingFields.length > 0) {
                        const nextField = missingFields[0];
                        const nextLabel = nextField.label || 'Unknown';
                        const nextType = nextField.field_type || 'text';
                        const nextOptions = nextField.options || [];
                        const nextRequired = nextField.required;

                        const reqText = nextRequired ? " ⚠️ (обов'язкове)" : "";
                        let message = `❓ <b>${nextLabel}</b>${reqText}\n\n`;

                        const keyboard: any = { inline_keyboard: [] };

                        if ((nextType === 'select' || nextType === 'radio') && nextOptions.length > 0) {
                            message += "Обери варіант:";
                            let row: any[] = [];
                            for (let i = 0; i < Math.min(nextOptions.length, 12); i++) {
                                row.push({
                                    text: nextOptions[i],
                                    callback_data: `field_ans_${confirmationId}_0_${i}`
                                });
                                if (row.length === 2) {
                                    keyboard.inline_keyboard.push(row);
                                    row = [];
                                }
                            }
                            if (row.length > 0) {
                                keyboard.inline_keyboard.push(row);
                            }
                        } else if (nextType === 'date') {
                            message += "Напиши дату у форматі DD.MM.YYYY:";
                        } else {
                            message += "Напиши відповідь:";
                        }

                        if (!nextRequired) {
                            keyboard.inline_keyboard.push([{
                                text: "⏭️ Пропустити",
                                callback_data: `field_skip_${confirmationId}_0`
                            }]);
                        }

                        await sendTelegram(chatId, message, keyboard.inline_keyboard.length > 0 ? keyboard : undefined);
                    } else {
                        // All fields done
                        const matchedCount = (payload.matched_fields || []).length;
                        await sendTelegram(chatId,
                            `✅ <b>Всі питання оброблено!</b>\n\n` +
                            `📋 Готово полів: ${matchedCount}\n\n` +
                            `Тепер можете підтвердити заявку:`,
                            { inline_keyboard: [[
                                { text: "✅ Підтвердити", callback_data: `smart_confirm_${confirmationId}` }
                            ]]}
                        );
                    }
                } catch (e: any) {
                    console.error('Field skip exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // REGISTRATION QUESTION ANSWER (inline button)
            if (data.startsWith('regq_')) {
                // Format: regq_{question_id}_{option_number}
                const parts = data.split('_');
                const questionId = parts[1];
                const optionNum = parseInt(parts[2]);

                console.log(`📋 [TG] Registration question answer: ${questionId}, option: ${optionNum}`);

                // Get question with options
                const { data: question } = await supabase
                    .from('registration_questions')
                    .select('*')
                    .eq('id', questionId)
                    .single();

                if (!question) {
                    await sendTelegram(chatId, "⚠️ Питання не знайдено або вже відповіли.");
                    return;
                }

                // Get the selected option
                const options = question.options || [];
                const answer = options[optionNum - 1] || `Option ${optionNum}`;

                // Update question with answer
                const { error: updateError } = await supabase
                    .from('registration_questions')
                    .update({
                        status: 'answered',
                        answer: answer,
                        answer_source: 'user_telegram',
                        answered_at: new Date().toISOString()
                    })
                    .eq('id', questionId);

                if (updateError) {
                    await sendTelegram(chatId, "❌ Помилка збереження відповіді.");
                    return;
                }

                // Update flow Q&A history
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('qa_history, site_name')
                    .eq('id', question.flow_id)
                    .single();

                if (flow) {
                    const qaHistory = flow.qa_history || [];
                    qaHistory.push({
                        question: question.question_text,
                        answer: answer,
                        field_name: question.field_name,
                        answered_at: new Date().toISOString()
                    });

                    await supabase
                        .from('registration_flows')
                        .update({
                            status: 'registering',
                            pending_question: null,
                            qa_history: qaHistory
                        })
                        .eq('id', question.flow_id);
                }

                await sendTelegram(chatId,
                    `✅ <b>Відповідь прийнято!</b>\n\n` +
                    `📝 ${question.question_text}\n` +
                    `✏️ ${answer}\n\n` +
                    `⏳ Продовжую реєстрацію...`
                );
            }

            // SKYVERN Q&A ANSWER (inline button) - for form filling questions
            if (data.startsWith('skyq_')) {
                // Format: skyq_{question_id}_{option_number}
                const parts = data.split('_');
                const questionId = parts[1];
                const optionNum = parseInt(parts[2]);

                console.log(`📋 [TG] Skyvern Q&A answer: ${questionId}, option: ${optionNum}`);

                const { data: question } = await supabase
                    .from('registration_questions')
                    .select('*')
                    .eq('id', questionId)
                    .single();

                if (!question) {
                    await sendTelegram(chatId, "⚠️ Питання не знайдено або вже відповіли.");
                    return;
                }

                const options = question.options || [];
                const answer = options[optionNum] || `Option ${optionNum}`;

                const { error: updateError } = await supabase
                    .from('registration_questions')
                    .update({
                        status: 'answered',
                        answer: answer,
                        answer_source: 'user_telegram',
                        answered_at: new Date().toISOString()
                    })
                    .eq('id', questionId);

                if (updateError) {
                    await sendTelegram(chatId, "❌ Помилка збереження відповіді.");
                    return;
                }

                await sendTelegram(chatId,
                    `✅ <b>Збережено!</b>\n\n` +
                    `📝 ${question.question_text}\n` +
                    `✏️ ${answer}\n\n` +
                    `⏳ Продовжую заповнення форми...`
                );
            }

            // ============================================
            // PAYLOAD PREVIEW HANDLERS
            // ============================================

            // PAYLOAD CONFIRM - User confirms payload preview
            if (data.startsWith('payconfirm_')) {
                const confirmationId = data.split('payconfirm_')[1];
                console.log(`✅ [TG] Payload confirm: ${confirmationId}`);

                try {
                    await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'confirmed',
                            confirmed_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    await sendTelegram(chatId,
                        `✅ <b>Підтверджено!</b>\n\n` +
                        `⏳ Skyvern заповнює форму...`
                    );
                } catch (e: any) {
                    console.error('Payload confirm error:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // PAYLOAD CANCEL - User cancels payload preview
            if (data.startsWith('paycancel_')) {
                const confirmationId = data.split('paycancel_')[1];
                console.log(`❌ [TG] Payload cancel: ${confirmationId}`);

                try {
                    await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'cancelled',
                            cancelled_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    await sendTelegram(chatId,
                        `❌ <b>Скасовано</b>\n\n` +
                        `Заявка не буде відправлена.`
                    );
                } catch (e: any) {
                    console.error('Payload cancel error:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // PAYLOAD EDIT - Show editable field buttons
            if (data.startsWith('payedit_')) {
                const confirmationId = data.split('payedit_')[1];
                console.log(`✏️ [TG] Payload edit: ${confirmationId}`);

                try {
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('payload')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf) {
                        await sendTelegram(chatId, "⚠️ Не знайдено.");
                        return;
                    }

                    const fields = conf.payload?.fields || {};
                    const editableFields = [
                        { key: 'full_name', label: '👤 Ім\'я' },
                        { key: 'email', label: '📧 Email' },
                        { key: 'phone', label: '📱 Телефон' },
                        { key: 'birth_date', label: '🎂 Дата народження' },
                        { key: 'street', label: '🏠 Вулиця' },
                        { key: 'postal_code', label: '📮 Індекс' },
                        { key: 'city', label: '🏙 Місто' },
                        { key: 'nationality', label: '🌍 Громадянство' },
                        { key: 'gender', label: '⚧ Стать' },
                    ];

                    const keyboard = editableFields.map(f => [{
                        text: `${f.label}: ${(fields[f.key] || '—').substring(0, 20)}`,
                        callback_data: `payfield_${confirmationId}_${f.key}`
                    }]);

                    // Add back button
                    keyboard.push([
                        { text: '✅ Відправити', callback_data: `payconfirm_${confirmationId}` },
                        { text: '❌ Скасувати', callback_data: `paycancel_${confirmationId}` },
                    ]);

                    await sendTelegram(chatId,
                        "✏️ <b>Оберіть поле для редагування:</b>",
                        { inline_keyboard: keyboard }
                    );
                } catch (e: any) {
                    console.error('Payload edit error:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // PAYLOAD FIELD SELECT - User selected a field to edit
            if (data.startsWith('payfield_')) {
                const parts = data.split('_');
                // Format: payfield_{confirmationId}_{fieldKey}
                // confirmationId is UUID (has hyphens), fieldKey may have underscores
                // Split: ['payfield', '{uuid-part1}', ...]
                // We need to reconstruct: confirmationId = parts[1], fieldKey = rest after confirmationId
                const withoutPrefix = data.substring('payfield_'.length);
                // UUID is 36 chars (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
                const confirmationId = withoutPrefix.substring(0, 36);
                const fieldKey = withoutPrefix.substring(37); // skip the underscore after UUID

                console.log(`✏️ [TG] Payload field edit: ${confirmationId}, field: ${fieldKey}`);

                try {
                    const { data: conf } = await supabase
                        .from('application_confirmations')
                        .select('payload')
                        .eq('id', confirmationId)
                        .single();

                    if (!conf) {
                        await sendTelegram(chatId, "⚠️ Не знайдено.");
                        return;
                    }

                    const payload = conf.payload || {};

                    // Store pending edit field
                    await supabase
                        .from('application_confirmations')
                        .update({
                            payload: { ...payload, pending_edit_field: fieldKey }
                        })
                        .eq('id', confirmationId);

                    const fieldLabels: Record<string, string> = {
                        'full_name': '👤 Ім\'я',
                        'email': '📧 Email',
                        'phone': '📱 Телефон',
                        'birth_date': '🎂 Дата народження',
                        'street': '🏠 Вулиця',
                        'postal_code': '📮 Індекс',
                        'city': '🏙 Місто',
                        'nationality': '🌍 Громадянство',
                        'gender': '⚧ Стать',
                    };

                    const currentValue = payload.fields?.[fieldKey] || '';
                    const label = fieldLabels[fieldKey] || fieldKey;

                    await sendTelegram(chatId,
                        `✏️ <b>Редагування: ${label}</b>\n` +
                        `Поточне значення: <code>${currentValue || '(пусто)'}</code>\n\n` +
                        `Введіть нове значення:`
                    );
                } catch (e: any) {
                    console.error('Payload field error:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // REGISTRATION CONFIRMATION
            if (data.startsWith('reg_confirm_')) {
                const flowId = data.split('reg_confirm_')[1];

                await supabase
                    .from('registration_flows')
                    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
                    .eq('id', flowId);

                await sendTelegram(chatId, "✅ <b>Підтверджено!</b>\n\n⏳ Починаю реєстрацію...");
            }

            // REGISTRATION EDIT - Show editable fields
            if (data.startsWith('reg_edit_')) {
                const flowId = data.split('reg_edit_')[1];

                // Get flow with profile data
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('profile_data_snapshot, site_name')
                    .eq('id', flowId)
                    .single();

                if (flow && flow.profile_data_snapshot) {
                    const pd = flow.profile_data_snapshot;
                    const siteName = flow.site_name || 'сайт';

                    const editMsg = (
                        `✏️ <b>Редагування даних для ${siteName}</b>\n\n` +
                        `Оберіть поле для редагування:\n\n` +
                        `👤 Ім'я: <code>${pd.full_name || '—'}</code>\n` +
                        `📱 Телефон: <code>${pd.phone || '—'}</code>\n` +
                        `🏠 Місто: <code>${pd.city || '—'}</code>\n` +
                        `📮 Індекс: <code>${pd.postal_code || '—'}</code>\n\n` +
                        `Натисніть на поле або напишіть нове значення у форматі:\n` +
                        `<code>поле: нове значення</code>\n\n` +
                        `Наприклад: <code>телефон: +47 123 45 678</code>`
                    );

                    const editKeyboard = {
                        inline_keyboard: [
                            [
                                { text: "👤 Ім'я", callback_data: `reg_field_${flowId}_full_name` },
                                { text: "📱 Телефон", callback_data: `reg_field_${flowId}_phone` }
                            ],
                            [
                                { text: "🏠 Місто", callback_data: `reg_field_${flowId}_city` },
                                { text: "📮 Індекс", callback_data: `reg_field_${flowId}_postal_code` }
                            ],
                            [
                                { text: "✅ Готово - продовжити", callback_data: `reg_confirm_${flowId}` }
                            ],
                            [
                                { text: "❌ Скасувати", callback_data: `reg_cancel_${flowId}` }
                            ]
                        ]
                    };

                    await sendTelegram(chatId, editMsg, editKeyboard);

                    // Update flow to editing state
                    await supabase
                        .from('registration_flows')
                        .update({ status: 'editing' })
                        .eq('id', flowId);
                } else {
                    await sendTelegram(chatId, "⚠️ Не вдалося завантажити дані для редагування.");
                }
            }

            // REGISTRATION FIELD EDIT - Select specific field to edit
            if (data.startsWith('reg_field_')) {
                const parts = data.split('reg_field_')[1].split('_');
                const flowId = parts[0];
                const fieldName = parts.slice(1).join('_');

                const fieldLabels: Record<string, string> = {
                    'full_name': "Ім'я",
                    'phone': 'Телефон',
                    'city': 'Місто',
                    'postal_code': 'Поштовий індекс'
                };

                const label = fieldLabels[fieldName] || fieldName;

                // Update flow with pending edit field
                await supabase
                    .from('registration_flows')
                    .update({
                        pending_edit_field: fieldName,
                        status: 'editing_field'
                    })
                    .eq('id', flowId);

                await sendTelegram(chatId,
                    `✏️ <b>Редагування: ${label}</b>\n\n` +
                    `Введіть нове значення для поля "${label}":`
                );
            }

            // REGISTRATION CANCEL
            if (data.startsWith('reg_cancel_')) {
                const flowId = data.split('reg_cancel_')[1];

                await supabase
                    .from('registration_flows')
                    .update({ status: 'cancelled', error_message: 'Cancelled by user' })
                    .eq('id', flowId);

                await sendTelegram(chatId, "❌ <b>Реєстрацію скасовано.</b>");
            }

            // SHOW LAST SCAN RESULTS (all jobs)
            if (data === 'show_last_scan' || data === 'show_hot_scan') {
                const onlyHot = data === 'show_hot_scan';
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                await sendTelegram(chatId, onlyHot ? "🔥 <b>Завантажую релевантні вакансії...</b>" : "📋 <b>Завантажую всі вакансії...</b>");

                // Get last successful scan from system_logs for this user
                const { data: lastScan } = await supabase
                    .from('system_logs')
                    .select('details')
                    .eq('event_type', 'SCAN')
                    .eq('status', 'SUCCESS')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (!lastScan?.details?.scannedJobIds || lastScan.details.scannedJobIds.length === 0) {
                    await sendTelegram(chatId, "⚠️ Немає даних про останнє сканування.");
                    return;
                }

                const jobIds = lastScan.details.scannedJobIds;

                // Query jobs for this user
                let query = supabase.from('jobs').select('*').in('id', jobIds).eq('user_id', userId);
                if (onlyHot) {
                    query = query.gte('relevance_score', 50);
                }
                const { data: jobs } = await query.order('relevance_score', { ascending: false });

                if (!jobs || jobs.length === 0) {
                    await sendTelegram(chatId, onlyHot ? "⚠️ Немає вакансій з релевантністю ≥50%." : "⚠️ Немає вакансій.");
                    return;
                }

                // Show each job with action buttons
                for (const job of jobs.slice(0, 10)) { // Limit to 10 to avoid spam
                    const score = job.relevance_score || 0;
                    const scoreEmoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
                    const hotEmoji = score >= 80 ? ' 🔥' : '';

                    // Format application form type
                    const formInfo = formatFormType(job);

                    // Get AI analysis and tasks (if available)
                    const aiAnalysis = job.ai_recommendation
                        ? `\n\n💬 <b>AI-аналіз:</b>\n${job.ai_recommendation.substring(0, 300)}${job.ai_recommendation.length > 300 ? '...' : ''}`
                        : '';
                    const tasks = job.tasks_summary
                        ? `\n\n📋 <b>Обов'язки:</b>\n${job.tasks_summary.substring(0, 200)}${job.tasks_summary.length > 200 ? '...' : ''}`
                        : '';

                    const jobMsg = `🏢 <b>${job.title}</b>${hotEmoji}\n` +
                        `🏢 ${job.company || 'Компанія не вказана'}\n` +
                        `📍 ${job.location || 'Norway'}\n` +
                        `📊 <b>${score}/100</b> ${scoreEmoji}\n` +
                        `${formInfo}` +
                        aiAnalysis +
                        tasks +
                        `\n\n🔗 <a href="${job.job_url}">Оригінал</a>`;

                    // Check if application exists for this user
                    const { data: existingApp } = await supabase
                        .from('applications')
                        .select('id, status')
                        .eq('job_id', job.id)
                        .eq('user_id', userId)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    const buttons: any[] = [];
                    let statusMsg = "";

                    if (!existingApp) {
                        statusMsg = "\n❌ <i>Søknad не створено</i>";
                        if (score >= 50) {
                            buttons.push({ text: "✍️ Написати Søknad", callback_data: `write_app_${job.id}` });
                        }
                    } else {
                        switch (existingApp.status) {
                            case 'draft': statusMsg = "\n📝 <i>Є чернетка</i>"; break;
                            case 'approved': statusMsg = "\n✅ <i>Затверджено</i>"; break;
                            case 'sent': statusMsg = "\n📬 <i>Відправлено</i>"; break;
                            default: statusMsg = `\n📋 <i>${existingApp.status}</i>`;
                        }
                        buttons.push({ text: "📂 Показати Søknad", callback_data: `view_app_${existingApp.id}` });
                    }

                    const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
                    await sendTelegram(chatId, jobMsg + statusMsg, keyboard);
                }

                if (jobs.length > 10) {
                    await sendTelegram(chatId, `ℹ️ Показано 10 з ${jobs.length} вакансій. Решту дивіться в Dashboard.`);
                }
            }
        }

        // --- 2. HANDLE TEXT MESSAGES ---
        if (update.message && update.message.text) {
            const text = update.message.text.trim();
            const chatId = update.message.chat.id;
            const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? 'https://jobbotnetlify.netlify.app';

            console.log(`💬 [TG] Message from ${chatId}: "${text}"`);
            console.log(`💬 [TG] Dashboard URL: ${dashboardUrl}`);

            // LINK COMMAND - Link Telegram to account via code
            if (text.startsWith('/link ') || text.startsWith('/link')) {
                const code = text.replace('/link', '').trim().toUpperCase();
                const chatIdStr = chatId.toString();

                if (!code || code.length < 4) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Невірний формат</b>\n\n` +
                        `Використовуйте: <code>/link XXXXXX</code>\n\n` +
                        `Код привязки можна отримати в Settings → Automation на сайті.`
                    );
                    return;
                }

                console.log(`🔗 [TG] Link attempt: code=${code}, chat=${chatIdStr}`);

                // Check if already linked
                const { data: existingLink } = await supabase
                    .from('user_settings')
                    .select('user_id')
                    .eq('telegram_chat_id', chatIdStr)
                    .single();

                if (existingLink) {
                    await sendTelegram(chatId,
                        `✅ <b>Telegram вже підключено!</b>\n\n` +
                        `Ваш акаунт вже прив'язаний до цього чату.\n` +
                        `Якщо хочете перепривязати — від'єднайте в Settings.`
                    );
                    return;
                }

                // Find user with this code
                const { data: userWithCode, error: findError } = await supabase
                    .from('user_settings')
                    .select('id, user_id, telegram_link_code_expires_at')
                    .eq('telegram_link_code', code)
                    .single();

                if (findError || !userWithCode) {
                    console.log(`❌ [TG] Code not found: ${code}`);
                    await sendTelegram(chatId,
                        `❌ <b>Код не знайдено</b>\n\n` +
                        `Перевірте правильність коду.\n` +
                        `Код можна отримати в Settings → Automation.`
                    );
                    return;
                }

                // Check expiration
                if (userWithCode.telegram_link_code_expires_at) {
                    const expiresAt = new Date(userWithCode.telegram_link_code_expires_at);
                    if (expiresAt < new Date()) {
                        console.log(`⏰ [TG] Code expired: ${code}`);
                        await sendTelegram(chatId,
                            `⏰ <b>Код прострочений</b>\n\n` +
                            `Згенеруйте новий код в Settings → Automation.`
                        );
                        return;
                    }
                }

                // Link chat to user and clear code
                const { error: linkError } = await supabase
                    .from('user_settings')
                    .update({
                        telegram_chat_id: chatIdStr,
                        telegram_link_code: null,
                        telegram_link_code_expires_at: null
                    })
                    .eq('id', userWithCode.id);

                if (linkError) {
                    console.error(`❌ [TG] Link error: ${linkError.message}`);
                    await sendTelegram(chatId,
                        `❌ <b>Помилка привязки</b>\n\n` +
                        `Спробуйте ще раз або зверніться в підтримку.`
                    );
                    return;
                }

                console.log(`✅ [TG] Successfully linked chat ${chatIdStr} to user ${userWithCode.user_id}`);
                await sendTelegram(chatId,
                    `✅ <b>Telegram успішно підключено!</b>\n\n` +
                    `🔔 Тепер ви отримуватимете:\n` +
                    `• Сповіщення про нові вакансії\n` +
                    `• Запити 2FA кодів для FINN\n` +
                    `• Статуси відправлених заявок\n\n` +
                    `📊 Dashboard: ${dashboardUrl}`
                );
                return;
            }

            // START / HELP
            if (text === '/start' || text === '/help') {
                // Check if this chat is already linked
                const chatIdStr = chatId.toString();
                const { data: existingLink } = await supabase
                    .from('user_settings')
                    .select('user_id')
                    .eq('telegram_chat_id', chatIdStr)
                    .single();

                let linkStatus = '';
                let statsSection = '';

                if (!existingLink) {
                    // Not linked - show instructions
                    linkStatus = `\n\n⚠️ <b>Telegram не підключено</b>\n` +
                        `Щоб підключити:\n` +
                        `1. Відкрийте Settings → Automation на сайті\n` +
                        `2. Згенеруйте код привязки\n` +
                        `3. Надішліть: <code>/link КОД</code>`;
                    statsSection = `📊 <i>Статистика доступна після привязки</i>`;
                } else {
                    linkStatus = `\n\n✅ Telegram підключено.`;
                    const userId = existingLink.user_id;

                    // Fetch statistics for the welcome message (filtered by user_id)
                    const today = new Date();
                    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                    const weekAgoStr = weekAgo.toISOString();

                    const { count: totalJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId);
                    const { count: newThisWeek } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', weekAgoStr);
                    const { count: relevantJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('relevance_score', 50);
                    const { count: sentApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'sent');
                    const { count: pendingApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['draft', 'approved']);

                    statsSection = `📊 <b>Статистика:</b>\n` +
                        `🏢 Всього вакансій: <b>${totalJobs || 0}</b>\n` +
                        `🆕 Нових за тиждень: <b>${newThisWeek || 0}</b>\n` +
                        `🎯 Релевантних (≥50%): <b>${relevantJobs || 0}</b>\n` +
                        `✅ Відправлено заявок: <b>${sentApps || 0}</b>\n` +
                        `📝 В обробці: <b>${pendingApps || 0}</b>`;
                }

                await sendTelegram(chatId,
                    `👋 <b>Вітаю в JobBot Norway!</b>\n\n` +
                    `${statsSection}\n\n` +
                    `<b>Команди:</b>\n` +
                    `/link КОД - Привязати Telegram\n` +
                    `/scan - Запустити сканування\n` +
                    `/report - Денний звіт\n` +
                    `/apply - Подати на FINN Easy\n` +
                    `/apply all - Масова подача\n` +
                    `<code>123456</code> - Ввести код 2FA (просто цифри)\n\n` +
                    `Або просто відправ посилання на FINN.no!${linkStatus}\n\n` +
                    `📊 Dashboard: ${dashboardUrl}`
                );
                return;
            }

            // REPORT
            if (text === '/report') {
                const userId = await getUserIdFromChat(supabase, chatId);

                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                const { count: totalJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId);
                const today = new Date().toISOString().split('T')[0];
                const { count: newJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', today);
                const { count: sentApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['sent', 'manual_review']);

                await sendTelegram(chatId,
                    `📊 <b>Звіт</b>\n\n` +
                    `🏢 Всього вакансій: <b>${totalJobs || 0}</b>\n` +
                    `🆕 Нових сьогодні: <b>${newJobs || 0}</b>\n` +
                    `✅ Відправлено заявок: <b>${sentApps || 0}</b>\n\n` +
                    `🔗 <a href="${dashboardUrl}">Дашборд</a>`
                );
                return;
            }

            // SCAN - invoke scheduled-scanner for full pipeline
            if (text === '/scan') {
                const userId = await getUserIdFromChat(supabase, chatId);
                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                await sendTelegram(chatId, "🔎 <b>Запускаю повне сканування...</b>");

                const { error } = await supabase.functions.invoke('scheduled-scanner', {
                    body: { forceRun: true, source: 'TELEGRAM', userId: userId }
                });

                if (error) {
                    console.error('[TG] scheduled-scanner invoke error:', error);
                    await sendTelegram(chatId, `⚠️ Помилка сканування: ${error.message}`);
                }
                // scheduled-scanner sends all messages (progress, job cards) directly to user's telegram
                return;
            }

            // WORKER STATUS - admin only (v14.0 - heartbeat + rich stats)
            if (text === '/worker') {
                const userId = await getUserIdFromChat(supabase, chatId);
                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                if (!(await isAdmin(supabase, userId))) {
                    await sendTelegram(chatId, "⛔ Ця команда доступна тільки адміністратору.");
                    return;
                }

                // --- Section 1: Worker + Skyvern Health (from heartbeat table) ---
                const { data: heartbeat } = await supabase
                    .from('worker_heartbeat')
                    .select('*')
                    .eq('id', 'main')
                    .single();

                let msg = `🤖 <b>Worker Status</b>\n\n`;

                if (heartbeat?.last_heartbeat) {
                    const lastBeat = new Date(heartbeat.last_heartbeat);
                    const staleMs = Date.now() - lastBeat.getTime();
                    const isAlive = staleMs < 30000; // worker polls every 10s, 30s = stale

                    if (isAlive) {
                        const uptime = heartbeat.started_at ? formatUptime(new Date(heartbeat.started_at)) : '?';
                        msg += `🟢 Worker: <b>Працює</b> (uptime: ${uptime})\n`;
                        msg += heartbeat.skyvern_healthy
                            ? `✅ Skyvern: Доступний\n`
                            : `❌ Skyvern: Недоступний\n`;
                        msg += `🔄 Цикл: #${heartbeat.poll_cycle}, оброблено: ${heartbeat.applications_processed}\n`;
                    } else {
                        msg += `🔴 Worker: <b>Не працює</b>\n`;
                        msg += `   Останній сигнал: ${formatAgo(lastBeat)}\n`;
                        msg += `❓ Skyvern: Невідомо\n`;
                    }
                } else {
                    msg += `🔴 Worker: <b>Не працює</b>\n`;
                    msg += `   Жодного сигналу не було\n`;
                    msg += `❓ Skyvern: Невідомо\n`;
                }

                // --- Section 2: Queue ---
                const { count: sendingCount } = await supabase
                    .from('applications')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'sending');

                const { count: approvedCount } = await supabase
                    .from('applications')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'approved');

                const { data: lastSent } = await supabase
                    .from('applications')
                    .select('sent_at')
                    .eq('status', 'sent')
                    .order('sent_at', { ascending: false })
                    .limit(1)
                    .single();

                msg += `\n📊 <b>Черга</b>\n`;
                msg += `📨 Надсилаються: ${sendingCount || 0}\n`;
                msg += `✅ Готові: ${approvedCount || 0}\n`;

                if (lastSent?.sent_at) {
                    msg += `🕐 Остання відправка: ${formatAgo(new Date(lastSent.sent_at))}\n`;
                }

                // --- Section 3: Per-User Breakdown ---
                const { data: allUsers } = await supabase
                    .from('user_settings')
                    .select('user_id, is_auto_scan_enabled')
                    .order('user_id');

                if (allUsers && allUsers.length > 0) {
                    msg += `\n👥 <b>Користувачі</b>\n`;
                    for (let i = 0; i < allUsers.length; i++) {
                        const u = allUsers[i];
                        const isLast = i === allUsers.length - 1;
                        const prefix = isLast ? '└' : '├';

                        // Get email from auth.users via service role
                        const { data: authUser } = await supabase.rpc('get_user_email', { uid: u.user_id }).single();
                        const email = authUser?.email || u.user_id.substring(0, 8);
                        const username = email.includes('@') ? email.split('@')[0] : email;

                        // Job count for this user
                        const { count: jobCount } = await supabase
                            .from('jobs')
                            .select('*', { count: 'exact', head: true })
                            .eq('user_id', u.user_id);

                        // Application count for this user
                        const { count: appCount } = await supabase
                            .from('applications')
                            .select('*', { count: 'exact', head: true })
                            .eq('user_id', u.user_id)
                            .in('status', ['sent', 'approved', 'sending']);

                        const scanIcon = u.is_auto_scan_enabled ? '✅' : '⏸';
                        msg += `${prefix} ${username} — ${jobCount || 0} вакансій, ${appCount || 0} заявок ${scanIcon}\n`;
                    }
                }

                // --- Section 4: Last Activity (from system_logs) ---
                const { data: lastScan } = await supabase
                    .from('system_logs')
                    .select('created_at, details')
                    .eq('event_type', 'SCAN')
                    .eq('status', 'SUCCESS')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                const { data: lastAnalysis } = await supabase
                    .from('system_logs')
                    .select('created_at, details')
                    .eq('event_type', 'ANALYSIS')
                    .eq('status', 'SUCCESS')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { data: costData } = await supabase
                    .from('system_logs')
                    .select('cost_usd')
                    .gte('created_at', twentyFourHoursAgo);

                msg += `\n📋 <b>Остання активність</b>\n`;

                if (lastScan?.created_at) {
                    const scanDetails = lastScan.details as any;
                    const newJobs = scanDetails?.new_jobs || scanDetails?.newJobs || '?';
                    msg += `🔍 Скан: ${formatAgo(new Date(lastScan.created_at))} (${newJobs} нових)\n`;
                } else {
                    msg += `🔍 Скан: немає даних\n`;
                }

                if (lastAnalysis?.created_at) {
                    const analysisDetails = lastAnalysis.details as any;
                    const analyzed = analysisDetails?.jobs_analyzed || analysisDetails?.analyzed || '?';
                    msg += `📊 Аналіз: ${formatAgo(new Date(lastAnalysis.created_at))} (${analyzed} оброблено)\n`;
                }

                const totalCost24h = costData?.reduce((sum: number, row: any) => sum + (row.cost_usd || 0), 0) || 0;
                msg += `💰 Витрати 24г: $${totalCost24h.toFixed(2)}\n`;

                // Startup instructions if worker is not running
                const isAlive = heartbeat?.last_heartbeat &&
                    (Date.now() - new Date(heartbeat.last_heartbeat).getTime()) < 30000;
                if (!isAlive) {
                    msg += `\n⚙️ <b>Запуск системи</b>\n\n`;
                    msg += `<b>Крок 1:</b> Відкрий Docker Desktop\n`;
                    msg += `Переконайся що Docker запущено (іконка в треї)\n\n`;
                    msg += `<b>Крок 2:</b> Відкрий термінал (WSL Ubuntu)\n`;
                    msg += `<code>wsl</code> або Windows Terminal → Ubuntu\n\n`;
                    msg += `<b>Крок 3:</b> Запусти одним скриптом:\n`;
                    msg += `<code>cd ~/Jobbot-NO && ./worker/start.sh</code>\n\n`;
                    msg += `Скрипт автоматично:\n`;
                    msg += `✅ Запустить Skyvern контейнери\n`;
                    msg += `✅ Дочекається готовності API\n`;
                    msg += `✅ Перевірить .env конфіг\n`;
                    msg += `✅ Запустить worker\n\n`;
                    msg += `<b>Додаткові команди:</b>\n`;
                    msg += `<code>./worker/start.sh --status</code> — статус\n`;
                    msg += `<code>./worker/start.sh --stop</code> — зупинити\n`;
                    msg += `<code>Ctrl+C</code> — зупинити worker`;
                }

                await sendTelegram(chatId, msg);
                return;
            }

            // APPLY - show FINN Easy jobs or batch apply
            if (text === '/apply' || text.startsWith('/apply ')) {
                const userId = await getUserIdFromChat(supabase, chatId);
                if (!userId) {
                    await sendTelegram(chatId, "⚠️ Telegram не прив'язаний до акаунту. Використайте /link CODE");
                    return;
                }

                const isBatchAll = text.trim() === '/apply all';

                // Today's date at midnight UTC
                const todayStart = new Date();
                todayStart.setUTCHours(0, 0, 0, 0);
                const todayISO = todayStart.toISOString();

                // Get today's hot FINN Easy jobs
                const { data: finnJobs } = await supabase
                    .from('jobs')
                    .select('id, title, company, relevance_score, job_url, created_at')
                    .eq('user_id', userId)
                    .eq('has_enkel_soknad', true)
                    .gte('relevance_score', 50)
                    .gte('created_at', todayISO)
                    .order('relevance_score', { ascending: false })
                    .limit(15);

                if (!finnJobs || finnJobs.length === 0) {
                    await sendTelegram(chatId, "ℹ️ Сьогодні немає нових FINN Easy вакансій з релевантністю ≥50%.\n\nЗапустіть /scan щоб оновити.");
                    return;
                }

                // Get existing applications for these jobs
                const jobIds = finnJobs.map((j: any) => j.id);
                const { data: existingApps } = await supabase
                    .from('applications')
                    .select('id, job_id, status')
                    .eq('user_id', userId)
                    .in('job_id', jobIds);

                const appByJobId: Record<string, any> = {};
                for (const app of (existingApps || [])) {
                    appByJobId[app.job_id] = app;
                }

                // Classify
                const needSoknad: any[] = [];
                const readyToSend: any[] = [];
                const alreadySent: any[] = [];
                const drafts: any[] = [];

                for (const job of finnJobs) {
                    const app = appByJobId[job.id];
                    if (!app) {
                        needSoknad.push(job);
                    } else if (app.status === 'approved') {
                        readyToSend.push({ ...job, appId: app.id });
                    } else if (app.status === 'draft') {
                        drafts.push({ ...job, appId: app.id });
                    } else if (app.status === 'sent' || app.status === 'sending') {
                        alreadySent.push(job);
                    } else if (app.status === 'failed') {
                        readyToSend.push({ ...job, appId: app.id }); // can retry
                    }
                }

                const actionableCount = needSoknad.length + readyToSend.length + drafts.length;

                if (isBatchAll) {
                    // /apply all — show confirmation
                    if (actionableCount === 0) {
                        await sendTelegram(chatId, "✅ Всі FINN Easy вакансії вже оброблені!");
                        return;
                    }

                    let msg = `🚀 <b>Масова подача на сьогоднішні FINN вакансії</b>\n\n`;
                    msg += `Буде оброблено <b>${actionableCount}</b> вакансій:\n`;
                    if (needSoknad.length > 0) msg += `✍️ Написати Søknad: ${needSoknad.length}\n`;
                    if (drafts.length > 0) msg += `📝 Підтвердити чернетки: ${drafts.length}\n`;
                    if (readyToSend.length > 0) msg += `⚡ Відправити (вже готові): ${readyToSend.length}\n`;
                    if (alreadySent.length > 0) msg += `✅ Вже відправлені: ${alreadySent.length}\n`;

                    msg += `\n<b>Вакансії:</b>\n`;
                    const allActionable = [...readyToSend, ...drafts, ...needSoknad];
                    for (const job of allActionable.slice(0, 12)) {
                        msg += `• ${job.title} (${job.company}) — ${job.relevance_score}%\n`;
                    }
                    if (allActionable.length > 12) {
                        msg += `• ... ще ${allActionable.length - 12}\n`;
                    }

                    msg += `\n⚠️ Søknader будуть згенеровані автоматично.\nWorker має бути запущений!`;

                    const kb = { inline_keyboard: [[
                        { text: `✅ Так, подати на ${actionableCount} вакансій`, callback_data: 'batch_apply_confirm' },
                        { text: '❌ Скасувати', callback_data: 'batch_apply_cancel' }
                    ]]};

                    await sendTelegram(chatId, msg, kb);
                    return;
                }

                // /apply — show individual jobs with buttons (max 10)
                let header = `🚀 <b>Сьогоднішні FINN Easy вакансії</b>\n\n`;
                header += `Знайдено: <b>${finnJobs.length}</b> вакансій\n`;
                if (readyToSend.length > 0) header += `⚡ Готових відправити: ${readyToSend.length}\n`;
                if (drafts.length > 0) header += `📝 Чернетки: ${drafts.length}\n`;
                if (needSoknad.length > 0) header += `✍️ Потрібен Søknad: ${needSoknad.length}\n`;
                if (alreadySent.length > 0) header += `✅ Вже відправлені: ${alreadySent.length}\n`;
                header += `\n💡 Масова подача: /apply all`;

                await sendTelegram(chatId, header);

                // Show individual jobs (max 10)
                const jobsToShow = [...readyToSend, ...drafts, ...needSoknad].slice(0, 10);

                for (const job of jobsToShow) {
                    const app = appByJobId[job.id];
                    let statusLine = '';
                    let button: any = null;

                    if (!app) {
                        statusLine = '✍️ Потрібен Søknad';
                        button = { text: '✍️ Написати Søknad', callback_data: `write_app_${job.id}` };
                    } else if (app.status === 'draft') {
                        statusLine = '📝 Чернетка';
                        button = { text: '✅ Підтвердити', callback_data: `approve_app_${app.id}` };
                    } else if (app.status === 'approved') {
                        statusLine = '✅ Затверджено — готово!';
                        button = { text: '⚡ Відправити', callback_data: `finn_apply_${app.id}` };
                    } else if (app.status === 'failed') {
                        statusLine = '❌ Помилка — повторити?';
                        button = { text: '🔄 Повторити', callback_data: `finn_apply_${app.id}` };
                    }

                    const scoreEmoji = job.relevance_score >= 80 ? '🟢' : job.relevance_score >= 60 ? '🟡' : '🔵';
                    const daysAgo = job.created_at ? Math.floor((Date.now() - new Date(job.created_at).getTime()) / 86400000) : null;
                    const dateLabel = daysAgo === 0 ? '🆕 Сьогодні' : daysAgo === 1 ? '📅 Вчора' : daysAgo !== null ? `📅 ${daysAgo}д тому` : '';
                    const msg = `${scoreEmoji} <b>${job.title}</b> — ${job.relevance_score}%\n🏢 ${job.company}${dateLabel ? ' · ' + dateLabel : ''}\n${statusLine}`;

                    if (button) {
                        await sendTelegram(chatId, msg, { inline_keyboard: [[button]] });
                    } else {
                        await sendTelegram(chatId, msg);
                    }
                }

                return;
            }

            // 2FA CODE for FINN login - supports both "/code 123456" and just "123456"
            const isCodeCommand = text.startsWith('/code ') || text.startsWith('/code');
            const isPlainCode = /^\d{4,8}$/.test(text.trim()); // 4-8 digit number

            if (isCodeCommand || isPlainCode) {
                const code = isCodeCommand ? text.replace('/code', '').trim() : text.trim();

                if (!code || code.length < 4) {
                    await sendTelegram(chatId, "⚠️ Код має бути від 4 до 8 цифр.\nПриклад: <code>123456</code>");
                    return;
                }

                console.log(`🔐 [TG] Received 2FA code from ${chatId}: ${code} (plain: ${isPlainCode})`);

                // Find pending auth request for this chat
                // Look for both 'code_requested' (webhook already called) and 'pending' (worker pre-created)
                const { data: authRequest, error: findError } = await supabase
                    .from('finn_auth_requests')
                    .select('*')
                    .eq('telegram_chat_id', chatId.toString())
                    .in('status', ['code_requested', 'pending'])
                    .gt('expires_at', new Date().toISOString())
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (findError || !authRequest) {
                    console.log(`⚠️ [TG] No auth request found for chat ${chatId}. Error: ${findError?.message}`);
                    // Only show warning for /code command, not for plain numbers (might be other number input)
                    if (isCodeCommand) {
                        await sendTelegram(chatId, "⚠️ Немає активних запитів на верифікацію.\nСпочатку запустіть подачу на FINN через дашборд.");
                    }
                    // For plain numbers, silently ignore if no auth request (might be other input)
                    return;
                }

                console.log(`✅ [TG] Found auth request: ${authRequest.id}, status: ${authRequest.status}`);

                // Update with code
                const { error: updateError } = await supabase
                    .from('finn_auth_requests')
                    .update({
                        verification_code: code,
                        status: 'code_received',
                        code_received_at: new Date().toISOString()
                    })
                    .eq('id', authRequest.id);

                if (updateError) {
                    console.error("❌ Error saving code:", updateError);
                    await sendTelegram(chatId, "❌ Помилка збереження коду. Спробуйте ще раз.");
                    return;
                }

                await sendTelegram(chatId, `✅ Код <code>${code}</code> прийнято!\n\n⏳ Очікуйте, Skyvern обробляє...`);
                return;
            }

            // Check for pending registration questions or verification (text answers)
            const chatIdStr = chatId.toString();

            // Check for pending verification (email/sms code for registration)
            const { data: pendingVerification } = await supabase
                .from('registration_flows')
                .select('id, site_name, verification_type')
                .eq('telegram_chat_id', chatIdStr)
                .in('status', ['email_verification', 'sms_verification', 'link_verification'])
                .gt('verification_expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingVerification) {
                console.log(`🔐 [TG] Verification code for registration: ${text}`);

                // Handle "готово" for link verification
                if (pendingVerification.verification_type === 'link_verification' &&
                    text.toLowerCase().includes('готово')) {
                    await supabase
                        .from('registration_flows')
                        .update({
                            verification_code: 'link_confirmed',
                            status: 'registering'
                        })
                        .eq('id', pendingVerification.id);

                    await sendTelegram(chatId,
                        `✅ <b>Підтвердження лінку прийнято!</b>\n\n` +
                        `⏳ Продовжую реєстрацію на ${pendingVerification.site_name}...`
                    );
                    return;
                }

                // Save verification code
                await supabase
                    .from('registration_flows')
                    .update({
                        verification_code: text.trim(),
                        status: 'registering'
                    })
                    .eq('id', pendingVerification.id);

                await sendTelegram(chatId,
                    `✅ <b>Код прийнято!</b>\n\n` +
                    `⏳ Продовжую реєстрацію на ${pendingVerification.site_name}...`
                );
                return;
            }

            // Check for pending field edit (registration confirmation edit flow)
            const { data: pendingFieldEdit } = await supabase
                .from('registration_flows')
                .select('id, pending_edit_field, profile_data_snapshot, site_name')
                .eq('telegram_chat_id', chatIdStr)
                .eq('status', 'editing_field')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingFieldEdit && pendingFieldEdit.pending_edit_field) {
                const flowId = pendingFieldEdit.id;
                const fieldName = pendingFieldEdit.pending_edit_field;
                const newValue = text.trim();
                const siteName = pendingFieldEdit.site_name || 'сайт';

                const fieldLabels: Record<string, string> = {
                    'full_name': "Ім'я",
                    'phone': 'Телефон',
                    'city': 'Місто',
                    'postal_code': 'Поштовий індекс'
                };
                const label = fieldLabels[fieldName] || fieldName;

                console.log(`✏️ [TG] Field edit: ${fieldName} = "${newValue}" for flow ${flowId}`);

                // Update profile data snapshot with new value
                const profileData = pendingFieldEdit.profile_data_snapshot || {};
                profileData[fieldName] = newValue;

                // Also store in edited_profile_data for later use
                await supabase
                    .from('registration_flows')
                    .update({
                        profile_data_snapshot: profileData,
                        edited_profile_data: profileData,
                        pending_edit_field: null,
                        status: 'editing'
                    })
                    .eq('id', flowId);

                // Show updated data with edit buttons
                const pd = profileData;
                const editMsg = (
                    `✅ <b>${label}</b> змінено на: <code>${newValue}</code>\n\n` +
                    `<b>Поточні дані для ${siteName}:</b>\n\n` +
                    `👤 Ім'я: <code>${pd.full_name || '—'}</code>\n` +
                    `📱 Телефон: <code>${pd.phone || '—'}</code>\n` +
                    `🏠 Місто: <code>${pd.city || '—'}</code>\n` +
                    `📮 Індекс: <code>${pd.postal_code || '—'}</code>\n\n` +
                    `Оберіть наступну дію:`
                );

                const editKeyboard = {
                    inline_keyboard: [
                        [
                            { text: "👤 Ім'я", callback_data: `reg_field_${flowId}_full_name` },
                            { text: "📱 Телефон", callback_data: `reg_field_${flowId}_phone` }
                        ],
                        [
                            { text: "🏠 Місто", callback_data: `reg_field_${flowId}_city` },
                            { text: "📮 Індекс", callback_data: `reg_field_${flowId}_postal_code` }
                        ],
                        [
                            { text: "✅ Готово - продовжити", callback_data: `reg_confirm_${flowId}` }
                        ],
                        [
                            { text: "❌ Скасувати", callback_data: `reg_cancel_${flowId}` }
                        ]
                    ]
                };

                await sendTelegram(chatId, editMsg, editKeyboard);
                return;
            }

            // Check for flows waiting for field answer (from worker asking for missing field)
            const { data: waitingFlow } = await supabase
                .from('registration_flows')
                .select('id, pending_question, qa_history, site_name')
                .eq('telegram_chat_id', chatIdStr)
                .eq('status', 'waiting_answer')
                .not('pending_question', 'is', null)
                .limit(1)
                .single();

            if (waitingFlow && waitingFlow.pending_question) {
                console.log(`📝 [TG] Answer for missing field: ${waitingFlow.pending_question}`);

                // Update qa_history with the answer
                const qaHistory = waitingFlow.qa_history || [];
                qaHistory.push({
                    question: waitingFlow.pending_question,
                    answer: text.trim(),
                    answered_at: new Date().toISOString()
                });

                await supabase
                    .from('registration_flows')
                    .update({
                        status: 'registering',
                        pending_question: null,
                        qa_history: qaHistory
                    })
                    .eq('id', waitingFlow.id);

                await sendTelegram(chatId,
                    `✅ <b>Відповідь збережено!</b>\n\n` +
                    `📝 ${waitingFlow.pending_question}: <code>${text.trim()}</code>\n\n` +
                    `⏳ Продовжую на ${waitingFlow.site_name}...`
                );
                return;
            }

            // Check for pending registration questions (text input)
            const { data: pendingQuestion } = await supabase
                .from('registration_questions')
                .select('id, flow_id, field_name, question_text')
                .eq('status', 'pending')
                .gt('timeout_at', new Date().toISOString())
                .order('asked_at', { ascending: false })
                .limit(1)
                .single();

            // Need to verify this question belongs to this chat
            if (pendingQuestion) {
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('telegram_chat_id, qa_history, site_name')
                    .eq('id', pendingQuestion.flow_id)
                    .single();

                if (flow && flow.telegram_chat_id === chatIdStr) {
                    console.log(`📝 [TG] Text answer for registration question: ${pendingQuestion.id}`);

                    // Update question with answer
                    await supabase
                        .from('registration_questions')
                        .update({
                            status: 'answered',
                            answer: text.trim(),
                            answer_source: 'user_telegram',
                            answered_at: new Date().toISOString()
                        })
                        .eq('id', pendingQuestion.id);

                    // Update flow Q&A history
                    const qaHistory = flow.qa_history || [];
                    qaHistory.push({
                        question: pendingQuestion.question_text,
                        answer: text.trim(),
                        field_name: pendingQuestion.field_name,
                        answered_at: new Date().toISOString()
                    });

                    await supabase
                        .from('registration_flows')
                        .update({
                            status: 'registering',
                            pending_question: null,
                            qa_history: qaHistory
                        })
                        .eq('id', pendingQuestion.flow_id);

                    await sendTelegram(chatId,
                        `✅ <b>Відповідь прийнято!</b>\n\n` +
                        `📝 ${pendingQuestion.question_text}\n` +
                        `✏️ ${text.trim()}\n\n` +
                        `⏳ Продовжую реєстрацію на ${flow.site_name}...`
                    );
                    return;
                }
            }

            // Check for pending payload field edit (text input)
            // Only check recent records (last 30 min) to prevent stale confirmations from intercepting messages
            const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
            const { data: pendingPayloadEdit } = await supabase
                .from('application_confirmations')
                .select('id, payload')
                .eq('telegram_chat_id', chatIdStr)
                .eq('status', 'pending')
                .gt('created_at', thirtyMinAgo)
                .not('payload->pending_edit_field', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingPayloadEdit?.payload?.pending_edit_field) {
                const payload = pendingPayloadEdit.payload;
                const fieldKey = payload.pending_edit_field;
                const fields = payload.fields || {};

                console.log(`✏️ [TG] Payload field text answer: ${fieldKey} = ${text.trim()}`);

                // Update the field value and clear pending edit
                fields[fieldKey] = text.trim();

                await supabase
                    .from('application_confirmations')
                    .update({
                        payload: { ...payload, fields, pending_edit_field: null }
                    })
                    .eq('id', pendingPayloadEdit.id);

                const fieldLabels: Record<string, string> = {
                    'full_name': '👤 Ім\'я',
                    'email': '📧 Email',
                    'phone': '📱 Телефон',
                    'birth_date': '🎂 Дата народження',
                    'street': '🏠 Вулиця',
                    'postal_code': '📮 Індекс',
                    'city': '🏙 Місто',
                    'nationality': '🌍 Громадянство',
                    'gender': '⚧ Стать',
                };

                const label = fieldLabels[fieldKey] || fieldKey;

                // Re-send preview with updated data + buttons
                const confirmationId = pendingPayloadEdit.id;

                // Build updated preview message
                const fieldDisplay = [
                    { key: 'full_name', emoji: '👤' },
                    { key: 'email', emoji: '📧' },
                    { key: 'phone', emoji: '📱' },
                    { key: 'birth_date', emoji: '🎂' },
                    { key: 'street', emoji: '🏠' },
                    { key: 'postal_code', emoji: '📮' },
                    { key: 'city', emoji: '🏙' },
                    { key: 'nationality', emoji: '🌍' },
                    { key: 'gender', emoji: '⚧' },
                ];

                let previewLines = [`✅ <b>${label}</b> оновлено: <code>${text.trim()}</code>\n`];
                previewLines.push("━━━━━━━━━━━━━━━━━━");
                for (const fd of fieldDisplay) {
                    const val = fields[fd.key] || '';
                    if (val) {
                        previewLines.push(`${fd.emoji} ${val.substring(0, 60)}`);
                    }
                }
                previewLines.push("━━━━━━━━━━━━━━━━━━");

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '✅ Відправити', callback_data: `payconfirm_${confirmationId}` },
                            { text: '✏️ Редагувати', callback_data: `payedit_${confirmationId}` },
                        ],
                        [
                            { text: '❌ Скасувати', callback_data: `paycancel_${confirmationId}` },
                        ]
                    ]
                };

                await sendTelegram(chatId, previewLines.join('\n'), keyboard);
                return;
            }

            // Check for pending Skyvern Q&A questions (text input, no flow_id)
            const { data: pendingSkyvernQ } = await supabase
                .from('registration_questions')
                .select('id, field_name, question_text, user_id')
                .eq('status', 'pending')
                .eq('field_context', 'skyvern_form')
                .gt('timeout_at', new Date().toISOString())
                .order('asked_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingSkyvernQ) {
                // Verify this question belongs to this chat's user
                const { data: userSettings } = await supabase
                    .from('user_settings')
                    .select('user_id')
                    .eq('telegram_chat_id', chatIdStr)
                    .single();

                if (userSettings && userSettings.user_id === pendingSkyvernQ.user_id) {
                    console.log(`📝 [TG] Text answer for Skyvern Q&A: ${pendingSkyvernQ.id}`);

                    await supabase
                        .from('registration_questions')
                        .update({
                            status: 'answered',
                            answer: text.trim(),
                            answer_source: 'user_telegram',
                            answered_at: new Date().toISOString()
                        })
                        .eq('id', pendingSkyvernQ.id);

                    await sendTelegram(chatId,
                        `✅ <b>Збережено!</b>\n\n` +
                        `📝 ${pendingSkyvernQ.question_text}\n` +
                        `✏️ ${text.trim()}\n\n` +
                        `⏳ Продовжую заповнення форми...`
                    );
                    return;
                }
            }

            // DIRECT LINK
            if (text.includes('finn.no') || text.includes('nav.no')) {
                 const { data: settings } = await supabase.from('user_settings').select('user_id').eq('telegram_chat_id', chatId.toString()).single();
                 if (!settings) {
                    await sendTelegram(chatId, "⚠️ Акаунт не прив'язаний. Зайдіть в налаштування на сайті.");
                    return;
                 }
                 await processUrlPipeline(text, chatId, supabase, settings.user_id);
            }
        }
    } catch (error) {
        console.error("Background Job Error:", error);
    }
}

// --- REUSABLE PIPELINE LOGIC ---
async function processUrlPipeline(url: string, chatId: string, supabase: any, userId: string) {
    const cleanUrl = url.split('?')[0];
    const finnCodeMatch = url.match(/(\d{8,})/);
    const finnCode = finnCodeMatch ? finnCodeMatch[1] : null;

    console.log(`🔎 Processing URL: ${url}`);
    await sendTelegram(chatId, `🔎 Перевіряю базу даних...`);

    let job = null;

    // 1. CHECK IF JOB EXISTS (for this user)
    if (finnCode) {
        const { data: byCode } = await supabase.from('jobs').select('*').eq('user_id', userId).ilike('job_url', `%${finnCode}%`).limit(1);
        if (byCode && byCode.length > 0) job = byCode[0];
    }
    if (!job) {
        const { data: byUrl } = await supabase.from('jobs').select('*').eq('user_id', userId).eq('job_url', url).limit(1);
        if (byUrl && byUrl.length > 0) job = byUrl[0];
    }
    if (!job) {
         const { data: byClean } = await supabase.from('jobs').select('*').eq('user_id', userId).ilike('job_url', `${cleanUrl}%`).limit(1);
         if (byClean && byClean.length > 0) job = byClean[0];
    }

    if (job) {
        await sendTelegram(chatId, `ℹ️ <b>Знайдено в архіві!</b> (Дата: ${new Date(job.created_at).toLocaleDateString()})`);
    } 
    
    // 2. SCRAPE NEW
    if (!job) {
        if (url.includes('/ad/') || url.includes('/stilling/')) {
            await sendTelegram(chatId, `⏳ Вакансія нова. Запускаю сканування...`);
            try {
                const res = await fetch(url, { 
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    } 
                });
                
                if (res.status === 403 || res.status === 401) {
                     await sendTelegram(chatId, `⚠️ Сайт блокує доступ.`);
                     const { data: minJob } = await supabase.from('jobs').insert({
                        job_url: url, title: 'Manual Check Required', company: 'FINN.no', location: 'Unknown', description: '',
                        source: 'FINN', user_id: userId, status: 'NEW'
                     }).select().single();
                     if (minJob) job = minJob;
                } else {
                    const html = await res.text();
                    const $ = cheerio.load(html);
                    const title = $('h1').first().text().trim() || $('title').text().split('-')[0].trim();
                    let company = $('h1').next('p').text().trim();
                    if (!company) company = $('a[data-testid="company-name"]').text().trim() || 'Unknown Company';
                    const location = $('span[data-testid="location"]').text() || '';
                    const description = $('div[data-testid="job-description-text"]').text() || $('.import_decoration').text() || $('section[aria-label="Jobbbeskrivelse"]').text() || '';

                    if (title) {
                        const { data: newJob } = await supabase.from('jobs').insert({
                            job_url: url, title, company, location, description,
                            source: 'FINN', user_id: userId, status: 'NEW'
                        }).select().single();
                        if (newJob) job = newJob;
                    }
                }
            } catch (e) {
                await sendTelegram(chatId, `⚠️ Помилка мережі.`);
                return;
            }
        } else {
            const { data: scrapeData } = await supabase.functions.invoke('job-scraper', {
                body: { searchUrl: url, userId: userId }
            });
            if (scrapeData?.success && scrapeData.jobs.length > 0) {
                await sendTelegram(chatId, `✅ Знайдено ${scrapeData.jobs.length} вакансій. Перевірте Дашборд.`);
                return; 
            }
        }
    }

    if (!job) {
        await sendTelegram(chatId, "⚠️ Не вдалося завантажити вакансію.");
        return;
    }

    // MSG 1: BASIC INFO + FORM TYPE
    const formTypeInfo = formatFormType(job);
    await sendTelegram(chatId, `🏢 <b>${job.title}</b>\n🏢 ${job.company}\n📍 ${job.location}\n\n${formTypeInfo}\n\n🔗 <a href="${job.job_url}">Оригінал вакансії</a>`);

    // MSG 2: ANALYZE
    if (job.status === 'ANALYZED' && job.relevance_score !== null) {
        const score = job.relevance_score || 0;
        const emoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
        
        // Added Tasks Summary to Message
        const tasksSection = job.tasks_summary 
            ? `\n\n📋 <b>Що робити (Обов'язки):</b>\n${job.tasks_summary}` 
            : "";

        await sendTelegram(chatId, `🤖 <b>AI Аналіз (Cached)</b>\n📊 <b>${score}/100</b> ${emoji}${tasksSection}\n\n💬 ${job.ai_recommendation?.substring(0, 300)}...`);
    } else {
        await sendTelegram(chatId, `🤖 Аналізую релевантність та обов'язки...`);
        const { data: analyzeRes } = await supabase.functions.invoke('job-analyzer', { body: { jobIds: [job.id], userId: userId } });
        
        if (analyzeRes?.success) {
            const { data: analyzed } = await supabase.from('jobs').select('*').eq('id', job.id).single();
            job = analyzed;
            const score = job.relevance_score || 0;
            const emoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
            
            // Added Tasks Summary to Message
            const tasksSection = job.tasks_summary 
                ? `\n\n📋 <b>Що робити (Обов'язки):</b>\n${job.tasks_summary}` 
                : "";

            await sendTelegram(chatId, `🤖 <b>AI Аналіз (Новий)</b>\n📊 <b>${score}/100</b> ${emoji}${tasksSection}\n\n💬 ${job.ai_recommendation?.substring(0, 300)}...`);
        } else {
            await sendTelegram(chatId, `⚠️ Помилка аналізу.`);
        }
    }

    // MSG 3: ACTIONS
    const { data: existingApp } = await supabase.from('applications').select('*').eq('job_id', job.id).eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    let statusMsg = "";
    const buttons = [];

    if (!existingApp) {
        statusMsg = "❌ <b>Søknad не створено</b>";
        buttons.push({ text: "✍️ Написати Søknad", callback_data: `write_app_${job.id}` });
    } else {
        switch (existingApp.status) {
            case 'draft':
                statusMsg = "📝 <b>Є чернетка</b>";
                buttons.push({ text: "📂 Показати Søknad", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'approved':
                statusMsg = "✅ <b>Затверджено</b>";
                buttons.push({ text: "🚀 Відправити / Показати", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'sending':
                statusMsg = "⏳ <b>Відправляється...</b>";
                buttons.push({ text: "📂 Переглянути", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'sent':
                statusMsg = "📬 <b>Вже відправлено</b>";
                buttons.push({ text: "📂 Показати", callback_data: `view_app_${existingApp.id}` });
                break;
            default:
                statusMsg = `Статус: ${existingApp.status}`;
                buttons.push({ text: "📂 Відкрити", callback_data: `view_app_${existingApp.id}` });
        }
    }

    await sendTelegram(chatId, `👇 <b>Дії:</b>\n${statusMsg}`, { inline_keyboard: [buttons] });
}

serve(async (req: Request) => {
  console.log(`📥 [TG] Incoming ${req.method} request`);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const update = await req.json();
    console.log(`📥 [TG] Update received:`, JSON.stringify(update).substring(0, 300));

    if (update.message && update.message.date) {
        const msgAge = Math.floor(Date.now() / 1000) - update.message.date;
        console.log(`📥 [TG] Message age: ${msgAge} seconds`);
        if (msgAge > 120) {
            console.log(`⏭️ [TG] Skipping old message`);
            return new Response(JSON.stringify({ success: true, skipped: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    }

    if (update.callback_query) {
        console.log(`🔘 [TG] Callback query: ${update.callback_query.data}`);
        await answerCallback(update.callback_query.id);
    }

    // CRITICAL: Do NOT await - respond to Telegram immediately!
    // Supabase Edge Functions (Deno Deploy) continue execution after response is sent.
    // This prevents "Read timeout expired" errors from Telegram webhook.
    console.log(`🚀 [TG] Starting background job (non-blocking)`);
    runBackgroundJob(update).catch(e => console.error(`❌ [TG] Background job error:`, e));

    // Return immediately - Telegram needs response within ~5 seconds
    console.log(`✅ [TG] Responding to Telegram immediately`);
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error(`❌ [TG] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});