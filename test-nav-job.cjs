const { createClient } = require('@supabase/supabase-js');

// Configuration from services/supabase.ts
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Copy the updated parseJobDetails function
const parseJobDetails = (title, company, location) => {
  console.log("=== PARSING JOB DETAILS ===");
  console.log("Original title:", JSON.stringify(title));
  console.log("Original company:", JSON.stringify(company));
  console.log("Original location:", JSON.stringify(location));
  
  // Use the actual company and location from the database if they exist and are specific
  let extractedCompany = company;
  let extractedLocation = location;
  
  // Check if we already have good data from database
  const hasSpecificLocation = location && location !== 'Norway' && location !== 'Unknown' && location !== '';
  const hasSpecificCompany = company && company !== 'Unknown Company' && company !== 'Unknown' && company !== '';
  
  console.log("Has specific location from DB:", hasSpecificLocation);
  console.log("Has specific company from DB:", hasSpecificCompany);
  
  // Only try to parse from title if company/location are missing or generic
  if (!hasSpecificCompany) {
    // Try to extract from title
    const lines = title.split('\n').map(line => line.trim()).filter(line => line);
    
    for (let i = 1; i < lines.length; i++) { // Skip first line (usually title)
      const line = lines[i];
      
      // Check for company patterns
      if (line.includes('NAV') || line.includes('AS') || line.includes('HF') ||
          line.includes('kommune') || line.includes('Kommune') || line.includes('INNLANDET')) {
        extractedCompany = line;
        break;
      }
    }
    
    // Fallback to "NAV" if no company found but NAV is mentioned
    if (!extractedCompany && lines.some(line => line.includes('NAV'))) {
      extractedCompany = 'NAV';
    }
  }
  
  if (!hasSpecificLocation) {
    // Try to extract from title with improved patterns
    const lines = title.split('\n').map(line => line.trim()).filter(line => line);
    
    for (let i = 1; i < lines.length; i++) { // Skip first line (usually title)
      const line = lines[i];
      
      // Check for location patterns - prioritize specific locations over generic "Norway"
      if (/\d{4}/.test(line)) { // Postal code - very specific
        extractedLocation = line;
        break;
      }
      
      // Enhanced city pattern with more Norwegian cities
      const cityPattern = /Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Løten|Stange|Øyer|Vestre Toten|Østre Toten|Skjåk/i;
      if (cityPattern.test(line)) {
        extractedLocation = line;
        break;
      }
      
      // Check for street patterns - improved regex
      if (/^\d{1,3}\s+[A-ZæøåÆØÅ]/i.test(line) || /^[A-ZæøåÆØÅ][a-zæøå]+\s+\d{1,3}/i.test(line)) {
        extractedLocation = line;
        break;
      }
      
      // Check for "i [city]" pattern (common in Norwegian job titles)
      if (/i\s+(Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Løten|Stange|Øyer|Skjåk)/i.test(line)) {
        extractedLocation = line;
        break;
      }
    }
  }
  
  // If we still don't have a specific location, try to extract from the full title text
  if (!extractedLocation || extractedLocation === 'Norway' || extractedLocation === 'Unknown' || extractedLocation === '') {
    // Check if title contains location patterns
    if (/\d{4}/.test(title)) { // Postal code in title
      const postalMatch = title.match(/\d{4}\s*([^\n\r]+)/i);
      if (postalMatch) {
        extractedLocation = postalMatch[0].trim();
      }
    } else {
      // Check for city names in the full title
      const cityPattern = /(Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Løten|Stange|Øyer|Vestre Toten|Østre Toten|Skjåk)/i;
      const cityMatch = title.match(cityPattern);
      if (cityMatch) {
        extractedLocation = cityMatch[0];
      }
      
      // Enhanced: Check for NAV job patterns with location in title
      if (!extractedLocation || extractedLocation === 'Norway') {
        // Look for patterns like "ved [location]" in NAV jobs
        const navLocationPattern = /ved\s+(Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Løten|Stange|Øyer|Vestre Toten|Østre Toten|Skjåk)/i;
        const navLocationMatch = title.match(navLocationPattern);
        if (navLocationMatch) {
          extractedLocation = navLocationMatch[1];
        }
        
        // Look for address patterns (street + postal code + city)
        const addressPattern = /([A-ZæøåÆØÅ][a-zæøå\s]+\s+\d{1,3}[^,]*,\s*\d{4}\s+[A-ZæøåÆØÅ][a-zæøå\s]+)/i;
        const addressMatch = title.match(addressPattern);
        if (addressMatch) {
          extractedLocation = addressMatch[0];
        }
        
        // Look for "Parkgata" or similar street patterns
        if (title.includes('Parkgata') || title.includes('Gjøvik')) {
          // Extract the full address if it contains Gjøvik
          const gjovikPattern = /([^\n]*Gjøvik[^\n]*)/i;
          const gjovikMatch = title.match(gjovikPattern);
          if (gjøvikMatch) {
            extractedLocation = gjovikMatch[1].trim();
          }
        }
      }
    }
  }
  
  const result = {
    company: extractedCompany || 'Unknown',
    location: extractedLocation || 'Norway'
  };
  
  console.log("Parse result:", JSON.stringify(result));
  return result;
};

async function testNavJob() {
  try {
    console.log('🔍 Testing the specific NAV job mentioned in feedback...');
    
    // Search for the specific job: "Vil du utgjøre en forskjell i folks liv?"
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .ilike('title', '%Vil du utgjøre en forskjell i folks liv%')
      .limit(1);
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log(`\n📊 Found ${data.length} jobs matching the title:`);
    console.log('=====================================================');
    
    data.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`);
      console.log(`   Title: ${JSON.stringify(job.title.substring(0, 200) + '...')}`);
      console.log(`   Company: ${JSON.stringify(job.company)}`);
      console.log(`   Location: ${JSON.stringify(job.location)}`);
      console.log(`   Source: ${job.source}`);
      
      // Test our enhanced parsing logic on this specific job
      console.log('\n   --- Testing Enhanced parseJobDetails ---');
      const result = parseJobDetails(job.title, job.company, job.location);
      console.log(`   Parsed company: ${JSON.stringify(result.company)}`);
      console.log(`   Parsed location: ${JSON.stringify(result.location)}`);
      console.log('   ---------------------------------------------');
      
      if (result.location !== 'Norway' && result.location !== 'Unknown') {
        console.log('   ✅ SUCCESS: Found specific location!');
      } else {
        console.log('   ❌ STILL GENERIC: No improvement found');
      }
    });
    
  } catch (err) {
    console.error('❌ Critical error:', err);
  }
}

testNavJob();