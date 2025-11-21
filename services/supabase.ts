import { createClient } from '@supabase/supabase-js';

// Configuration provided by user
const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
// USING SERVICE ROLE KEY - For Admin Dashboard Access Only
// ⚠️ WARNING: This key allows full admin access. Do not expose this app publicly without authentication.
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQzNDc0OSwiZXhwIjoyMDc4MDEwNzQ5fQ.46uj0VMvxoWvApNTDdifgpfkbDv5fBhU3GfUjIGIwtU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);