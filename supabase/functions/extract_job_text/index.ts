
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

// Helper: Extract finnkode from FINN URL using multiple patterns
function extractFinnkode(url: string): string | null {
  if (!url || !url.includes('finn.no')) {
    return null;
  }

  // Pattern 1: Query parameter format - ?finnkode=123456789
  const queryMatch = url.match(/[?&]finnkode=(\d+)/);
  if (queryMatch) {
    return queryMatch[1];
  }

  // Pattern 2: Path-based format - /job/123456789 or /job/123456789.html
  const jobPathMatch = url.match(/\/job\/(\d{8,})(?:\.html|\?|$)/);
  if (jobPathMatch) {
    return jobPathMatch[1];
  }

  // Pattern 3: Old format - /ad/123456789 or /ad.html?finnkode=...
  const adPathMatch = url.match(/\/ad[\/.](\d{8,})(?:\?|$)/);
  if (adPathMatch) {
    return adPathMatch[1];
  }

  // Pattern 4: Just a number at the end of URL path (8+ digits)
  const endMatch = url.match(/\/(\d{8,})(?:\?|$)/);
  if (endMatch) {
    return endMatch[1];
  }

  // Pattern 5: In path like /job/fulltime/123456789
  const fulltimeMatch = url.match(/\/job\/[^\/]+\/(\d{8,})(?:\?|$)/);
  if (fulltimeMatch) {
    return fulltimeMatch[1];
  }

  return null;
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

// Helper: Check if text indicates ASAP/immediate deadline
function isAsapDeadline(text: string): boolean {
  const asapTerms = ['snarest', 'asap', 'fortløpende', 'løpende', 'straks', 'umiddelbart', 'så snart som mulig'];
  const lower = text.toLowerCase().trim();
  return asapTerms.some(term => lower.includes(term));
}

// Helper: Calculate estimated deadline (today + N days)
function getEstimatedDeadline(daysFromNow: number = 14): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return '~' + date.toISOString().split('T')[0]; // Prefix with ~ to indicate estimated
}

// Helper: Extract deadline (søknadsfrist) from FINN page
function extractDeadline($: cheerio.CheerioAPI, html: string): string | null {
  // Method 0: FINN-specific structure - <li>Frist<span>DATE</span></li>
  // This is the actual FINN HTML structure as of Dec 2025
  try {
    const fristLi = $('li').filter((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      return text.toLowerCase().includes('frist');
    }).first();

    if (fristLi.length > 0) {
      const dateSpan = fristLi.find('span').first();
      if (dateSpan.length > 0) {
        const dateText = dateSpan.text().trim();

        // Check for "Snarest" / ASAP indicators
        if (isAsapDeadline(dateText)) {
          const estimated = getEstimatedDeadline(14); // 2 weeks from now
          console.log(`📅 Found ASAP deadline "${dateText}", estimated: ${estimated}`);
          return estimated;
        }

        const parsed = parseNorwegianDate(dateText);
        if (parsed) {
          console.log(`📅 Found deadline from FINN li>span: ${dateText} -> ${parsed}`);
          return parsed;
        }
      }
    }
  } catch (e) {
    console.log(`⚠️ Error in FINN li>span selector: ${e}`);
  }

  // Method 1: Look for specific selectors (order matters - most specific first)
  const deadlineSelectors = [
    'dt:contains("Søknadsfrist") + dd',
    'dt:contains("Frist") + dd',
    'th:contains("Søknadsfrist") + td',
    'th:contains("Frist") + td',
    '[data-testid*="deadline"]',
    '[data-testid*="frist"]',
    '.deadline',
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

  // Method 2: Regex search in HTML for "Søknadsfrist" or "Frist"
  const htmlLower = html.toLowerCase();
  const fristPatterns = [
    /søknadsfrist[:\s]*(\d{1,2}\.?\s*[a-zæøå]+\s*\d{4})/i,  // "søknadsfrist: 16. januar 2026"
    /søknadsfrist[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,  // "søknadsfrist: 16.01.2026"
    /frist[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i,         // "frist: 16.01.2026" - FINN format!
    /frist[:\s]*(\d{1,2}\.?\s*[a-zæøå]+\s*\d{4})/i,        // "frist: 16. januar 2026"
    /deadline[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i       // "deadline: 16.01.2026"
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

  // Method 3: Look for "Snarest" or "ASAP" indicators in HTML
  if (isAsapDeadline(html)) {
    const estimated = getEstimatedDeadline(14);
    console.log(`📅 Found ASAP indicator in HTML, estimated: ${estimated}`);
    return estimated;
  }

  return null;
}

// Helper: Extract contact information from job page
interface ContactInfo {
  name: string | null;
  phone: string | null;
  email: string | null;
  title: string | null;
}

function extractContactInfo($: cheerio.CheerioAPI, html: string): ContactInfo {
  const contact: ContactInfo = { name: null, phone: null, email: null, title: null };

  // Method 1: Look for structured contact sections
  const contactSelectors = [
    'dt:contains("Kontaktperson") + dd',
    'dt:contains("Kontakt") + dd',
    'th:contains("Kontaktperson") + td',
    '[data-testid*="contact"]',
    '[class*="contact"]',
    '.contact-info',
    '.kontaktperson',
  ];

  for (const selector of contactSelectors) {
    try {
      const el = $(selector).first();
      if (el.length > 0) {
        const text = el.text().trim();
        if (text && text.length > 2) {
          // Try to extract name (first part before phone/email)
          const parts = text.split(/[\n\r,]/);
          if (parts[0] && parts[0].length > 2 && parts[0].length < 50) {
            contact.name = parts[0].trim();
            console.log(`👤 Found contact name from selector: ${contact.name}`);
          }
        }
      }
    } catch (e) {
      // Continue
    }
  }

  // Method 2: FINN-specific li>span structure
  try {
    const kontaktLi = $('li').filter((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim().toLowerCase();
      return text.includes('kontakt') || text.includes('spørsmål');
    }).first();

    if (kontaktLi.length > 0) {
      const spans = kontaktLi.find('span');
      spans.each((_, span) => {
        const text = $(span).text().trim();
        // Check for phone
        if (/^\+?\d[\d\s]{7,}$/.test(text.replace(/\s/g, ''))) {
          contact.phone = text;
          console.log(`📞 Found phone from li>span: ${contact.phone}`);
        }
        // Check for email
        else if (text.includes('@')) {
          contact.email = text;
          console.log(`📧 Found email from li>span: ${contact.email}`);
        }
        // Check for name (if not phone/email and looks like a name)
        else if (text.length > 2 && text.length < 50 && !contact.name && /^[A-ZÆØÅ]/.test(text)) {
          contact.name = text;
          console.log(`👤 Found contact name from li>span: ${contact.name}`);
        }
      });
    }
  } catch (e) {
    console.log(`⚠️ Error in contact li>span selector: ${e}`);
  }

  // Method 3: Extract phone numbers from HTML
  if (!contact.phone) {
    // Norwegian phone patterns: +47 XXX XX XXX, 4X XX XX XX, 9X XX XX XX
    const phonePatterns = [
      /(?:\+47|0047)?\s*[49]\d[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2,3}/g,
      /tlf\.?:?\s*(\+?\d[\d\s\-]{7,})/gi,
      /telefon:?\s*(\+?\d[\d\s\-]{7,})/gi,
      /mobil:?\s*(\+?\d[\d\s\-]{7,})/gi,
    ];

    for (const pattern of phonePatterns) {
      const matches = html.match(pattern);
      if (matches && matches.length > 0) {
        // Take first match that looks valid
        for (const match of matches) {
          const cleaned = match.replace(/[^\d+]/g, '');
          if (cleaned.length >= 8 && cleaned.length <= 14) {
            contact.phone = match.trim();
            console.log(`📞 Found phone from regex: ${contact.phone}`);
            break;
          }
        }
        if (contact.phone) break;
      }
    }
  }

  // Method 4: Extract email addresses from HTML
  if (!contact.email) {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = html.match(emailPattern);
    if (matches && matches.length > 0) {
      // Filter out common non-contact emails
      const ignorePatterns = ['@finn.no', '@nav.no', '@example', 'noreply', 'no-reply', 'info@', 'post@', 'firmapost@'];
      for (const email of matches) {
        const lower = email.toLowerCase();
        if (!ignorePatterns.some(p => lower.includes(p))) {
          contact.email = email;
          console.log(`📧 Found email from regex: ${contact.email}`);
          break;
        }
      }
    }
  }

  // Method 5: Look for contact name patterns in text
  if (!contact.name) {
    // Pattern: "Kontakt: Name" or "Kontaktperson: Name"
    const namePatterns = [
      /kontaktperson:?\s*([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+){1,2})/i,
      /kontakt:?\s*([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+){1,2})/i,
      /spørsmål.*?:?\s*([A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+){1,2})/i,
    ];

    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name.length > 2 && name.length < 40) {
          contact.name = name;
          console.log(`👤 Found contact name from regex: ${contact.name}`);
          break;
        }
      }
    }
  }

  return contact;
}

// Helper: Extract company name from job page
function extractCompanyName($: cheerio.CheerioAPI, html: string, url: string): string | null {
  const isNav = url.includes('nav.no') || url.includes('arbeidsplassen');
  const isFinn = url.includes('finn.no');

  // Method 0: NAV-specific - try to get from JSON-LD or API data embedded in page
  if (isNav) {
    // NAV often embeds job data in script tags
    try {
      // Look for JSON-LD structured data
      const jsonLdScript = $('script[type="application/ld+json"]').html();
      if (jsonLdScript) {
        const jsonData = JSON.parse(jsonLdScript);
        if (jsonData.hiringOrganization?.name) {
          console.log(`🏢 Found company from NAV JSON-LD: ${jsonData.hiringOrganization.name}`);
          return jsonData.hiringOrganization.name;
        }
      }
    } catch (e) {
      // Continue
    }

    // NAV page structure - company appears near the title with building icon
    const navCompanySelectors = [
      // Common NAV selectors for employer
      '[class*="employer"]',
      '[class*="Employer"]',
      '[class*="company"]',
      '[class*="Company"]',
      '[class*="arbeidsgiver"]',
      '[data-testid*="employer"]',
      // Look for paragraph/span near title that contains company
      'header p',
      'header span',
      '.job-header p',
      // Generic patterns
      'p:has(svg)', // NAV often shows company with an icon
    ];

    for (const selector of navCompanySelectors) {
      try {
        const el = $(selector).first();
        if (el.length > 0) {
          const text = el.text().trim();
          // Filter out addresses and other non-company text
          if (text && text.length > 2 && text.length < 100 &&
              !text.match(/^\d/) && // Doesn't start with number (address)
              !text.includes('Søk senest') && // Not deadline text
              !text.includes('Hjemmekontor')) { // Not work location
            console.log(`🏢 Found company from NAV selector "${selector}": ${text}`);
            return text;
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // NAV: Look for text pattern "employer" in any element following the title
    const h1 = $('h1').first();
    if (h1.length > 0) {
      const nextElements = h1.nextAll().slice(0, 5);
      nextElements.each((_, el) => {
        const text = $(el).text().trim();
        // Company names often contain AS, kommune, or are capitalized
        if (text && text.length > 2 && text.length < 100 &&
            !text.match(/^\d/) && !text.includes('Søk') &&
            (text.includes(' AS') || text.includes(' as') ||
             text.includes('kommune') || text.includes('Kommune') ||
             text.match(/^[A-ZÆØÅ]/))) {
          console.log(`🏢 Found company from NAV h1 sibling: ${text}`);
          return text;
        }
      });
    }
  }

  // Method 1: FINN-specific - look for company in JSON config data
  // Pattern: "company_name","value":["Company Name"]
  if (isFinn) {
    const configMatch = html.match(/"company_name"\s*,\s*"value"\s*:\s*\[\s*"([^"]+)"\s*\]/);
    if (configMatch && configMatch[1]) {
      console.log(`🏢 Found company from FINN config data: ${configMatch[1]}`);
      return configMatch[1];
    }
  }

  // Method 2: Look for employer/arbeidsgiver section (works for both FINN and NAV)
  const employerSelectors = [
    'dt:contains("Arbeidsgiver") + dd',
    'dt:contains("Bedrift") + dd',
    'th:contains("Arbeidsgiver") + td',
    '[data-testid*="employer"]',
    '[data-testid*="company"]',
    '.employer-name',
    '.company-name',
  ];

  for (const selector of employerSelectors) {
    try {
      const el = $(selector).first();
      if (el.length > 0) {
        const text = el.text().trim();
        if (text && text.length > 1 && text.length < 100) {
          console.log(`🏢 Found company from selector "${selector}": ${text}`);
          return text;
        }
      }
    } catch (e) {
      // Continue
    }
  }

  // Method 3: FINN-specific li>span structure - <li>Arbeidsgiver<span>Company</span></li>
  if (isFinn) {
    try {
      const arbeidsgiverLi = $('li').filter((_, el) => {
        const text = $(el).clone().children().remove().end().text().trim().toLowerCase();
        return text.includes('arbeidsgiver') || text.includes('bedrift');
      }).first();

      if (arbeidsgiverLi.length > 0) {
        const companySpan = arbeidsgiverLi.find('span').first();
        if (companySpan.length > 0) {
          const company = companySpan.text().trim();
          if (company && company.length > 1) {
            console.log(`🏢 Found company from FINN li>span: ${company}`);
            return company;
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ Error in company li>span selector: ${e}`);
    }
  }

  // Method 4: Look for og:site_name or similar meta tags
  const metaCompany = $('meta[property="og:site_name"]').attr('content') ||
                      $('meta[name="author"]').attr('content');
  if (metaCompany && !metaCompany.toLowerCase().includes('finn') &&
      !metaCompany.toLowerCase().includes('nav') &&
      !metaCompany.toLowerCase().includes('arbeidsplassen') &&
      metaCompany.length < 100) {
    console.log(`🏢 Found company from meta tag: ${metaCompany}`);
    return metaCompany;
  }

  // Method 5: Generic - look for text with "AS" suffix (Norwegian company indicator)
  try {
    const allText = $('body').text();
    const asMatch = allText.match(/([A-ZÆØÅ][A-Za-zæøåÆØÅ\s&]+(?:\s+AS|\s+ASA))/);
    if (asMatch && asMatch[1] && asMatch[1].length > 3 && asMatch[1].length < 80) {
      console.log(`🏢 Found company from AS pattern: ${asMatch[1].trim()}`);
      return asMatch[1].trim();
    }
  } catch (e) {
    // Continue
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

    // Validate URL - reject search/filter pages
    const invalidPatterns = [
      'finn.no/job/search',
      'finn.no/job/fulltime?',  // search with filters
      'finn.no/job/parttime?',
      '/search?',
      '/filter?'
    ];

    const urlLower = url.toLowerCase();
    for (const pattern of invalidPatterns) {
      if (urlLower.includes(pattern)) {
        console.log(`❌ Rejected search URL: ${url}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: 'This is a search/filter page URL, not a specific job listing. Please provide a direct job URL.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
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

    // NEW: For NAV pages, check for embedded FINN apply URLs first
    // NAV often embeds applicationUrl in JSON or uses FINN for applications
    if (url.includes('nav.no') || url.includes('arbeidsplassen')) {
      // Method 1: Look for applicationUrl in embedded JSON
      const applicationUrlMatch = html.match(/"applicationUrl"\s*:\s*"([^"]+)"/);
      if (applicationUrlMatch && applicationUrlMatch[1]) {
        const appUrl = applicationUrlMatch[1].replace(/\\/g, '');
        console.log(`🔍 NAV: Found applicationUrl in JSON: ${appUrl}`);
        if (appUrl.includes('finn.no/job/apply')) {
          externalApplyUrl = appUrl;
          hasEnkelSoknad = true;
          applicationFormType = 'finn_easy';
          console.log(`✅ NAV job uses FINN Enkel Søknad: ${externalApplyUrl}`);
        } else if (appUrl.startsWith('http')) {
          externalApplyUrl = appUrl;
          applicationFormType = 'external_form';
          console.log(`🔗 NAV job uses external form: ${externalApplyUrl}`);
        }
      }

      // Method 2: Look for FINN apply URL in href attributes
      if (!externalApplyUrl) {
        const finnApplyMatch = html.match(/href="(https?:\/\/[^"]*finn\.no\/job\/apply[^"]*)"/);
        if (finnApplyMatch && finnApplyMatch[1]) {
          externalApplyUrl = finnApplyMatch[1];
          hasEnkelSoknad = true;
          applicationFormType = 'finn_easy';
          console.log(`✅ NAV: Found FINN apply URL in href: ${externalApplyUrl}`);
        }
      }
    }

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

          // FIXED: Also capture FINN apply URLs (for cross-platform cases like NAV->FINN)
          if (href && href.startsWith('http')) {
            if (href.includes('finn.no/job/apply')) {
              // This is a FINN Easy Apply through another platform
              externalApplyUrl = href;
              hasEnkelSoknad = true;
              applicationFormType = 'finn_easy';
              console.log(`✅ Cross-platform FINN Enkel Søknad: ${externalApplyUrl}`);
            } else if (!href.includes('finn.no')) {
              externalApplyUrl = href;
              console.log(`🔗 External apply URL: ${externalApplyUrl}`);
            }
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
        'button:contains("Enkel Søknad")',
        'a:contains("Enkel Søknad")',
        '[data-testid*="easy-apply"]',
        '[data-testid*="enkel"]',
        '[class*="easy-apply"]',
        '[class*="enkel"]',
        '[class*="Enkel"]',
        'button:contains("Easy apply")',
        '.apply-button:contains("Enkel")',
        '[aria-label*="Enkel søknad"]',
        '[aria-label*="enkel søknad"]',
        'button[type="button"]:contains("Enkel")',
        'a[role="button"]:contains("Enkel")'
      ];

      for (const selector of enkelSoknadSelectors) {
        try {
          const el = $(selector).first();
          if (el.length > 0) {
            const text = el.text().trim();
            console.log(`✅ Found "Enkel søknad" button: "${text}" with selector: ${selector}`);
            hasEnkelSoknad = true;
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      // Check raw HTML with multiple patterns if no button found
      if (!hasEnkelSoknad) {
        const htmlLower = html.toLowerCase();
        // Multiple patterns to catch different HTML structures
        const patterns = [
          />enkel\s*søknad</i,
          /"enkel\s*søknad"/i,
          /'enkel\s*søknad'/i,
          /enkel\s*søknad/i,
          /button[^>]*>.*enkel\s*søknad/i,
          /<a[^>]*>.*enkel\s*søknad/i
        ];
        
        for (const pattern of patterns) {
          if (pattern.test(html)) {
            hasEnkelSoknad = true;
            console.log(`✅ Found "Enkel søknad" in HTML with pattern: ${pattern}`);
            break;
          }
        }
      }

      // FINN-specific fallback: If no external button found and this is a FINN job,
      // check if there's an apply section without external links - likely Enkel søknad
      if (!hasEnkelSoknad && url.includes('finn.no') && !hasSokHerButton) {
        // Look for apply-related sections that don't have external links
        const applySections = $('[class*="apply"], [class*="søknad"], [id*="apply"]');
        let hasExternalLink = false;
        
        applySections.each((_, section) => {
          const links = $(section).find('a[href^="http"]');
          links.each((_, link) => {
            const href = $(link).attr('href') || '';
            if (href && !href.includes('finn.no')) {
              hasExternalLink = true;
              return false; // break
            }
          });
          if (hasExternalLink) return false; // break
        });

        // If we found apply sections but no external links, likely Enkel søknad
        if (applySections.length > 0 && !hasExternalLink) {
          hasEnkelSoknad = true;
          console.log('✅ FINN fallback: Found apply section without external links - likely Enkel søknad');
        }
      }
    }

    console.log(`📋 Søk her button: ${hasSokHerButton}, Enkel søknad: ${hasEnkelSoknad}`);

    // 2.5. Extract deadline (søknadsfrist)
    const deadline = extractDeadline($, html);
    console.log(`📅 Deadline: ${deadline || 'not found'}`);

    // 2.6. Extract company name (will be used if current company is "Unknown Company")
    const extractedCompany = extractCompanyName($, html, url);
    console.log(`🏢 Extracted company: ${extractedCompany || 'not found'}`);

    // 2.7. Extract contact information
    const contactInfo = extractContactInfo($, html);
    console.log(`👤 Contact: name=${contactInfo.name || 'none'}, phone=${contactInfo.phone || 'none'}, email=${contactInfo.email || 'none'}`);

    // 3. Determine application form type
    if (hasEnkelSoknad) {
      applicationFormType = 'finn_easy';
      console.log('📝 Application type: FINN Easy Apply');
      
      // For FINN Easy Apply, construct and set the apply URL
      if (url.includes('finn.no')) {
        const finnkode = extractFinnkode(url);
        if (finnkode) {
          externalApplyUrl = `https://www.finn.no/job/apply/${finnkode}`;
          console.log(`🔗 Constructed FINN apply URL: ${externalApplyUrl}`);
        } else {
          console.log(`⚠️ Could not extract finnkode from URL: ${url}`);
        }
      }
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
      // First, check if the current company needs updating
      let shouldUpdateCompany = false;
      if (extractedCompany) {
        const { data: currentJob } = await supabase
          .from('jobs')
          .select('company')
          .eq('id', job_id)
          .single();

        // Update company if it's "Unknown Company", empty, or null
        if (currentJob && (!currentJob.company || currentJob.company === 'Unknown Company' || currentJob.company === 'Unknown')) {
          shouldUpdateCompany = true;
          console.log(`🏢 Will update company from "${currentJob.company || 'null'}" to "${extractedCompany}"`);
        }
      }

      const updateData: any = {
        has_enkel_soknad: hasEnkelSoknad,
        application_form_type: applicationFormType
      };

      if (text.length > 50) {
        updateData.description = text;
      }

      // Update company if needed
      if (shouldUpdateCompany && extractedCompany) {
        updateData.company = extractedCompany;
      }

      // Always set external_apply_url if we have one (especially for FINN Easy Apply)
      // This ensures the URL is saved even if it was constructed from finnkode
      if (externalApplyUrl) {
        updateData.external_apply_url = externalApplyUrl;
        console.log(`💾 Saving external_apply_url: ${externalApplyUrl}`);
      } else if (hasEnkelSoknad && applicationFormType === 'finn_easy') {
        // For FINN Easy Apply, if we couldn't extract finnkode here,
        // it will be constructed later by finn-apply or auto_apply.py
        // But we should still mark it as finn_easy
        console.log(`⚠️ FINN Easy Apply detected but no URL constructed (will be built from job_url later)`);
      }

      if (deadline) {
        updateData.deadline = deadline;
      }

      await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', job_id);

      console.log(`✅ Updated job ${job_id}: type=${applicationFormType}, enkel=${hasEnkelSoknad}, url=${externalApplyUrl ? 'set' : 'none'}, company=${shouldUpdateCompany ? extractedCompany : 'unchanged'}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        text,
        has_enkel_soknad: hasEnkelSoknad,
        application_form_type: applicationFormType,
        external_apply_url: externalApplyUrl,
        deadline: deadline,
        company: extractedCompany,
        contact: contactInfo
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
