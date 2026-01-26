// cancel-task/index.ts
// Edge Function to cancel a Skyvern task and reset application status

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Environment
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface RequestBody {
    applicationId: string;
}

serve(async (req: Request) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { applicationId }: RequestBody = await req.json();

        console.log(`[cancel-task] Cancelling application: ${applicationId}`);

        if (!applicationId) {
            return new Response(
                JSON.stringify({ success: false, error: "applicationId is required" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
        }

        // 1. Get application with skyvern_metadata
        const { data: app, error: appError } = await supabase
            .from("applications")
            .select("id, status, skyvern_metadata, job_id")
            .eq("id", applicationId)
            .single();

        if (appError || !app) {
            return new Response(
                JSON.stringify({ success: false, error: "Application not found" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
            );
        }

        // 2. Check if application is in 'sending' status
        if (app.status !== 'sending') {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Cannot cancel: application status is '${app.status}', not 'sending'`
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
            );
        }

        // 3. Get task_id from skyvern_metadata if exists
        const taskId = app.skyvern_metadata?.task_id;

        // 4. Update application status to 'approved' (cancelling the task)
        // The worker's monitor_task_status will detect this change and cancel the Skyvern task
        const { error: updateError } = await supabase
            .from("applications")
            .update({
                status: "approved",
                skyvern_metadata: {
                    ...app.skyvern_metadata,
                    cancelled_at: new Date().toISOString(),
                    cancelled_task_id: taskId
                }
            })
            .eq("id", applicationId);

        if (updateError) {
            console.error(`[cancel-task] Update error:`, updateError);
            return new Response(
                JSON.stringify({ success: false, error: "Failed to update application" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
            );
        }

        console.log(`[cancel-task] Application ${applicationId} cancelled. Task: ${taskId || 'none'}`);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Task cancelled, status reset to approved",
                taskId: taskId || null
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error(`[cancel-task] Error:`, error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
    }
});
