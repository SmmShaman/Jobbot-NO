import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1'

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Setup Supabase Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Server configuration error: Missing Supabase secrets.")
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey)

    // 2. Parse Request Body
    let body;
    try {
        body = await req.json();
    } catch (e) {
        throw new Error("Invalid Request Body: Failed to parse JSON.");
    }

    const { file_paths, system_prompt, user_prompt, raw_text, skip_analysis } = body;

    // 3. Process Input (Files or Raw Text)
    let combinedText = "";

    if (raw_text) {
        combinedText = raw_text;
    } else if (file_paths && Array.isArray(file_paths) && file_paths.length > 0) {
        const texts = [];
        for (const path of file_paths) {
             const { data, error: signError } = await supabaseClient.storage.from('resumes').createSignedUrl(path, 60);
             if (signError || !data?.signedUrl) {
                 console.warn(`Could not sign URL for ${path}`, signError);
                 continue;
             }
             
             try {
                const response = await fetch(data.signedUrl);
                if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
                const { text } = await extractText(pdf, { mergePages: true });
                texts.push(`=== FILE: ${path} ===\n${text.trim()}`);
             } catch (err: any) {
                console.error(`PDF Parse Error (${path}):`, err);
                texts.push(`=== FILE: ${path} (PARSE ERROR) ===\nError: ${err.message}`);
             }
        }
        combinedText = texts.join('\n\n');
    } else {
        throw new Error("No input provided. Please upload files or provide text.");
    }

    if (!combinedText || combinedText.length < 10) {
        throw new Error("Extracted text is too short or empty. Please check if the file is readable.");
    }

    // 4. Skip Analysis if requested (Return extracted text only)
    if (skip_analysis) {
        return new Response(
            JSON.stringify({ success: true, text: combinedText }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
    }

    // 5. Azure OpenAI Analysis
    const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT');
    const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const deploymentName = Deno.env.get('AZURE_OPENAI_DEPLOYMENT');

    if (!azureEndpoint || !azureApiKey || !deploymentName) {
        throw new Error("Azure OpenAI configuration is missing on server. Check Edge Function Secrets.");
    }

    // Determine Prompts - MUST contain "json" for response_format to work
    const sysPrompt = system_prompt
        ? `${system_prompt}\n\nIMPORTANT: You must respond with valid JSON only.`
        : `You are an HR Data Analyst. Extract a complete JSON profile from the resume. Respond with valid JSON only.`;
    const usrPrompt = user_prompt
        ? `${user_prompt}\n\nSOURCE DATA:\n${combinedText.substring(0, 15000)}\n\nRespond with JSON.`
        : `TASK: Create a JSON profile.\n\nINPUT:\n${combinedText.substring(0, 15000)}\n\nRespond with JSON.`;

    const response = await fetch(
        `${azureEndpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': azureApiKey },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: usrPrompt }
            ],
            temperature: 0.3,
            response_format: { type: "json_object" }
          }),
        }
    );

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Azure API error: ${response.status} - ${txt}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const usage = data.usage;

    // Parse JSON output
    let jsonProfile = null;
    try {
        jsonProfile = JSON.parse(content);
    } catch (e) {
        console.warn("Failed to parse AI output as JSON", e);
    }

    // 6. Log Usage
    let cost = 0;
    if (usage) {
        cost = (usage.prompt_tokens / 1000000 * 2.50) + (usage.completion_tokens / 1000000 * 10.00); 
    }

    await supabaseClient.from('system_logs').insert({
        event_type: 'PROFILE_GEN',
        status: 'SUCCESS',
        message: `Profile generated. Tokens: ${usage?.total_tokens}`,
        tokens_used: usage?.total_tokens || 0,
        cost_usd: cost,
        source: 'WEB_DASHBOARD'
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        profileJSON: jsonProfile, 
        profileText: jsonProfile?.professionalSummary || content 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error("Analyze Profile Error:", error);
    // Return 200 with error details so frontend can display the message instead of generic 500
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Unknown error occurred" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  }
})