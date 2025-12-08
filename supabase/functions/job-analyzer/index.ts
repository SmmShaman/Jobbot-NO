
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRICE_PER_1M_INPUT = 2.50; 
const PRICE_PER_1M_OUTPUT = 10.00;

const DEFAULT_ANALYSIS_PROMPT = `
You are a Vibe & Fit Scanner for Recruitment.
TASK:
1. Analyze how well the candidate fits this job.
2. Provide a Relevance Score (0-100).
3. AURA SCAN: Detect the "vibe" of the job description (e.g., is it toxic, growth-oriented, stable, or a grind?).
4. RADAR METRICS: Rate the job on 5 specific axes (0-100).
5. EXTRACT TASKS: List specifically what the candidate needs to DO.

OUTPUT FORMAT (JSON ONLY):
{
  "score": number,
  "analysis": "string (markdown supported)",
  "tasks": "string (bullet point list)",
  "aura": {
      "status": "Toxic" | "Growth" | "Balanced" | "Chill" | "Grind" | "Neutral",
      "color": "#hex color code matching status (Toxic=#ef4444, Growth=#22c55e, Balanced=#3b82f6, Chill=#06b6d4, Grind=#a855f7, Neutral=#6b7280)",
      "tags": ["string", "string"] (e.g. "🚩 High Turnover", "🚀 Stock Options", "🛡️ Stable"),
      "explanation": "short reason for aura"
  },
  "radar": {
      "tech_stack": number (0-100 fit),
      "soft_skills": number (0-100 fit),
      "culture": number (0-100 match),
      "salary_potential": number (0-100 estimate based on market),
      "career_growth": number (0-100)
  }
}
`;

// Color mapping for aura status (fallback if AI doesn't provide color)
const AURA_COLORS: Record<string, string> = {
    'Toxic': '#ef4444',
    'Growth': '#22c55e',
    'Balanced': '#3b82f6',
    'Chill': '#06b6d4',
    'Grind': '#a855f7',
    'Neutral': '#6b7280'
};

const LANG_MAP: any = {
    'uk': 'Ukrainian',
    'no': 'Norwegian (Bokmål)',
    'en': 'English'
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { jobIds, userId } = await req.json();

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      throw new Error('No jobIds provided');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch Profile - filter by user_id!
    let profileContent = "";
    const { data: activeProfile } = await supabase
      .from('cv_profiles').select('content').eq('is_active', true).eq('user_id', userId).single();

    if (activeProfile) profileContent = activeProfile.content;
    else {
      // Fallback: try resumes table for legacy data
      const { data: resume } = await supabase.from('resumes').select('content').limit(1).single();
      if (resume) profileContent = resume.content;
    }

    if (!profileContent) throw new Error("No active candidate profile found.");

    // 2. Fetch Settings (Prompt & Language) - filter by user_id!
    let analysisPrompt = DEFAULT_ANALYSIS_PROMPT;
    let targetLang = "Ukrainian"; // Default

    const { data: settings } = await supabase.from('user_settings').select('job_analysis_prompt, preferred_analysis_language').eq('user_id', userId).single();
    
    // If user has a custom prompt, append the required JSON schema
    // This ensures radar/aura data is always generated even with custom prompts
    const REQUIRED_JSON_SCHEMA = `

CRITICAL: Your response MUST be valid JSON with this EXACT structure:
{
  "score": <number 0-100>,
  "analysis": "<your analysis text>",
  "tasks": "<bullet point list of duties>",
  "aura": {
      "status": "<one of: Toxic, Growth, Balanced, Chill, Grind, Neutral>",
      "color": "<hex color: Toxic=#ef4444, Growth=#22c55e, Balanced=#3b82f6, Chill=#06b6d4, Grind=#a855f7, Neutral=#6b7280>",
      "tags": ["<tag1>", "<tag2>"],
      "explanation": "<short reason>"
  },
  "radar": {
      "tech_stack": <number 0-100>,
      "soft_skills": <number 0-100>,
      "culture": <number 0-100>,
      "salary_potential": <number 0-100>,
      "career_growth": <number 0-100>
  }
}`;

    if (settings?.job_analysis_prompt && settings.job_analysis_prompt.length > 20) {
         analysisPrompt = settings.job_analysis_prompt + REQUIRED_JSON_SCHEMA;
    }
    
    if (settings?.preferred_analysis_language && LANG_MAP[settings.preferred_analysis_language]) {
        targetLang = LANG_MAP[settings.preferred_analysis_language];
    }

    // 3. Fetch Jobs
    const { data: jobs } = await supabase.from('jobs').select('id, title, company, description, location').in('id', jobIds);
    if (!jobs) throw new Error(`Error fetching jobs`);

    // 4. Azure OpenAI
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const azureKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const deploymentName = Deno.env.get('AZURE_OPENAI_DEPLOYMENT');

    if (!azureEndpoint || !azureKey) throw new Error("Azure OpenAI secrets missing.");

    const apiUrl = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;
    const results = [];

    for (const job of jobs) {
      if (!job.description || job.description.length < 50) continue;

      const fullPrompt = `
        ${analysisPrompt}

        IMPORTANT: Provide the 'analysis', 'tasks', and 'aura.explanation' fields in ${targetLang}.

        --- CANDIDATE PROFILE ---
        ${profileContent}

        --- JOB DESCRIPTION ---
        Title: ${job.title}
        Company: ${job.company}
        Location: ${job.location}

        ${job.description}
      `;

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': azureKey },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: 'You are a helpful HR assistant that outputs strictly JSON.' },
              { role: 'user', content: fullPrompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
          })
        });

        if (!response.ok) throw new Error(`Azure API Error: ${response.status}`);
        const json = await response.json();
        const content = JSON.parse(json.choices[0].message.content);

        let cost = 0;
        let tokensIn = json.usage?.prompt_tokens || 0;
        let tokensOut = json.usage?.completion_tokens || 0;
        cost = (tokensIn / 1000000 * PRICE_PER_1M_INPUT) + (tokensOut / 1000000 * PRICE_PER_1M_OUTPUT);

        // Validate and normalize Aura data
        let aura = content.aura;
        if (aura && aura.status) {
            // Ensure color is set (fallback to mapped color if AI didn't provide it)
            if (!aura.color || !aura.color.startsWith('#')) {
                aura.color = AURA_COLORS[aura.status] || AURA_COLORS['Neutral'];
            }
            // Ensure tags is an array
            if (!Array.isArray(aura.tags)) {
                aura.tags = [];
            }
        } else {
            // Create default aura if AI didn't return it
            aura = null;
        }

        // Validate Radar data
        let radar = content.radar;
        if (radar) {
            // Ensure all fields are numbers between 0-100
            const fields = ['tech_stack', 'soft_skills', 'culture', 'salary_potential', 'career_growth'];
            for (const field of fields) {
                if (typeof radar[field] !== 'number' || radar[field] < 0 || radar[field] > 100) {
                    radar[field] = 50; // Default to middle value
                }
            }
        } else {
            // AI didn't return radar data
            radar = null;
        }

        // Prepare Metadata (Aura + Radar)
        const metadata = {
            aura: aura,
            radar: radar
        };

        await supabase
          .from('jobs')
          .update({
            relevance_score: content.score,
            ai_recommendation: content.analysis,
            tasks_summary: content.tasks,
            analysis_metadata: metadata, // NEW COLUMN
            status: 'ANALYZED',
            analyzed_at: new Date().toISOString(),
            cost_usd: cost,
            tokens_input: tokensIn,
            tokens_output: tokensOut
          })
          .eq('id', job.id);

        results.push({ id: job.id, success: true, cost });
      } catch (err: any) {
        results.push({ id: job.id, success: false, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
