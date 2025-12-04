
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Extract domain from URL
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove www. prefix and get main domain
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// Helper: Parse Norwegian date format to ISO date string
// Handles formats like: "31. desember 2024", "31.12.2024", "31/12/2024", "2024-12-31"
function parseNorwegianDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const norwegianMonths: Record<string, string> = {
    'januar': '01', 'februar': '02', 'mars': '03', 'april': '04',
    'mai': '05', 'juni': '06', 'juli': '07', 'august': '08',
    'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
  };

  const cleaned = dateStr.toLowerCase().trim();

  // Try format: "31. desember 2024" or "31 desember 2024"
  const norwegianMatch = cleaned.match(/(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/);
  if (norwegianMatch) {
    const day = norwegianMatch[1].padStart(2, '0');
    const month = norwegianMonths[norwegianMatch[2]];
    const year = norwegianMatch[3];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // Try format: "31.12.2024" or "31/12/2024"
  const numericMatch = cleaned.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (numericMatch) {
    const day = numericMatch[1].padStart(2, '0');
    const month = numericMatch[2].padStart(2, '0');
    const year = numericMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Try ISO format: "2024-12-31"
  const isoMatch = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }

  return null;
}

// Helper: Extract deadline (søknadsfrist) from FINN page
function extractDeadline($: cheerio.CheerioAPI, html: string): string | null {
  // Method 1: Look for specific FINN selectors
  const deadlineSelectors = [
    'dt:contains("Søknadsfrist") + dd',
    'th:contains("Søknadsfrist") + td',
    '[data-testid*="deadline"]',
    '.deadline',
    'time[datetime]'
  ];

  for (const selector of deadlineSelectors) {
    try {
      const el = $(selector).first();
      if (el.length > 0) {
        // Check for datetime attribute first
        const datetime = el.attr('datetime');
        if (datetime) {
          const parsed = parseNorwegianDate(datetime);
          if (parsed) {
            console.log(`📅 Found deadline from datetime attr: ${parsed}`);
            return parsed;
          }
        }

        // Otherwise use text content
        const text = el.text().trim();
        const parsed = parseNorwegianDate(text);
        if (parsed) {
          console.log(`📅 Found deadline from selector "${selector}": ${text} -> ${parsed}`);
          return parsed;
        }
      }
    } catch (e) {
      // Continue
    }
  }

  // Method 2: Regex search in HTML for "Søknadsfrist"
  const htmlLower = html.toLowerCase();
  const fristPatterns = [
    /søknadsfrist[:\s]*(\d{1,2}\.?\s*[a-zæøå]+\s*\d{4})/i,
    /søknadsfrist[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,
    /frist[:\s]*(\d{1,2}\.?\s*[a-zæøå]+\s*\d{4})/i,
    /deadline[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i
  ];

  for (const pattern of fristPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const parsed = parseNorwegianDate(match[1]);
      if (parsed) {
        console.log(`📅 Found deadline from regex: ${match[1]} -> ${parsed}`);
        return parsed;
      }
    }
  }

  // Method 3: Look for "Snarest" or "ASAP" indicators
  if (htmlLower.includes('søknadsfrist') && (htmlLower.includes('snarest') || htmlLower.includes('asap'))) {
    // Today's date + 7 days as estimate for "ASAP" listings
    const today = new Date();
    today.setDate(today.getDate() + 7);
    const estimated = today.toISOString().split('T')[0];
    console.log(`📅 Found "snarest" deadline, estimated: ${estimated}`);
    return estimated;
  }

  return null;
}

// Helper: Detect form type from external page HTML
function detectFormType(html: string, $: cheerio.CheerioAPI): 'form' | 'registration' | 'unknown' {
  const htmlLower = html.toLowerCase();

  // Registration indicators (strong signals)
  const registrationPatterns = [
    'create account', 'create an account', 'sign up', 'signup',
    'register', 'registrer', 'opprett konto', 'opprett bruker',
    'lag konto', 'log in to apply', 'logg inn for å søke',
    'create your profile', 'opprett din profil'
  ];

  // Check for password field (strong registration indicator)
  const hasPasswordField = $('input[type="password"]').length > 0;

  // Check for registration patterns in text
  const hasRegistrationText = registrationPatterns.some(pattern =>
    htmlLower.includes(pattern)
  );

  // Check for social login buttons (indicates registration required)
  const hasSocialLogin = htmlLower.includes('sign in with') ||
                         htmlLower.includes('logg inn med') ||
                         htmlLower.includes('linkedin') && htmlLower.includes('login');

  // Form indicators (direct application)
  const formPatterns = [
    'upload cv', 'last opp cv', 'attach resume', 'legg ved',
    'søknadsskjema', 'application form', 'send søknad',
    'submit application', 'apply now', 'søk nå'
  ];

  const hasDirectForm = formPatterns.some(pattern =>
    htmlLower.includes(pattern)
  ) && !hasPasswordField;

  // Decision logic
  if (hasPasswordField || hasSocialLogin) {
    return 'registration';
  }

  if (hasRegistrationText && !hasDirectForm) {
    return 'registration';
  }

  if (hasDirectForm) {
    return 'form';
  }

  // If we find a form element with file upload but no password, likely direct form
  const hasFileUpload = $('input[type="file"]').length > 0;
  const hasEmailField = $('input[type="email"]').length > 0;

  if (hasFileUpload && hasEmailField && !hasPasswordField) {
    return 'form';
  }

  return 'unknown';
}

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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // 2. Detect application type - prioritize button detection over raw text
    let hasEnkelSoknad = false;
    let hasSokHerButton = false;
    let applicationFormType: 'finn_easy' | 'external_form' | 'external_registration' | 'unknown' = 'unknown';
    let externalApplyUrl: string | null = null;

    // FIRST: Check for "Søk her" button (external apply) - this takes priority!
    const sokHerSelectors = [
      'a:contains("Søk her")',
      'a:contains("Søk på stillingen")',
      'a:contains("Søk på jobben")',
      'button:contains("Søk her")',
    ];

    for (const selector of sokHerSelectors) {
      try {
        const el = $(selector).first();
        if (el.length > 0) {
          const href = el.attr('href');
          const text = el.text().trim();
          console.log(`🔍 Found "Søk her" button: "${text}" with href: ${href}`);
          hasSokHerButton = true;

          if (href && href.startsWith('http') && !href.includes('finn.no')) {
            externalApplyUrl = href;
            console.log(`🔗 External apply URL: ${externalApplyUrl}`);
          }
          break;
        }
      } catch (e) {
        // Continue
      }
    }

    // SECOND: Only check for "Enkel søknad" if NO "Søk her" button was found
    if (!hasSokHerButton) {
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
            console.log(`✅ Found "Enkel søknad" button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      // Only check raw HTML if no button found at all
      if (!hasEnkelSoknad) {
        const htmlLower = html.toLowerCase();
        // More strict check - look for button-like context
        if (htmlLower.includes('>enkel søknad<') || htmlLower.includes('button.*enkel søknad')) {
          hasEnkelSoknad = true;
          console.log('✅ Found "Enkel søknad" in HTML (strict match)');
        }
      }
    }

    console.log(`📋 Søk her button: ${hasSokHerButton}, Enkel søknad: ${hasEnkelSoknad}`);

    // 2.5. Extract deadline (søknadsfrist)
    const deadline = extractDeadline($, html);
    console.log(`📅 Deadline: ${deadline || 'not found'}`);

    // 3. Determine application form type
    if (hasEnkelSoknad) {
      applicationFormType = 'finn_easy';
      console.log('📝 Application type: FINN Easy Apply');
    } else {
      // FINN.no specific: Look for "Søk her" or "Søk på stillingen" buttons
      // These buttons typically have external URLs

      // First, try to find FINN-specific apply button selectors
      const finnApplySelectors = [
        'a:contains("Søk her")',
        'a:contains("Søk på stillingen")',
        'a:contains("Søk på jobben")',
        'button:contains("Søk her")',
        '[data-testid*="apply"] a',
        '[class*="apply"] a',
        '.job-apply a',
        'a[href*="webcruiter"]',
        'a[href*="jobylon"]',
        'a[href*="teamtailor"]',
        'a[href*="recman"]',
        'a[href*="cvpartner"]'
      ];

      // Try FINN-specific selectors first
      for (const selector of finnApplySelectors) {
        try {
          const el = $(selector).first();
          if (el.length > 0) {
            const href = el.attr('href');
            const text = el.text().trim();
            console.log(`🔍 Found apply element: "${text}" with href: ${href}`);

            if (href && href.startsWith('http') && !href.includes('finn.no')) {
              externalApplyUrl = href;
              console.log(`🔗 Found external apply URL from FINN button: ${externalApplyUrl}`);
              break;
            }
          }
        } catch (e) {
          // Continue
        }
      }

      // If still not found, scan ALL links for external recruitment sites
      if (!externalApplyUrl) {
        const knownRecruitmentDomains = [
          'webcruiter', 'jobylon', 'teamtailor', 'recman', 'cvpartner',
          'easycruit', 'varbi', 'greenhouse', 'lever', 'workday',
          'smartrecruiters', 'talentech', 'csod', 'cornerstone'
        ];

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const isRecruitmentSite = knownRecruitmentDomains.some(domain =>
            href.toLowerCase().includes(domain)
          );

          if (href.startsWith('http') && !href.includes('finn.no') && isRecruitmentSite) {
            externalApplyUrl = href;
            console.log(`🔗 Found recruitment site URL: ${externalApplyUrl}`);
            return false; // break
          }
        });
      }

      // Fallback: look for any external link in apply-related sections
      if (!externalApplyUrl) {
        $('a, button').each((_, el) => {
          const href = $(el).attr('href') || '';
          const onclick = $(el).attr('onclick') || '';
          const text = $(el).text().toLowerCase();

          // Check if this looks like an apply button
          const isApplyButton = text.includes('søk') || text.includes('apply') ||
                               text.includes('send') || text.includes('registrer');

          if (isApplyButton) {
            // Try to extract URL from href or onclick
            if (href.startsWith('http') && !href.includes('finn.no')) {
              externalApplyUrl = href;
              console.log(`🔗 Found apply URL from button text: ${externalApplyUrl}`);
              return false;
            }

            const urlMatch = onclick.match(/https?:\/\/[^\s'"]+/);
            if (urlMatch && !urlMatch[0].includes('finn.no')) {
              externalApplyUrl = urlMatch[0];
              console.log(`🔗 Found apply URL from onclick: ${externalApplyUrl}`);
              return false;
            }
          }
        });
      }

      if (externalApplyUrl) {
        const domain = extractDomain(externalApplyUrl);
        console.log(`🏢 External domain: ${domain}`);

        // Check if domain is in our known agencies database
        const { data: knownAgency } = await supabase
          .from('recruitment_agencies')
          .select('form_type, name')
          .eq('domain', domain)
          .single();

        if (knownAgency) {
          console.log(`✅ Found known agency: ${knownAgency.name} (${knownAgency.form_type})`);
          applicationFormType = knownAgency.form_type === 'registration' ? 'external_registration' : 'external_form';
        } else {
          // Unknown agency - scrape external page to detect form type
          console.log(`🔍 Unknown agency, scanning external page...`);

          try {
            const extResponse = await fetch(externalApplyUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              redirect: 'follow'
            });

            if (extResponse.ok) {
              const extHtml = await extResponse.text();
              const $ext = cheerio.load(extHtml);
              const detectedType = detectFormType(extHtml, $ext);

              console.log(`🎯 Detected form type: ${detectedType}`);

              // Save new agency to database for future reference
              if (detectedType !== 'unknown') {
                await supabase
                  .from('recruitment_agencies')
                  .upsert({
                    domain: domain,
                    form_type: detectedType,
                    detection_method: 'auto',
                    sample_urls: [externalApplyUrl],
                    updated_at: new Date().toISOString()
                  }, { onConflict: 'domain' });

                console.log(`💾 Saved new agency: ${domain} (${detectedType})`);
              }

              applicationFormType = detectedType === 'registration' ? 'external_registration' :
                                   detectedType === 'form' ? 'external_form' : 'unknown';
            }
          } catch (extError) {
            console.error('Error fetching external page:', extError);
            applicationFormType = 'unknown';
          }
        }
      } else {
        console.log('⚠️ No external apply URL found');
        applicationFormType = 'unknown';
      }
    }

    // 4. Extract Text based on domain
    let text = "";

    if (url.includes('finn.no')) {
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

       if (!text) {
          text = $('main p').map((_, el) => $(el).text()).get().join('\n\n');
       }

    } else if (url.includes('nav.no')) {
       text = $('.job-posting-text').text()
           || $('section.description').text()
           || $('div[data-testid="description"]').text()
           || $('section[aria-label="Stillingstekst"]').text();

       if (!text || text.length < 50) {
           text = $('.JobPosting__Description').text();
       }
    }

    // Clean up text
    text = text.replace(/\s\s+/g, ' ').trim();

    // Generic Fallback
    if (!text || text.length < 50) {
         text = $('main').text() || $('article').text() || $('body').text();
         if (text.length > 10000) text = text.substring(0, 10000);
    }

    if (!text) {
       text = "Could not extract text automatically. Please visit the link.";
    }

    // 5. Save to Database (if job_id provided)
    if (job_id) {
      const updateData: any = {
        has_enkel_soknad: hasEnkelSoknad,
        application_form_type: applicationFormType
      };

      if (text.length > 50) {
        updateData.description = text;
      }

      if (externalApplyUrl) {
        updateData.external_apply_url = externalApplyUrl;
      }

      if (deadline) {
        updateData.deadline = deadline;
      }

      await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', job_id);

      console.log(`✅ Updated job ${job_id}: type=${applicationFormType}, enkel=${hasEnkelSoknad}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        text,
        has_enkel_soknad: hasEnkelSoknad,
        application_form_type: applicationFormType,
        external_apply_url: externalApplyUrl,
        deadline: deadline
      }),
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
