/**
 * registration-webhook - Handles registration flow webhooks and user responses
 *
 * Endpoints:
 * POST /registration-webhook
 *   - question: Ask user a question for missing field
 *   - verification: Request verification code from user
 *   - answer: User submitted answer (from Telegram callback)
 *   - status: Update registration flow status
 *
 * This function works with:
 * - register_site.py (Python worker)
 * - telegram-bot (for user interactions)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// TELEGRAM HELPERS
// ============================================

async function sendTelegram(
    chatId: string,
    text: string,
    replyMarkup?: object
): Promise<number | null> {
    if (!TELEGRAM_BOT_TOKEN || !chatId) return null;

    try {
        const payload: Record<string, unknown> = {
            chat_id: chatId,
            text,
            parse_mode: "HTML",
        };

        if (replyMarkup) {
            payload.reply_markup = replyMarkup;
        }

        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
        );

        if (response.ok) {
            const data = await response.json();
            return data.result?.message_id || null;
        }
        return null;
    } catch (error) {
        console.error("Telegram error:", error);
        return null;
    }
}

// ============================================
// HANDLERS
// ============================================

interface QuestionRequest {
    flow_id: string;
    field_name: string;
    question_text: string;
    field_type?: string;
    options?: string[];
}

async function handleQuestion(req: QuestionRequest): Promise<Response> {
    const { flow_id, field_name, question_text, field_type, options } = req;

    // Get flow data
    const { data: flow, error: flowError } = await supabase
        .from("registration_flows")
        .select("*")
        .eq("id", flow_id)
        .single();

    if (flowError || !flow) {
        return new Response(
            JSON.stringify({ error: "Flow not found" }),
            { status: 404 }
        );
    }

    const chatId = flow.telegram_chat_id;
    const siteName = flow.site_name || flow.site_domain;

    // Create question record
    const questionData = {
        flow_id,
        field_name,
        field_type: field_type || "text",
        question_text,
        options: options || null,
        status: "pending",
        timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
    };

    const { data: question, error: qError } = await supabase
        .from("registration_questions")
        .insert(questionData)
        .select()
        .single();

    if (qError) {
        return new Response(
            JSON.stringify({ error: "Failed to create question" }),
            { status: 500 }
        );
    }

    // Build Telegram message
    let message = `❓ <b>Питання при реєстрації на ${siteName}</b>\n\n`;
    message += `📝 ${question_text}\n\n`;

    let replyMarkup: object | undefined;

    if (options && options.length > 0) {
        message += "Оберіть варіант або введіть свій:\n";
        options.slice(0, 10).forEach((opt, i) => {
            message += `  ${i + 1}. ${opt}\n`;
        });

        // Create inline keyboard
        const buttons = options.slice(0, 5).map((opt, i) => ({
            text: `${i + 1}. ${opt.substring(0, 20)}`,
            callback_data: `regq_${question.id}_${i + 1}`,
        }));
        replyMarkup = { inline_keyboard: [buttons] };
    } else {
        message += "Введіть відповідь текстом:";
    }

    // Update flow status
    await supabase
        .from("registration_flows")
        .update({
            status: "waiting_for_user",
            pending_question: {
                question_id: question.id,
                field_name,
                question_text,
                asked_at: new Date().toISOString(),
            },
        })
        .eq("id", flow_id);

    // Send Telegram message
    const messageId = await sendTelegram(chatId, message, replyMarkup);

    if (messageId) {
        await supabase
            .from("registration_questions")
            .update({ telegram_message_id: messageId })
            .eq("id", question.id);
    }

    return new Response(
        JSON.stringify({
            success: true,
            question_id: question.id,
            message_id: messageId,
        }),
        { status: 200 }
    );
}

interface VerificationRequest {
    flow_id: string;
    verification_type: "email_code" | "sms_code" | "email_link" | "phone_call";
    identifier?: string; // email or phone
}

async function handleVerification(req: VerificationRequest): Promise<Response> {
    const { flow_id, verification_type, identifier } = req;

    // Get flow data
    const { data: flow, error: flowError } = await supabase
        .from("registration_flows")
        .select("*")
        .eq("id", flow_id)
        .single();

    if (flowError || !flow) {
        return new Response(
            JSON.stringify({ error: "Flow not found" }),
            { status: 404 }
        );
    }

    const chatId = flow.telegram_chat_id;
    const siteName = flow.site_name || flow.site_domain;

    // Update flow status
    await supabase
        .from("registration_flows")
        .update({
            status: `${verification_type.replace("_", "_")}`,
            verification_type,
            verification_requested_at: new Date().toISOString(),
            verification_expires_at: new Date(
                Date.now() + 5 * 60 * 1000
            ).toISOString(),
        })
        .eq("id", flow_id);

    // Build message based on type
    let message = "";
    if (verification_type === "email_code") {
        message =
            `📧 <b>Підтвердження email на ${siteName}</b>\n\n` +
            `На пошту ${identifier || ""} надіслано код підтвердження.\n\n` +
            `Введіть код з листа:`;
    } else if (verification_type === "sms_code") {
        message =
            `📱 <b>Підтвердження телефону на ${siteName}</b>\n\n` +
            `На номер ${identifier || ""} надіслано SMS з кодом.\n\n` +
            `Введіть код з SMS:`;
    } else if (verification_type === "email_link") {
        message =
            `🔗 <b>Підтвердження email на ${siteName}</b>\n\n` +
            `На пошту надіслано лінк для підтвердження.\n\n` +
            `<b>Перейдіть за лінком</b> і потім напишіть <code>готово</code>`;
    } else {
        message =
            `🔐 <b>Підтвердження на ${siteName}</b>\n\n` +
            `Потрібна верифікація. Введіть код або напишіть <code>готово</code>:`;
    }

    await sendTelegram(chatId, message);

    return new Response(
        JSON.stringify({ success: true, verification_type }),
        { status: 200 }
    );
}

interface AnswerRequest {
    question_id?: string;
    flow_id?: string;
    answer: string;
    answer_source?: "user_telegram" | "profile" | "generated" | "default";
}

async function handleAnswer(req: AnswerRequest): Promise<Response> {
    const { question_id, flow_id, answer, answer_source } = req;

    if (question_id) {
        // Answer to specific question
        const { error } = await supabase
            .from("registration_questions")
            .update({
                status: "answered",
                answer,
                answer_source: answer_source || "user_telegram",
                answered_at: new Date().toISOString(),
            })
            .eq("id", question_id);

        if (error) {
            return new Response(
                JSON.stringify({ error: "Failed to save answer" }),
                { status: 500 }
            );
        }

        // Get question to update flow
        const { data: question } = await supabase
            .from("registration_questions")
            .select("flow_id, field_name, question_text")
            .eq("id", question_id)
            .single();

        if (question) {
            // Update flow Q&A history
            const { data: flow } = await supabase
                .from("registration_flows")
                .select("qa_history")
                .eq("id", question.flow_id)
                .single();

            const qaHistory = flow?.qa_history || [];
            qaHistory.push({
                question: question.question_text,
                answer,
                field_name: question.field_name,
                answered_at: new Date().toISOString(),
            });

            await supabase
                .from("registration_flows")
                .update({
                    status: "registering",
                    pending_question: null,
                    qa_history: qaHistory,
                })
                .eq("id", question.flow_id);
        }
    } else if (flow_id) {
        // Verification code answer
        await supabase
            .from("registration_flows")
            .update({
                verification_code: answer,
                status: "registering",
            })
            .eq("id", flow_id);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
}

interface StatusRequest {
    flow_id: string;
    status: string;
    error_message?: string;
    completed_data?: Record<string, unknown>;
}

async function handleStatusUpdate(req: StatusRequest): Promise<Response> {
    const { flow_id, status, error_message, completed_data } = req;

    const updateData: Record<string, unknown> = { status };

    if (error_message) {
        updateData.error_message = error_message;
    }

    if (status === "completed") {
        updateData.completed_at = new Date().toISOString();
        if (completed_data) {
            updateData.form_fields = completed_data;
        }
    }

    const { error } = await supabase
        .from("registration_flows")
        .update(updateData)
        .eq("id", flow_id);

    if (error) {
        return new Response(
            JSON.stringify({ error: "Failed to update status" }),
            { status: 500 }
        );
    }

    // Notify user on completion or failure
    const { data: flow } = await supabase
        .from("registration_flows")
        .select("telegram_chat_id, site_name")
        .eq("id", flow_id)
        .single();

    if (flow?.telegram_chat_id) {
        if (status === "completed") {
            await sendTelegram(
                flow.telegram_chat_id,
                `✅ <b>Реєстрація на ${flow.site_name} завершена!</b>\n\n` +
                    `Тепер можна подаватись на вакансії автоматично.`
            );
        } else if (status === "failed") {
            await sendTelegram(
                flow.telegram_chat_id,
                `❌ <b>Помилка реєстрації на ${flow.site_name}</b>\n\n` +
                    `${error_message || "Невідома помилка"}\n\n` +
                    `Спробуйте зареєструватись вручну.`
            );
        }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
}

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req: Request) => {
    // CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, x-api-key",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json",
    };

    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response(
            JSON.stringify({ error: "Method not allowed" }),
            { status: 405, headers: corsHeaders }
        );
    }

    try {
        const body = await req.json();
        const action = body.action;

        console.log(`[registration-webhook] Action: ${action}`);

        let response: Response;

        switch (action) {
            case "question":
                response = await handleQuestion(body);
                break;

            case "verification":
                response = await handleVerification(body);
                break;

            case "answer":
                response = await handleAnswer(body);
                break;

            case "status":
                response = await handleStatusUpdate(body);
                break;

            default:
                response = new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400 }
                );
        }

        // Add CORS headers to response
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
            newHeaders.set(key, value);
        });

        return new Response(response.body, {
            status: response.status,
            headers: newHeaders,
        });
    } catch (error) {
        console.error("[registration-webhook] Error:", error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: corsHeaders }
        );
    }
});
