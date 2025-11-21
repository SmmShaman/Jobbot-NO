
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to capitalize location names (OSLO -> Oslo)
function formatLocation(loc: string): string {
    if (!loc) return 'Norway';
    return loc.charAt(0).toUpperCase() + loc.slice(1).toLowerCase();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { searchUrl, userId } = await req.json();

    if (!searchUrl) throw new Error('Search URL is required');
    console.log(`🕵️ [Scraper] Visiting: ${searchUrl}`);

    let jobs: any[] = [];

    // --- STRATEGY 1: NAV.no (Use Internal API) ---
    if (searchUrl.includes('arbeidsplassen.nav.no') || searchUrl.includes('nav.no/stillinger')) {
        console.log("🔵 Detected NAV URL. Switching to API strategy.");

        const urlObj = new URL(searchUrl);
        const params = urlObj.searchParams;
        const apiUrl = new URL("https://arbeidsplassen.nav.no/stillinger/api/search");
        
        params.forEach((value, key) => {
            apiUrl.searchParams.append(key, value);
        });

        if (!apiUrl.searchParams.has('size')) apiUrl.searchParams.set('size', '50');
        if (!apiUrl.searchParams.has('sort')) apiUrl.searchParams.set('sort', 'published');

        console.log(`📡 Calling NAV API: ${apiUrl.toString()}`);

        const apiRes = await fetch(apiUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json',
                'Referer': searchUrl
            }
        });

        if (!apiRes.ok) {
            throw new Error(`NAV API Error: ${apiRes.status} ${apiRes.statusText}`);
        }

        const json = await apiRes.json();
        
        let hits = [];
        if (Array.isArray(json.hits)) {
            hits = json.hits;
        } else if (json.hits && Array.isArray(json.hits.hits)) {
            hits = json.hits.hits;
        } else if (json.content && Array.isArray(json.content)) {
             hits = json.content;
        }

        console.log(`[Scraper] Raw hits found: ${hits.length}`);

        jobs = hits.map((hit: any) => {
            const source = hit._source || {};
            const uuid = hit._id || hit.uuid || source.uuid;
            
            // FIX: Better Location Logic
            let location = 'Norway';
            if (source.locations && source.locations.length > 0) {
                const loc = source.locations[0];
                if (loc.city) location = formatLocation(loc.city);
                else if (loc.municipal) location = formatLocation(loc.municipal);
                else if (loc.county) location = formatLocation(loc.county);
            }

            // FIX: Better Company Logic
            const company = source.employer ? source.employer.name : (source.businessName || 'NAV Employer');

            return {
                job_url: `https://arbeidsplassen.nav.no/stillinger/stilling/${uuid}`,
                title: source.title || 'Untitled Job',
                company: company,
                location: location,
                description: source.description || '', 
                source: 'NAV',
                user_id: userId,
                status: 'NEW'
            };
        });

    // --- STRATEGY 2: FINN.no (HTML Scraping) ---
    } else {
        console.log("🔵 Using HTML Scraping strategy (FINN).");
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        if (!response.ok) throw new Error(`Failed to fetch page: ${response.status}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const seenUrls = new Set();

        let jobCards: any = [];
        
        // Attempt to find job cards
        if (searchUrl.includes('finn.no')) {
            // Try specific FINN article tag
            jobCards = $('article');
            if (jobCards.length === 0) {
                // Fallback to links looking like jobs
                jobCards = $('a[href*="/job/"], a[href*="/stilling/"]').closest('div, li');
            }
        } else {
            // Generic
            jobCards = $('a[href]').filter((i, el) => {
                 const h = $(el).text().toLowerCase();
                 return h.includes('apply') || h.includes('søk');
            }).parent();
        }

        $(jobCards).each((i, el) => {
            let title = '';
            let company = '';
            let link = '';
            let location = '';
            let source = 'FINN';

            if (searchUrl.includes('finn.no')) {
                const anchor = $(el).find('a[href*="/job/"], a[href*="/stilling/"]').first();
                link = anchor.attr('href') || '';
                
                if (link && !link.startsWith('http')) {
                    link = `https://www.finn.no${link}`;
                }

                // Title Extraction
                title = anchor.text().trim();
                if (!title) title = $(el).find('h2').text().trim();

                // Company Extraction (Multiple Selectors for Robustness)
                company = $(el).find('.sf-search-ad-content__company').text().trim() || 
                          $(el).find('[data-testid="company-name"]').text().trim() ||
                          $(el).find('.company-name').text().trim();
                
                // Fallback Company: look for text in spans/divs that isn't title or location
                if (!company) {
                     // On some FINN versions, company is just a span next to location
                     company = $(el).find('span').filter((i, s) => $(s).text().length > 2 && !$(s).text().includes('Oslo') && !$(s).text().includes('Norge')).first().text().trim();
                }

                // Location Extraction
                location = $(el).find('.sf-search-ad-content__location').text().trim() || 
                           $(el).find('[data-testid="location"]').text().trim() ||
                           $(el).find('.location').text().trim();

                // Fallback Location
                if (!location) {
                    // Try finding common cities
                    const textBlock = $(el).text();
                    if (textBlock.includes('Oslo')) location = 'Oslo';
                    else if (textBlock.includes('Bergen')) location = 'Bergen';
                    else if (textBlock.includes('Trondheim')) location = 'Trondheim';
                    else if (textBlock.includes('Stavanger')) location = 'Stavanger';
                    else location = 'Norway';
                }
            }

            if (link && !seenUrls.has(link) && title && link) {
                seenUrls.add(link);
                jobs.push({
                    job_url: link,
                    title: title || 'Untitled Job',
                    company: company || 'Unknown Company',
                    location: location || 'Norway',
                    source: source,
                    user_id: userId,
                    status: 'NEW'
                });
            }
        });
    }

    console.log(`✅ [Scraper] Successfully extracted ${jobs.length} jobs.`);

    return new Response(
      JSON.stringify({ success: true, jobs }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`❌ [Scraper] Error: ${error.message}`);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
