
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICE_PER_1M_INPUT = 2.50;
const PRICE_PER_1M_OUTPUT = 10.00;

const logs: string[] = [];
function log(msg: string) {
    console.log(msg);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function sendTelegramMessage(token: string, chatId: string, text: string, keyboard?: any) {
  try {
    const body: any = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch (e: any) {}
}

async function extractTextFromUrl(url: string) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0...' } });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    let text = $('div[data-testid="job-description-text"]').text() 
            || $('.import_decoration').text() 
            || $('section[aria-label="Jobbbeskrivelse"]').text()
            || $('.job-posting-text').text()
            || $('main p').text();
    return text ? text.replace(/\s\s+/g, ' ').trim() : null;
  } catch (e) { return null; }
}

const LANG_MAP: any = { 'uk': 'Ukrainian', 'no': 'Norwegian', 'en': 'English' };

async function analyzeJobRelevance(job: any, profile: string, azureKey: string, azureEndpoint: string, deployName: string, targetLangCode: string = 'uk') {
   if (!job.description) return null;
   
   const targetLang = LANG_MAP[targetLangCode] || 'Ukrainian';

   const prompt = `
     CANDIDATE PROFILE:
     ${profile.substring(0, 3000)}

     JOB DESCRIPTION:
     Title: ${job.title}
     ${job.description.substring(0, 2000)}
     
     TASK:
     1. Analyze relevance (0-100).
     2. Summarize pros/cons in ${targetLang}.
     3. Extract duties list in ${targetLang}.
     
     OUTPUT JSON ONLY: 
     { 
        "score": number, 
        "analysis": "summary in ${targetLang}", 
        "tasks": "bullet points in ${targetLang}" 
     }
   `;
   
   const apiUrl = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments/${deployName}/chat/completions?api-version=2024-10-21`;
   const res = await fetch(apiUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': azureKey },
      body: JSON.stringify({
         messages: [{ role: 'user', content: prompt }],
         response_format: { type: "json_object" }
      })
   });
   
   if (!res.ok) throw new Error(`Azure Error: ${res.status}`);
   const json = await res.json();
   return { 
       content: JSON.parse(json.choices[0].message.content), 
       usage: json.usage 
   };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  logs.length = 0;
  log(`🔔 [Orchestrator] Request received.`);

  let totalFound = 0, totalAnalyzed = 0, totalInserted = 0, totalTokens = 0, totalCost = 0.0;
  const allScannedJobIds: string[] = []; // Track all jobs from this scan
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  try {
    const { forceRun, source } = await req.json().catch(() => ({}));
    
    const { data: activeProfile } = await supabase.from('cv_profiles').select('content').eq('is_active', true).single();
    if (!activeProfile) throw new Error("No active profile");

    const { data: settings } = await supabase.from('user_settings').select('*').limit(1).single();
    if (!settings) throw new Error("No settings");
    
    if (!forceRun && !settings.is_auto_scan_enabled) {
        return new Response(JSON.stringify({ success: true, message: "Auto-scan disabled", logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check if current hour matches scheduled time (unless forceRun)
    if (!forceRun && settings.scan_time_utc) {
        const [scheduledHour] = settings.scan_time_utc.split(':').map(Number);
        const currentUtcHour = new Date().getUTCHours();

        if (currentUtcHour !== scheduledHour) {
            log(`⏰ Skipping: Current hour (${currentUtcHour} UTC) doesn't match scheduled hour (${scheduledHour} UTC)`);
            return new Response(JSON.stringify({
                success: true,
                message: `Not scheduled time. Current: ${currentUtcHour}:00 UTC, Scheduled: ${settings.scan_time_utc} UTC`,
                logs
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        log(`✅ Time match! Running scheduled scan at ${currentUtcHour}:00 UTC`);
    }

    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const urls = settings.finn_search_urls || [];
    const analysisLang = settings.preferred_analysis_language || 'uk';

    // Start scanning message
    await sendTelegramMessage(tgToken, settings.telegram_chat_id, `🔎 <b>Починаю сканування...</b>\n\n📋 URL для перевірки: ${urls.length}`);

    for (const url of urls) {
        // Notify which URL is being scanned
        const urlSource = url.includes('finn.no') ? 'FINN.no' : url.includes('nav.no') ? 'NAV.no' : 'Джерело';
        await sendTelegramMessage(tgToken, settings.telegram_chat_id, `🔍 Сканую <b>${urlSource}</b>...`);

        const { data: scrapeData } = await supabase.functions.invoke('job-scraper', { body: { searchUrl: url, userId: settings.user_id } });
        if (!scrapeData?.success) {
            await sendTelegramMessage(tgToken, settings.telegram_chat_id, `⚠️ Помилка сканування ${urlSource}`);
            continue;
        }

        const jobs = scrapeData.jobs || [];
        totalFound += jobs.length;
        const scannedUrls = jobs.map((j: any) => j.job_url);
        const { data: existingRows } = await supabase.from('jobs').select('job_url').in('job_url', scannedUrls);
        const existingUrlSet = new Set((existingRows || []).map((r: any) => r.job_url));
        const newJobsToInsert = jobs.filter((j: any) => !existingUrlSet.has(j.job_url));

        // Report findings for this URL
        const existingCount = existingUrlSet.size;
        const newCount = newJobsToInsert.length;
        await sendTelegramMessage(tgToken, settings.telegram_chat_id,
            `📊 <b>${urlSource}:</b>\n` +
            `   📋 Знайдено: ${jobs.length}\n` +
            `   ℹ️ В архіві: ${existingCount}\n` +
            `   🆕 Нових: ${newCount}`
        );

        if (newJobsToInsert.length > 0) {
            await supabase.from('jobs').insert(newJobsToInsert);
            totalInserted += newJobsToInsert.length;

            // Extract full job details (company, deadline, form type) for each new job
            log(`📄 Extracting details for ${newJobsToInsert.length} new jobs...`);
            await sendTelegramMessage(tgToken, settings.telegram_chat_id, `📄 <b>Витягую деталі для ${newJobsToInsert.length} нових вакансій...</b>`);

            for (const job of newJobsToInsert) {
                try {
                    const { data: extractResult } = await supabase.functions.invoke('extract_job_text', {
                        body: { url: job.job_url }
                    });

                    if (extractResult) {
                        const updates: any = {};

                        // Update company if we got a better one
                        if (extractResult.company && extractResult.company !== 'Unknown Company' &&
                            (job.company === 'Unknown Company' || !job.company)) {
                            updates.company = extractResult.company;
                        }

                        // Update deadline
                        if (extractResult.deadline) {
                            updates.deadline = extractResult.deadline;
                        }

                        // Update form type info
                        if (extractResult.hasEnkelSoknad !== undefined) {
                            updates.has_enkel_soknad = extractResult.hasEnkelSoknad;
                        }
                        if (extractResult.applicationFormType) {
                            updates.application_form_type = extractResult.applicationFormType;
                        }
                        if (extractResult.externalApplyUrl) {
                            updates.external_apply_url = extractResult.externalApplyUrl;
                        }

                        // Update description if we got a better one
                        if (extractResult.text && (!job.description || job.description.length < 100)) {
                            updates.description = extractResult.text;
                        }

                        if (Object.keys(updates).length > 0) {
                            await supabase.from('jobs').update(updates).eq('job_url', job.job_url);
                            log(`✅ Extracted details for: ${job.title.substring(0, 40)}...`);
                        }
                    }
                } catch (e: any) {
                    log(`⚠️ Failed to extract details for ${job.job_url}: ${e.message}`);
                }
            }
        }

        // Analyze Loop
        const { data: jobsToProcess } = await supabase.from('jobs').select('*').in('job_url', scannedUrls);

        // Track all job IDs from this scan
        (jobsToProcess || []).forEach((j: any) => allScannedJobIds.push(j.id));

        const jobsNeedingAnalysis = (jobsToProcess || []).filter((j: any) => j.status !== 'ANALYZED');

        if (jobsNeedingAnalysis.length > 0) {
            await sendTelegramMessage(tgToken, settings.telegram_chat_id, `🤖 <b>Аналізую ${jobsNeedingAnalysis.length} вакансій...</b>`);
        }

        for (const j of (jobsToProcess || [])) {
            if (!j.description || j.description.length < 50) {
                const desc = await extractTextFromUrl(j.job_url);
                if (desc) await supabase.from('jobs').update({ description: desc }).eq('id', j.id);
                else continue;
                j.description = desc; 
            }

            if (j.status !== 'ANALYZED') {
                try {
                    const { content, usage } = await analyzeJobRelevance(j, activeProfile.content, Deno.env.get('AZURE_OPENAI_API_KEY'), Deno.env.get('AZURE_OPENAI_ENDPOINT'), Deno.env.get('AZURE_OPENAI_DEPLOYMENT'), analysisLang);
                    
                    let cost = 0;
                    if (usage) {
                        cost = (usage.prompt_tokens / 1000000 * PRICE_PER_1M_INPUT) + (usage.completion_tokens / 1000000 * PRICE_PER_1M_OUTPUT);
                        totalCost += cost;
                        totalTokens += (usage.prompt_tokens + usage.completion_tokens);
                    }

                    await supabase.from('jobs').update({ 
                        relevance_score: content.score, ai_recommendation: content.analysis, tasks_summary: content.tasks,
                        status: 'ANALYZED', analyzed_at: new Date().toISOString(), cost_usd: cost, tokens_input: usage.prompt_tokens, tokens_output: usage.completion_tokens
                    }).eq('id', j.id);
                    
                    totalAnalyzed++;

                    // Send detailed Telegram notification for analyzed job
                    if (tgToken && settings.telegram_chat_id) {
                        // Score indicator
                        const scoreEmoji = content.score >= 70 ? '🟢' : content.score >= 40 ? '🟡' : '🔴';
                        const hotEmoji = content.score >= 80 ? ' 🔥' : '';

                        // Job info message
                        const jobInfoMsg = `🏢 <b>${j.title}</b>${hotEmoji}\n` +
                            `🏢 ${j.company || 'Компанія не вказана'}\n` +
                            `📍 ${j.location || 'Norway'}\n` +
                            `🔗 <a href="${j.job_url}">Відкрити вакансію</a>`;
                        await sendTelegramMessage(tgToken, settings.telegram_chat_id, jobInfoMsg);

                        // AI Analysis message
                        const tasksText = content.tasks ? `\n\n📋 <b>Що робити (Обов'язки):</b>\n${content.tasks.substring(0, 500)}` : '';
                        const analysisText = content.analysis ? `\n\n💬 ${content.analysis.substring(0, 400)}...` : '';

                        const analysisMsg = `🤖 <b>AI Аналіз</b>\n` +
                            `📊 <b>${content.score}/100</b> ${scoreEmoji}` +
                            tasksText +
                            analysisText;
                        await sendTelegramMessage(tgToken, settings.telegram_chat_id, analysisMsg);

                        // Action buttons for jobs with score >= 50
                        if (content.score >= 50) {
                            const { data: existingApp } = await supabase
                                .from('applications')
                                .select('id, status')
                                .eq('job_id', j.id)
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .maybeSingle();

                            let statusMsg = "";
                            const buttons: any[] = [];

                            if (!existingApp) {
                                statusMsg = "❌ <b>Søknad не створено</b>";
                                buttons.push({ text: "✍️ Написати Søknad", callback_data: `write_app_${j.id}` });
                            } else {
                                switch (existingApp.status) {
                                    case 'draft':
                                        statusMsg = "📝 <b>Є чернетка</b>";
                                        buttons.push({ text: "📂 Показати Søknad", callback_data: `view_app_${existingApp.id}` });
                                        break;
                                    case 'approved':
                                        statusMsg = "✅ <b>Затверджено</b>";
                                        buttons.push({ text: "📂 Показати", callback_data: `view_app_${existingApp.id}` });
                                        break;
                                    case 'sent':
                                        statusMsg = "📬 <b>Вже відправлено</b>";
                                        break;
                                    default:
                                        statusMsg = `📋 Статус: ${existingApp.status}`;
                                        buttons.push({ text: "📂 Відкрити", callback_data: `view_app_${existingApp.id}` });
                                }
                            }

                            const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
                            await sendTelegramMessage(tgToken, settings.telegram_chat_id, `👇 <b>Дії:</b>\n${statusMsg}`, keyboard);
                        }
                    }
                } catch (e: any) { log(`Analysis failed: ${e.message}`); }
            }
        }
    }

    await supabase.from('system_logs').insert({
        event_type: 'SCAN', status: 'SUCCESS', message: `Scan completed.`,
        details: {
            jobsFound: totalFound,
            newJobs: totalInserted,
            analyzed: totalAnalyzed,
            scannedJobIds: allScannedJobIds // Store job IDs for "Show all" button
        },
        tokens_used: totalTokens, cost_usd: totalCost, source: source || 'CRON'
    });

    // Send final summary to Telegram with date and statistics
    if (tgToken && settings.telegram_chat_id) {
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}`;

        // Count jobs with score >= 50 from this scan
        const { data: hotJobs } = await supabase
            .from('jobs')
            .select('id')
            .in('id', allScannedJobIds)
            .gte('relevance_score', 50);
        const hotCount = hotJobs?.length || 0;

        const summaryMsg = `✅ <b>Сканування завершено!</b>\n\n` +
            `📅 Дата: <b>${dateStr}</b>\n` +
            `📊 Знайдено вакансій: <b>${totalFound}</b>\n` +
            `🆕 Нових: <b>${totalInserted}</b>\n` +
            `🤖 Проаналізовано: <b>${totalAnalyzed}</b>\n` +
            `🔥 Релевантних (≥50%): <b>${hotCount}</b>\n` +
            (totalCost > 0 ? `💰 Витрачено: <b>$${totalCost.toFixed(4)}</b>` : '');

        // Always show button to view all jobs from scan
        const buttons: any[] = [];
        if (allScannedJobIds.length > 0) {
            buttons.push({ text: `📋 Показати всі (${allScannedJobIds.length})`, callback_data: `show_last_scan` });
        }
        if (hotCount > 0) {
            buttons.push({ text: `🔥 Тільки релевантні (${hotCount})`, callback_data: `show_hot_scan` });
        }

        const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
        await sendTelegramMessage(tgToken, settings.telegram_chat_id, summaryMsg, keyboard);
    }

    return new Response(JSON.stringify({ success: true, jobsFound: totalFound, logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    await supabase.from('system_logs').insert({ event_type: 'SCAN', status: 'FAILED', message: error.message, source: 'CRON' });
    return new Response(JSON.stringify({ success: false, error: error.message, logs }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
