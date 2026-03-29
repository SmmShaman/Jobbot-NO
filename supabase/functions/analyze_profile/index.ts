import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
const VERSION_STAMP = '2026-03-29-force-redeploy';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
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

    const { file_paths, system_prompt, user_prompt, raw_text, skip_analysis, user_id } = body;

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

    // 5. Gemini API Analysis
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY is missing on server. Check Edge Function Secrets.");
    }

    const GEMINI_MODEL = 'gemini-2.5-flash';

    // Determine Prompts
    const sysPrompt = system_prompt
        ? `${system_prompt}\n\nIMPORTANT: You must respond with valid JSON only.`
        : `You are an HR Data Analyst. Extract a complete JSON profile from the resume. Respond with valid JSON only.`;
    const usrPrompt = user_prompt
        ? `${user_prompt}\n\nSOURCE DATA:\n${combinedText}\n\nRespond with JSON.`
        : `TASK: Create a JSON profile.\n\nINPUT:\n${combinedText}\n\nRespond with JSON.`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: usrPrompt }] }
            ],
            systemInstruction: {
              parts: [{ text: sysPrompt }]
            },
            generationConfig: {
              temperature: 0.3,
              responseMimeType: 'application/json'
            }
          }),
    });

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${txt}`);
    }

    const data = await response.json();
    const candidates = data.candidates || [];
    if (!candidates.length) {
        throw new Error('No candidates in Gemini response');
    }
    const content = candidates[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata;

    // Parse JSON output
    let jsonProfile = null;
    try {
        jsonProfile = JSON.parse(content);
    } catch (e) {
        console.warn("Failed to parse AI output as JSON", e);
    }

    // 6. Log Usage
    let cost = 0;
    const tokensIn = usage?.promptTokenCount || 0;
    const tokensOut = usage?.candidatesTokenCount || 0;
    const totalTokens = tokensIn + tokensOut;
    if (usage) {
        cost = (tokensIn / 1000000 * 0.15) + (tokensOut / 1000000 * 3.50);
    }

    await supabaseClient.from('system_logs').insert({
        user_id: user_id || null,
        event_type: 'PROFILE_GEN',
        status: 'SUCCESS',
        message: `Profile generated. Tokens: ${totalTokens}`,
        tokens_used: totalTokens,
        cost_usd: cost,
        source: 'WEB_DASHBOARD'
    });

    return new Response(
      JSON.stringify({
        success: true,
        profileJSON: jsonProfile,
        // Use fullResumeText (complete merged CV) or fall back to professionalSummary or raw content
        profileText: jsonProfile?.fullResumeText || jsonProfile?.professionalSummary || content
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