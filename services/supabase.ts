
import { createClient } from '@supabase/supabase-js';

// Configuration
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';

// ⚠️ UPDATE REQUIRED: Replace this with your 'anon' / 'public' key from Supabase Dashboard.
// Project Settings -> API -> Project API keys -> anon public
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

console.log('[Supabase] Initializing client...');
console.log('[Supabase] URL:', SUPABASE_URL);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Test connection on load
(async () => {
  try {
    console.log('[Supabase] Testing connection...');
    const start = Date.now();
    const { error } = await supabase.from('jobs').select('count', { count: 'exact', head: true });
    const duration = Date.now() - start;
    if (error) {
      console.error('[Supabase] Connection test failed:', error.message);
    } else {
      console.log(`[Supabase] Connection OK (${duration}ms)`);
    }
  } catch (e) {
    console.error('[Supabase] Connection test exception:', e);
  }
})();
