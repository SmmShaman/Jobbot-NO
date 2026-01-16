
import { createClient } from '@supabase/supabase-js';

// Configuration - exported for direct API calls
export const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';

// ⚠️ UPDATE REQUIRED: Replace this with your 'anon' / 'public' key from Supabase Dashboard.
// Project Settings -> API -> Project API keys -> anon public
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

// Storage key for session (same as supabase-js uses internally)
export const STORAGE_KEY = `sb-ptrmidlhfdbybxmyovtm-auth-token`;

console.log('[Supabase] Initializing client...');
console.log('[Supabase] URL:', SUPABASE_URL);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sync session with Supabase client (required for RLS auth.uid() to work)
export const setSupabaseSession = async (accessToken: string, refreshToken: string): Promise<boolean> => {
  try {
    console.log('[Supabase] Setting session for RLS...');
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (error) {
      console.error('[Supabase] setSession error:', error.message);
      return false;
    }
    console.log('[Supabase] Session set successfully, auth.uid() will now work');
    return true;
  } catch (e: any) {
    console.error('[Supabase] setSession exception:', e.message);
    return false;
  }
};

// Test 1: Direct fetch to REST API
(async () => {
  console.log('[Supabase] Test 1: Direct fetch to REST API...');
  try {
    const start = Date.now();
    const response = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=count&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    console.log(`[Supabase] Test 1 Result: ${response.status} (${Date.now() - start}ms)`);
  } catch (e: any) {
    console.error('[Supabase] Test 1 Failed:', e.message);
  }
})();

// Test 2: Direct fetch to Auth API
(async () => {
  console.log('[Supabase] Test 2: Direct fetch to Auth API...');
  try {
    const start = Date.now();
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: 'test@test.com', password: 'test' })
    });
    console.log(`[Supabase] Test 2 Result: ${response.status} (${Date.now() - start}ms)`);
  } catch (e: any) {
    console.error('[Supabase] Test 2 Failed:', e.message);
  }
})();

// Test 3: Supabase client - simple query
(async () => {
  console.log('[Supabase] Test 3: Supabase client query...');
  try {
    const start = Date.now();
    const { data, error } = await supabase.from('jobs').select('id').limit(1);
    if (error) {
      console.error(`[Supabase] Test 3 Error: ${error.message} (${Date.now() - start}ms)`);
    } else {
      console.log(`[Supabase] Test 3 OK: ${data?.length} rows (${Date.now() - start}ms)`);
    }
  } catch (e: any) {
    console.error('[Supabase] Test 3 Exception:', e.message);
  }
})();

// Test 4: Supabase auth getSession
(async () => {
  console.log('[Supabase] Test 4: Supabase auth.getSession()...');
  try {
    const start = Date.now();
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error(`[Supabase] Test 4 Error: ${error.message} (${Date.now() - start}ms)`);
    } else {
      console.log(`[Supabase] Test 4 OK: session=${!!data.session} (${Date.now() - start}ms)`);
    }
  } catch (e: any) {
    console.error('[Supabase] Test 4 Exception:', e.message);
  }
})();
