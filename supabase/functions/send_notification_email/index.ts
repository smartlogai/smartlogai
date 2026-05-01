import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.10.0";

type NotifyPayload = {
  notification_id?: string;
  to_user_id?: string;
  to_user_name?: string;
  from_user_id?: string;
  from_user_name?: string;
  type?: string;
  entry_id?: string;
  entry_summary?: string;
  message?: string;
  target_menu?: string;
  channel?: string;
  invoice_html?: string;
  invoice_summary_text?: string;
};

const EMAIL_TYPES = new Set([
  "project_registered_final_approved",
  "project_output_publish_request",
  "project_output_access_request",
  "project_output_bulk_access_alert",
  "project_clearance_notice",
  "helpdesk_new_ticket",
  "project_invoice_request",
]);

const TYPE_LABEL: Record<string, string> = {
  project_registered_final_approved: "프로젝트 최종승인",
  project_output_publish_request: "결과보고서 게시요청",
  project_output_access_request: "결과물 접근신청",
  project_output_bulk_access_alert: "결과물 대량접근 알림",
  project_clearance_notice: "통관 유의사항",
  helpdesk_new_ticket: "Helpdesk 신규 접수",
  project_invoice_request: "고객청구서 발행요청",
};

function pickOrigin(req: Request) {
  const reqOrigin = req.headers.get("origin") || "";
  const allowed = Deno.env.get("ALLOWED_ORIGIN") || "*";
  if (allowed === "*") return "*";
  if (!reqOrigin) return allowed;
  return reqOrigin === allowed ? reqOrigin : allowed;
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": pickOrigin(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function buildMail(payload: NotifyPayload) {
  const type = String(payload.type || "").trim();
  const label = TYPE_LABEL[type] || type || "알림";
  const toName = String(payload.to_user_name || "").trim() || "수신자";
  const fromName = String(payload.from_user_name || "").trim() || "시스템";
  const summary = String(payload.entry_summary || "").trim();
  const body = String(payload.message || "").trim();
  const targetMenu = String(payload.target_menu || "").trim();
  const invoiceHtml = String(payload.invoice_html || "").trim();
  const invoiceSummaryText = String(payload.invoice_summary_text || "").trim();

  const subject = `[SmartLog] ${label}`;
  const html = [
    `<h2 style="margin:0 0 12px 0;font-size:18px">SmartLog 알림: ${label}</h2>`,
    `<p style="margin:0 0 8px 0"><strong>수신자:</strong> ${toName}</p>`,
    `<p style="margin:0 0 8px 0"><strong>발신:</strong> ${fromName}</p>`,
    summary ? `<p style="margin:0 0 8px 0"><strong>요약:</strong> ${summary}</p>` : "",
    `<div style="margin:12px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px;white-space:pre-wrap">${body || "-"}</div>`,
    invoiceHtml ? `<div style="margin:12px 0">${invoiceHtml}</div>` : "",
    targetMenu ? `<p style="margin:0;color:#6b7280;font-size:12px">화면 이동 키: ${targetMenu}</p>` : "",
  ].filter(Boolean).join("");

  const text = [
    `SmartLog 알림: ${label}`,
    `수신자: ${toName}`,
    `발신: ${fromName}`,
    summary ? `요약: ${summary}` : "",
    "",
    body || "-",
    invoiceSummaryText ? "[고객청구서 본문]" : "",
    invoiceSummaryText || "",
    targetMenu ? `화면 이동 키: ${targetMenu}` : "",
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const EMAIL_ENABLED = (Deno.env.get("EMAIL_ENABLED") || "true").toLowerCase() === "true";
    if (!EMAIL_ENABLED) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "email_disabled" }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const MAIL_HOST = Deno.env.get("MAIL_HOST") || "";
    const MAIL_PORT = Number(Deno.env.get("MAIL_PORT") || "465");
    const MAIL_SSL_ENABLE = (Deno.env.get("MAIL_SSL_ENABLE") || "true").toLowerCase() === "true";
    const MAIL_AUTH = (Deno.env.get("MAIL_AUTH") || "true").toLowerCase() === "true";
    const MAIL_PROTOCOL = String(Deno.env.get("MAIL_PROTOCOL") || "smtp").toLowerCase();
    const MAIL_ID = Deno.env.get("MAIL_ID") || "";
    const MAIL_PW = Deno.env.get("MAIL_PW") || "";
    const SEND_NAME = Deno.env.get("SEND_NAME") || "SmartLog";
    const SEND_EMAIL = Deno.env.get("SEND_EMAIL") || MAIL_ID;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, code: "supabase_env_missing", message: "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 누락" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (MAIL_PROTOCOL !== "smtp") {
      return new Response(JSON.stringify({ ok: false, code: "protocol_not_supported", message: "현재는 MAIL_PROTOCOL=smtp만 지원합니다." }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (!MAIL_HOST || !MAIL_PORT || !MAIL_ID || !MAIL_PW || !SEND_EMAIL) {
      return new Response(JSON.stringify({
        ok: false,
        code: "mail_env_missing",
        message: "MAIL_HOST/MAIL_PORT/MAIL_ID/MAIL_PW/SEND_EMAIL 환경변수를 확인하세요.",
      }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const payload = (await req.json().catch(() => ({}))) as NotifyPayload;
    const type = String(payload.type || "").trim();
    const toUserId = String(payload.to_user_id || "").trim();
    if (!type || !EMAIL_TYPES.has(type)) {
      return new Response(JSON.stringify({ ok: false, code: "type_not_allowed", message: "메일 발송 허용 타입이 아닙니다." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (!toUserId) {
      return new Response(JSON.stringify({ ok: false, code: "missing_to_user_id", message: "to_user_id가 필요합니다." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: userRow, error: userErr } = await sb
      .from("users")
      .select("id,name,email")
      .eq("id", toUserId)
      .maybeSingle();
    if (userErr) {
      return new Response(JSON.stringify({ ok: false, code: "user_lookup_failed", message: userErr.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const toEmail = String(userRow?.email || "").trim();
    if (!toEmail) {
      return new Response(JSON.stringify({ ok: false, code: "recipient_not_found", message: "수신자 이메일을 찾을 수 없습니다." }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const mail = buildMail({
      ...payload,
      to_user_name: String(userRow?.name || payload.to_user_name || ""),
    });

    const transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: MAIL_SSL_ENABLE,
      auth: MAIL_AUTH ? { user: MAIL_ID, pass: MAIL_PW } : undefined,
    });
    let sendInfo: { messageId?: string } | null = null;
    try {
      sendInfo = await transporter.sendMail({
        from: `${SEND_NAME} <${SEND_EMAIL}>`,
        to: toEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    } catch (smtpErr) {
      return new Response(JSON.stringify({
        ok: false,
        code: "provider_send_failed",
        message: smtpErr instanceof Error ? smtpErr.message : String(smtpErr),
        provider: "mailplug_smtp",
      }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      provider: "mailplug_smtp",
      type,
      message_id: String(sendInfo?.messageId || ""),
      to_email: toEmail,
      notification_id: String(payload.notification_id || ""),
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      code: "unexpected_error",
      message: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});

