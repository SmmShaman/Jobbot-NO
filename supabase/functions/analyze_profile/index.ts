import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';
import { GoogleGenAI } from "npm:@google/genai";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Extract text from a single PDF URL
async function extractPdfText(url: string) {
  console.log('Downloading PDF from:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Parse PDF with unpdf
  const pdf = await getDocumentProxy(uint8Array);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

serve(async (req: Request) => {
  // 1. Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Get Data from Request
    const { file_paths, system_prompt, user_prompt } = await req.json();

    if (!file_paths || !Array.isArray(file_paths) || file_paths.length === 0) {
      throw new Error('No file paths provided');
    }

    // 3. Initialize Supabase
    // Note: In Supabase Edge Functions, these env vars are set automatically
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 4. Process Files (Download & Extract Text)
    let combinedText = "";
    console.log(`Processing ${file_paths.length} files...`);

    for (const path of file_paths) {
      // Get a signed URL to download the file (valid for 60 seconds)
      const { data, error } = await supabase
        .storage
        .from('resumes')
        .createSignedUrl(path, 60);

      if (error || !data?.signedUrl) {
        console.error(`Error getting URL for ${path}:`, error);
        continue;
      }

      try {
        const text = await extractPdfText(data.signedUrl);
        combinedText += `\n\n--- FILE START: ${path} ---\n${text}\n--- FILE END ---\n`;
      } catch (e: any) {
        console.error(`Error extracting text from ${path}:`, e);
        combinedText += `\n[Error reading ${path}]\n`;
      }
    }

    if (!combinedText.trim()) {
      throw new Error("Could not extract text from any of the provided files.");
    }

    // 5. Prepare Gemini Request
    const apiKey = Deno.env.get('API_KEY');

    if (!apiKey) {
      throw new Error("API_KEY is missing in Edge Function Secrets.");
    }

    console.log(`Sending to Gemini...`);
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${user_prompt}\n\nSOURCE DATA:\n${combinedText}`,
      config: {
        systemInstruction: system_prompt,
      }
    });

    const profile = response.text || "No analysis generated.";

    // 6. Return Result
    return new Response(
      JSON.stringify({ profile }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Function Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});