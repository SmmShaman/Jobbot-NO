const { createClient } = require('@supabase/supabase-js');

// Configuration from services/supabase.ts
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkLocations() {
  try {
    console.log('🔍 Checking job locations data...');
    
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, company, location')
      .limit(20);
      
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    console.log(`\n📊 Found ${data.length} jobs:`);
    console.log('=====================================');
    
    data.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`);
      console.log(`   Title: ${JSON.stringify(job.title?.substring(0, 80) + (job.title?.length > 80 ? '...' : ''))}`);
      console.log(`   Company: ${JSON.stringify(job.company)}`);
      console.log(`   Location: ${JSON.stringify(job.location)}`);
      
      // Check if location contains city names
      if (job.location && job.location !== 'Norway' && job.location !== 'Unknown') {
        console.log(`   ✅ Has specific location: ${job.location}`);
      } else if (job.title) {
        // Check if title contains location info
        const hasPostalCode = /\d{4}/.test(job.title);
        const hasCityName = /Gjøvik|Hamar|Lillehammer|Ottestad|Brumunddal|Moelv|Raufoss|Toten|Lenang|Svingvoll|Tessanden|Elverum|Tynset|Alvdal|Østre Gausdal|Bismo|Skarnes|Lena|Kauffeldts|Hunndalen|Rudshøgda|Kauffeldts/i.test(job.title);
        
        if (hasPostalCode || hasCityName) {
          console.log(`   ⚠️ Title contains location info but not extracted`);
        }
      }
    });
    
    console.log('\n=====================================');
    console.log('📈 Summary:');
    const specificLocations = data.filter(job => 
      job.location && job.location !== 'Norway' && job.location !== 'Unknown'
    ).length;
    console.log(`   Jobs with specific locations: ${specificLocations}/${data.length}`);
    console.log(`   Jobs with generic "Norway": ${data.filter(job => job.location === 'Norway').length}`);
    console.log(`   Jobs with "Unknown": ${data.filter(job => job.location === 'Unknown').length}`);
    
  } catch (err) {
    console.error('❌ Critical error:', err);
  }
}

checkLocations();