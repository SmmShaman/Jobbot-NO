
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- PRICING CONFIGURATION (USD per 1M tokens) ---
// Default to GPT-4o pricing (as of late 2024)
const PRICE_PER_1M_INPUT = 2.50; 
const PRICE_PER_1M_OUTPUT = 10.00;

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { jobIds, userId } = await req.json();

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      throw new Error('No jobIds provided');
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Analyzing ${jobIds.length} jobs...`);

    // 1. Fetch Active Profile
    let profileContent = "";
    
    const { data: activeProfile } = await supabase
      .from('cv_profiles')
      .select('content')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (activeProfile) {
      profileContent = activeProfile.content;
    } else {
      console.log("No active cv_profile found. Trying legacy resumes...");
      const { data: resume } = await supabase
         .from('resumes')
         .select('content')
         .limit(1)
         .single();
      if (resume) profileContent = resume.content;
    }

    if (!profileContent) {
      throw new Error("No active candidate profile found. Please go to Settings -> Profiles and set one as active.");
    }

    // 2. Fetch Jobs Data
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('id, title, company, description, location')
      .in('id', jobIds);

    if (jobsError || !jobs) {
      throw new Error(`Error fetching jobs: ${jobsError?.message}`);
    }

    // 3. Setup Azure OpenAI
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const azureKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const deploymentName = Deno.env.get('AZURE_OPENAI_DEPLOYMENT');

    if (!azureEndpoint || !azureKey) {
      throw new Error("Azure OpenAI secrets missing.");
    }

    const baseUrl = azureEndpoint.replace(/\/$/, '');
    const apiUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;

    const results = [];

    // 4. Analyze each job
    for (const job of jobs) {
      if (!job.description || job.description.length < 50) {
        console.log(`Skipping job ${job.id}: No description extracted.`);
        continue;
      }

      const prompt = `
        You are a Job Relevance Analyzer.
        
        CANDIDATE PROFILE:
        ${profileContent.substring(0, 3000)}

        JOB DESCRIPTION:
        Title: ${job.title}
        Company: ${job.company}
        Location: ${job.location}
        
        ${job.description.substring(0, 3000)}

        TASK:
        1. Analyze how well the candidate fits this job.
        2. Provide a Relevance Score (0-100).
        3. Provide a concise explanation (in Ukrainian) highlighting Pros and Cons.
        4. EXTRACT TASKS: List specifically what the candidate needs to DO (duties/responsibilities). 
           - Language: Ukrainian.
           - Format: Concise bullet points.
           - Content: Concrete actions only (e.g. "Develop React components", "Configure Azure pipelines"). No fluff like "Join our friendly team".

        OUTPUT FORMAT (JSON ONLY):
        {
          "score": number,
          "analysis": "string (markdown supported, analysis of fit)",
          "tasks": "string (bullet point list of duties in Ukrainian)"
        }
      `;

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': azureKey
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: 'You are a helpful HR assistant that outputs strictly JSON.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
          })
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`Azure API Error: ${response.status} - ${txt}`);
        }

        const json = await response.json();
        const content = json.choices[0].message.content;
        let result;
        try {
            result = JSON.parse(content);
        } catch (e) {
            console.error("JSON Parse Error:", content);
            throw new Error("AI returned invalid JSON");
        }

        // --- CALCULATE COST ---
        let cost = 0;
        let tokensIn = 0;
        let tokensOut = 0;
        
        if (json.usage) {
            tokensIn = json.usage.prompt_tokens || 0;
            tokensOut = json.usage.completion_tokens || 0;
            cost = (tokensIn / 1000000 * PRICE_PER_1M_INPUT) + 
                   (tokensOut / 1000000 * PRICE_PER_1M_OUTPUT);
        }

        // Update Database with tasks_summary AND COST
        await supabase
          .from('jobs')
          .update({
            relevance_score: result.score,
            ai_recommendation: result.analysis,
            tasks_summary: result.tasks,
            status: 'ANALYZED',
            analyzed_at: new Date().toISOString(),
            // Cost Tracking
            cost_usd: cost,
            tokens_input: tokensIn,
            tokens_output: tokensOut
          })
          .eq('id', job.id);

        results.push({ id: job.id, success: true, cost });
        
      } catch (err: any) {
        console.error(`Error analyzing job ${job.id}:`, err);
        results.push({ id: job.id, success: false, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Function Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
