
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- PRICING CONFIGURATION (USD per 1M tokens) ---
const PRICE_PER_1M_INPUT = 2.50; 
const PRICE_PER_1M_OUTPUT = 10.00;

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { job_id, user_id } = await req.json();

    if (!job_id) {
      throw new Error('Job ID is required');
    }

    // 1. Check Secrets FIRST
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const azureKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const deploymentName = Deno.env.get('AZURE_OPENAI_DEPLOYMENT');

    if (!azureEndpoint || !azureKey || !deploymentName) {
      throw new Error("Missing Azure OpenAI Secrets.");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Check if Application already exists
    const { data: existingApp } = await supabase
      .from('applications')
      .select('*')
      .eq('job_id', job_id)
      .limit(1)
      .single();

    if (existingApp) {
      return new Response(JSON.stringify({ success: true, application: existingApp, message: "Returning existing application" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Fetch Job Description
    const { data: job } = await supabase.from('jobs').select('description, title, company').eq('id', job_id).single();
    if (!job || !job.description) {
      throw new Error("Job description missing. Please click 'Extract Details' first.");
    }

    // 4. Fetch Active Profile
    const { data: profile } = await supabase.from('cv_profiles').select('content').eq('is_active', true).limit(1).single();
    if (!profile) {
      throw new Error("No Active Profile found. Go to Settings -> Resume and set a profile as active.");
    }

    // 5. Fetch Application Prompt (User Settings)
    const { data: settings } = await supabase.from('user_settings').select('application_prompt').limit(1).single();
    const userPrompt = settings?.application_prompt || "Write a professional cover letter.";

    // 6. Call Azure OpenAI
    const systemInstruction = `
      You are an expert career consultant for the Norwegian job market.
      Your task is to write a "Søknad" (Cover Letter) based on the provided Job Description and Candidate Profile.
      
      OUTPUT FORMAT:
      You must output valid JSON only.
      {
         "soknad_no": "The application text in Norwegian (Bokmål)",
         "translation_uk": "A translation in Ukrainian for the user"
      }
    `;

    const fullPrompt = `
      ${userPrompt}

      --- JOB DESCRIPTION ---
      Title: ${job.title}
      Company: ${job.company}
      
      ${job.description}

      --- CANDIDATE PROFILE ---
      ${profile.content}
    `;

    // Clean endpoint URL
    const baseUrl = azureEndpoint.replace(/\/$/, '');
    const apiUrl = `${baseUrl}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-21`;

    console.log("Sending request to Azure OpenAI...");

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': azureKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: fullPrompt }
        ],
        temperature: 0.7,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
       const txt = await response.text();
       console.error("Azure API Error:", txt);
       throw new Error(`Azure API returned error: ${response.status} - ${txt}`);
    }

    const json = await response.json();
    
    if (!json.choices || !json.choices[0]?.message?.content) {
      throw new Error("Invalid response from Azure OpenAI");
    }

    let contentObj;
    try {
      contentObj = JSON.parse(json.choices[0].message.content);
    } catch (e) {
      console.error("Failed to parse AI response as JSON:", json.choices[0].message.content);
      throw new Error("AI did not return valid JSON. Try again.");
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

    // 7. Save to Database
    const { data: savedApp, error: saveError } = await supabase
      .from('applications')
      .insert([{
        job_id,
        user_id, 
        cover_letter_no: contentObj.soknad_no,
        cover_letter_uk: contentObj.translation_uk,
        status: 'draft',
        created_at: new Date().toISOString(),
        generated_prompt: fullPrompt,
        prompt_source: 'web-dashboard',
        // Cost Tracking
        cost_usd: cost,
        tokens_input: tokensIn,
        tokens_output: tokensOut
      }])
      .select()
      .single();

    if (saveError) {
      console.error("Database Save Error:", saveError);
      throw new Error(`Database Save Error: ${saveError.message}`);
    }

    return new Response(JSON.stringify({ success: true, application: savedApp }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Generate Application Error:", error);
    // Return 200 with success: false so the frontend can read the error message
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 200 
    });
  }
});
