
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to capitalize location names (OSLO -> Oslo)
function formatLocation(loc: string): string {
    if (!loc) return '';
    return loc.charAt(0).toUpperCase() + loc.slice(1).toLowerCase();
}

// Helper: Parse deadline date from various formats
function parseDeadlineDate(dateStr: string): string | null {
    if (!dateStr) return null;

    const cleaned = dateStr.trim();

    // Check for ASAP/Snarest indicators
    const asapTerms = ['snarest', 'asap', 'fortløpende', 'løpende', 'straks', 'umiddelbart'];
    if (asapTerms.some(term => cleaned.toLowerCase().includes(term))) {
        // Return estimated date (~2 weeks from now)
        const estimated = new Date();
        estimated.setDate(estimated.getDate() + 14);
        return '~' + estimated.toISOString().split('T')[0];
    }

    // ISO format: "2026-02-11" or "2026-02-11T00:00:00"
    const isoMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    // Norwegian numeric format: "11.02.2026" or "11/02/2026"
    const numMatch = cleaned.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
    if (numMatch) {
        const day = numMatch[1].padStart(2, '0');
        const month = numMatch[2].padStart(2, '0');
        return `${numMatch[3]}-${month}-${day}`;
    }

    // Norwegian text format: "11. februar 2026"
    const norwegianMonths: Record<string, string> = {
        'januar': '01', 'februar': '02', 'mars': '03', 'april': '04',
        'mai': '05', 'juni': '06', 'juli': '07', 'august': '08',
        'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
    };
    const textMatch = cleaned.toLowerCase().match(/(\d{1,2})\.?\s*([a-zæøå]+)\s*(\d{4})/);
    if (textMatch && norwegianMonths[textMatch[2]]) {
        const day = textMatch[1].padStart(2, '0');
        const month = norwegianMonths[textMatch[2]];
        return `${textMatch[3]}-${month}-${day}`;
    }

    return null;
}

// Helper: Extract finnkode from FINN URL (multiple patterns)
function extractFinnkode(url: string): string | null {
    if (!url || !url.includes('finn.no')) return null;

    // Pattern 1: ?finnkode=123456789
    const queryMatch = url.match(/[?&]finnkode=(\d+)/);
    if (queryMatch) return queryMatch[1];

    // Pattern 2: /job/123456789 or /job/123456789.html
    const jobPathMatch = url.match(/\/job\/(\d{8,})(?:\.html|\?|$)/);
    if (jobPathMatch) return jobPathMatch[1];

    // Pattern 3: /ad/123456789 or /ad.123456789
    const adPathMatch = url.match(/\/ad[\/.](\d{8,})(?:\?|$)/);
    if (adPathMatch) return adPathMatch[1];

    // Pattern 4: 8+ digits at URL end
    const endMatch = url.match(/\/(\d{8,})(?:\?|$)/);
    if (endMatch) return endMatch[1];

    // Pattern 5: /job/fulltime/123456789
    const fulltimeMatch = url.match(/\/job\/[^\/]+\/(\d{8,})(?:\?|$)/);
    if (fulltimeMatch) return fulltimeMatch[1];

    return null;
}

// Helper: Validate FINN job URL (reject search pages, map, assistant, etc.)
function isValidFinnJobUrl(url: string): boolean {
    if (!url) return false;
    const urlLower = url.toLowerCase();

    // Reject known garbage patterns
    const invalidPatterns = [
        'finn.no/job/search',
        'finn.no/job/fulltime?',  // search with filters (no finnkode)
        'finn.no/job/parttime?',  // search with filters
        '/search?',
        '/filter?',
        '/browse',
        '/map/job',
        '/assistant',
        '/job?page='
    ];

    for (const pattern of invalidPatterns) {
        if (urlLower.includes(pattern)) {
            // Exception: if URL has finnkode param, it's valid
            if (urlLower.includes('finnkode=')) return true;
            return false;
        }
    }

    // Verify finnkode is extractable
    return extractFinnkode(url) !== null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { searchUrl, userId } = await req.json();

    if (!searchUrl) throw new Error('Search URL is required');
    console.log(`🕵️ [Scraper] Visiting: ${searchUrl}`);

    let jobs: any[] = [];

    // --- STRATEGY 0: Specific NAV Job URL (Direct API) ---
    // Matches: https://arbeidsplassen.nav.no/stillinger/stilling/[UUID]
    const navStillingMatch = searchUrl.match(/\/stillinger\/stilling\/([a-f0-9\-]+)/);

    if (navStillingMatch) {
        console.log("🔵 Detected Single NAV Job URL. Using Direct API.");
        const uuid = navStillingMatch[1];
        const apiUrl = `https://arbeidsplassen.nav.no/stillinger/api/stilling/${uuid}`;
        
        console.log(`📡 Calling NAV Single API: ${apiUrl}`);
        const apiRes = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json'
            }
        });

        if (!apiRes.ok) {
            throw new Error(`NAV API Error: ${apiRes.status} ${apiRes.statusText}`);
        }

        const json = await apiRes.json();
        // NAV API for single job usually returns the ES document source directly or inside _source
        const source = json._source || json; 

        if (source) {
            let location = 'Norway';
            let company = source.employer ? source.employer.name : (source.businessName || 'Unknown');

            // Extract Precise Location
            if (source.locations && source.locations.length > 0) {
                const loc = source.locations[0];
                const parts = [];
                if (loc.address) parts.push(loc.address);
                if (loc.postalCode) parts.push(loc.postalCode);
                if (loc.city) parts.push(formatLocation(loc.city));

                if (parts.length > 0) {
                    location = parts.join(', ');
                } else if (loc.municipal) {
                    location = formatLocation(loc.municipal);
                } else if (loc.county) {
                    location = formatLocation(loc.county);
                }
            }

            // Extract deadline from NAV API
            let deadline: string | null = null;
            if (source.properties?.applicationdue) {
                deadline = parseDeadlineDate(source.properties.applicationdue);
                if (deadline) {
                    console.log(`📅 NAV Strategy 0: Found deadline from properties.applicationdue: ${deadline}`);
                }
            }
            // Fallback to expires field
            if (!deadline && source.expires) {
                deadline = source.expires.split('T')[0]; // "2026-02-11T00:00:00" -> "2026-02-11"
                console.log(`📅 NAV Strategy 0: Found deadline from expires: ${deadline}`);
            }

            jobs.push({
                job_url: searchUrl,
                title: source.title || 'Untitled Job',
                company: company,
                location: location,
                description: source.description || '',
                deadline: deadline,
                source: 'NAV',
                user_id: userId,
                status: 'NEW'
            });
        }

    // --- STRATEGY 1: NAV Search Results (API) ---
    } else if (searchUrl.includes('arbeidsplassen.nav.no') || searchUrl.includes('nav.no/stillinger')) {
        console.log("🔵 Detected NAV Search URL. Switching to API strategy.");

        const urlObj = new URL(searchUrl);
        const params = urlObj.searchParams;
        const apiUrl = new URL("https://arbeidsplassen.nav.no/stillinger/api/search");
        
        params.forEach((value, key) => {
            apiUrl.searchParams.append(key, value);
        });

        if (!apiUrl.searchParams.has('size')) apiUrl.searchParams.set('size', '50');
        if (!apiUrl.searchParams.has('sort')) apiUrl.searchParams.set('sort', 'published');

        console.log(`📡 Calling NAV Search API: ${apiUrl.toString()}`);

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

            // Extract full address (address, postalCode, city)
            let location = 'Norway';
            if (source.locations && source.locations.length > 0) {
                const loc = source.locations[0];
                const parts = [];
                if (loc.address) parts.push(loc.address);
                if (loc.postalCode) parts.push(loc.postalCode);
                if (loc.city) parts.push(formatLocation(loc.city));

                if (parts.length > 0) {
                    location = parts.join(', ');
                } else if (loc.municipal) {
                    location = formatLocation(loc.municipal);
                } else if (loc.county) {
                    location = formatLocation(loc.county);
                }
            }

            // Extract deadline from NAV API
            let deadline: string | null = null;
            if (source.properties?.applicationdue) {
                deadline = parseDeadlineDate(source.properties.applicationdue);
            }
            // Fallback to expires field
            if (!deadline && source.expires) {
                deadline = source.expires.split('T')[0]; // "2026-02-11T00:00:00" -> "2026-02-11"
            }

            const company = source.employer ? source.employer.name : (source.businessName || 'NAV Employer');

            return {
                job_url: `https://arbeidsplassen.nav.no/stillinger/stilling/${uuid}`,
                title: source.title || 'Untitled Job',
                company: company,
                location: location,
                description: source.description || '',
                deadline: deadline,
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
            jobCards = $('article');
            if (jobCards.length === 0) {
                jobCards = $('a[href*="/job/"], a[href*="/stilling/"]').closest('div, li');
            }
        } else {
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

                title = anchor.text().trim();
                if (!title) title = $(el).find('h2').text().trim();

                // 2025 FINN Structure Parsing
                const keysDiv = $(el).find('div[class*="content__keys"]');
                if (keysDiv.length > 0) {
                    const spans = keysDiv.find('span');
                    if (spans.length >= 2) {
                        company = $(spans[0]).text().trim();
                        location = $(spans[1]).text().trim();
                    } else if (spans.length === 1) {
                         const text = $(spans[0]).text().trim();
                         if (text.match(/\d{4}/) || text.includes('Oslo') || text.includes('Viken') || text.includes('Innlandet')) {
                             location = text;
                         } else {
                             company = text;
                         }
                    }
                }

                // Fallback selectors
                if (!company) {
                    company = $(el).find('.sf-search-ad-content__company').text().trim() || 
                              $(el).find('[data-testid="company-name"]').text().trim() ||
                              $(el).find('.company-name').text().trim();
                }

                if (!location) {
                     location = $(el).find('.sf-search-ad-content__location').text().trim() || 
                                $(el).find('[data-testid="location"]').text().trim() ||
                                $(el).find('.location').text().trim();
                }

                // Generic fallback
                if (!location || location.toLowerCase() === 'norge' || location === '') {
                     const textBlock = $(el).text();
                     const commonCities = ["Oslo", "Bergen", "Trondheim", "Stavanger", "Drammen", "Fredrikstad", "Kristiansand", "Sandnes", "Tromsø", "Sarpsborg", "Gjøvik", "Hamar", "Lillehammer"];
                     
                     for (const city of commonCities) {
                         if (textBlock.includes(city)) {
                             location = city;
                             break;
                         }
                     }
                     if (!location) location = 'Norway';
                }
            }

            // Validate URL before adding
            if (link && !seenUrls.has(link) && title) {
                // Skip invalid FINN URLs (search pages, map, assistant, etc.)
                if (searchUrl.includes('finn.no') && !isValidFinnJobUrl(link)) {
                    console.log(`⏭️ Skipping invalid FINN URL: ${link.substring(0, 80)}...`);
                    return; // continue in .each() context
                }

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
