
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Added to fix "Property 'env' does not exist on type 'typeof Deno'"
declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  try {
    console.log('=== Admin Action Request Started ===');

    // 1. Check Environment Variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      console.error('❌ Missing environment variables!');
      throw new Error('Server configuration error: Missing required secrets (SUPABASE_SERVICE_ROLE_KEY)');
    }

    // 2. Verify Caller Authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('❌ No Authorization header');
      throw new Error('Missing Authorization header');
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('❌ Invalid user token:', userError);
      throw new Error('Invalid User Token');
    }
    console.log('✅ User authenticated:', user.email);

    // 3. Verify Admin Role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: settings, error: settingsError } = await supabaseAdmin.from('user_settings').select('role').eq('user_id', user.id).single();

    if (settingsError || !settings || settings.role !== 'admin') {
      console.warn(`⚠️ Unauthorized access attempt by ${user.email}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Unauthorized: Admin access required'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.log('✅ Admin verified');

    // 4. Parse Request
    const body = await req.json();
    const { action, email, password, role, userId } = body;
    console.log(`📋 Action requested: ${action}`);

    // 5. Handle Actions
    if (action === 'list_users') {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) throw error;

      const { data: allSettings } = await supabaseAdmin.from('user_settings').select('user_id, role');
      const roleMap = new Map(allSettings?.map((s) => [s.user_id, s.role]) || []);

      const enrichedUsers = users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        role: roleMap.get(u.id) || 'user'
      }));

      return new Response(JSON.stringify({ success: true, users: enrichedUsers }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'create_user') {
      if (!email || !password) throw new Error('Email and password required');
      console.log(`Creating user: ${email}`);

      // A. Create user in auth.users
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });

      if (createError) {
        console.error('❌ Error creating user:', createError);
        throw new Error(`Failed to create user: ${createError.message}`);
      }
      console.log('✅ User created in auth.users:', newUser.user.id);

      // B. MANUALLY Create Settings (Since we deleted the SQL trigger)
      const userRole = role || 'user';
      console.log(`Creating settings for user with role: ${userRole}`);

      const { error: settingsInsertError } = await supabaseAdmin
        .from('user_settings')
        .insert({
            user_id: newUser.user.id,
            role: userRole,
            ui_language: 'uk',
            is_auto_scan_enabled: false
        });

      if (settingsInsertError) {
          console.error('❌ Error creating settings:', settingsInsertError);
          // We return success for the user creation, but warn about settings
          // Ideally, we should rollback (delete user), but for now, let's just report.
          return new Response(JSON.stringify({
            success: true,
            user: newUser.user,
            warning: "User created, but settings creation failed. User may need to be deleted and recreated."
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
      }

      console.log('✅ Settings created successfully');

      return new Response(JSON.stringify({
        success: true,
        user: newUser.user
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'delete_user') {
      if (!userId) throw new Error('User ID required');
      console.log(`Deleting user: ${userId}`);
      
      // Also delete from user_settings explicitly (though CASCADE usually handles it)
      await supabaseAdmin.from('user_settings').delete().eq('user_id', userId);

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) {
        console.error('❌ Error deleting user:', deleteError);
        throw deleteError;
      }
      console.log('✅ User deleted successfully');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Invalid action: ${action}`);

  } catch (error: any) {
    console.error('❌ Function Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 400, // Use 200 if you want frontend to handle error messages via JSON body, but 400 is more semantically correct
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
