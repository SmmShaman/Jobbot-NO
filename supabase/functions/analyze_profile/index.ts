
/**
 * ENHANCED PDF Parser & Text Analyzer Edge Function
 * Supports MULTIPLE resumes or RAW TEXT and creates comprehensive JSON profile
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1'

declare const Deno: any;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ENHANCED_PROMPT_SYSTEM = `You are an EXPERT HR Data Analyst.
Your mission: Extract EVERY possible detail from resumes and CREATE A FULLY POPULATED JSON profile.
When information is missing, make INTELLIGENT INFERENCES based on context and Norwegian job market standards.
NEVER return incomplete profiles. EVERY field must contain meaningful, realistic data.`;

const ENHANCED_RULES = `
REQUIREMENTS:
1. OUTPUT MUST BE VALID JSON.
2. Phone numbers: +47 format if inferred.
3. Include Norwegian (Bokmål) in languages if context implies it (min B1).
4. Combine info from ALL provided resumes.
`;

async function parseTextWithAI(
  text: string,
  customSystemPrompt?: string,
  customUserPrompt?: string
): Promise<any> {
  const azureEndpoint = Deno.env.get('AZURE_OPENAI_ENDPOINT')!;
  const azureApiKey = Deno.env.get('AZURE_OPENAI_API_KEY')!;
  const deploymentName = Deno.env.get('AZURE_OPENAI_DEPLOYMENT')!;

  // Determine Prompts
  const systemPrompt = customSystemPrompt || ENHANCED_PROMPT_SYSTEM;
  let userPrompt = "";

  if (customUserPrompt) {
      userPrompt = `${customUserPrompt}\n\nSOURCE DATA:\n${text}`;
  } else {
      userPrompt = `
      TASK: Create a MAXIMALLY COMPLETE professional JSON profile.
      ${ENHANCED_RULES}

      INPUT DATA:
      ${text.substring(0, 15000)} 

      OUTPUT JSON FORMAT:
      {
        "personalInfo": {
          "fullName": "string", "email": "string", "phone": "string", 
          "website": "string", "address": { "city": "string", "country": "string" }
        },
        "professionalSummary": "string (2-3 sentences)",
        "workExperience": [
          { 
            "company": "string", "position": "string", "startDate": "string", "endDate": "string",
            "responsibilities": ["string"], "achievements": ["string"], "technologiesUsed": ["string"]
          }
        ],
        "technicalSkills": {
          "aiTools": ["string"], "programmingLanguages": ["string"], "frameworks": ["string"],
          "databases": ["string"], "cloudPlatforms": ["string"], "developmentTools": ["string"], "other": ["string"]
        },
        "softSkills": ["string"],
        "languages": [ { "language": "string", "proficiencyLevel": "string" } ],
        "education": [ { "institution": "string", "degree": "string", "field": "string", "graduationYear": "string" } ],
        "certifications": ["string"],
        "interests": ["string"],
        "careerStats": { "totalExperienceYears": number, "currentRole": "string", "industries": ["string"] }
      }
      `;
  }

  // Call Azure OpenAI
  const response = await fetch(
    `${azureEndpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': azureApiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: "json_object" }
      }),
    }
  );

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Azure API error: ${txt}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
      return {
          json: JSON.parse(content),
          raw: content,
          usage: data.usage
      };
  } catch (e) {
      return {
          json: null,
          raw: content,
          usage: data.usage
      };
  }
}

async function extractTextFromPDF(fileUrl: string): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Use unpdf
  const pdf = await getDocumentProxy(uint8Array);
  const { text } = await extractText(pdf, { mergePages: true });
  
  return text.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { file_paths, system_prompt, user_prompt, raw_text } = await req.json();

    let combinedText = "";

    // 1. Handle Raw Text (For upgrading Legacy Profiles)
    if (raw_text) {
        combinedText = raw_text;
    } 
    // 2. Handle File Paths (Standard Upload)
    else if (file_paths && Array.isArray(file_paths) && file_paths.length > 0) {
        const texts = [];
        for (const path of file_paths) {
            const { data } = await supabaseClient.storage.from('resumes').createSignedUrl(path, 60);
            if (data?.signedUrl) {
                const text = await extractTextFromPDF(data.signedUrl);
                texts.push(`=== FILE: ${path} ===\n${text}`);
            }
        }
        combinedText = texts.join('\n\n');
    } else {
        throw new Error('No file paths or raw text provided');
    }

    if (!combinedText || combinedText.length < 20) throw new Error("Text extracted is too short or empty.");

    // 3. Analyze with AI
    const aiResult = await parseTextWithAI(combinedText, system_prompt, user_prompt);
    
    // 4. Calculate Costs
    let cost = 0;
    if (aiResult.usage) {
        cost = (aiResult.usage.prompt_tokens / 1000000 * 2.50) + (aiResult.usage.completion_tokens / 1000000 * 10.00); 
    }

    // 5. Log
    await supabaseClient.from('system_logs').insert({
        event_type: 'PROFILE_GEN',
        status: 'SUCCESS',
        message: `Parsed profile data. Source: ${raw_text ? 'Legacy Text' : 'PDF Files'}`,
        tokens_used: (aiResult.usage?.total_tokens || 0),
        cost_usd: cost,
        source: 'WEB_DASHBOARD'
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        profileJSON: aiResult.json, 
        profileText: aiResult.json?.professionalSummary || aiResult.raw 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
