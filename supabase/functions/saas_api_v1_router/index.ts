// GEOPERF SaaS — saas_api_v1_router (API publique Agency)
// Spec : SPRINTS_S8_S9_S10_PLAN.md S10.4
//
// Auth : header `Authorization: Bearer gp_live_<24 hex>`
// Rate limit : 60 req/min/key (saas_api_calls + count helper SQL)
// Tier : Agency only (vérifié sur le user_id de la clé)
//
// Endpoints (REST, suffixe après /functions/v1/saas_api_v1_router) :
//   GET /v1/brands                                 → list user's brands
//   GET /v1/brands/:id                             → brand detail (latest snapshot stats)
//   GET /v1/brands/:id/snapshots?limit=50          → list snapshots
//   GET /v1/brands/:id/snapshots/:sid              → snapshot detail (responses summary)
//   GET /v1/brands/:id/recommendations             → list recos
//   GET /v1/brands/:id/alerts                      → list alerts
//   POST /v1/brands/:id/snapshots                  → trigger snapshot (write scope)
//
// Réponses : { ok: bool, data?: any, error?: string, request_id?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? SUPABASE_SERVICE_ROLE_KEY;
const RATE_LIMIT_PER_MIN = 60;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  scopes: string[];
  revoked_at: string | null;
  use_count: number;
}

async function authenticateApiKey(authHeader: string | null): Promise<{ key: ApiKeyRow; tier: string } | { error: string; status: number }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return { error: "Missing Bearer token", status: 401 };
  const fullKey = authHeader.slice("Bearer ".length).trim();
  if (!fullKey.startsWith("gp_live_")) return { error: "Invalid key format. Expected gp_live_<hex>.", status: 401 };

  const hash = await sha256Hex(fullKey);
  const { data: keyRow } = await admin
    .from("saas_api_keys")
    .select("id, user_id, scopes, revoked_at, use_count")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!keyRow) return { error: "Invalid API key", status: 401 };
  if ((keyRow as any).revoked_at) return { error: "API key revoked", status: 401 };

  // Tier-gate Agency
  const { data: sub } = await admin
    .from("saas_subscriptions").select("tier")
    .eq("user_id", (keyRow as any).user_id).in("status", ["active", "trialing"]).maybeSingle();
  const tier = (sub as any)?.tier ?? "free";
  if (tier !== "agency") {
    return { error: "API access requires Agency tier", status: 403 };
  }
  return { key: keyRow as ApiKeyRow, tier };
}

async function checkRateLimit(apiKeyId: string): Promise<{ ok: boolean; count: number }> {
  const { data } = await admin.rpc("saas_api_calls_count_last_minute", { p_api_key_id: apiKeyId });
  const count = Number(data ?? 0);
  return { ok: count < RATE_LIMIT_PER_MIN, count };
}

async function logCall(opts: { apiKeyId: string; userId: string; endpoint: string; status: number; durationMs: number; ip: string | null; }): Promise<void> {
  await admin.from("saas_api_calls").insert({
    api_key_id: opts.apiKeyId,
    user_id: opts.userId,
    endpoint: opts.endpoint,
    status_code: opts.status,
    duration_ms: opts.durationMs,
    ip_address: opts.ip,
  });
  // Update last_used_at + use_count
  await admin.from("saas_api_keys").update({
    last_used_at: new Date().toISOString(),
    use_count: opts.status >= 200 && opts.status < 300
      ? undefined  // incremented via RPC trick (skip if we can't)
      : undefined,
  }).eq("id", opts.apiKeyId);
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

// Route matching helpers
function matchPath(pathname: string): { route: string; params: Record<string, string> } | null {
  // Strip /functions/v1/saas_api_v1_router prefix
  const stripped = pathname.replace(/^\/functions\/v1\/saas_api_v1_router/, "") || "/";
  const trimmed = stripped.replace(/\/$/, "") || "/";

  if (trimmed === "/v1/brands") return { route: "GET /v1/brands", params: {} };
  let m = trimmed.match(/^\/v1\/brands\/([0-9a-f-]{36})$/i);
  if (m) return { route: "GET /v1/brands/:id", params: { id: m[1] } };
  m = trimmed.match(/^\/v1\/brands\/([0-9a-f-]{36})\/snapshots$/i);
  if (m) return { route: "GET /v1/brands/:id/snapshots", params: { id: m[1] } };
  m = trimmed.match(/^\/v1\/brands\/([0-9a-f-]{36})\/snapshots\/([0-9a-f-]{36})$/i);
  if (m) return { route: "GET /v1/brands/:id/snapshots/:sid", params: { id: m[1], sid: m[2] } };
  m = trimmed.match(/^\/v1\/brands\/([0-9a-f-]{36})\/recommendations$/i);
  if (m) return { route: "GET /v1/brands/:id/recommendations", params: { id: m[1] } };
  m = trimmed.match(/^\/v1\/brands\/([0-9a-f-]{36})\/alerts$/i);
  if (m) return { route: "GET /v1/brands/:id/alerts", params: { id: m[1] } };
  return null;
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const url = new URL(req.url);
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? null;

  // Auth
  const authResult = await authenticateApiKey(req.headers.get("authorization"));
  if ("error" in authResult) {
    return jsonResponse({ ok: false, error: authResult.error }, authResult.status);
  }
  const { key, tier } = authResult;

  // Rate limit
  const rate = await checkRateLimit(key.id);
  if (!rate.ok) {
    return jsonResponse({
      ok: false,
      error: "Rate limit exceeded",
      hint: `${RATE_LIMIT_PER_MIN} req/min`,
      current: rate.count,
    }, 429, { "Retry-After": "60" });
  }

  const matched = matchPath(url.pathname);
  const method = req.method.toUpperCase();
  const endpointKey = `${method} ${matched?.route?.replace(/^GET /, "") ?? url.pathname}`;

  let status = 200;
  let respBody: unknown = { ok: true };

  try {
    if (!matched && !(method === "POST" && url.pathname.match(/^\/functions\/v1\/saas_api_v1_router\/v1\/brands\/[0-9a-f-]{36}\/snapshots/i))) {
      status = 404;
      respBody = { ok: false, error: "Endpoint not found", hint: "See /saas/api-docs" };
    } else if (method === "GET" && matched?.route === "GET /v1/brands") {
      const { data } = await admin.from("saas_tracked_brands")
        .select("id, name, domain, category_slug, cadence, is_active, created_at, brand_keywords, brand_value_props")
        .eq("user_id", key.user_id)
        .order("created_at", { ascending: false });
      respBody = { ok: true, data: data ?? [] };
    } else if (method === "GET" && matched?.route === "GET /v1/brands/:id") {
      const { data: brand } = await admin.from("saas_tracked_brands")
        .select("id, name, domain, category_slug, cadence, is_active, created_at, brand_description, brand_keywords, brand_value_props, competitor_domains")
        .eq("id", matched.params.id).eq("user_id", key.user_id).maybeSingle();
      if (!brand) { status = 404; respBody = { ok: false, error: "Brand not found" }; }
      else {
        const { data: latest } = await admin.from("saas_brand_snapshots")
          .select("id, status, visibility_score, avg_rank, citation_rate, share_of_voice, avg_sentiment_score, alignment_score, created_at, completed_at")
          .eq("brand_id", matched.params.id).eq("status", "completed")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        respBody = { ok: true, data: { brand, latest_snapshot: latest } };
      }
    } else if (method === "GET" && matched?.route === "GET /v1/brands/:id/snapshots") {
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10) || 50));
      const { data: brand } = await admin.from("saas_tracked_brands")
        .select("id").eq("id", matched.params.id).eq("user_id", key.user_id).maybeSingle();
      if (!brand) { status = 404; respBody = { ok: false, error: "Brand not found" }; }
      else {
        const { data } = await admin.from("saas_brand_snapshots")
          .select("id, topic_id, status, llms_used, prompts_count, visibility_score, avg_rank, citation_rate, share_of_voice, avg_sentiment_score, alignment_score, total_cost_usd, raw_response_count, created_at, completed_at, error_message")
          .eq("brand_id", matched.params.id)
          .order("created_at", { ascending: false }).limit(limit);
        respBody = { ok: true, data: data ?? [] };
      }
    } else if (method === "GET" && matched?.route === "GET /v1/brands/:id/snapshots/:sid") {
      const { data: snap } = await admin.from("saas_brand_snapshots")
        .select("id, brand_id, user_id, topic_id, status, llms_used, prompts_count, visibility_score, avg_rank, citation_rate, share_of_voice, avg_sentiment_score, sentiment_distribution, alignment_score, alignment_gaps, total_cost_usd, raw_response_count, created_at, completed_at, error_message")
        .eq("id", matched.params.sid).eq("brand_id", matched.params.id).maybeSingle();
      if (!snap || (snap as any).user_id !== key.user_id) {
        status = 404; respBody = { ok: false, error: "Snapshot not found" };
      } else {
        const { data: responses } = await admin.from("saas_snapshot_responses")
          .select("id, llm, prompt_text, brand_mentioned, brand_rank, sentiment, sentiment_score, competitors_mentioned, sources_cited, cost_usd, latency_ms")
          .eq("snapshot_id", matched.params.sid);
        respBody = { ok: true, data: { snapshot: snap, responses: responses ?? [] } };
      }
    } else if (method === "GET" && matched?.route === "GET /v1/brands/:id/recommendations") {
      const { data: brand } = await admin.from("saas_tracked_brands")
        .select("id").eq("id", matched.params.id).eq("user_id", key.user_id).maybeSingle();
      if (!brand) { status = 404; respBody = { ok: false, error: "Brand not found" }; }
      else {
        const { data } = await admin.from("saas_recommendations")
          .select("id, snapshot_id, priority, category, title, body, authority_sources, is_read, created_at")
          .eq("brand_id", matched.params.id)
          .order("created_at", { ascending: false }).limit(50);
        respBody = { ok: true, data: data ?? [] };
      }
    } else if (method === "GET" && matched?.route === "GET /v1/brands/:id/alerts") {
      const { data } = await admin.from("saas_alerts")
        .select("id, snapshot_id, alert_type, severity, title, body, metadata, is_read, email_sent_at, created_at")
        .eq("brand_id", matched.params.id).eq("user_id", key.user_id)
        .order("created_at", { ascending: false }).limit(100);
      respBody = { ok: true, data: data ?? [] };
    } else if (method === "POST" && url.pathname.match(/\/v1\/brands\/[0-9a-f-]{36}\/snapshots$/i)) {
      // POST /v1/brands/:id/snapshots → trigger snapshot (scope=write)
      const m = url.pathname.match(/\/v1\/brands\/([0-9a-f-]{36})\/snapshots$/i);
      if (!m) { status = 400; respBody = { ok: false, error: "Bad path" }; }
      else if (!key.scopes.includes("write")) {
        status = 403; respBody = { ok: false, error: "API key lacks 'write' scope" };
      } else {
        const brandId = m[1];
        const { data: brand } = await admin.from("saas_tracked_brands")
          .select("id, user_id, is_active").eq("id", brandId).maybeSingle();
        if (!brand || (brand as any).user_id !== key.user_id) {
          status = 404; respBody = { ok: false, error: "Brand not found" };
        } else if (!(brand as any).is_active) {
          status = 400; respBody = { ok: false, error: "Brand inactive" };
        } else {
          let body: { topic_id?: string } = {};
          try { body = await req.json(); } catch { /* empty body OK */ }
          const triggerResp = await fetch(`${SUPABASE_URL}/functions/v1/saas_run_brand_snapshot`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ brand_id: brandId, topic_id: body.topic_id, mode: "api" }),
          });
          const triggerData = await triggerResp.json().catch(() => ({}));
          status = triggerResp.ok ? 202 : triggerResp.status;
          respBody = { ok: triggerResp.ok, data: triggerData, message: triggerResp.ok ? "Snapshot triggered. Use GET /v1/brands/:id/snapshots/:sid to poll status." : undefined };
        }
      }
    } else {
      status = 405;
      respBody = { ok: false, error: `Method ${method} not allowed for this endpoint` };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_api_v1_router ERROR]", msg);
    status = 500;
    respBody = { ok: false, error: msg };
  }

  // Log + update last_used
  const durationMs = Date.now() - t0;
  await logCall({ apiKeyId: key.id, userId: key.user_id, endpoint: endpointKey, status, durationMs, ip });

  return jsonResponse(respBody, status, {
    "X-RateLimit-Limit": String(RATE_LIMIT_PER_MIN),
    "X-RateLimit-Remaining": String(Math.max(0, RATE_LIMIT_PER_MIN - rate.count - 1)),
    "X-Geoperf-Tier": tier,
    "X-Geoperf-Duration-Ms": String(durationMs),
  });
});