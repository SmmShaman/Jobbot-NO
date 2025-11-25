
import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';

// ⚠️ UPDATE REQUIRED: Replace this with your 'anon' / 'public' key from Supabase Dashboard.
// Project Settings -> API -> Project API keys -> anon public
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

console.log('[Supabase] Initializing client...');
console.log('[Supabase] URL:', SUPABASE_URL);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Direct fetch test (bypasses Supabase JS client)
(async () => {
  console.log('[Supabase] Testing direct fetch...');
  try {
    const start = Date.now();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=count&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const duration = Date.now() - start;
    console.log(`[Supabase] Direct fetch: ${response.status} ${response.statusText} (${duration}ms)`);
    if (!response.ok) {
      const text = await response.text();
      console.error('[Supabase] Response body:', text);
    }
  } catch (e: any) {
    console.error('[Supabase] Direct fetch failed:', e.message || e);
  }
})();

// Test Supabase client connection
(async () => {
  try {
    console.log('[Supabase] Testing client connection...');
    const start = Date.now();
    const { error } = await supabase.from('jobs').select('count', { count: 'exact', head: true });
    const duration = Date.now() - start;
    if (error) {
      console.error('[Supabase] Client test failed:', error.message);
    } else {
      console.log(`[Supabase] Client test OK (${duration}ms)`);
    }
  } catch (e: any) {
    console.error('[Supabase] Client test exception:', e.message || e);
  }
})();
