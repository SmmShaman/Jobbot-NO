
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { job_id, url } = await req.json();

    if (!url) {
      throw new Error('URL is required');
    }

    console.log(`Scraping job text for: ${url}`);
    
    // 1. Fetch URL HTML
    const response = await fetch(url, {
       headers: {
         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
       }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    // 2. Detect "Enkel søknad" button (FINN.no easy apply)
    let hasEnkelSoknad = false;

    // Check for various forms of "Enkel søknad" button on FINN
    const enkelSoknadSelectors = [
      'button:contains("Enkel søknad")',
      'a:contains("Enkel søknad")',
      '[data-testid*="easy-apply"]',
      '[class*="easy-apply"]',
      'button:contains("Easy apply")',
      '.apply-button:contains("Enkel")'
    ];

    for (const selector of enkelSoknadSelectors) {
      try {
        if ($(selector).length > 0) {
          hasEnkelSoknad = true;
          console.log(`✅ Found "Enkel søknad" with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Selector might not be valid, continue
      }
    }

    // Also check raw HTML text for "Enkel søknad" phrase
    if (!hasEnkelSoknad) {
      const htmlLower = html.toLowerCase();
      if (htmlLower.includes('enkel søknad') || htmlLower.includes('enkelsøknad') || htmlLower.includes('easy apply')) {
        hasEnkelSoknad = true;
        console.log('✅ Found "Enkel søknad" in raw HTML text');
      }
    }

    console.log(`📋 Enkel søknad detected: ${hasEnkelSoknad}`);

    // 3. Extract Text based on domain
    let text = "";

    if (url.includes('finn.no')) {
       // Try different selectors common on FINN
       // 2025 selector guesses based on typical FINN structure
       const selectors = [
         'div[data-testid="job-description-text"]',
         '.import_decoration', 
         'section[aria-label="Jobbbeskrivelse"]'
       ];
       
       for (const selector of selectors) {
         const content = $(selector).text();
         if (content && content.length > 100) {
           text = content;
           break;
         }
       }
       
       // Fallback: grab all paragraphs if specific selectors fail
       if (!text) {
          text = $('main p').map((_, el) => $(el).text()).get().join('\n\n');
       }

    } else if (url.includes('nav.no')) {
       // NAV selectors (arbeidsplassen.nav.no)
       // Often located in specific sections
       text = $('.job-posting-text').text() 
           || $('section.description').text()
           || $('div[data-testid="description"]').text()
           || $('section[aria-label="Stillingstekst"]').text();

       // Fallback to specific semantic elements usually found on NAV
       if (!text || text.length < 50) {
           text = $('.JobPosting__Description').text();
       }
    }

    // Clean up text
    text = text.replace(/\s\s+/g, ' ').trim();

    // Generic Fallback if specific logic failed but we have body text
    if (!text || text.length < 50) {
         text = $('main').text() || $('article').text() || $('body').text();
         // Limit generic text to avoid clutter
         if (text.length > 10000) text = text.substring(0, 10000);
    }

    if (!text) {
       text = "Could not extract text automatically. Please visit the link.";
    }

    // 4. Save to Database (if job_id provided)
    if (job_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const updateData: any = { has_enkel_soknad: hasEnkelSoknad };
      if (text.length > 50) {
        updateData.description = text;
      }

      await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', job_id);

      console.log(`Updated job ${job_id} with extracted text and enkel_soknad: ${hasEnkelSoknad}`);
    }

    return new Response(
      JSON.stringify({ success: true, text, has_enkel_soknad: hasEnkelSoknad }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
