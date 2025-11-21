
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';
import { GoogleGenAI } from "npm:@google/genai";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Estimated Gemini Flash Pricing
const GEMINI_INPUT_COST = 0.075; // per 1M tokens
const GEMINI_OUTPUT_COST = 0.30; // per 1M tokens

// Helper: Extract text from a single PDF URL
async function extractPdfText(url: string) {
  console.log('Downloading PDF from:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  const pdf = await getDocumentProxy(uint8Array);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { file_paths, system_prompt, user_prompt } = await req.json();

    if (!file_paths || !Array.isArray(file_paths) || file_paths.length === 0) {
      throw new Error('No file paths provided');
    }

    // Process Files
    let combinedText = "";
    console.log(`Processing ${file_paths.length} files...`);

    for (const path of file_paths) {
      const { data, error } = await supabase.storage.from('resumes').createSignedUrl(path, 60);
      if (error || !data?.signedUrl) continue;

      try {
        const text = await extractPdfText(data.signedUrl);
        combinedText += `\n\n--- FILE START: ${path} ---\n${text}\n--- FILE END ---\n`;
      } catch (e: any) {
        combinedText += `\n[Error reading ${path}]\n`;
      }
    }

    if (!combinedText.trim()) {
      throw new Error("Could not extract text from any of the provided files.");
    }

    // Gemini Request
    const apiKey = Deno.env.get('API_KEY');
    if (!apiKey) throw new Error("API_KEY is missing.");

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${user_prompt}\n\nSOURCE DATA:\n${combinedText}`,
      config: { systemInstruction: system_prompt }
    });

    const profile = response.text || "No analysis generated.";
    
    // Calculate Costs
    let tokensIn = 0;
    let tokensOut = 0;
    let cost = 0;

    // Check usage metadata if available
    if (response.usageMetadata) {
        tokensIn = response.usageMetadata.promptTokenCount || 0;
        tokensOut = response.usageMetadata.candidatesTokenCount || 0;
        cost = (tokensIn / 1000000 * GEMINI_INPUT_COST) + (tokensOut / 1000000 * GEMINI_OUTPUT_COST);
    }

    // Log to DB
    await supabase.from('system_logs').insert({
        event_type: 'PROFILE_GEN',
        status: 'SUCCESS',
        message: `Profile generated from ${file_paths.length} files.`,
        details: { fileCount: file_paths.length },
        tokens_used: tokensIn + tokensOut,
        cost_usd: cost,
        source: 'WEB_DASHBOARD'
    });

    return new Response(
      JSON.stringify({ profile }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Function Error:", error);
    // Log Failure
    await supabase.from('system_logs').insert({
        event_type: 'PROFILE_GEN',
        status: 'FAILED',
        message: error.message,
        source: 'WEB_DASHBOARD'
    });

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
