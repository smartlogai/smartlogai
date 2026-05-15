import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type PushAction = "config" | "register_subscription" | "send";

type PushPayload = {
  action?: PushAction;
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
  user_agent?: string;
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

const TYPE_LABEL: Record<string, string> = {
  submitted: "승인 요청",
  pre_approved: "1차 승인",
  approved: "최종 승인",
  rejected: "반려",
  project_registered_final_approved: "프로젝트 최종승인",
  project_output_publish_request: "결과보고서 게시요청",
  project_output_access_request: "결과물 접근신청",
  project_output_access_decision: "결과물 신청결과",
  project_output_bulk_access_alert: "결과물 대량접근 알림",
  project_clearance_notice: "통관 유의사항",
  helpdesk_new_ticket: "Help Desk 접수",
  helpdesk_status_updated: "Help Desk 업데이트",
  helpdesk_comment: "Help Desk 코멘트",
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

function getEnv() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const WEBPUSH_VAPID_PUBLIC_KEY = Deno.env.get("WEBPUSH_VAPID_PUBLIC_KEY") || "";
  const WEBPUSH_VAPID_PRIVATE_KEY = Deno.env.get("WEBPUSH_VAPID_PRIVATE_KEY") || "";
  const WEBPUSH_SUBJECT = Deno.env.get("WEBPUSH_SUBJECT") || "mailto:admin@hjcustoms.co.kr";
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    WEBPUSH_VAPID_PUBLIC_KEY,
    WEBPUSH_VAPID_PRIVATE_KEY,
    WEBPUSH_SUBJECT,
  };
}

function nowMs() {
  return Date.now();
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
    const payload = (await req.json().catch(() => ({}))) as PushPayload;
    const action = String(payload.action || "").trim() as PushAction;
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({
        ok: false,
        code: "supabase_env_missing",
        message: "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 누락",
      }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "config") {
      return new Response(JSON.stringify({
        ok: true,
        vapid_public_key: env.WEBPUSH_VAPID_PUBLIC_KEY,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (action === "register_subscription") {
      const toUserId = String(payload.to_user_id || "").trim();
      const endpoint = String(payload.subscription?.endpoint || "").trim();
      const p256dh = String(payload.subscription?.keys?.p256dh || "").trim();
      const auth = String(payload.subscription?.keys?.auth || "").trim();
      const userAgent = String(payload.user_agent || "").trim();

      if (!toUserId || !endpoint || !p256dh || !auth) {
        return new Response(JSON.stringify({
          ok: false,
          code: "invalid_subscription",
          message: "to_user_id 또는 구독 정보(endpoint/keys)가 누락되었습니다.",
        }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const { error: upErr } = await sb.from("push_subscriptions").upsert({
        to_user_id: toUserId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        is_active: true,
        updated_at: nowMs(),
      }, { onConflict: "endpoint" });
      if (upErr) {
        return new Response(JSON.stringify({
          ok: false,
          code: "upsert_failed",
          message: upErr.message,
        }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (action === "send") {
      if (!env.WEBPUSH_VAPID_PUBLIC_KEY || !env.WEBPUSH_VAPID_PRIVATE_KEY) {
        return new Response(JSON.stringify({
          ok: false,
          code: "vapid_env_missing",
          message: "WEBPUSH_VAPID_PUBLIC_KEY 또는 WEBPUSH_VAPID_PRIVATE_KEY 누락",
        }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }

      webpush.setVapidDetails(
        env.WEBPUSH_SUBJECT,
        env.WEBPUSH_VAPID_PUBLIC_KEY,
        env.WEBPUSH_VAPID_PRIVATE_KEY,
      );

      const toUserId = String(payload.to_user_id || "").trim();
      if (!toUserId) {
        return new Response(JSON.stringify({
          ok: false,
          code: "missing_to_user_id",
          message: "to_user_id가 필요합니다.",
        }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const { data: subs, error: subErr } = await sb
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("to_user_id", toUserId)
        .eq("is_active", true);
      if (subErr) {
        return new Response(JSON.stringify({
          ok: false,
          code: "subscription_lookup_failed",
          message: subErr.message,
        }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const { count: unreadCount } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("to_user_id", toUserId)
        .eq("is_read", false);

      const title = `Smart Log AI · ${TYPE_LABEL[String(payload.type || "")] || "알림"}`;
      const body = String(payload.message || "").trim() || "새 알림이 도착했습니다.";
      const pushData = {
        title,
        body,
        tag: `smartlog-${String(payload.type || "notice")}`,
        url: "/main.html",
        target_menu: String(payload.target_menu || "").trim(),
        entry_id: String(payload.entry_id || "").trim(),
        badge_count: Number(unreadCount || 0),
      };

      const list = Array.isArray(subs) ? subs : [];
      let success = 0;
      let failed = 0;
      for (const s of list) {
        const endpoint = String(s.endpoint || "").trim();
        const p256dh = String(s.p256dh || "").trim();
        const auth = String(s.auth || "").trim();
        if (!endpoint || !p256dh || !auth) continue;
        try {
          await webpush.sendNotification({
            endpoint,
            keys: { p256dh, auth },
          }, JSON.stringify(pushData));
          success += 1;
          await sb
            .from("push_subscriptions")
            .update({ last_sent_at: nowMs(), updated_at: nowMs() })
            .eq("id", s.id);
        } catch (err) {
          failed += 1;
          const code = Number((err as { statusCode?: number })?.statusCode || 0);
          if (code === 404 || code === 410) {
            await sb.from("push_subscriptions").update({
              is_active: false,
              updated_at: nowMs(),
            }).eq("id", s.id);
          }
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        sent: success,
        failed,
        total: list.length,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: false,
      code: "invalid_action",
      message: "action은 config/register_subscription/send 중 하나여야 합니다.",
    }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      code: "unexpected_error",
      message: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
