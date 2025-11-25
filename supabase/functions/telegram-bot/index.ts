import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;
declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("🤖 [TelegramBot] v7.8 Debug Mode");

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
console.log(`🤖 [TelegramBot] BOT_TOKEN exists: ${!!BOT_TOKEN}`);

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
                await sendTelegram(chatId, "⏳ <b>Пишу Søknad...</b>\n(Це може зайняти до 30 сек)");

                const { data: settings } = await supabase.from('user_settings').select('user_id').eq('telegram_chat_id', chatId.toString()).single();
                
                const { data: genResult } = await supabase.functions.invoke('generate_application', {
                    body: { job_id: jobId, user_id: settings?.user_id }
                });

                if (!genResult?.success) {
                    await sendTelegram(chatId, `❌ Помилка: ${genResult?.message || 'Unknown'}`);
                    return;
                }

                const app = genResult.application;
                const msg = `✅ <b>Søknad готовий!</b>\n\n` +
                            `🇳🇴 <b>Norsk:</b>\n<tg-spoiler>${app.cover_letter_no}</tg-spoiler>\n\n` + 
                            `🇺🇦 <b>Переклад:</b>\n<tg-spoiler>${app.cover_letter_uk || '...'}</tg-spoiler>`;
                
                const kb = { inline_keyboard: [[
                    { text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` }
                ]]};

                await sendTelegram(chatId, msg, kb);
            }

            // VIEW EXISTING APPLICATION
            if (data.startsWith('view_app_')) {
                const appId = data.split('view_app_')[1];
                const { data: app } = await supabase.from('applications').select('*').eq('id', appId).single();
                
                if (app) {
                    let statusText = "📝 Draft";
                    const buttons = [];

                    if (app.status === 'approved') {
                        statusText = "✅ Approved (Ready to Send)";
                        buttons.push({ text: "🚀 Auto-Apply (Skyvern)", callback_data: `auto_apply_${app.id}` });
                    } else if (app.status === 'sending') {
                        statusText = "🚀 Sending...";
                    } else if (app.status === 'manual_review') {
                        statusText = "⚠️ Check Task (Skyvern Done)";
                        buttons.push({ text: "🔄 Retry", callback_data: `auto_apply_${app.id}` });
                    } else if (app.status === 'sent') {
                        statusText = "📬 Sent to Employer";
                    } else if (app.status === 'failed') {
                        statusText = "❌ Failed to Send";
                        buttons.push({ text: "🚀 Retry Auto-Apply", callback_data: `auto_apply_${app.id}` });
                    } else {
                        // Draft
                        statusText = "📝 Draft";
                        buttons.push({ text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` });
                    }

                    const msg = `📂 <b>Ваш Søknad</b>\nСтатус: <b>${statusText}</b>\n\n` +
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
                
                try {
                    const { error } = await supabase.from('applications').update({ 
                        status: 'approved', 
                        approved_at: new Date().toISOString(),
                        skyvern_metadata: { source: 'telegram' } 
                    }).eq('id', appId);

                    if (error) {
                        console.error("Approve DB Error:", error);
                        await sendTelegram(chatId, `❌ <b>Помилка оновлення бази!</b>\n\nДеталі: ${error.message}`);
                        return;
                    }
                    
                    const msg = "✅ <b>Підтверджено!</b>\nСтатус в Dashboard змінено на 'Approved'.\n\nБажаєте запустити автоматичну подачу через Skyvern?";
                    const kb = { inline_keyboard: [[
                        { text: "🚀 Запустити (Auto-Apply)", callback_data: `auto_apply_${appId}` }
                    ]]};
                    
                    await sendTelegram(chatId, msg, kb);
                } catch (e: any) {
                    console.error("Approve Exception:", e);
                    await sendTelegram(chatId, `❌ Критична помилка: ${e.message}`);
                }
            }

            // AUTO-APPLY
            if (data.startsWith('auto_apply_')) {
                const appId = data.split('auto_apply_')[1];
                await supabase.from('applications').update({ status: 'sending' }).eq('id', appId);
                await sendTelegram(chatId, "🚀 <b>Запущено!</b>\nСтатус змінено на 'Sending'.\nПеревірте термінал вашого ПК (Worker).");
            }
        }

        // --- 2. HANDLE TEXT MESSAGES ---
        if (update.message && update.message.text) {
            const text = update.message.text.trim();
            const chatId = update.message.chat.id;
            const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? 'https://jobbotnetlify.netlify.app';

            console.log(`💬 [TG] Message from ${chatId}: "${text}"`);
            console.log(`💬 [TG] Dashboard URL: ${dashboardUrl}`);

            // START / HELP
            if (text === '/start' || text === '/help') {
                await sendTelegram(chatId, 
                    `👋 <b>Вітаю в JobBot Norway!</b>\n\n` +
                    `Я допоможу знайти та проаналізувати вакансії з FINN.no\n\n` +
                    `<b>Команди:</b>\n` +
                    `/scan - Запустити повне сканування збережених\n` +
                    `/report - Денний звіт\n\n` +
                    `Або просто відправ посилання на FINN.no!\n\n` +
                    `📊 Dashboard: ${dashboardUrl}`
                );
                return;
            }

            // REPORT
            if (text === '/report') {
                const { count: totalJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
                const today = new Date().toISOString().split('T')[0];
                const { count: newJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('created_at', today);
                const { count: sentApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).in('status', ['sent', 'manual_review']);
                
                await sendTelegram(chatId, 
                    `📊 <b>Звіт</b>\n\n` +
                    `🏢 Всього вакансій: <b>${totalJobs || 0}</b>\n` +
                    `🆕 Нових сьогодні: <b>${newJobs || 0}</b>\n` +
                    `✅ Відправлено заявок: <b>${sentApps || 0}</b>\n\n` +
                    `🔗 <a href="${dashboardUrl}">Дашборд</a>`
                );
                return;
            }

            // SCAN
            if (text === '/scan') {
                const { data: settings } = await supabase.from('user_settings').select('finn_search_urls, user_id').eq('telegram_chat_id', chatId.toString()).single();
                
                if (!settings || !settings.finn_search_urls || settings.finn_search_urls.length === 0) {
                    await sendTelegram(chatId, "⚠️ У вас немає збережених URL в налаштуваннях.");
                    return;
                }

                await sendTelegram(chatId, `🚀 <b>Запускаю сканування ${settings.finn_search_urls.length} джерел...</b>`);

                for (const url of settings.finn_search_urls) {
                     await processUrlPipeline(url, chatId, supabase, settings.user_id);
                }
                return;
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

    // 1. CHECK IF JOB EXISTS
    if (finnCode) {
        const { data: byCode } = await supabase.from('jobs').select('*').ilike('job_url', `%${finnCode}%`).limit(1);
        if (byCode && byCode.length > 0) job = byCode[0];
    }
    if (!job) {
        const { data: byUrl } = await supabase.from('jobs').select('*').eq('job_url', url).limit(1);
        if (byUrl && byUrl.length > 0) job = byUrl[0];
    }
    if (!job) {
         const { data: byClean } = await supabase.from('jobs').select('*').ilike('job_url', `${cleanUrl}%`).limit(1);
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

    // MSG 1: BASIC INFO
    await sendTelegram(chatId, `🏢 <b>${job.title}</b>\n🏢 ${job.company}\n📍 ${job.location}\n🔗 <a href="${job.job_url}">Лінк</a>`);

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
    const { data: existingApp } = await supabase.from('applications').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
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

    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        console.log(`🚀 [TG] Running in EdgeRuntime.waitUntil`);
        EdgeRuntime.waitUntil(runBackgroundJob(update));
    } else {
        console.log(`🚀 [TG] Running sync (no EdgeRuntime)`);
        await runBackgroundJob(update);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error(`❌ [TG] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});