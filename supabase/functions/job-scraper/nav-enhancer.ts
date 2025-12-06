// Enhanced NAV job extraction utilities
export function extractFullJobDetails(el: any, title: string) {
    let fullTitle = title;
    let company = '';
    let location = '';
    let description = '';
    
    // Extract all text content from the job element
    const jobContent = el.text();
    
    // Try to extract the full job title (sometimes it's truncated)
    const titleElement = el.find('h1, h2, h3').first();
    if (titleElement) {
        fullTitle = titleElement.text().trim();
    }
    
    // Extract company information
    company = el.find('.company-name, [data-testid="company-name"], .sf-search-ad-content__company').text().trim() || '';
    
    // Extract location information  
    location = el.find('.location, [data-testid="location"], .sf-search-ad-content__location').text().trim() || '';
    
    // Extract description
    description = el.find('.ad-content, .job-description').text().trim() || '';
    
    // Enhanced location extraction from full content
    if (!location || location === 'Norway') {
        // Look for address patterns in the full content
        const addressPatterns = [
            /([A-ZæøåÆØÅ][a-zæøå\s]+\s+\d{1,3}[^,]*,\s*\d{4}\s+[A-ZæøåÆØÅ][a-zæøå\s]+)/i, // Street + Postal + City
            /(Parkgata|Storgata|Kongens|Kongens?\s+\d{1,3}[^,]*,\s*\d{4}\s+[A-ZæøåÆØÅ][a-zæøå\s]+)/i, // Specific street patterns
            /(Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Løten|Stange|Øyer|Vestre Toten|Østre Toten|Skjåk)/i, // City names
        ];
        
        for (const pattern of addressPatterns) {
            const match = jobContent.match(pattern);
            if (match && match[0] && match[0].length > 5) {
                location = match[0].trim();
                break;
            }
        }
    }
    
    // Enhanced company extraction from content
    if (!company) {
        // Look for NAV or municipality patterns
        const companyPatterns = [
            /NAV\s+Gjøvik/i,
            /Gjøvik\s+kommune/i,
            /\w+kommune\s+Gjøvik/i,
            /NAV\s+[A-ZæøåÆØÅ][a-zæøå\s]+/i
        ];
        
        for (const pattern of companyPatterns) {
            const match = jobContent.match(pattern);
            if (match && match[0]) {
                company = match[0].trim();
                break;
            }
        }
    }
    
    return {
        title: fullTitle,
        company: company || 'NAV',
        location: location || 'Norway',
        description: description,
        fullContent: jobContent
    };
}