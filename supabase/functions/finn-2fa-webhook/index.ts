import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-skyvern-signature',
};

console.log("🔐 [FINN-2FA] v1.0 - Webhook for Skyvern 2FA codes");

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const SKYVERN_WEBHOOK_SECRET = Deno.env.get('SKYVERN_WEBHOOK_SECRET') || '';

// Send Telegram message
async function sendTelegram(chatId: string, text: string, replyMarkup?: any) {
  if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN missing");
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    })
  });
}

serve(async (req: Request) => {
  console.log(`📥 [FINN-2FA] ${req.method} request received`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    console.log(`📦 [FINN-2FA] Request body:`, JSON.stringify(body).substring(0, 200));

    // Skyvern sends: { totp_identifier: "email@example.com" }
    const totpIdentifier = body.totp_identifier || body.identifier || body.email;

    if (!totpIdentifier) {
      console.error("❌ Missing totp_identifier");
      return new Response(
        JSON.stringify({ error: "Missing totp_identifier" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 [FINN-2FA] Looking for code for: ${totpIdentifier}`);

    // PRIORITY 1: Look for pre-created auth request from worker (with code already received)
    const { data: pendingWithCode } = await supabase
      .from('finn_auth_requests')
      .select('*')
      .eq('totp_identifier', totpIdentifier)
      .eq('status', 'code_received')
      .gt('expires_at', new Date().toISOString())
      .order('code_received_at', { ascending: false })
      .limit(1)
      .single();

    if (pendingWithCode?.verification_code) {
      console.log(`✅ [FINN-2FA] Found existing code: ${pendingWithCode.verification_code}`);

      // Mark as completed
      await supabase
        .from('finn_auth_requests')
        .update({ status: 'completed', success: true })
        .eq('id', pendingWithCode.id);

      // Return code to Skyvern
      return new Response(
        JSON.stringify({ totp: pendingWithCode.verification_code }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PRIORITY 2: Look for pre-created pending request from worker
    const { data: preCreatedRequest } = await supabase
      .from('finn_auth_requests')
      .select('*')
      .eq('totp_identifier', totpIdentifier)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let authRequest: any;
    let chatId: string | null = null;

    if (preCreatedRequest) {
      // Use the pre-created request
      console.log(`✅ [FINN-2FA] Found pre-created request: ${preCreatedRequest.id}`);
      chatId = preCreatedRequest.telegram_chat_id;

      // Update status to code_requested
      const { data: updatedRequest, error: updateError } = await supabase
        .from('finn_auth_requests')
        .update({
          status: 'code_requested',
          code_requested_at: new Date().toISOString()
        })
        .eq('id', preCreatedRequest.id)
        .select()
        .single();

      if (updateError) {
        console.error("❌ Update error:", updateError);
        throw updateError;
      }

      authRequest = updatedRequest;
    } else {
      // FALLBACK: Try to find user by telegram_chat_id from any recent auth request
      console.log(`⚠️ [FINN-2FA] No pre-created request, trying fallback lookup...`);

      const { data: existingRequest } = await supabase
        .from('finn_auth_requests')
        .select('telegram_chat_id, user_id')
        .eq('totp_identifier', totpIdentifier)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      chatId = existingRequest?.telegram_chat_id || null;

      if (!chatId) {
        console.error(`❌ No Telegram chat found for: ${totpIdentifier}`);
        console.error(`   Worker should pre-create finn_auth_requests before Skyvern starts.`);
        return new Response(
          JSON.stringify({ error: "User not found. Worker didn't pre-create auth request." }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create new auth request as last resort
      const { data: newRequest, error: insertError } = await supabase
        .from('finn_auth_requests')
        .insert({
          telegram_chat_id: chatId,
          user_id: existingRequest?.user_id,
          totp_identifier: totpIdentifier,
          status: 'code_requested',
          code_requested_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) {
        console.error("❌ Insert error:", insertError);
        throw insertError;
      }

      authRequest = newRequest;
    }

    console.log(`📝 [FINN-2FA] Auth request ready: ${authRequest.id}, chatId: ${chatId}`);

    // Send Telegram notification
    const message = `🔐 <b>FINN потребує верифікації!</b>\n\n` +
      `Код надіслано на: <code>${totpIdentifier}</code>\n\n` +
      `Введіть код командою:\n<code>/code XXXXXX</code>\n\n` +
      `⏱ Код дійсний 10 хвилин`;

    await sendTelegram(chatId, message);
    console.log(`📤 [FINN-2FA] Telegram notification sent to ${chatId}`);

    // Poll for code (max 5 minutes = 300 seconds, check every 3 seconds)
    const maxWaitSeconds = 300;
    const pollInterval = 3;
    const startTime = Date.now();

    while ((Date.now() - startTime) / 1000 < maxWaitSeconds) {
      // Check if code was entered
      const { data: updated } = await supabase
        .from('finn_auth_requests')
        .select('verification_code, status')
        .eq('id', authRequest.id)
        .single();

      if (updated?.verification_code && updated?.status === 'code_received') {
        console.log(`✅ [FINN-2FA] Code received: ${updated.verification_code}`);

        // Mark as completed
        await supabase
          .from('finn_auth_requests')
          .update({ status: 'completed', success: true })
          .eq('id', authRequest.id);

        // Notify user
        await sendTelegram(chatId, "✅ Код прийнято! Skyvern продовжує...");

        // Return code to Skyvern
        return new Response(
          JSON.stringify({ totp: updated.verification_code }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
    }

    // Timeout
    console.log(`⏰ [FINN-2FA] Timeout waiting for code`);

    await supabase
      .from('finn_auth_requests')
      .update({ status: 'expired' })
      .eq('id', authRequest.id);

    await sendTelegram(chatId, "⏰ Час вичерпано. Спробуйте ще раз.");

    return new Response(
      JSON.stringify({ error: "Timeout waiting for verification code" }),
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
