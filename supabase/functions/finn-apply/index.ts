// finn-apply/index.ts
// Edge Function to submit FINN Enkel Søknad via Skyvern
// Handles login (with 2FA webhook) and form submission

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Environment
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SKYVERN_API_URL = Deno.env.get("SKYVERN_API_URL") || "http://host.docker.internal:8000";
const SKYVERN_API_KEY = Deno.env.get("SKYVERN_API_KEY") || "";
const FINN_EMAIL = Deno.env.get("FINN_EMAIL") || "";
const FINN_PASSWORD = Deno.env.get("FINN_PASSWORD") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";

interface RequestBody {
    jobId: string;
    applicationId: string;
}

serve(async (req: Request) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { jobId, applicationId }: RequestBody = await req.json();

        console.log(`[finn-apply] Starting for job=${jobId}, app=${applicationId}`);

        // 1. Get job data
        const { data: job, error: jobError } = await supabase
            .from("jobs")
            .select("*")
            .eq("id", jobId)
            .single();

        if (jobError || !job) {
            return new Response(
                JSON.stringify({ success: false, error: "Job not found" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
            );
        }

        // Verify this is a FINN Easy Apply job
        if (!job.external_apply_url?.includes("finn.no/job/apply")) {
            return new Response(
                JSON.stringify({ success: false, error: "This is not a FINN Enkel Søknad job" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
        }

        // 2. Get application data (cover letter)
        const { data: application, error: appError } = await supabase
            .from("applications")
            .select("*")
            .eq("id", applicationId)
            .single();

        if (appError || !application) {
            return new Response(
                JSON.stringify({ success: false, error: "Application not found" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
            );
        }

        // 3. Get user settings (for telegram notifications)
        const { data: settings } = await supabase
            .from("user_settings")
            .select("telegram_chat_id")
            .eq("user_id", job.user_id)
            .single();

        const telegramChatId = settings?.telegram_chat_id;

        // 4. Get active CV profile
        const { data: profile } = await supabase
            .from("cv_profiles")
            .select("*")
            .eq("is_active", true)
            .limit(1)
            .single();

        // Extract profile data for form filling
        const profileData = profile?.structured_content || {};
        const contactInfo = {
            name: profileData.personalInfo?.name || profileData.name || "Job Applicant",
            email: FINN_EMAIL,
            phone: profileData.personalInfo?.phone || profileData.phone || "",
        };

        console.log(`[finn-apply] Profile: ${contactInfo.name}, Chat: ${telegramChatId}`);

        // 5. Create Skyvern task for FINN application
        const finnApplyUrl = job.external_apply_url;
        const coverLetter = application.cover_letter_no || application.cover_letter_uk || "";

        // Build the 2FA webhook URL
        const totpWebhookUrl = `${SUPABASE_URL}/functions/v1/finn-2fa-webhook`;

        const navigationGoal = `
GOAL: Submit a job application on FINN.no Enkel Søknad.

PREREQUISITE: You must be logged in to FINN.no first.

STEP 1: Navigate to ${finnApplyUrl}

STEP 2: If prompted to log in:
   - Go to FINN.no login (Schibsted/Vend)
   - Enter email: ${FINN_EMAIL}
   - Click "Neste" / "Continue"
   - Enter password (from navigation_payload)
   - Click "Logg inn"
   - If 2FA code is requested, wait for the system to provide it via webhook
   - Enter the 2FA code when received
   - Complete login

STEP 3: Once logged in and on the application page, fill the form:
   - Name field: ${contactInfo.name}
   - Email field: ${contactInfo.email}
   - Phone field: ${contactInfo.phone}
   - Cover letter / Message / Søknadstekst field: Enter the following text:

${coverLetter}

STEP 4: Review the form to ensure all required fields are filled.

STEP 5: Look for and click the "Send søknad" or "Send application" or "Submit" button.

STEP 6: Wait for confirmation that the application was sent.

IMPORTANT:
- Accept any cookie popups
- If there are checkboxes for terms/conditions, check them
- Do NOT close the browser until confirmation is received
- Report any errors you encounter
`;

        const dataExtractionSchema = {
            type: "object",
            properties: {
                application_sent: {
                    type: "boolean",
                    description: "True if the application was successfully submitted"
                },
                confirmation_message: {
                    type: "string",
                    description: "The confirmation message shown after submission"
                },
                error_message: {
                    type: "string",
                    description: "Any error message if submission failed"
                },
                login_required: {
                    type: "boolean",
                    description: "True if login was required"
                },
                login_success: {
                    type: "boolean",
                    description: "True if login was successful"
                }
            }
        };

        const skyvernPayload = {
            url: finnApplyUrl,
            webhook_callback_url: `${SUPABASE_URL}/functions/v1/skyvern-callback`,
            navigation_goal: navigationGoal,
            data_extraction_goal: "Determine if the application was successfully submitted. Report any errors.",
            data_extraction_schema: dataExtractionSchema,
            navigation_payload: {
                email: FINN_EMAIL,
                password: FINN_PASSWORD,
                name: contactInfo.name,
                phone: contactInfo.phone,
                cover_letter: coverLetter
            },
            totp_verification_url: totpWebhookUrl,
            totp_identifier: FINN_EMAIL,
            max_steps: 35,
            proxy_location: "RESIDENTIAL"
        };

        // 6. Call Skyvern API
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        if (SKYVERN_API_KEY) {
            headers["x-api-key"] = SKYVERN_API_KEY;
        }

        console.log(`[finn-apply] Calling Skyvern at ${SKYVERN_API_URL}`);

        const skyvernResponse = await fetch(`${SKYVERN_API_URL}/api/v1/tasks`, {
            method: "POST",
            headers,
            body: JSON.stringify(skyvernPayload)
        });

        if (!skyvernResponse.ok) {
            const errorText = await skyvernResponse.text();
            console.error(`[finn-apply] Skyvern error: ${errorText}`);
            return new Response(
                JSON.stringify({ success: false, error: `Skyvern error: ${errorText}` }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
            );
        }

        const skyvernData = await skyvernResponse.json();
        const taskId = skyvernData.task_id;

        console.log(`[finn-apply] Skyvern task created: ${taskId}`);

        // 7. Update application with Skyvern task info
        await supabase
            .from("applications")
            .update({
                status: "sending",
                skyvern_metadata: {
                    task_id: taskId,
                    source: "dashboard",
                    finn_apply: true,
                    started_at: new Date().toISOString()
                }
            })
            .eq("id", applicationId);

        // 8. Update job status
        await supabase
            .from("jobs")
            .update({ status: "APPLIED" })
            .eq("id", jobId);

        // 9. Send Telegram notification
        if (telegramChatId && TELEGRAM_BOT_TOKEN) {
            const message = `🚀 *Заявка відправляється на FINN*

📋 *${job.title}*
🏢 ${job.company || "Unknown"}

⏳ Skyvern заповнює форму...
🔐 Очікуйте запит на 2FA код!

Коли отримаєте код на пошту, надішліть:
\`/code XXXXXX\``;

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: telegramChatId,
                    text: message,
                    parse_mode: "Markdown"
                })
            });
        }

        // 10. Log to system_logs
        await supabase.from("system_logs").insert({
            event_type: "FINN_APPLY",
            status: "started",
            message: `Started FINN application for job: ${job.title}`,
            metadata: {
                job_id: jobId,
                application_id: applicationId,
                skyvern_task_id: taskId,
                finn_url: finnApplyUrl
            }
        });

        return new Response(
            JSON.stringify({
                success: true,
                message: "Application submission started",
                taskId: taskId
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("[finn-apply] Error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
    }
});
