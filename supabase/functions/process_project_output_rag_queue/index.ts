import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type QueueRow = {
  id: string;
  seed_id: string;
  output_id: string;
  status: string;
};

type SeedRow = {
  id: string;
  output_id: string;
  title: string;
  summary: string;
  source_kind: string;
  output_type: string;
  main_category: string;
  sub_category: string;
  project_code: string;
};

type ReqPayload = {
  limit?: number;
  dry_run?: boolean;
  job_ids?: string[];
};

function nowMs() {
  return Date.now();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function splitIntoChunks(text: string, maxChars = 1200, overlap = 120): string[] {
  const src = String(text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!src) return [];
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const end = Math.min(i + maxChars, src.length);
    let cut = end;
    if (end < src.length) {
      const nearestBreak = Math.max(
        src.lastIndexOf("\n", end),
        src.lastIndexOf(". ", end),
        src.lastIndexOf("。", end),
      );
      if (nearestBreak > i + Math.floor(maxChars * 0.55)) cut = nearestBreak + 1;
    }
    const chunk = src.slice(i, cut).trim();
    if (chunk) out.push(chunk);
    i = Math.max(cut - overlap, cut);
    if (i >= src.length) break;
  }
  return out;
}

function estimateTokens(text: string) {
  // 대략치: 한글/영문 혼합 환경에서 1토큰 ~= 2.5~3.5 chars
  return Math.max(1, Math.round(String(text || "").length / 3));
}

async function embedWithOpenAI(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small";
  if (!apiKey) return null;
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`openai_embedding_failed: ${resp.status} ${t}`);
  }
  const json = await resp.json();
  const vec = json?.data?.[0]?.embedding;
  return Array.isArray(vec) ? vec.map((x: unknown) => Number(x || 0)) : null;
}

function buildDocText(seed: SeedRow) {
  const lines = [
    `제목: ${seed.title || ""}`,
    `유형: ${seed.output_type || seed.source_kind || ""}`,
    seed.project_code ? `프로젝트코드: ${seed.project_code}` : "",
    seed.main_category ? `대분류: ${seed.main_category}` : "",
    seed.sub_category ? `소분류: ${seed.sub_category}` : "",
    "",
    seed.summary || "",
  ].filter(Boolean);
  return lines.join("\n").trim();
}

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

serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ ok: false, code: "env_missing", message: "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY 누락" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const payload = (await req.json().catch(() => ({}))) as ReqPayload;
    const limit = clamp(Number(payload.limit || 10), 1, 50);
    const dryRun = !!payload.dry_run;
    const jobIds = (payload.job_ids || []).map((v) => String(v || "").trim()).filter(Boolean);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let q = sb
      .from("project_output_rag_index_queue")
      .select("id,seed_id,output_id,status")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (jobIds.length) q = q.in("id", jobIds);

    const { data: jobs, error: jobsErr } = await q;
    if (jobsErr) throw jobsErr;
    const queueRows = (jobs || []) as QueueRow[];

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        queued: queueRows.length,
        jobs: queueRows.map((j) => ({ id: j.id, seed_id: j.seed_id, output_id: j.output_id })),
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const results: Array<{ id: string; status: string; chunks?: number; error?: string }> = [];
    for (const job of queueRows) {
      const jobId = String(job.id || "").trim();
      try {
        const startedAt = nowMs();
        await sb.from("project_output_rag_index_queue").update({
          status: "processing",
          error_message: "",
          updated_at: startedAt,
        }).eq("id", jobId);

        const { data: seedData, error: seedErr } = await sb
          .from("project_output_rag_seeds")
          .select("id,output_id,title,summary,source_kind,output_type,main_category,sub_category,project_code")
          .eq("id", job.seed_id)
          .maybeSingle();
        if (seedErr) throw seedErr;
        const seed = seedData as SeedRow | null;
        if (!seed) throw new Error("seed_not_found");

        const text = buildDocText(seed);
        if (!text) throw new Error("seed_text_empty");
        const chunks = splitIntoChunks(text, 1200, 120);
        if (!chunks.length) throw new Error("chunking_empty");

        await sb.from("project_output_rag_chunks").delete().eq("output_id", seed.output_id);

        const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small";
        for (let idx = 0; idx < chunks.length; idx += 1) {
          const chunkText = chunks[idx];
          let embedding: number[] | null = null;
          try {
            embedding = await embedWithOpenAI(chunkText);
          } catch (embErr) {
            console.warn("[rag-queue] embedding fallback(null)", embErr);
          }
          const insertPayload = {
            output_id: String(seed.output_id || ""),
            seed_id: String(seed.id || ""),
            chunk_index: idx + 1,
            chunk_text: chunkText,
            token_estimate: estimateTokens(chunkText),
            embedding_model: embedding ? model : "",
            embedding_values: embedding,
            metadata: {
              source_kind: seed.source_kind || "",
              output_type: seed.output_type || "",
              main_category: seed.main_category || "",
              sub_category: seed.sub_category || "",
              project_code: seed.project_code || "",
            },
            created_at: nowMs(),
            updated_at: nowMs(),
          };
          const { error: insErr } = await sb.from("project_output_rag_chunks").insert(insertPayload);
          if (insErr) throw insErr;
        }

        await sb.from("project_output_rag_seeds").update({
          rag_status: "indexed",
          updated_at: nowMs(),
        }).eq("id", seed.id);

        await sb.from("project_output_rag_index_queue").update({
          status: "done",
          error_message: "",
          updated_at: nowMs(),
        }).eq("id", jobId);

        results.push({ id: jobId, status: "done", chunks: chunks.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sb.from("project_output_rag_index_queue").update({
          status: "failed",
          error_message: msg.slice(0, 500),
          updated_at: nowMs(),
        }).eq("id", jobId);
        if (job.seed_id) {
          await sb.from("project_output_rag_seeds").update({
            rag_status: "failed",
            updated_at: nowMs(),
          }).eq("id", job.seed_id);
        }
        results.push({ id: jobId, status: "failed", error: msg });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      requested_limit: limit,
      picked_jobs: queueRows.length,
      done: results.filter((r) => r.status === "done").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      code: "unexpected_error",
      message: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
