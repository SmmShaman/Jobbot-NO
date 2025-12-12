import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("🤖 [TelegramBot] v11.0 - Registration flow support");

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
console.log(`🤖 [TelegramBot] BOT_TOKEN exists: ${!!BOT_TOKEN}`);

// --- HELPER: Format Application Form Type ---
function formatFormType(job: any): string {
  const formType = job.application_form_type;
  const externalUrl = job.external_apply_url;

  if (!formType && !externalUrl) {
    return "❓ <i>Тип подачі: невідомо</i>";
  }

  let emoji = "🔗";
  let label = "Зовнішня форма";

  switch (formType) {
    case 'finn_easy':
      emoji = "⚡";
      label = "FINN Enkel søknad";
      break;
    case 'external_form':
      emoji = "📝";
      label = "Зовнішня форма";
      break;
    case 'external_registration':
      emoji = "🔐";
      label = "Потрібна реєстрація";
      break;
    case 'email':
      emoji = "📧";
      label = "Email";
      break;
    case 'processing':
      emoji = "⏳";
      label = "Обробляється...";
      break;
    case 'skyvern_failed':
      emoji = "⚠️";
      label = "Не вдалося визначити";
      break;
    default:
      emoji = "❓";
      label = "Невідомо";
  }

  let result = `${emoji} <b>Подача:</b> ${label}`;

  if (externalUrl) {
    // Truncate long URLs for display
    const displayUrl = externalUrl.length > 40
      ? externalUrl.substring(0, 40) + "..."
      : externalUrl;
    result += `\n🔗 <a href="${externalUrl}">${displayUrl}</a>`;
  }

  return result;
}

// --- HELPER: Send Message ---
async function sendTelegram(chatId: string, text: string, replyMarkup?: any) {
  console.log(`📤 [TG] Sending to ${chatId}: ${text.substring(0, 50)}...`);

  if (!BOT_TOKEN) {
    console.error("❌ [TG] BOT_TOKEN is missing! Cannot send message.");
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  const markup = replyMarkup || { remove_keyboard: true };

  const body: any = { 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML', 
      disable_web_page_preview: true,
      reply_markup: markup
  };

  try {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const responseText = await res.text();
    if (!res.ok) {
      console.error(`❌ [TG] Send Error (${res.status}):`, responseText);
    } else {
      console.log(`✅ [TG] Message sent successfully to ${chatId}`);
    }
  } catch (e) {
    console.error("❌ [TG] Network Error:", e);
  }
}

// --- HELPER: Answer Callback ---
async function answerCallback(callbackId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text })
  });
}

// --- HEAVY LOGIC (Running in Background) ---
async function runBackgroundJob(update: any) {
    console.log(`🔄 [TG] runBackgroundJob started with update:`, JSON.stringify(update).substring(0, 200));

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ [TG] Supabase credentials missing!");
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // --- 1. HANDLE CALLBACK BUTTONS (Inline) ---
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const data = cb.data;

            // WRITE APPLICATION
            if (data.startsWith('write_app_')) {
                const jobId = data.split('write_app_')[1];
                await sendTelegram(chatId, "⏳ <b>Пишу Søknad...</b>\n(Це може зайняти до 30 сек)");

                const { data: settings } = await supabase.from('user_settings').select('user_id').eq('telegram_chat_id', chatId.toString()).single();

                const { data: genResult } = await supabase.functions.invoke('generate_application', {
                    body: { job_id: jobId, user_id: settings?.user_id }
                });

                if (!genResult?.success) {
                    await sendTelegram(chatId, `❌ Помилка: ${genResult?.message || 'Unknown'}`);
                    return;
                }

                const app = genResult.application;
                const msg = `✅ <b>Søknad готовий!</b>\n\n` +
                            `🇳🇴 <b>Norsk:</b>\n<tg-spoiler>${app.cover_letter_no}</tg-spoiler>\n\n` +
                            `🇺🇦 <b>Переклад:</b>\n<tg-spoiler>${app.cover_letter_uk || '...'}</tg-spoiler>`;

                const kb = { inline_keyboard: [[
                    { text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` }
                ]]};

                await sendTelegram(chatId, msg, kb);
            }

            // SUBMIT TO FINN (Enkel Søknad)
            if (data.startsWith('finn_apply_')) {
                const appId = data.split('finn_apply_')[1];

                // Get application with job info
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(*)')
                    .eq('id', appId)
                    .single();

                if (!app || !app.jobs) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                const isFinnEasy = app.jobs?.has_enkel_soknad ||
                                   app.jobs?.application_form_type === 'finn_easy' ||
                                   app.jobs?.external_apply_url?.includes('finn.no/job/apply');

                if (!isFinnEasy) {
                    await sendTelegram(chatId,
                        `⚠️ <b>Автозаповнення недоступне</b>\n\n` +
                        `Ця вакансія використовує зовнішню форму:\n` +
                        `🔗 <a href="${app.jobs.external_apply_url || app.jobs.job_url}">Відкрити форму</a>\n\n` +
                        `📝 Заповніть заявку вручну.`
                    );
                    return;
                }

                // Check if already sent (block duplicates)
                if (app.status === 'sent' || app.status === 'sending') {
                    await sendTelegram(chatId,
                        `⚠️ <b>Заявку вже відправлено!</b>\n\n` +
                        `📋 ${app.jobs.title}\n` +
                        `🏢 ${app.jobs.company}\n\n` +
                        `Повторна відправка заблокована.`
                    );
                    return;
                }

                await sendTelegram(chatId, "🚀 <b>Запускаю подачу на FINN...</b>\n\n⏳ Це може зайняти 2-5 хвилин.\n🔐 Очікуйте запит на 2FA код!");

                // Call finn-apply edge function
                const { data: result, error } = await supabase.functions.invoke('finn-apply', {
                    body: { jobId: app.jobs.id, applicationId: appId }
                });

                if (error || !result?.success) {
                    await sendTelegram(chatId, `❌ Помилка: ${result?.message || error?.message || 'Unknown'}`);
                    return;
                }

                await sendTelegram(chatId,
                    `✅ <b>Заявка відправлена на обробку!</b>\n\n` +
                    `📋 ${app.jobs.title}\n` +
                    `🔑 Task ID: <code>${result.taskId}</code>\n\n` +
                    `⏳ Коли отримаєте код на пошту/SMS, надішліть:\n` +
                    `<code>/code XXXXXX</code>`
                );
            }

            // VIEW EXISTING APPLICATION
            if (data.startsWith('view_app_')) {
                const appId = data.split('view_app_')[1];
                // Get application with job info to check form type
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(id, title, company, external_apply_url, job_url, has_enkel_soknad, application_form_type)')
                    .eq('id', appId)
                    .single();

                if (app) {
                    let statusText = "📝 Draft";
                    const buttons: any[] = [];
                    // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                    const isFinnEasy = app.jobs?.has_enkel_soknad ||
                                       app.jobs?.application_form_type === 'finn_easy' ||
                                       app.jobs?.external_apply_url?.includes('finn.no/job/apply');

                    if (app.status === 'approved') {
                        statusText = "✅ Approved (Ready to Send)";
                        if (isFinnEasy) {
                            buttons.push({ text: "⚡ Подати на FINN", callback_data: `finn_apply_${app.id}` });
                        } else {
                            buttons.push({ text: "🚀 Auto-Apply (Skyvern)", callback_data: `auto_apply_${app.id}` });
                        }
                    } else if (app.status === 'sending') {
                        statusText = "🚀 Sending...";
                    } else if (app.status === 'manual_review') {
                        statusText = "⚠️ Check Task (Skyvern Done)";
                        buttons.push({ text: "🔄 Retry", callback_data: isFinnEasy ? `finn_apply_${app.id}` : `auto_apply_${app.id}` });
                    } else if (app.status === 'sent') {
                        statusText = "📬 Sent to Employer";
                    } else if (app.status === 'failed') {
                        statusText = "❌ Failed to Send";
                        buttons.push({ text: "🚀 Retry", callback_data: isFinnEasy ? `finn_apply_${app.id}` : `auto_apply_${app.id}` });
                    } else {
                        // Draft
                        statusText = "📝 Draft";
                        buttons.push({ text: "✅ Підтвердити (Approve)", callback_data: `approve_app_${app.id}` });
                    }

                    // Add form type info to message
                    let formInfo = "";
                    if (isFinnEasy) {
                        formInfo = "\n⚡ <i>FINN Enkel Søknad (авто)</i>";
                    } else if (app.jobs?.external_apply_url) {
                        formInfo = `\n📝 <i>Зовнішня форма (вручну)</i>\n🔗 <a href="${app.jobs.external_apply_url}">Відкрити форму</a>`;
                    }

                    const msg = `📂 <b>Ваш Søknad</b>\nСтатус: <b>${statusText}</b>${formInfo}\n\n` +
                                `🇳🇴 <b>Norsk:</b>\n<tg-spoiler>${app.cover_letter_no}</tg-spoiler>\n\n` +
                                `🇺🇦 <b>Переклад:</b>\n<tg-spoiler>${app.cover_letter_uk || '...'}</tg-spoiler>`;

                    await sendTelegram(chatId, msg, { inline_keyboard: [buttons] });
                } else {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                }
            }

            // APPROVE APPLICATION
            if (data.startsWith('approve_app_')) {
                const appId = data.split('approve_app_')[1];

                try {
                    // Get application with job to check form type AND get company/title
                    const { data: app } = await supabase
                        .from('applications')
                        .select('*, jobs(id, title, company, external_apply_url, job_url, has_enkel_soknad, application_form_type)')
                        .eq('id', appId)
                        .single();

                    const { error } = await supabase.from('applications').update({
                        status: 'approved',
                        approved_at: new Date().toISOString(),
                        skyvern_metadata: { source: 'telegram' }
                    }).eq('id', appId);

                    if (error) {
                        console.error("Approve DB Error:", error);
                        await sendTelegram(chatId, `❌ <b>Помилка оновлення бази!</b>\n\nДеталі: ${error.message}`);
                        return;
                    }

                    // Check if FINN Easy Apply (priority: has_enkel_soknad > application_form_type > URL)
                    const isFinnEasy = app?.jobs?.has_enkel_soknad ||
                                       app?.jobs?.application_form_type === 'finn_easy' ||
                                       app?.jobs?.external_apply_url?.includes('finn.no/job/apply');

                    const jobTitle = app?.jobs?.title || 'Вакансія';
                    const companyName = app?.jobs?.company || 'Компанія';

                    let msg = `✅ <b>Søknad підтверджено!</b>\n\n` +
                              `📋 <b>${jobTitle}</b>\n` +
                              `🏢 ${companyName}\n\n`;
                    let kb;

                    if (isFinnEasy) {
                        msg += `⚡ <b>FINN Enkel Søknad доступний!</b>\nНатисніть щоб відправити заявку автоматично:`;
                        kb = { inline_keyboard: [[
                            { text: `⚡ Відправити в ${companyName}`, callback_data: `finn_apply_${appId}` }
                        ]]};
                    } else if (app?.jobs?.external_apply_url) {
                        msg += `📝 Зовнішня форма.\nЗаповніть вручну:\n🔗 <a href="${app.jobs.external_apply_url}">Відкрити форму</a>`;
                        kb = undefined;
                    } else {
                        msg += "Бажаєте запустити автоматичну подачу через Skyvern?";
                        kb = { inline_keyboard: [[
                            { text: "🚀 Запустити (Auto-Apply)", callback_data: `auto_apply_${appId}` }
                        ]]};
                    }

                    await sendTelegram(chatId, msg, kb);
                } catch (e: any) {
                    console.error("Approve Exception:", e);
                    await sendTelegram(chatId, `❌ Критична помилка: ${e.message}`);
                }
            }

            // AUTO-APPLY (External forms via Skyvern)
            if (data.startsWith('auto_apply_')) {
                const appId = data.split('auto_apply_')[1];

                // Get application with job info
                const { data: app } = await supabase
                    .from('applications')
                    .select('*, jobs(id, title, company, external_apply_url, application_form_type)')
                    .eq('id', appId)
                    .single();

                if (!app || !app.jobs) {
                    await sendTelegram(chatId, "❌ Заявку не знайдено.");
                    return;
                }

                // Check if already sent (block duplicates)
                if (app.status === 'sent' || app.status === 'sending') {
                    await sendTelegram(chatId,
                        `⚠️ <b>Заявку вже відправлено!</b>\n\n` +
                        `📋 ${app.jobs.title}\n` +
                        `🏢 ${app.jobs.company}\n\n` +
                        `Повторна відправка заблокована.`
                    );
                    return;
                }

                // Update status to sending
                await supabase.from('applications').update({ status: 'sending' }).eq('id', appId);

                // Build informative message based on form type
                const isRegistration = app.jobs.application_form_type === 'external_registration';
                let domain = '';
                try {
                    domain = new URL(app.jobs.external_apply_url || '').hostname;
                } catch { domain = 'зовнішній сайт'; }

                let infoMsg = `🚀 <b>Auto-Apply запущено!</b>\n\n` +
                    `📋 ${app.jobs.title}\n` +
                    `🏢 ${app.jobs.company}\n` +
                    `🌐 ${domain}\n\n`;

                if (isRegistration) {
                    infoMsg += `🔐 <b>Тип:</b> Потрібна реєстрація\n\n` +
                        `Система перевірить чи є акаунт.\n` +
                        `Якщо ні — зареєструється автоматично.\n` +
                        `⚠️ <i>Можливо будуть запитання в цьому чаті!</i>\n\n`;
                } else {
                    infoMsg += `📝 <b>Тип:</b> Зовнішня форма\n\n` +
                        `Skyvern заповнить та відправить форму.\n\n`;
                }

                infoMsg += `⏳ Обробка може зайняти 1-5 хвилин.\n` +
                    `Переконайтесь що <code>auto_apply.py</code> запущений!`;

                await sendTelegram(chatId, infoMsg);
            }

            // CONFIRM APPLICATION (before Skyvern submission)
            if (data.startsWith('confirm_apply_')) {
                const confirmationId = data.split('confirm_apply_')[1];
                console.log(`✅ [TG] Confirming application: ${confirmationId}`);

                try {
                    // Update confirmation status
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'confirmed',
                            confirmed_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    if (error) {
                        console.error('Confirm error:', error);
                        await sendTelegram(chatId, "⚠️ Помилка підтвердження. Можливо час вже вичерпано.");
                        return;
                    }

                    await sendTelegram(chatId,
                        `✅ <b>Підтверджено!</b>\n\n` +
                        `⏳ Skyvern зараз заповнить та відправить форму.\n` +
                        `Слідкуйте за повідомленнями...`
                    );
                } catch (e: any) {
                    console.error('Confirm exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // CANCEL APPLICATION
            if (data.startsWith('cancel_apply_')) {
                const confirmationId = data.split('cancel_apply_')[1];
                console.log(`❌ [TG] Cancelling application: ${confirmationId}`);

                try {
                    // Update confirmation status
                    const { error } = await supabase
                        .from('application_confirmations')
                        .update({
                            status: 'cancelled',
                            cancelled_at: new Date().toISOString()
                        })
                        .eq('id', confirmationId)
                        .eq('status', 'pending');

                    if (error) {
                        console.error('Cancel error:', error);
                        await sendTelegram(chatId, "⚠️ Помилка скасування.");
                        return;
                    }

                    await sendTelegram(chatId,
                        `❌ <b>Заявку скасовано</b>\n\n` +
                        `Заявка повернута в чернетки. Ви можете відправити її пізніше.`
                    );
                } catch (e: any) {
                    console.error('Cancel exception:', e);
                    await sendTelegram(chatId, `❌ Помилка: ${e.message}`);
                }
            }

            // REGISTRATION QUESTION ANSWER (inline button)
            if (data.startsWith('regq_')) {
                // Format: regq_{question_id}_{option_number}
                const parts = data.split('_');
                const questionId = parts[1];
                const optionNum = parseInt(parts[2]);

                console.log(`📋 [TG] Registration question answer: ${questionId}, option: ${optionNum}`);

                // Get question with options
                const { data: question } = await supabase
                    .from('registration_questions')
                    .select('*')
                    .eq('id', questionId)
                    .single();

                if (!question) {
                    await sendTelegram(chatId, "⚠️ Питання не знайдено або вже відповіли.");
                    return;
                }

                // Get the selected option
                const options = question.options || [];
                const answer = options[optionNum - 1] || `Option ${optionNum}`;

                // Update question with answer
                const { error: updateError } = await supabase
                    .from('registration_questions')
                    .update({
                        status: 'answered',
                        answer: answer,
                        answer_source: 'user_telegram',
                        answered_at: new Date().toISOString()
                    })
                    .eq('id', questionId);

                if (updateError) {
                    await sendTelegram(chatId, "❌ Помилка збереження відповіді.");
                    return;
                }

                // Update flow Q&A history
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('qa_history, site_name')
                    .eq('id', question.flow_id)
                    .single();

                if (flow) {
                    const qaHistory = flow.qa_history || [];
                    qaHistory.push({
                        question: question.question_text,
                        answer: answer,
                        field_name: question.field_name,
                        answered_at: new Date().toISOString()
                    });

                    await supabase
                        .from('registration_flows')
                        .update({
                            status: 'registering',
                            pending_question: null,
                            qa_history: qaHistory
                        })
                        .eq('id', question.flow_id);
                }

                await sendTelegram(chatId,
                    `✅ <b>Відповідь прийнято!</b>\n\n` +
                    `📝 ${question.question_text}\n` +
                    `✏️ ${answer}\n\n` +
                    `⏳ Продовжую реєстрацію...`
                );
            }

            // REGISTRATION CONFIRMATION
            if (data.startsWith('reg_confirm_')) {
                const flowId = data.split('reg_confirm_')[1];

                await supabase
                    .from('registration_flows')
                    .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
                    .eq('id', flowId);

                await sendTelegram(chatId, "✅ <b>Підтверджено!</b>\n\n⏳ Починаю реєстрацію...");
            }

            // REGISTRATION EDIT - Show editable fields
            if (data.startsWith('reg_edit_')) {
                const flowId = data.split('reg_edit_')[1];

                // Get flow with profile data
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('profile_data_snapshot, site_name')
                    .eq('id', flowId)
                    .single();

                if (flow && flow.profile_data_snapshot) {
                    const pd = flow.profile_data_snapshot;
                    const siteName = flow.site_name || 'сайт';

                    const editMsg = (
                        `✏️ <b>Редагування даних для ${siteName}</b>\n\n` +
                        `Оберіть поле для редагування:\n\n` +
                        `👤 Ім'я: <code>${pd.full_name || '—'}</code>\n` +
                        `📱 Телефон: <code>${pd.phone || '—'}</code>\n` +
                        `🏠 Місто: <code>${pd.city || '—'}</code>\n` +
                        `📮 Індекс: <code>${pd.postal_code || '—'}</code>\n\n` +
                        `Натисніть на поле або напишіть нове значення у форматі:\n` +
                        `<code>поле: нове значення</code>\n\n` +
                        `Наприклад: <code>телефон: +47 123 45 678</code>`
                    );

                    const editKeyboard = {
                        inline_keyboard: [
                            [
                                { text: "👤 Ім'я", callback_data: `reg_field_${flowId}_full_name` },
                                { text: "📱 Телефон", callback_data: `reg_field_${flowId}_phone` }
                            ],
                            [
                                { text: "🏠 Місто", callback_data: `reg_field_${flowId}_city` },
                                { text: "📮 Індекс", callback_data: `reg_field_${flowId}_postal_code` }
                            ],
                            [
                                { text: "✅ Готово - продовжити", callback_data: `reg_confirm_${flowId}` }
                            ],
                            [
                                { text: "❌ Скасувати", callback_data: `reg_cancel_${flowId}` }
                            ]
                        ]
                    };

                    await sendTelegram(chatId, editMsg, editKeyboard);

                    // Update flow to editing state
                    await supabase
                        .from('registration_flows')
                        .update({ status: 'editing' })
                        .eq('id', flowId);
                } else {
                    await sendTelegram(chatId, "⚠️ Не вдалося завантажити дані для редагування.");
                }
            }

            // REGISTRATION FIELD EDIT - Select specific field to edit
            if (data.startsWith('reg_field_')) {
                const parts = data.split('reg_field_')[1].split('_');
                const flowId = parts[0];
                const fieldName = parts.slice(1).join('_');

                const fieldLabels: Record<string, string> = {
                    'full_name': "Ім'я",
                    'phone': 'Телефон',
                    'city': 'Місто',
                    'postal_code': 'Поштовий індекс'
                };

                const label = fieldLabels[fieldName] || fieldName;

                // Update flow with pending edit field
                await supabase
                    .from('registration_flows')
                    .update({
                        pending_edit_field: fieldName,
                        status: 'editing_field'
                    })
                    .eq('id', flowId);

                await sendTelegram(chatId,
                    `✏️ <b>Редагування: ${label}</b>\n\n` +
                    `Введіть нове значення для поля "${label}":`
                );
            }

            // REGISTRATION CANCEL
            if (data.startsWith('reg_cancel_')) {
                const flowId = data.split('reg_cancel_')[1];

                await supabase
                    .from('registration_flows')
                    .update({ status: 'cancelled', error_message: 'Cancelled by user' })
                    .eq('id', flowId);

                await sendTelegram(chatId, "❌ <b>Реєстрацію скасовано.</b>");
            }

            // SHOW LAST SCAN RESULTS (all jobs)
            if (data === 'show_last_scan' || data === 'show_hot_scan') {
                const onlyHot = data === 'show_hot_scan';
                await sendTelegram(chatId, onlyHot ? "🔥 <b>Завантажую релевантні вакансії...</b>" : "📋 <b>Завантажую всі вакансії...</b>");

                // Get last successful scan from system_logs
                const { data: lastScan } = await supabase
                    .from('system_logs')
                    .select('details')
                    .eq('event_type', 'SCAN')
                    .eq('status', 'SUCCESS')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (!lastScan?.details?.scannedJobIds || lastScan.details.scannedJobIds.length === 0) {
                    await sendTelegram(chatId, "⚠️ Немає даних про останнє сканування.");
                    return;
                }

                const jobIds = lastScan.details.scannedJobIds;

                // Query jobs
                let query = supabase.from('jobs').select('*').in('id', jobIds);
                if (onlyHot) {
                    query = query.gte('relevance_score', 50);
                }
                const { data: jobs } = await query.order('relevance_score', { ascending: false });

                if (!jobs || jobs.length === 0) {
                    await sendTelegram(chatId, onlyHot ? "⚠️ Немає вакансій з релевантністю ≥50%." : "⚠️ Немає вакансій.");
                    return;
                }

                // Show each job with action buttons
                for (const job of jobs.slice(0, 10)) { // Limit to 10 to avoid spam
                    const score = job.relevance_score || 0;
                    const scoreEmoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
                    const hotEmoji = score >= 80 ? ' 🔥' : '';

                    // Format application form type
                    const formInfo = formatFormType(job);

                    const jobMsg = `🏢 <b>${job.title}</b>${hotEmoji}\n` +
                        `🏢 ${job.company || 'Компанія не вказана'}\n` +
                        `📍 ${job.location || 'Norway'}\n` +
                        `📊 <b>${score}/100</b> ${scoreEmoji}\n` +
                        `${formInfo}\n` +
                        `🔗 <a href="${job.job_url}">Оригінал</a>`;

                    // Check if application exists
                    const { data: existingApp } = await supabase
                        .from('applications')
                        .select('id, status')
                        .eq('job_id', job.id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    const buttons: any[] = [];
                    let statusMsg = "";

                    if (!existingApp) {
                        statusMsg = "\n❌ <i>Søknad не створено</i>";
                        if (score >= 50) {
                            buttons.push({ text: "✍️ Написати Søknad", callback_data: `write_app_${job.id}` });
                        }
                    } else {
                        switch (existingApp.status) {
                            case 'draft': statusMsg = "\n📝 <i>Є чернетка</i>"; break;
                            case 'approved': statusMsg = "\n✅ <i>Затверджено</i>"; break;
                            case 'sent': statusMsg = "\n📬 <i>Відправлено</i>"; break;
                            default: statusMsg = `\n📋 <i>${existingApp.status}</i>`;
                        }
                        buttons.push({ text: "📂 Показати Søknad", callback_data: `view_app_${existingApp.id}` });
                    }

                    const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
                    await sendTelegram(chatId, jobMsg + statusMsg, keyboard);
                }

                if (jobs.length > 10) {
                    await sendTelegram(chatId, `ℹ️ Показано 10 з ${jobs.length} вакансій. Решту дивіться в Dashboard.`);
                }
            }
        }

        // --- 2. HANDLE TEXT MESSAGES ---
        if (update.message && update.message.text) {
            const text = update.message.text.trim();
            const chatId = update.message.chat.id;
            const dashboardUrl = Deno.env.get('DASHBOARD_URL') ?? 'https://jobbotnetlify.netlify.app';

            console.log(`💬 [TG] Message from ${chatId}: "${text}"`);
            console.log(`💬 [TG] Dashboard URL: ${dashboardUrl}`);

            // START / HELP
            if (text === '/start' || text === '/help') {
                // Check if this chat is already linked
                const chatIdStr = chatId.toString();
                const { data: existingLink } = await supabase
                    .from('user_settings')
                    .select('user_id')
                    .eq('telegram_chat_id', chatIdStr)
                    .single();

                let linkStatus = '';

                if (!existingLink) {
                    // Try to link to an existing user (find user without telegram_chat_id)
                    const { data: unlinkedUser } = await supabase
                        .from('user_settings')
                        .select('id, user_id')
                        .is('telegram_chat_id', null)
                        .limit(1)
                        .single();

                    if (unlinkedUser) {
                        // Link the chat to this user
                        const { error: linkError } = await supabase
                            .from('user_settings')
                            .update({ telegram_chat_id: chatIdStr })
                            .eq('id', unlinkedUser.id);

                        if (!linkError) {
                            console.log(`🔗 [TG] Linked chat ${chatIdStr} to user ${unlinkedUser.user_id}`);
                            linkStatus = `\n\n✅ <b>Telegram підключено!</b> Сповіщення тепер працюють.`;
                        } else {
                            console.error(`❌ [TG] Failed to link chat: ${linkError.message}`);
                            linkStatus = `\n\n⚠️ Не вдалось підключити Telegram автоматично.\nВаш Chat ID: <code>${chatIdStr}</code>`;
                        }
                    } else {
                        // No user to link to - show chat_id for manual linking
                        linkStatus = `\n\n⚠️ Немає користувача для підключення.\nВаш Chat ID: <code>${chatIdStr}</code>`;
                    }
                } else {
                    linkStatus = `\n\n✅ Telegram вже підключено.`;
                }

                // Fetch statistics for the welcome message
                const today = new Date();
                const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                const weekAgoStr = weekAgo.toISOString();

                const { count: totalJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
                const { count: newThisWeek } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('created_at', weekAgoStr);
                const { count: relevantJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('relevance_score', 50);
                const { count: sentApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('status', 'sent');
                const { count: pendingApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).in('status', ['draft', 'approved']);

                await sendTelegram(chatId,
                    `👋 <b>Вітаю в JobBot Norway!</b>\n\n` +
                    `📊 <b>Статистика:</b>\n` +
                    `🏢 Всього вакансій: <b>${totalJobs || 0}</b>\n` +
                    `🆕 Нових за тиждень: <b>${newThisWeek || 0}</b>\n` +
                    `🎯 Релевантних (≥50%): <b>${relevantJobs || 0}</b>\n` +
                    `✅ Відправлено заявок: <b>${sentApps || 0}</b>\n` +
                    `📝 В обробці: <b>${pendingApps || 0}</b>\n\n` +
                    `<b>Команди:</b>\n` +
                    `/scan - Запустити сканування\n` +
                    `/report - Денний звіт\n` +
                    `<code>123456</code> - Ввести код 2FA (просто цифри)\n\n` +
                    `Або просто відправ посилання на FINN.no!${linkStatus}\n\n` +
                    `📊 Dashboard: ${dashboardUrl}`
                );
                return;
            }

            // REPORT
            if (text === '/report') {
                const { count: totalJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
                const today = new Date().toISOString().split('T')[0];
                const { count: newJobs } = await supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('created_at', today);
                const { count: sentApps } = await supabase.from('applications').select('*', { count: 'exact', head: true }).in('status', ['sent', 'manual_review']);
                
                await sendTelegram(chatId, 
                    `📊 <b>Звіт</b>\n\n` +
                    `🏢 Всього вакансій: <b>${totalJobs || 0}</b>\n` +
                    `🆕 Нових сьогодні: <b>${newJobs || 0}</b>\n` +
                    `✅ Відправлено заявок: <b>${sentApps || 0}</b>\n\n` +
                    `🔗 <a href="${dashboardUrl}">Дашборд</a>`
                );
                return;
            }

            // SCAN
            if (text === '/scan') {
                const { data: settings } = await supabase.from('user_settings').select('finn_search_urls, user_id').eq('telegram_chat_id', chatId.toString()).single();

                if (!settings || !settings.finn_search_urls || settings.finn_search_urls.length === 0) {
                    await sendTelegram(chatId, "⚠️ У вас немає збережених URL в налаштуваннях.");
                    return;
                }

                await sendTelegram(chatId, `🚀 <b>Запускаю сканування ${settings.finn_search_urls.length} джерел...</b>`);

                for (const url of settings.finn_search_urls) {
                     await processUrlPipeline(url, chatId, supabase, settings.user_id);
                }
                return;
            }

            // 2FA CODE for FINN login - supports both "/code 123456" and just "123456"
            const isCodeCommand = text.startsWith('/code ') || text.startsWith('/code');
            const isPlainCode = /^\d{4,8}$/.test(text.trim()); // 4-8 digit number

            if (isCodeCommand || isPlainCode) {
                const code = isCodeCommand ? text.replace('/code', '').trim() : text.trim();

                if (!code || code.length < 4) {
                    await sendTelegram(chatId, "⚠️ Код має бути від 4 до 8 цифр.\nПриклад: <code>123456</code>");
                    return;
                }

                console.log(`🔐 [TG] Received 2FA code from ${chatId}: ${code} (plain: ${isPlainCode})`);

                // Find pending auth request for this chat
                // Look for both 'code_requested' (webhook already called) and 'pending' (worker pre-created)
                const { data: authRequest, error: findError } = await supabase
                    .from('finn_auth_requests')
                    .select('*')
                    .eq('telegram_chat_id', chatId.toString())
                    .in('status', ['code_requested', 'pending'])
                    .gt('expires_at', new Date().toISOString())
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (findError || !authRequest) {
                    console.log(`⚠️ [TG] No auth request found for chat ${chatId}. Error: ${findError?.message}`);
                    // Only show warning for /code command, not for plain numbers (might be other number input)
                    if (isCodeCommand) {
                        await sendTelegram(chatId, "⚠️ Немає активних запитів на верифікацію.\nСпочатку запустіть подачу на FINN через дашборд.");
                    }
                    // For plain numbers, silently ignore if no auth request (might be other input)
                    return;
                }

                console.log(`✅ [TG] Found auth request: ${authRequest.id}, status: ${authRequest.status}`);

                // Update with code
                const { error: updateError } = await supabase
                    .from('finn_auth_requests')
                    .update({
                        verification_code: code,
                        status: 'code_received',
                        code_received_at: new Date().toISOString()
                    })
                    .eq('id', authRequest.id);

                if (updateError) {
                    console.error("❌ Error saving code:", updateError);
                    await sendTelegram(chatId, "❌ Помилка збереження коду. Спробуйте ще раз.");
                    return;
                }

                await sendTelegram(chatId, `✅ Код <code>${code}</code> прийнято!\n\n⏳ Очікуйте, Skyvern обробляє...`);
                return;
            }

            // Check for pending registration questions or verification (text answers)
            const chatIdStr = chatId.toString();

            // Check for pending verification (email/sms code for registration)
            const { data: pendingVerification } = await supabase
                .from('registration_flows')
                .select('id, site_name, verification_type')
                .eq('telegram_chat_id', chatIdStr)
                .in('status', ['email_verification', 'sms_verification', 'link_verification'])
                .gt('verification_expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingVerification) {
                console.log(`🔐 [TG] Verification code for registration: ${text}`);

                // Handle "готово" for link verification
                if (pendingVerification.verification_type === 'link_verification' &&
                    text.toLowerCase().includes('готово')) {
                    await supabase
                        .from('registration_flows')
                        .update({
                            verification_code: 'link_confirmed',
                            status: 'registering'
                        })
                        .eq('id', pendingVerification.id);

                    await sendTelegram(chatId,
                        `✅ <b>Підтвердження лінку прийнято!</b>\n\n` +
                        `⏳ Продовжую реєстрацію на ${pendingVerification.site_name}...`
                    );
                    return;
                }

                // Save verification code
                await supabase
                    .from('registration_flows')
                    .update({
                        verification_code: text.trim(),
                        status: 'registering'
                    })
                    .eq('id', pendingVerification.id);

                await sendTelegram(chatId,
                    `✅ <b>Код прийнято!</b>\n\n` +
                    `⏳ Продовжую реєстрацію на ${pendingVerification.site_name}...`
                );
                return;
            }

            // Check for pending field edit (registration confirmation edit flow)
            const { data: pendingFieldEdit } = await supabase
                .from('registration_flows')
                .select('id, pending_edit_field, profile_data_snapshot, site_name')
                .eq('telegram_chat_id', chatIdStr)
                .eq('status', 'editing_field')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (pendingFieldEdit && pendingFieldEdit.pending_edit_field) {
                const flowId = pendingFieldEdit.id;
                const fieldName = pendingFieldEdit.pending_edit_field;
                const newValue = text.trim();
                const siteName = pendingFieldEdit.site_name || 'сайт';

                const fieldLabels: Record<string, string> = {
                    'full_name': "Ім'я",
                    'phone': 'Телефон',
                    'city': 'Місто',
                    'postal_code': 'Поштовий індекс'
                };
                const label = fieldLabels[fieldName] || fieldName;

                console.log(`✏️ [TG] Field edit: ${fieldName} = "${newValue}" for flow ${flowId}`);

                // Update profile data snapshot with new value
                const profileData = pendingFieldEdit.profile_data_snapshot || {};
                profileData[fieldName] = newValue;

                // Also store in edited_profile_data for later use
                await supabase
                    .from('registration_flows')
                    .update({
                        profile_data_snapshot: profileData,
                        edited_profile_data: profileData,
                        pending_edit_field: null,
                        status: 'editing'
                    })
                    .eq('id', flowId);

                // Show updated data with edit buttons
                const pd = profileData;
                const editMsg = (
                    `✅ <b>${label}</b> змінено на: <code>${newValue}</code>\n\n` +
                    `<b>Поточні дані для ${siteName}:</b>\n\n` +
                    `👤 Ім'я: <code>${pd.full_name || '—'}</code>\n` +
                    `📱 Телефон: <code>${pd.phone || '—'}</code>\n` +
                    `🏠 Місто: <code>${pd.city || '—'}</code>\n` +
                    `📮 Індекс: <code>${pd.postal_code || '—'}</code>\n\n` +
                    `Оберіть наступну дію:`
                );

                const editKeyboard = {
                    inline_keyboard: [
                        [
                            { text: "👤 Ім'я", callback_data: `reg_field_${flowId}_full_name` },
                            { text: "📱 Телефон", callback_data: `reg_field_${flowId}_phone` }
                        ],
                        [
                            { text: "🏠 Місто", callback_data: `reg_field_${flowId}_city` },
                            { text: "📮 Індекс", callback_data: `reg_field_${flowId}_postal_code` }
                        ],
                        [
                            { text: "✅ Готово - продовжити", callback_data: `reg_confirm_${flowId}` }
                        ],
                        [
                            { text: "❌ Скасувати", callback_data: `reg_cancel_${flowId}` }
                        ]
                    ]
                };

                await sendTelegram(chatId, editMsg, editKeyboard);
                return;
            }

            // Check for pending registration questions (text input)
            const { data: pendingQuestion } = await supabase
                .from('registration_questions')
                .select('id, flow_id, field_name, question_text')
                .eq('status', 'pending')
                .gt('timeout_at', new Date().toISOString())
                .order('asked_at', { ascending: false })
                .limit(1)
                .single();

            // Need to verify this question belongs to this chat
            if (pendingQuestion) {
                const { data: flow } = await supabase
                    .from('registration_flows')
                    .select('telegram_chat_id, qa_history, site_name')
                    .eq('id', pendingQuestion.flow_id)
                    .single();

                if (flow && flow.telegram_chat_id === chatIdStr) {
                    console.log(`📝 [TG] Text answer for registration question: ${pendingQuestion.id}`);

                    // Update question with answer
                    await supabase
                        .from('registration_questions')
                        .update({
                            status: 'answered',
                            answer: text.trim(),
                            answer_source: 'user_telegram',
                            answered_at: new Date().toISOString()
                        })
                        .eq('id', pendingQuestion.id);

                    // Update flow Q&A history
                    const qaHistory = flow.qa_history || [];
                    qaHistory.push({
                        question: pendingQuestion.question_text,
                        answer: text.trim(),
                        field_name: pendingQuestion.field_name,
                        answered_at: new Date().toISOString()
                    });

                    await supabase
                        .from('registration_flows')
                        .update({
                            status: 'registering',
                            pending_question: null,
                            qa_history: qaHistory
                        })
                        .eq('id', pendingQuestion.flow_id);

                    await sendTelegram(chatId,
                        `✅ <b>Відповідь прийнято!</b>\n\n` +
                        `📝 ${pendingQuestion.question_text}\n` +
                        `✏️ ${text.trim()}\n\n` +
                        `⏳ Продовжую реєстрацію на ${flow.site_name}...`
                    );
                    return;
                }
            }

            // DIRECT LINK
            if (text.includes('finn.no') || text.includes('nav.no')) {
                 const { data: settings } = await supabase.from('user_settings').select('user_id').eq('telegram_chat_id', chatId.toString()).single();
                 if (!settings) {
                    await sendTelegram(chatId, "⚠️ Акаунт не прив'язаний. Зайдіть в налаштування на сайті.");
                    return;
                 }
                 await processUrlPipeline(text, chatId, supabase, settings.user_id);
            }
        }
    } catch (error) {
        console.error("Background Job Error:", error);
    }
}

// --- REUSABLE PIPELINE LOGIC ---
async function processUrlPipeline(url: string, chatId: string, supabase: any, userId: string) {
    const cleanUrl = url.split('?')[0];
    const finnCodeMatch = url.match(/(\d{8,})/);
    const finnCode = finnCodeMatch ? finnCodeMatch[1] : null;

    console.log(`🔎 Processing URL: ${url}`);
    await sendTelegram(chatId, `🔎 Перевіряю базу даних...`);

    let job = null;

    // 1. CHECK IF JOB EXISTS
    if (finnCode) {
        const { data: byCode } = await supabase.from('jobs').select('*').ilike('job_url', `%${finnCode}%`).limit(1);
        if (byCode && byCode.length > 0) job = byCode[0];
    }
    if (!job) {
        const { data: byUrl } = await supabase.from('jobs').select('*').eq('job_url', url).limit(1);
        if (byUrl && byUrl.length > 0) job = byUrl[0];
    }
    if (!job) {
         const { data: byClean } = await supabase.from('jobs').select('*').ilike('job_url', `${cleanUrl}%`).limit(1);
         if (byClean && byClean.length > 0) job = byClean[0];
    }

    if (job) {
        await sendTelegram(chatId, `ℹ️ <b>Знайдено в архіві!</b> (Дата: ${new Date(job.created_at).toLocaleDateString()})`);
    } 
    
    // 2. SCRAPE NEW
    if (!job) {
        if (url.includes('/ad/') || url.includes('/stilling/')) {
            await sendTelegram(chatId, `⏳ Вакансія нова. Запускаю сканування...`);
            try {
                const res = await fetch(url, { 
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    } 
                });
                
                if (res.status === 403 || res.status === 401) {
                     await sendTelegram(chatId, `⚠️ Сайт блокує доступ.`);
                     const { data: minJob } = await supabase.from('jobs').insert({
                        job_url: url, title: 'Manual Check Required', company: 'FINN.no', location: 'Unknown', description: '',
                        source: 'FINN', user_id: userId, status: 'NEW'
                     }).select().single();
                     if (minJob) job = minJob;
                } else {
                    const html = await res.text();
                    const $ = cheerio.load(html);
                    const title = $('h1').first().text().trim() || $('title').text().split('-')[0].trim();
                    let company = $('h1').next('p').text().trim();
                    if (!company) company = $('a[data-testid="company-name"]').text().trim() || 'Unknown Company';
                    const location = $('span[data-testid="location"]').text() || '';
                    const description = $('div[data-testid="job-description-text"]').text() || $('.import_decoration').text() || $('section[aria-label="Jobbbeskrivelse"]').text() || '';

                    if (title) {
                        const { data: newJob } = await supabase.from('jobs').insert({
                            job_url: url, title, company, location, description,
                            source: 'FINN', user_id: userId, status: 'NEW'
                        }).select().single();
                        if (newJob) job = newJob;
                    }
                }
            } catch (e) {
                await sendTelegram(chatId, `⚠️ Помилка мережі.`);
                return;
            }
        } else {
            const { data: scrapeData } = await supabase.functions.invoke('job-scraper', {
                body: { searchUrl: url, userId: userId }
            });
            if (scrapeData?.success && scrapeData.jobs.length > 0) {
                await sendTelegram(chatId, `✅ Знайдено ${scrapeData.jobs.length} вакансій. Перевірте Дашборд.`);
                return; 
            }
        }
    }

    if (!job) {
        await sendTelegram(chatId, "⚠️ Не вдалося завантажити вакансію.");
        return;
    }

    // MSG 1: BASIC INFO + FORM TYPE
    const formTypeInfo = formatFormType(job);
    await sendTelegram(chatId, `🏢 <b>${job.title}</b>\n🏢 ${job.company}\n📍 ${job.location}\n\n${formTypeInfo}\n\n🔗 <a href="${job.job_url}">Оригінал вакансії</a>`);

    // MSG 2: ANALYZE
    if (job.status === 'ANALYZED' && job.relevance_score !== null) {
        const score = job.relevance_score || 0;
        const emoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
        
        // Added Tasks Summary to Message
        const tasksSection = job.tasks_summary 
            ? `\n\n📋 <b>Що робити (Обов'язки):</b>\n${job.tasks_summary}` 
            : "";

        await sendTelegram(chatId, `🤖 <b>AI Аналіз (Cached)</b>\n📊 <b>${score}/100</b> ${emoji}${tasksSection}\n\n💬 ${job.ai_recommendation?.substring(0, 300)}...`);
    } else {
        await sendTelegram(chatId, `🤖 Аналізую релевантність та обов'язки...`);
        const { data: analyzeRes } = await supabase.functions.invoke('job-analyzer', { body: { jobIds: [job.id], userId: userId } });
        
        if (analyzeRes?.success) {
            const { data: analyzed } = await supabase.from('jobs').select('*').eq('id', job.id).single();
            job = analyzed;
            const score = job.relevance_score || 0;
            const emoji = score >= 70 ? '🟢' : score >= 40 ? '🟡' : '🔴';
            
            // Added Tasks Summary to Message
            const tasksSection = job.tasks_summary 
                ? `\n\n📋 <b>Що робити (Обов'язки):</b>\n${job.tasks_summary}` 
                : "";

            await sendTelegram(chatId, `🤖 <b>AI Аналіз (Новий)</b>\n📊 <b>${score}/100</b> ${emoji}${tasksSection}\n\n💬 ${job.ai_recommendation?.substring(0, 300)}...`);
        } else {
            await sendTelegram(chatId, `⚠️ Помилка аналізу.`);
        }
    }

    // MSG 3: ACTIONS
    const { data: existingApp } = await supabase.from('applications').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    let statusMsg = "";
    const buttons = [];

    if (!existingApp) {
        statusMsg = "❌ <b>Søknad не створено</b>";
        buttons.push({ text: "✍️ Написати Søknad", callback_data: `write_app_${job.id}` });
    } else {
        switch (existingApp.status) {
            case 'draft':
                statusMsg = "📝 <b>Є чернетка</b>";
                buttons.push({ text: "📂 Показати Søknad", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'approved':
                statusMsg = "✅ <b>Затверджено</b>";
                buttons.push({ text: "🚀 Відправити / Показати", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'sending':
                statusMsg = "⏳ <b>Відправляється...</b>";
                buttons.push({ text: "📂 Переглянути", callback_data: `view_app_${existingApp.id}` });
                break;
            case 'sent':
                statusMsg = "📬 <b>Вже відправлено</b>";
                buttons.push({ text: "📂 Показати", callback_data: `view_app_${existingApp.id}` });
                break;
            default:
                statusMsg = `Статус: ${existingApp.status}`;
                buttons.push({ text: "📂 Відкрити", callback_data: `view_app_${existingApp.id}` });
        }
    }

    await sendTelegram(chatId, `👇 <b>Дії:</b>\n${statusMsg}`, { inline_keyboard: [buttons] });
}

serve(async (req: Request) => {
  console.log(`📥 [TG] Incoming ${req.method} request`);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const update = await req.json();
    console.log(`📥 [TG] Update received:`, JSON.stringify(update).substring(0, 300));

    if (update.message && update.message.date) {
        const msgAge = Math.floor(Date.now() / 1000) - update.message.date;
        console.log(`📥 [TG] Message age: ${msgAge} seconds`);
        if (msgAge > 120) {
            console.log(`⏭️ [TG] Skipping old message`);
            return new Response(JSON.stringify({ success: true, skipped: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
    }

    if (update.callback_query) {
        console.log(`🔘 [TG] Callback query: ${update.callback_query.data}`);
        await answerCallback(update.callback_query.id);
    }

    // CRITICAL: Do NOT await - respond to Telegram immediately!
    // Supabase Edge Functions (Deno Deploy) continue execution after response is sent.
    // This prevents "Read timeout expired" errors from Telegram webhook.
    console.log(`🚀 [TG] Starting background job (non-blocking)`);
    runBackgroundJob(update).catch(e => console.error(`❌ [TG] Background job error:`, e));

    // Return immediately - Telegram needs response within ~5 seconds
    console.log(`✅ [TG] Responding to Telegram immediately`);
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error(`❌ [TG] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});