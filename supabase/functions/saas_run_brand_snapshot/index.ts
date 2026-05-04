// GEOPERF SaaS — saas_run_brand_snapshot
// Spec : saas/SPEC.md section 5.1 + SPRINT_S7_BRIEF.md (topic_id support)
// Trigger : POST { brand_id, topic_id?, mode? }  mode in 'manual'|'scheduled' (default: manual)
//
// Pipeline :
//   1. Charger brand + tier (et topic si topic_id fourni, sinon résolution default topic auto)
//   2. Charger prompts : si topic.prompts non-vide → utilise ces overrides ; sinon prompts.json bundlé
//   3. Filtrer prompts selon nb de competitor_domains
//   4. Créer snapshot row status='running' avec topic_id
//   5. Pour chaque (prompt × LLM autorisé par tier) → call OpenRouter (concurrency=16)
//   6. Parser response : brand_mentioned, brand_rank, competitors_mentioned, sources_cited
//   7. Insert saas_snapshot_responses
//   8. Aggréger scores → update snapshot status='completed' (le trigger DB cascade vers recos+alerts)
//   9. Log usage
//
// SAAS_TEST_MODE=true → bypass OpenRouter, retourne fixtures déterministes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Source unique pour les prompts (sync depuis saas/prompts/brand_monitoring/prompts.json
// via le pre-deploy : voir saas/docs/PROMPTS_SYNC.md). NE PAS éditer ce fichier dupliqué
// directement — éditer la copie dans saas/prompts/ puis copier ici avant deploy.
import promptsConfigData from "./prompts.json" with { type: "json" };

// ============== CONFIG ==============
// Tier ENUM v2 (S7) : free + 4 payants. Legacy 'solo' traité comme 'starter'.
type Tier = "free" | "starter" | "growth" | "pro" | "agency" | "solo";

const LLMS_BY_TIER: Record<Tier, string[]> = {
  free:    ["openai/gpt-4o"],
  starter: ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro", "perplexity/sonar-pro"],
  growth:  ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro", "perplexity/sonar-pro"],
  pro:     ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro", "perplexity/sonar-pro", "mistralai/mistral-large", "x-ai/grok-2"],
  agency:  ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro", "perplexity/sonar-pro", "mistralai/mistral-large", "x-ai/grok-2", "meta-llama/llama-3.3-70b-instruct"],
  // Legacy
  solo:    ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.5-pro", "perplexity/sonar-pro"],
};

// Limit nb prompts par tier (S7 grille pricing)
const PROMPTS_BY_TIER: Record<Tier, number> = {
  free: 30, starter: 50, growth: 200, pro: 200, agency: 300, solo: 50,
};

const TEST_MODE = Deno.env.get("SAAS_TEST_MODE") === "true";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Source unique : prompts.json (copié depuis saas/prompts/brand_monitoring/prompts.json
// avant chaque deploy — voir saas/docs/PROMPTS_SYNC.md).
const promptsConfig = promptsConfigData as {
  version: string;
  language: string;
  system_prompt: string;
  prompts: Array<{
    id: string;
    category: string;
    uses_brand: boolean;
    template: string;
  }>;
};

// ============== HELPERS ==============
function humanizeCategorySlug(slug: string): string {
  return slug.replace(/[-_]/g, " ").trim();
}

function humanizeDomain(d: string): string {
  const root = d.split(".")[0];
  return root.split("-").map(w => w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1)).join(" ");
}

function domainRoot(d: string): string {
  return d.split(".")[0].toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Substitute {key} et {key[idx]}. Retourne null si une variable demandée est absente.
function substituteVars(template: string, vars: { brand: string; category: string; competitors: string[] }): string | null {
  let missing = false;
  let out = template.replace(/\{(\w+)\[(\d+)\]\}/g, (_m, key, idx) => {
    if (key !== "competitors") return "";
    const i = parseInt(idx, 10);
    const v = vars.competitors[i];
    if (!v) { missing = true; return ""; }
    return v;
  });
  if (missing) return null;
  out = out.replace(/\{(\w+)\}/g, (_m, key) => {
    if (key === "brand") return vars.brand;
    if (key === "category") return vars.category;
    if (key === "competitors") return vars.competitors.join(", ");
    return "";
  });
  return out;
}

// ============== PARSER ==============
interface ParsedResponse {
  brand_mentioned: boolean;
  brand_rank: number | null;
  competitors_mentioned: string[];
  competitors_with_rank: { name: string; rank: number | null }[];
  sources_cited: { url: string; domain: string }[];
}

// Cherche le 1er numéro de ligne ordonnée ("1. foo", "2) foo", "3- foo") qui matche
// au moins une des regexes fournies. Retourne null si aucune ligne ne matche.
function findRankInLines(lines: string[], regexes: RegExp[]): number | null {
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)\-]\s+(.+)$/);
    if (!m) continue;
    if (regexes.some(re => re.test(m[2]))) {
      return parseInt(m[1], 10);
    }
  }
  return null;
}

function parseResponse(text: string, brandName: string, brandDomain: string, competitorHumans: string[]): ParsedResponse {
  const tokens: string[] = [];
  if (brandName) tokens.push(brandName.toLowerCase());
  const root = domainRoot(brandDomain);
  if (root && root !== brandName.toLowerCase()) tokens.push(root);
  const tokenRegexes = tokens.map(t => new RegExp(`\\b${escapeRegex(t)}\\b`, "i"));

  const brandMentioned = tokenRegexes.some(re => re.test(text));

  const lines = text.split(/\r?\n/);
  const brandRank = findRankInLines(lines, tokenRegexes);

  const competitorsMentioned: string[] = [];
  const competitorsWithRank: { name: string; rank: number | null }[] = [];
  for (const c of competitorHumans) {
    if (!c) continue;
    const re = new RegExp(`\\b${escapeRegex(c)}\\b`, "i");
    if (re.test(text)) {
      competitorsMentioned.push(c);
      competitorsWithRank.push({ name: c, rank: findRankInLines(lines, [re]) });
    }
  }

  const urlMatches = Array.from(text.matchAll(/https?:\/\/[^\s)\]>",]+/g)).map(m => m[0].replace(/[.,;:]+$/, ""));
  const seen = new Set<string>();
  const sources: { url: string; domain: string }[] = [];
  for (const url of urlMatches) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const u = new URL(url);
      sources.push({ url, domain: u.hostname });
    } catch { /* skip */ }
  }

  return {
    brand_mentioned: brandMentioned,
    brand_rank: brandRank,
    competitors_mentioned: competitorsMentioned,
    competitors_with_rank: competitorsWithRank,
    sources_cited: sources,
  };
}

// ============== LLM CLIENT ==============
async function callLLM(model: string, system: string, user: string): Promise<{ text: string; cost_usd: number; latency_ms: number; raw: unknown }> {
  if (TEST_MODE) return mockResponse(model, user);
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const t0 = Date.now();
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "Geoperf SaaS Brand Monitoring",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      usage: { include: true },
    }),
  });
  const latency_ms = Date.now() - t0;

  if (!resp.ok) {
    throw new Error(`OpenRouter ${model} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  // OpenRouter expose usage.cost (et parfois usage.total_cost selon versions)
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, latency_ms, raw: data };
}

function mockResponse(model: string, _prompt: string): { text: string; cost_usd: number; latency_ms: number; raw: unknown } {
  const text = `Voici les principaux acteurs identifiés.

1. BlackRock — leader mondial historique sur la gestion d'actifs.
2. Vanguard — challenger très installé, leader sur les ETF.
3. AXA Investment Managers — acteur français reconnu, présent à l'international.
4. Amundi — leader européen issu de la fusion Crédit Agricole / Société Générale AM.
5. BNP Paribas Asset Management — gamme large multi-actifs.

Sources :
https://example.com/asset-management-leaders-2026
https://test.fr/etude-am-france`;
  return { text, cost_usd: 0.001, latency_ms: 42, raw: { mock: true, model } };
}

// ============== AGGREGATION ==============
interface ResponseRow {
  brand_mentioned: boolean;
  brand_rank: number | null;
  competitors_mentioned: string[];
  cost_usd: number;
}

function aggregate(responses: ResponseRow[]): {
  visibility_score: number;
  avg_rank: number | null;
  citation_rate: number;
  share_of_voice: number;
  total_cost_usd: number;
  brand_mention_count: number;
  total_mention_count: number;
} {
  const n = responses.length;
  if (n === 0) return {
    visibility_score: 0, avg_rank: null, citation_rate: 0, share_of_voice: 0,
    total_cost_usd: 0, brand_mention_count: 0, total_mention_count: 0,
  };

  let scoreSum = 0;
  let mentionedCount = 0;
  let rankSum = 0;
  let rankCount = 0;
  let brandMentions = 0;
  let totalMentions = 0;
  let totalCost = 0;

  for (const r of responses) {
    totalCost += r.cost_usd ?? 0;
    let perScore = 0;
    if (r.brand_mentioned) {
      mentionedCount++;
      brandMentions++;
      if (r.brand_rank !== null) {
        rankSum += r.brand_rank;
        rankCount++;
        perScore = Math.max(10, 100 - (r.brand_rank - 1) * 10);
      } else {
        perScore = 50;
      }
    }
    scoreSum += perScore;
    totalMentions += (r.brand_mentioned ? 1 : 0) + (r.competitors_mentioned?.length ?? 0);
  }

  return {
    visibility_score: round2(scoreSum / n),
    avg_rank: rankCount > 0 ? round2(rankSum / rankCount) : null,
    citation_rate: round2((mentionedCount / n) * 100),
    share_of_voice: totalMentions > 0 ? round2((brandMentions / totalMentions) * 100) : 0,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
    brand_mention_count: brandMentions,
    total_mention_count: totalMentions,
  };
}

function round2(x: number): number { return Math.round(x * 100) / 100; }

// ============== CONCURRENCY ==============
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]() };
      } catch (e) {
        results[idx] = { status: "rejected", reason: e };
      }
    }
  };
  await Promise.all(Array(Math.min(concurrency, tasks.length)).fill(0).map(() => worker()));
  return results;
}

// ============== MAIN HANDLER ==============
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { brand_id?: string; topic_id?: string | null; mode?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.brand_id) return new Response(JSON.stringify({ error: "brand_id required" }), { status: 400 });
  const mode = body.mode === "scheduled" ? "scheduled" : "manual";

  const { data: brand, error: brandErr } = await supabase
    .from("saas_tracked_brands")
    .select("id, user_id, name, domain, category_slug, competitor_domains, is_active")
    .eq("id", body.brand_id)
    .maybeSingle();
  if (brandErr || !brand) return new Response(JSON.stringify({ error: `brand not found: ${brandErr?.message ?? "no row"}` }), { status: 404 });
  if (!brand.is_active) return new Response(JSON.stringify({ error: "brand inactive" }), { status: 400 });

  const { data: sub } = await supabase
    .from("saas_subscriptions")
    .select("tier, status")
    .eq("user_id", brand.user_id)
    .in("status", ["active", "trialing"])
    .maybeSingle();
  const tier = (sub?.tier ?? "free") as Tier;
  const llms = LLMS_BY_TIER[tier];
  const promptsLimit = PROMPTS_BY_TIER[tier];

  // Résolution topic : si fourni, charge le topic ; sinon prend le default topic du brand
  let topicId: string | null = body.topic_id ?? null;
  let topicPromptsOverride: Array<{ id: string; category: string; uses_brand?: boolean; template: string }> = [];
  if (topicId) {
    const { data: topic } = await supabase
      .from("saas_topics")
      .select("id, brand_id, prompts")
      .eq("id", topicId)
      .maybeSingle();
    if (!topic || (topic as any).brand_id !== brand.id) {
      return new Response(JSON.stringify({ error: "topic not found or wrong brand" }), { status: 404 });
    }
    const promptsRaw = (topic as any).prompts;
    if (Array.isArray(promptsRaw) && promptsRaw.length > 0) {
      topicPromptsOverride = promptsRaw;
    }
  } else {
    // Auto-résoudre default topic pour cohérence (rétro-compat : si NULL, OK aussi)
    const { data: defaultTopic } = await supabase
      .from("saas_topics")
      .select("id")
      .eq("brand_id", brand.id)
      .eq("is_default", true)
      .maybeSingle();
    topicId = (defaultTopic as any)?.id ?? null;
  }

  const competitorHumans = (brand.competitor_domains ?? []).map(humanizeDomain);
  const vars = {
    brand: brand.name,
    category: humanizeCategorySlug(brand.category_slug),
    competitors: competitorHumans,
  };

  // Source des prompts : topic.prompts si non vide, sinon prompts.json bundlé
  const sourcePrompts = topicPromptsOverride.length > 0
    ? topicPromptsOverride.map(p => ({ id: p.id, category: p.category, uses_brand: p.uses_brand ?? false, template: p.template }))
    : promptsConfig.prompts;

  const usablePrompts = sourcePrompts
    .map(p => ({ ...p, rendered: substituteVars(p.template, vars) }))
    .filter((p): p is typeof p & { rendered: string } => p.rendered !== null)
    .slice(0, promptsLimit);  // Tier-cap : starter=50, growth/pro=200, agency=300

  const { data: snap, error: snapErr } = await supabase
    .from("saas_brand_snapshots")
    .insert({
      brand_id: brand.id,
      user_id: brand.user_id,
      topic_id: topicId,
      status: "running",
      llms_used: llms,
      prompts_count: usablePrompts.length,
    })
    .select("id")
    .single();
  if (snapErr || !snap) return new Response(JSON.stringify({ error: `snapshot insert failed: ${snapErr?.message}` }), { status: 500 });
  const snapshotId = snap.id;

  try {
    const tasks: Array<() => Promise<{ row: Record<string, unknown>; parsed: ParsedResponse; cost_usd: number }>> = [];
    for (const p of usablePrompts) {
      for (const model of llms) {
        tasks.push(async () => {
          const r = await callLLM(model, promptsConfig.system_prompt, p.rendered);
          const parsed = parseResponse(r.text, brand.name, brand.domain, competitorHumans);
          return {
            row: {
              snapshot_id: snapshotId,
              llm: model,
              prompt_text: p.rendered,
              response_text: r.text,
              response_json: r.raw,
              brand_mentioned: parsed.brand_mentioned,
              brand_rank: parsed.brand_rank,
              competitors_mentioned: parsed.competitors_mentioned,
              competitors_with_rank: parsed.competitors_with_rank,
              sources_cited: parsed.sources_cited,
              cost_usd: r.cost_usd,
              latency_ms: r.latency_ms,
            },
            parsed,
            cost_usd: r.cost_usd,
          };
        });
      }
    }

    const settled = await runWithConcurrency(tasks, 16);
    const succeeded = settled.filter(s => s.status === "fulfilled") as PromiseFulfilledResult<{ row: Record<string, unknown>; parsed: ParsedResponse; cost_usd: number }>[];
    const failed = settled.filter(s => s.status === "rejected").length;

    const rows = succeeded.map(s => s.value.row);
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const { error } = await supabase.from("saas_snapshot_responses").insert(chunk);
      if (error) throw new Error(`insert responses chunk ${i}: ${error.message}`);
    }

    const agg = aggregate(succeeded.map(s => ({
      brand_mentioned: s.value.parsed.brand_mentioned,
      brand_rank: s.value.parsed.brand_rank,
      competitors_mentioned: s.value.parsed.competitors_mentioned,
      cost_usd: s.value.cost_usd,
    })));

    await supabase.from("saas_brand_snapshots").update({
      status: "completed",
      visibility_score: agg.visibility_score,
      avg_rank: agg.avg_rank,
      citation_rate: agg.citation_rate,
      share_of_voice: agg.share_of_voice,
      total_cost_usd: agg.total_cost_usd,
      brand_mention_count: agg.brand_mention_count,
      total_mention_count: agg.total_mention_count,
      raw_response_count: rows.length,
      completed_at: new Date().toISOString(),
      error_message: failed > 0 ? `${failed} LLM calls failed (see logs)` : null,
    }).eq("id", snapshotId);

    await supabase.from("saas_usage_log").insert({
      user_id: brand.user_id,
      event_type: "snapshot_run",
      cost_usd: agg.total_cost_usd,
      metadata: { snapshot_id: snapshotId, brand_id: brand.id, topic_id: topicId, mode, tier, llms, prompts_count: usablePrompts.length, failed_calls: failed, test_mode: TEST_MODE, topic_prompts_override: topicPromptsOverride.length > 0 },
    });

    // La cascade vers saas_generate_recommendations + saas_detect_alerts est gérée
    // par le trigger Postgres saas_snapshot_completion_cascade (migration
    // 20260429_saas_phase1_completion_cascade.sql) qui fire AFTER UPDATE OF status quand
    // status passe à 'completed'. Cette transition vient juste d'être faite par l'UPDATE
    // précédent. Plus besoin de chainFunction côté Edge Function.

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: snapshotId,
      topic_id: topicId,
      tier,
      llms_used: llms,
      prompts_run: usablePrompts.length,
      responses_inserted: rows.length,
      failed_calls: failed,
      test_mode: TEST_MODE,
      ...agg,
    }), { headers: { "content-type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_run_brand_snapshot ERROR]", msg);
    await supabase.from("saas_brand_snapshots").update({
      status: "failed",
      error_message: msg.slice(0, 1000),
      completed_at: new Date().toISOString(),
    }).eq("id", snapshotId);
    return new Response(JSON.stringify({ error: msg, snapshot_id: snapshotId }), { status: 500 });
  }
});

// Note historique : cette fonction utilisait chainFunction() avec EdgeRuntime.waitUntil
// pour fire-and-forget les chained calls vers saas_generate_recommendations et
// saas_detect_alerts. Le runtime Supabase tuait cependant le process avant la fin du
// fetch dans certains cas (cascade silencieusement perdue). Migré au pattern trigger
// Postgres AFTER UPDATE qui pose les jobs pg_net.http_post — fiable, asynchrone,
// observable via vault.decrypted_secrets + pg_net._http_response.