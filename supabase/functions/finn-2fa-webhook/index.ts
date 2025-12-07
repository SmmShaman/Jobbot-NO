import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-skyvern-signature',
};

console.log("🔐 [FINN-2FA] v2.0 - Webhook with retry handling and better logging");

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');

// Send Telegram message
async function sendTelegram(chatId: string, text: string) {
  if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN missing");
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.error("❌ Telegram send error:", e);
  }
}

serve(async (req: Request) => {
  console.log(`📥 [FINN-2FA] ${req.method} request received at ${new Date().toISOString()}`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const taskId = body.task_id;
    let totpIdentifier = body.totp_identifier || body.identifier || body.email;

    console.log(`📦 [FINN-2FA] Received: task_id=${taskId}, totp_identifier=${totpIdentifier || 'undefined'}`);

    // STEP 1: Find totp_identifier if not provided
    if (!totpIdentifier) {
      console.log(`🔍 [FINN-2FA] No totp_identifier, searching for recent auth requests...`);

      // Look for ANY recent auth request (including completed - for retries)
      const { data: recentRequests } = await supabase
        .from('finn_auth_requests')
        .select('id, totp_identifier, status, verification_code, expires_at')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

      console.log(`📊 [FINN-2FA] Found ${recentRequests?.length || 0} recent requests:`);
      recentRequests?.forEach(r => {
        console.log(`   - ${r.id}: status=${r.status}, has_code=${!!r.verification_code}`);
      });

      // Priority: code_received > pending > code_requested > completed (with code)
      const priorityOrder = ['code_received', 'pending', 'code_requested', 'completed'];
      let bestRequest = null;

      for (const status of priorityOrder) {
        const found = recentRequests?.find(r => r.status === status);
        if (found) {
          // For completed, only use if it has a verification code (retry scenario)
          if (status === 'completed' && !found.verification_code) continue;
          bestRequest = found;
          break;
        }
      }

      if (bestRequest) {
        totpIdentifier = bestRequest.totp_identifier;
        console.log(`✅ [FINN-2FA] Selected request: ${bestRequest.id} (status=${bestRequest.status})`);

        // If it's a completed request with code - this is a RETRY from Skyvern
        if (bestRequest.status === 'completed' && bestRequest.verification_code) {
          console.log(`🔄 [FINN-2FA] RETRY DETECTED! Returning saved code: ${bestRequest.verification_code}`);
          return new Response(
            JSON.stringify({ totp: bestRequest.verification_code }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        console.error("❌ [FINN-2FA] No suitable auth requests found!");
        console.error("   Possible causes:");
        console.error("   1. Worker didn't create pending request");
        console.error("   2. All requests expired");
        console.error("   3. Request was already used and completed");

        return new Response(
          JSON.stringify({
            error: "No pending auth requests. Worker must pre-create request before Skyvern starts.",
            debug: { found_requests: recentRequests?.length || 0 }
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`🔍 [FINN-2FA] Processing for: ${totpIdentifier}`);

    // STEP 2: Check for code_received (user already entered code)
    const { data: withCode } = await supabase
      .from('finn_auth_requests')
      .select('*')
      .eq('totp_identifier', totpIdentifier)
      .eq('status', 'code_received')
      .gt('expires_at', new Date().toISOString())
      .order('code_received_at', { ascending: false })
      .limit(1)
      .single();

    if (withCode?.verification_code) {
      console.log(`✅ [FINN-2FA] Code already received: ${withCode.verification_code}`);

      await supabase
        .from('finn_auth_requests')
        .update({ status: 'completed', success: true })
        .eq('id', withCode.id);

      return new Response(
        JSON.stringify({ totp: withCode.verification_code }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 3: Check for completed with code (Skyvern retry)
    const { data: completedWithCode } = await supabase
      .from('finn_auth_requests')
      .select('*')
      .eq('totp_identifier', totpIdentifier)
      .eq('status', 'completed')
      .not('verification_code', 'is', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (completedWithCode?.verification_code) {
      console.log(`🔄 [FINN-2FA] RETRY: Returning code from completed request: ${completedWithCode.verification_code}`);
      return new Response(
        JSON.stringify({ totp: completedWithCode.verification_code }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 4: Find or create code_requested record
    const { data: pendingRequest } = await supabase
      .from('finn_auth_requests')
      .select('*')
      .eq('totp_identifier', totpIdentifier)
      .in('status', ['pending', 'code_requested'])
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let authRequest: any;
    let chatId: string | null = null;

    if (pendingRequest) {
      console.log(`✅ [FINN-2FA] Found request: ${pendingRequest.id} (status=${pendingRequest.status})`);
      chatId = pendingRequest.telegram_chat_id;

      if (pendingRequest.status === 'pending') {
        // Update to code_requested
        const { data: updated, error } = await supabase
          .from('finn_auth_requests')
          .update({
            status: 'code_requested',
            code_requested_at: new Date().toISOString()
          })
          .eq('id', pendingRequest.id)
          .select()
          .single();

        if (error) {
          console.error("❌ Update error:", error);
          throw error;
        }
        authRequest = updated;
        console.log(`📝 [FINN-2FA] Updated status to code_requested`);
      } else {
        authRequest = pendingRequest;
        console.log(`📝 [FINN-2FA] Using existing code_requested record`);
      }
    } else {
      // No pending request - try to find user from previous requests
      console.log(`⚠️ [FINN-2FA] No pending/code_requested found, looking for user info...`);

      const { data: anyRequest } = await supabase
        .from('finn_auth_requests')
        .select('telegram_chat_id, user_id')
        .eq('totp_identifier', totpIdentifier)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!anyRequest?.telegram_chat_id) {
        console.error(`❌ [FINN-2FA] Cannot find user for: ${totpIdentifier}`);
        console.error("   Worker MUST pre-create finn_auth_requests before starting Skyvern!");

        return new Response(
          JSON.stringify({
            error: "User not found. Ensure worker is running and creates auth request first.",
            totp_identifier: totpIdentifier
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      chatId = anyRequest.telegram_chat_id;

      // Create new request
      const { data: newRequest, error } = await supabase
        .from('finn_auth_requests')
        .insert({
          telegram_chat_id: chatId,
          user_id: anyRequest.user_id,
          totp_identifier: totpIdentifier,
          status: 'code_requested',
          code_requested_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("❌ Insert error:", error);
        throw error;
      }

      authRequest = newRequest;
      console.log(`📝 [FINN-2FA] Created new code_requested record: ${newRequest.id}`);
    }

    // STEP 5: Send Telegram notification
    const message = `🔐 <b>FINN потребує код верифікації!</b>\n\n` +
      `📧 Код надіслано на: <code>${totpIdentifier}</code>\n\n` +
      `Введіть код командою:\n<code>/code XXXXXX</code>\n\n` +
      `⏱ Маєте 3 хвилини!`;

    await sendTelegram(chatId!, message);
    console.log(`📤 [FINN-2FA] Telegram notification sent to ${chatId}`);

    // STEP 6: Poll for code (3 minutes max, check every 3 seconds)
    const maxWaitMs = 180 * 1000; // 3 minutes
    const pollInterval = 3000; // 3 seconds
    const startTime = Date.now();
    let lastLogTime = 0;

    console.log(`⏳ [FINN-2FA] Waiting for code (max 3 minutes)...`);

    while ((Date.now() - startTime) < maxWaitMs) {
      const { data: updated } = await supabase
        .from('finn_auth_requests')
        .select('verification_code, status')
        .eq('id', authRequest.id)
        .single();

      if (updated?.verification_code && updated?.status === 'code_received') {
        const waitedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`✅ [FINN-2FA] Code received after ${waitedSec}s: ${updated.verification_code}`);

        await supabase
          .from('finn_auth_requests')
          .update({ status: 'completed', success: true })
          .eq('id', authRequest.id);

        await sendTelegram(chatId!, "✅ Код прийнято! Skyvern продовжує заповнення форми...");

        return new Response(
          JSON.stringify({ totp: updated.verification_code }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Log progress every 30 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed - lastLogTime >= 30000) {
        console.log(`⏳ [FINN-2FA] Still waiting... ${Math.round(elapsed / 1000)}s elapsed`);
        lastLogTime = elapsed;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    console.log(`⏰ [FINN-2FA] Timeout after 3 minutes`);

    await supabase
      .from('finn_auth_requests')
      .update({ status: 'expired' })
      .eq('id', authRequest.id);

    await sendTelegram(chatId!,
      "⏰ <b>Час вичерпано!</b>\n\n" +
      "Не отримали код протягом 3 хвилин.\n" +
      "Спробуйте ще раз: натисніть 'FINN Søknad' в дашборді."
    );

    return new Response(
      JSON.stringify({ error: "Timeout waiting for verification code (3 minutes)" }),
      { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("❌ [FINN-2FA] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
