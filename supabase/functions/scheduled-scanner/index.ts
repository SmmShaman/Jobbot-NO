
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

    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const urls = settings.finn_search_urls || [];
    const analysisLang = settings.preferred_analysis_language || 'uk';

    await sendTelegramMessage(tgToken, settings.telegram_chat_id, `🚀 <b>Scanning...</b>`);

    for (const url of urls) {
        const { data: scrapeData } = await supabase.functions.invoke('job-scraper', { body: { searchUrl: url, userId: settings.user_id } });
        if (!scrapeData?.success) continue;

        const jobs = scrapeData.jobs || [];
        totalFound += jobs.length;
        const scannedUrls = jobs.map((j: any) => j.job_url);
        const { data: existingRows } = await supabase.from('jobs').select('job_url').in('job_url', scannedUrls);
        const existingUrlSet = new Set((existingRows || []).map((r: any) => r.job_url));
        const newJobsToInsert = jobs.filter((j: any) => !existingUrlSet.has(j.job_url));

        if (newJobsToInsert.length > 0) {
            await supabase.from('jobs').insert(newJobsToInsert);
            totalInserted += newJobsToInsert.length;
        }

        // Analyze Loop
        const { data: jobsToProcess } = await supabase.from('jobs').select('*').in('job_url', scannedUrls);
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
                    // Send Telegram notification logic here (omitted for brevity, same as before)
                } catch (e) { log(`Analysis failed: ${e.message}`); }
            }
        }
    }

    await supabase.from('system_logs').insert({
        event_type: 'SCAN', status: 'SUCCESS', message: `Scan completed.`,
        details: { jobsFound: totalFound, newJobs: totalInserted, analyzed: totalAnalyzed },
        tokens_used: totalTokens, cost_usd: totalCost, source: source || 'CRON'
    });

    return new Response(JSON.stringify({ success: true, jobsFound: totalFound, logs }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    await supabase.from('system_logs').insert({ event_type: 'SCAN', status: 'FAILED', message: error.message, source: 'CRON' });
    return new Response(JSON.stringify({ success: false, error: error.message, logs }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
