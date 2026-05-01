// GEOPERF SaaS — saas_generate_recommendations
// Spec : saas/SPEC.md section 5.2
// Trigger : POST { snapshot_id }
//
// Pipeline :
//   1. Load snapshot + brand + user
//   2. Load all snapshot_responses (top citations / sources / rank stats)
//   3. Build context for Haiku 4.5 (compact summary, pas le full text)
//   4. Call Haiku via OpenRouter avec prompt structuré JSON
//   5. Parse JSON output → insert saas_recommendations rows
//   6. Log cost in saas_usage_log
//
// SAAS_TEST_MODE=true → mock 3 recos déterministes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TEST_MODE = Deno.env.get("SAAS_TEST_MODE") === "true";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const HAIKU_MODEL = "anthropic/claude-haiku-4-5";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SYSTEM_PROMPT = `Tu es expert en GEO (Generative Engine Optimization), discipline qui optimise la visibilité des marques dans les LLM (ChatGPT, Claude, Gemini, Perplexity).

Tu réponds UNIQUEMENT en JSON strict, sans backticks ni préambule. Format :

[
  {
    "priority": "high" | "medium" | "low",
    "category": "authority_source" | "content_gap" | "competitor_threat" | "positioning",
    "title": "Titre court actionnable (max 80 chars)",
    "body": "Explication 2-4 phrases : pourquoi c'est important + comment agir",
    "authority_sources": [
      {"domain": "ft.com", "why": "Raison de cibler ce média", "example_url": "https://..."}
    ]
  }
]

Catégories :
- authority_source : recommander de cibler une source web autorité (média/analyste/wiki) qui apparaît chez les concurrents mais pas chez la marque
- content_gap : sujet/use-case sur lequel la marque devrait publier (parce que des concurrents y sont visibles)
- competitor_threat : alerte sur un concurrent qui gagne du terrain
- positioning : retravailler le positionnement de la marque vis-à-vis du marché

Génère 3 à 5 recommandations priorisées. Reste actionnable et précis.`;

interface SnapshotSummary {
  brand_name: string;
  brand_domain: string;
  category: string;
  visibility_score: number | null;
  avg_rank: number | null;
  citation_rate: number | null;
  share_of_voice: number | null;
  top_competitors: Array<{ name: string; mentions: number }>;
  top_sources: Array<{ domain: string; count: number }>;
  prompts_count: number;
  responses_count: number;
}

function buildHaikuUserPrompt(s: SnapshotSummary): string {
  return `Marque analysée : ${s.brand_name} (${s.brand_domain})
Catégorie : ${s.category}
Snapshot agrégé sur ${s.responses_count} réponses LLM (${s.prompts_count} prompts) :

- visibility_score : ${s.visibility_score ?? "n/a"} / 100
- avg_rank quand cité : ${s.avg_rank ?? "non cité"}
- citation_rate : ${s.citation_rate ?? 0}%
- share_of_voice : ${s.share_of_voice ?? 0}%

Concurrents les plus mentionnés (${s.top_competitors.length}) :
${s.top_competitors.map(c => `  - ${c.name} (${c.mentions} mentions)`).join("\n") || "  (aucun)"}

Sources autorités les plus citées par les LLM (${s.top_sources.length}) :
${s.top_sources.map(s2 => `  - ${s2.domain} (${s2.count} citations)`).join("\n") || "  (aucune)"}

Génère 3 à 5 recommandations priorisées au format JSON spécifié.`;
}

async function callHaiku(system: string, user: string): Promise<{ text: string; cost_usd: number; raw: unknown }> {
  if (TEST_MODE) {
    const text = JSON.stringify([
      { priority: "high", category: "authority_source", title: "Cibler les médias financiers de référence", body: "Les concurrents apparaissent fréquemment via Bloomberg, Reuters, FT. La marque doit être citée sur ces autorités pour grimper dans les ranking LLM.", authority_sources: [{ domain: "ft.com", why: "Source la plus citée par les LLM", example_url: "https://ft.com" }] },
      { priority: "medium", category: "content_gap", title: "Publier sur l'angle ESG / impact", body: "Plusieurs prompts use-case mentionnent ESG ; la marque n'apparaît pas sur ce sujet. Lancer une série d'articles ou d'études dédiés.", authority_sources: [] },
      { priority: "low", category: "competitor_threat", title: "Surveiller la montée d'Amundi", body: "Amundi est cité dans 80% des réponses, souvent au rang 1 ou 2.", authority_sources: [] },
    ]);
    return { text, cost_usd: 0.0005, raw: { mock: true } };
  }
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "Geoperf SaaS Reco Generator",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 2500,
      temperature: 0.4,
      usage: { include: true },
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, raw: data };
}

function parseRecosJson(raw: string): Array<{ priority: string; category: string; title: string; body: string; authority_sources: unknown }> {
  // Strip Markdown fences si présents
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr)) throw new Error("recos: expected JSON array");
  const ALLOWED_PRIO = new Set(["high", "medium", "low"]);
  const ALLOWED_CAT = new Set(["authority_source", "content_gap", "competitor_threat", "positioning"]);
  return arr.map((r, i) => {
    if (!ALLOWED_PRIO.has(r.priority)) throw new Error(`reco[${i}] invalid priority: ${r.priority}`);
    if (!ALLOWED_CAT.has(r.category)) throw new Error(`reco[${i}] invalid category: ${r.category}`);
    if (typeof r.title !== "string" || typeof r.body !== "string") throw new Error(`reco[${i}] missing title/body`);
    return r;
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { snapshot_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.snapshot_id) return new Response(JSON.stringify({ error: "snapshot_id required" }), { status: 400 });

  try {
    const { data: snap, error: snapErr } = await supabase
      .from("saas_brand_snapshots")
      .select("id, brand_id, user_id, status, visibility_score, avg_rank, citation_rate, share_of_voice, prompts_count, raw_response_count")
      .eq("id", body.snapshot_id)
      .maybeSingle();
    if (snapErr || !snap) return new Response(JSON.stringify({ error: `snapshot not found: ${snapErr?.message}` }), { status: 404 });
    if (snap.status !== "completed") return new Response(JSON.stringify({ error: `snapshot status=${snap.status}, not completed` }), { status: 400 });

    const { data: brand } = await supabase
      .from("saas_tracked_brands")
      .select("name, domain, category_slug")
      .eq("id", snap.brand_id)
      .single();

    const { data: responses } = await supabase
      .from("saas_snapshot_responses")
      .select("competitors_mentioned, sources_cited")
      .eq("snapshot_id", snap.id);

    // Aggrégate top competitors + top source domains
    const competitorCounts: Record<string, number> = {};
    const sourceDomainCounts: Record<string, number> = {};
    for (const r of responses ?? []) {
      for (const c of (r.competitors_mentioned ?? []) as string[]) {
        competitorCounts[c] = (competitorCounts[c] ?? 0) + 1;
      }
      for (const s of (r.sources_cited ?? []) as Array<{ domain: string }>) {
        if (!s?.domain) continue;
        sourceDomainCounts[s.domain] = (sourceDomainCounts[s.domain] ?? 0) + 1;
      }
    }
    const topCompetitors = Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, mentions]) => ({ name, mentions }));
    const topSources = Object.entries(sourceDomainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));

    const summary: SnapshotSummary = {
      brand_name: brand?.name ?? "?",
      brand_domain: brand?.domain ?? "?",
      category: (brand?.category_slug ?? "").replace(/[-_]/g, " "),
      visibility_score: snap.visibility_score,
      avg_rank: snap.avg_rank,
      citation_rate: snap.citation_rate,
      share_of_voice: snap.share_of_voice,
      top_competitors: topCompetitors,
      top_sources: topSources,
      prompts_count: snap.prompts_count,
      responses_count: snap.raw_response_count,
    };

    const userPrompt = buildHaikuUserPrompt(summary);
    const llmResult = await callHaiku(SYSTEM_PROMPT, userPrompt);

    let recos: Array<{ priority: string; category: string; title: string; body: string; authority_sources: unknown }>;
    try {
      recos = parseRecosJson(llmResult.text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[parseRecosJson]", msg, "raw:", llmResult.text.slice(0, 500));
      throw new Error(`Reco parsing failed: ${msg}`);
    }

    const rows = recos.map(r => ({
      snapshot_id: snap.id,
      brand_id: snap.brand_id,
      priority: r.priority,
      category: r.category,
      title: r.title.slice(0, 200),
      body: r.body,
      authority_sources: r.authority_sources ?? null,
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from("saas_recommendations").insert(rows);
      if (error) throw new Error(`insert recos: ${error.message}`);
    }

    await supabase.from("saas_usage_log").insert({
      user_id: snap.user_id,
      event_type: "reco_generated",
      cost_usd: llmResult.cost_usd,
      metadata: { snapshot_id: snap.id, brand_id: snap.brand_id, recos_count: rows.length, model: HAIKU_MODEL, test_mode: TEST_MODE },
    });

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: snap.id,
      recos_inserted: rows.length,
      cost_usd: llmResult.cost_usd,
      test_mode: TEST_MODE,
    }), { headers: { "content-type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_generate_recommendations ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});