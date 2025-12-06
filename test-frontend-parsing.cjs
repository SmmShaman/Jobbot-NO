const { createClient } = require('@supabase/supabase-js');

// Configuration from services/supabase.ts
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Simulate the full parsing process that happens in the frontend
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
      if (/i\s+(Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Elverum|Tynset|Alvdal|Skarnes|Lena|Stange|Øyer|Skjåk)/i.test(line)) {
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
    }
  }
  
  const result = {
    company: extractedCompany || 'Unknown',
    location: extractedLocation || 'Norway'
  };
  
  console.log("Parse result:", JSON.stringify(result));
  return result;
};

// Simulate the mapJob function from services/api.ts
const mapJob = (job) => {
  console.log("Mapping job from DB:", job);
  console.log("Raw title from DB:", JSON.stringify(job.title));
  console.log("Raw company from DB:", JSON.stringify(job.company));
  console.log("Raw location from DB:", JSON.stringify(job.location));
  
  const { company, location } = parseJobDetails(job.title, job.company, job.location);
  
  const mappedJob = {
    id: job.id,
    title: job.title.split('\n')[0] || job.title, // Use only first line as title
    company,
    location,
    url: job.job_url,
    source: job.source,
    postedDate: new Date(job.created_at).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' }),
    scannedAt: job.created_at,
    status: job.status,
    matchScore: job.relevance_score,
    description: job.description,
    ai_recommendation: job.ai_recommendation,
    tasks_summary: job.tasks_summary,
    application_id: job.application_id,
    cost_usd: job.cost_usd,
    aura: job.analysis_metadata?.aura,
    radarData: job.analysis_metadata?.radar ? [
        { subject: 'Tech Stack', A: job.analysis_metadata.radar.tech_stack || 0, fullMark: 100 },
        { subject: 'Soft Skills', A: job.analysis_metadata.radar.soft_skills || 0, fullMark: 100 },
        { subject: 'Culture', A: job.analysis_metadata.radar.culture || 0, fullMark: 100 },
        { subject: 'Salary', A: job.analysis_metadata.radar.salary_potential || 0, fullMark: 100 },
        { subject: 'Growth', A: job.analysis_metadata.radar.career_growth || 0, fullMark: 100 },
    ] : undefined
  };
  
  console.log("Mapped job:", mappedJob);
  return mappedJob;
};

async function testFrontendParsing() {
  try {
    console.log('🌐 Testing full frontend parsing process...');
    
    // Get a mix of jobs to test the full mapping process
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .limit(15);
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log(`\n📊 Testing ${data.length} jobs with full frontend mapping:`);
    console.log('=====================================================');
    
    let specificLocationCount = 0;
    let norwayLocationCount = 0;
    let improvedFromNorway = 0;
    
    const mappedJobs = data.map(job => {
      const originalLocation = job.location;
      const mappedJob = mapJob(job);
      const finalLocation = mappedJob.location;
      
      if (finalLocation !== 'Norway' && finalLocation !== 'Unknown') {
        specificLocationCount++;
        if (originalLocation === 'Norway') {
          improvedFromNorway++;
          console.log(`✅ IMPROVED: Job "${job.title.substring(0, 50)}..." from "${originalLocation}" to "${finalLocation}"`);
        }
      } else {
        norwayLocationCount++;
        console.log(`⚠️ Still generic: Job "${job.title.substring(0, 50)}..." shows "${finalLocation}"`);
      }
      
      return mappedJob;
    });
    
    console.log('\n=====================================================');
    console.log('📈 Frontend Mapping Summary:');
    console.log(`   Total jobs processed: ${data.length}`);
    console.log(`   Jobs with specific locations: ${specificLocationCount}`);
    console.log(`   Jobs still showing "Norway": ${norwayLocationCount}`);
    console.log(`   Jobs improved from "Norway": ${improvedFromNorway}`);
    console.log(`   Success rate: ${((specificLocationCount / data.length) * 100).toFixed(1)}%`);
    
    // Show sample of final results
    console.log('\n📋 Sample of final job data (what users see):');
    console.log('-----------------------------------------------------');
    mappedJobs.slice(0, 5).forEach((job, index) => {
      console.log(`${index + 1}. ${job.title}`);
      console.log(`   Company: ${job.company}`);
      console.log(`   Location: ${job.location}`);
      console.log(`   Source: ${job.source}`);
      console.log('');
    });
    
  } catch (err) {
    console.error('❌ Critical error:', err);
  }
}

testFrontendParsing();