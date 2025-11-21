
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("🚀 [Orchestrator] Function loaded (Cold Start)");

// --- LOGGING HELPER ---
const logs: string[] = [];
function log(msg: string) {
    console.log(msg);
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// --- TELEGRAM HELPER ---
async function sendTelegramMessage(token: string, chatId: string, text: string, keyboard?: any) {
  if (!token || !chatId) {
      log("❌ [Telegram] Missing Token or ChatID");
      return;
  }
  try {
    const body: any = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
        log(`❌ [Telegram] API Error: ${await res.text()}`);
    }
  } catch (e: any) {
    log(`❌ [Telegram] Network Error: ${e.message}`);
  }
}

// --- TEXT EXTRACTION (Improved) ---
async function extractTextFromUrl(url: string) {
  try {
    log(`🕷️ [Orchestrator] Extracting text from: ${url}`);
    
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });
    
    if (!res.ok) {
        log(`⚠️ [Orchestrator] Extract failed. Status: ${res.status}`);
        return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Try standard selectors for FINN and NAV
    let text = $('div[data-testid="job-description-text"]').text() 
            || $('.import_decoration').text() 
            || $('section[aria-label="Jobbbeskrivelse"]').text()
            || $('.job-posting-text').text()
            || $('#job-description').text();

    // Fallback 1: Paragraphs in main container
    if (!text || text.length < 50) {
        text = $('main p').text() || $('article p').text();
    }

    // Fallback 2: Meta Description (Better than nothing for analysis)
    if (!text || text.length < 50) {
         text = $('meta[property="og:description"]').attr('content') || '';
         if (!text) text = $('meta[name="description"]').attr('content') || '';
         if (text) log(`⚠️ [Orchestrator] Used Meta Description fallback.`);
    }

    return text ? text.replace(/\s\s+/g, ' ').trim() : null;
  } catch (e: any) { 
      log(`❌ [Orchestrator] Extraction exception: ${e.message}`);
      return null; 
  }
}

async function analyzeJobRelevance(job: any, profile: string, azureKey: string, azureEndpoint: string, deployName: string) {
   if (!job.description) return null;
   
   const prompt = `
     CANDIDATE PROFILE:
     ${profile.substring(0, 3000)}

     JOB DESCRIPTION:
     Title: ${job.title} - ${job.company}
     ${job.description.substring(0, 2000)}
     
     TASK:
     1. Analyze relevance (0-100).
     2. Summarize pros/cons in Ukrainian.
     3. Extract a concise list of specific duties/responsibilities (what the candidate must actually DO) in Ukrainian. No fluff.
     
     OUTPUT JSON ONLY: 
     { 
        "score": number, 
        "analysis": "short summary of fit (pros/cons) in Ukrainian", 
        "tasks": "Bullet point list of duties in Ukrainian (e.g. - Rozrobka API...)" 
     }
   `;
   
   const apiUrl = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments/${deployName}/chat/completions?api-version=2024-10-21`;
   
   const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': azureKey },
      body: JSON.stringify({
         messages: [{ role: 'user', content: prompt }],
         response_format: { type: "json_object" }
      })
   });
   
   if (!res.ok) {
       const txt = await res.text();
       throw new Error(`Azure API Error: ${res.status} - ${txt}`);
   }

   const json = await res.json();
   return JSON.parse(json.choices[0].message.content);
}

// --- MAIN HANDLER ---

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Reset logs for this run
  logs.length = 0;
  log(`🔔 [Orchestrator] Request received.`);

  try {
    const body = await req.json().catch(() => ({}));
    const { forceRun } = body;
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const azureKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const azureDeploy = Deno.env.get('AZURE_OPENAI_DEPLOYMENT');
    
    if (!tgToken) log("❌ Missing TELEGRAM_BOT_TOKEN");
    if (!azureKey) log("❌ Missing AZURE_OPENAI_API_KEY");

    // 1. CHECK ACTIVE PROFILE (Fail fast)
    const { data: activeProfile } = await supabase.from('cv_profiles').select('content').eq('is_active', true).single();
    if (!activeProfile) {
        const msg = "❌ No ACTIVE Profile found. Please go to Settings -> Profiles and activate one.";
        log(msg);
        return new Response(JSON.stringify({ success: false, message: msg, logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. GET SETTINGS
    const { data: settings, error: settingsError } = await supabase.from('user_settings').select('*').limit(1).single();
    if (settingsError || !settings) {
        log("❌ No settings found in DB");
        throw new Error("No settings found.");
    }
    
    // Time check logic for auto-scans (skipped if forceRun)
    if (!forceRun) {
        if (!settings.is_auto_scan_enabled) {
            log("⏸️ Auto-scan is DISABLED.");
            return new Response(JSON.stringify({ success: true, message: "Auto-scan disabled", logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    }

    const chatId = settings.telegram_chat_id;
    const urls = settings.finn_search_urls || [];

    if (!urls.length) {
        log("❌ No URLs configured");
        return new Response(JSON.stringify({ success: false, message: "No URLs configured", logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await sendTelegramMessage(tgToken, chatId, `🚀 <b>Запускаю сканування ${urls.length} збережених URLs...</b>`);

    let totalFound = 0;
    let totalAnalyzed = 0;
    let totalInserted = 0;

    for (const url of urls) {
        log(`🔍 Scanning URL: ${url}`);
        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('job-scraper', {
            body: { searchUrl: url, userId: settings.user_id }
        });

        if (scrapeError || !scrapeData?.success) {
             log(`❌ Scraper failed for ${url}`);
             continue;
        }

        const jobs = scrapeData.jobs || [];
        log(`✅ Found ${jobs.length} jobs on page.`);
        totalFound += jobs.length;

        if (jobs.length > 0) {
            // FIX: "DB Upsert Error: no unique constraint"
            // Instead of upsert, we manually check for existing URLs and only insert new ones.
            
            const scannedUrls = jobs.map((j: any) => j.job_url);

            // Check DB for these URLs
            const { data: existingRows, error: checkError } = await supabase
                .from('jobs')
                .select('job_url')
                .in('job_url', scannedUrls);

            if (checkError) {
                log(`❌ DB Check Error: ${checkError.message}`);
                continue;
            }

            const existingUrlSet = new Set((existingRows || []).map((r: any) => r.job_url));
            
            // Filter only NEW jobs
            const newJobsToInsert = jobs.filter((j: any) => !existingUrlSet.has(j.job_url));

            if (newJobsToInsert.length > 0) {
                log(`✨ Inserting ${newJobsToInsert.length} NEW jobs...`);
                const { error: insertError } = await supabase.from('jobs').insert(newJobsToInsert);
                if (insertError) {
                     log(`❌ DB Insert Error: ${insertError.message}`);
                } else {
                     totalInserted += newJobsToInsert.length;
                     log(`✅ Successfully added ${newJobsToInsert.length} jobs.`);
                }
            } else {
                log(`💤 All ${jobs.length} jobs already exist in DB.`);
            }

            // Fetch ALL jobs (both new and existing) for analysis step
            // We fetch by URL to get the proper DB IDs
            const { data: jobsToProcess, error: fetchAllError } = await supabase
                 .from('jobs')
                 .select('*')
                 .in('job_url', scannedUrls);
            
            if (fetchAllError || !jobsToProcess) {
                log(`❌ Error fetching jobs for analysis: ${fetchAllError?.message}`);
                continue;
            }

            // EXTRACT TEXT LOOP
            for (const j of jobsToProcess) {
                let desc = j.description;
                if (!desc || desc.length < 50) {
                    log(`📝 Extracting details for: ${j.title}`);
                    desc = await extractTextFromUrl(j.job_url);
                    if (desc && desc.length > 50) {
                        await supabase.from('jobs').update({ description: desc }).eq('id', j.id);
                        log(`✅ Extracted ${desc.length} chars.`);
                    } else {
                        log(`⚠️ Extraction yielded no useful text.`);
                    }
                }
            }

            await sendTelegramMessage(tgToken, chatId, `🤖 <b>Аналіз ${jobsToProcess.length} вакансій</b>`);
            
            // ANALYZE LOOP
            for (const j of jobsToProcess) {
                // Re-fetch to get updated description
                const { data: currentJob } = await supabase.from('jobs').select('*').eq('id', j.id).single();
                
                if (currentJob.status === 'ANALYZED' && currentJob.relevance_score !== null) {
                     // log(`♻️ Job [${j.id}] already analyzed.`); // Less noise
                     continue; 
                }

                if (!currentJob.description || currentJob.description.length < 50) {
                    log(`⚠️ Skipping analysis for [${j.id}]: No description available.`);
                    continue;
                }

                try {
                    log(`🧠 Analyzing [${j.id}] ${j.title}...`);
                    const analysis = await analyzeJobRelevance(currentJob, activeProfile.content, azureKey, azureEndpoint, azureDeploy);
                    
                    if (analysis) {
                        // Update with BOTH analysis text AND tasks summary
                        await supabase.from('jobs').update({ 
                            relevance_score: analysis.score, 
                            ai_recommendation: analysis.analysis,
                            tasks_summary: analysis.tasks, // NEW FIELD
                            status: 'ANALYZED',
                            analyzed_at: new Date().toISOString()
                        }).eq('id', j.id);
                        
                        totalAnalyzed++;
                        log(`✅ Analyzed: Score ${analysis.score}`);

                        // Telegram notification
                        const emoji = analysis.score >= 70 ? '🟢' : analysis.score >= 40 ? '🟡' : '🔴';
                        const keyboard = { inline_keyboard: [[{ text: "✍️ Написати Søknad", callback_data: `write_app_${j.id}` }]] };
                        
                        const msg = `${emoji} <b>${currentJob.title}</b>\n` +
                                    `🏢 ${currentJob.company} | 📍 ${currentJob.location}\n` +
                                    `📊 Релевантність: <b>${analysis.score}/100</b>\n\n` +
                                    `📋 <b>Що робити (Обов'язки):</b>\n${analysis.tasks || "Не вдалося витягнути"}\n\n` +
                                    `🧐 <b>Аналіз:</b>\n${analysis.analysis}\n\n` +
                                    `🔗 <a href="${currentJob.job_url}">Посилання на вакансію</a>`;

                        await sendTelegramMessage(tgToken, chatId, msg, keyboard);
                    }
                } catch (e: any) { 
                    log(`❌ Analysis failed for [${j.id}]: ${e.message}`); 
                }
            }
        }
    }

    await sendTelegramMessage(tgToken, chatId, `✅ <b>Цикл завершено!</b>\nНових додано: ${totalInserted}\nВсього знайдено: ${totalFound}\nПроаналізовано: ${totalAnalyzed}`);
    log("🏁 Pipeline finished successfully");

    return new Response(JSON.stringify({ success: true, jobsFound: totalFound, jobsAnalyzed: totalAnalyzed, logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    log(`❌ Fatal Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message, logs }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});