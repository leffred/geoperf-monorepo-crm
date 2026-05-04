// GEOPERF SaaS — saas_compute_alignment
// Spec : SPRINTS_S8_S9_S10_PLAN.md S9.2
// Trigger : POST { snapshot_id }
//
// Pipeline :
//   1. Load snapshot + brand (brand_keywords, brand_value_props, brand_description) + tier
//   2. Skip si tier ∉ {pro, agency} (Alignment = Pro+ uniquement)
//   3. Skip si pas de brand_keywords ET pas de brand_value_props (rien à matcher)
//   4. Skip si déjà calculé (alignment_computed_at != NULL)
//   5. Load saas_snapshot_responses
//   6. Compte combien de réponses contiennent chaque keyword / value_prop (case insensitive)
//   7. Appel Sonnet pour détecter "themes inattendus" (sujets récurrents PAS dans description)
//   8. Compute alignment_score = (matched_keywords + matched_value_props) / (total) * 100
//   9. UPDATE snapshot avec alignment_score / alignment_gaps (JSONB) / alignment_summary
//   10. Log usage cost
//
// Coût : ~$0.005 par snapshot (1 call Sonnet pour themes).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const TEST_MODE = Deno.env.get("SAAS_TEST_MODE") === "true";

const SONNET_MODEL = "anthropic/claude-sonnet-4-6";
const ALLOWED_TIERS = new Set(["pro", "agency"]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const SYSTEM_PROMPT = `Tu es un analyste positionnement de marque. À partir de descriptions de marque + d'extraits de réponses LLM, tu identifies les "themes inattendus" : sujets ou angles récurrents dans les réponses LLM qui ne sont PAS dans la description de la marque.

Tu réponds UNIQUEMENT en JSON strict :
{
  "unexpected_themes": ["theme1", "theme2", ...],
  "summary": "1-2 phrases qui résument l'écart entre ce que dit la marque et ce que disent les LLM"
}

unexpected_themes : 3 à 8 expressions courtes (1-3 mots), en français, qui apparaissent dans les LLM mais pas dans la description de la marque. Pas de doublons. Pas de mention banale (ex: "société", "leader" sont trop génériques — préfère "innovation digitale", "approche ESG", etc.).`;

interface BrandSetup {
  description: string;
  keywords: string[];
  value_props: string[];
}

interface AggregatedResponses {
  matched_keywords: string[];
  missing_keywords: string[];
  matched_value_props: string[];
  missing_value_props: string[];
  totalResponses: number;
  textCorpus: string;
}

function aggregateMatches(setup: BrandSetup, responses: Array<{ response_text: string | null }>): AggregatedResponses {
  const corpusLower = responses.map(r => (r.response_text || "").toLowerCase()).join(" \n ");
  const matched_keywords: string[] = [];
  const missing_keywords: string[] = [];
  for (const kw of setup.keywords) {
    if (!kw) continue;
    const re = new RegExp(`\\b${escapeRegex(kw.toLowerCase())}\\b`, "i");
    if (re.test(corpusLower)) matched_keywords.push(kw); else missing_keywords.push(kw);
  }
  const matched_value_props: string[] = [];
  const missing_value_props: string[] = [];
  for (const vp of setup.value_props) {
    if (!vp) continue;
    // Pour les value props, on accepte un match partiel par mots-clés (≥50% des mots de la phrase présents)
    const tokens = vp.toLowerCase().split(/\s+/).filter(t => t.length >= 4);
    if (tokens.length === 0) { missing_value_props.push(vp); continue; }
    const matchedTokens = tokens.filter(t => new RegExp(`\\b${escapeRegex(t)}\\b`, "i").test(corpusLower));
    if (matchedTokens.length / tokens.length >= 0.5) matched_value_props.push(vp);
    else missing_value_props.push(vp);
  }
  return {
    matched_keywords,
    missing_keywords,
    matched_value_props,
    missing_value_props,
    totalResponses: responses.length,
    textCorpus: corpusLower,
  };
}

async function callSonnet(system: string, user: string): Promise<{ text: string; cost_usd: number; raw: unknown }> {
  if (TEST_MODE) {
    return {
      text: JSON.stringify({ unexpected_themes: ["mock theme"], summary: "Mock summary." }),
      cost_usd: 0.0005,
      raw: { mock: true },
    };
  }
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "Geoperf SaaS Alignment",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      usage: { include: true },
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${SONNET_MODEL} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, raw: data };
}

function parseSonnetOutput(raw: string): { unexpected_themes: string[]; summary: string } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const obj = JSON.parse(cleaned);
  return {
    unexpected_themes: Array.isArray(obj?.unexpected_themes) ? obj.unexpected_themes.slice(0, 8).map((x: unknown) => String(x).slice(0, 60)) : [],
    summary: String(obj?.summary ?? "").slice(0, 800),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { snapshot_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.snapshot_id) return new Response(JSON.stringify({ error: "snapshot_id required" }), { status: 400 });

  try {
    const { data: snap, error: snapErr } = await supabase
      .from("saas_brand_snapshots")
      .select("id, brand_id, user_id, status, alignment_computed_at")
      .eq("id", body.snapshot_id)
      .maybeSingle();
    if (snapErr || !snap) return new Response(JSON.stringify({ error: `snapshot not found: ${snapErr?.message}` }), { status: 404 });
    if (snap.status !== "completed") return new Response(JSON.stringify({ error: `snapshot status=${snap.status}` }), { status: 400 });
    if (snap.alignment_computed_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already_computed", snapshot_id: snap.id }), { headers: { "content-type": "application/json" } });
    }

    // Tier-gate
    const { data: sub } = await supabase
      .from("saas_subscriptions").select("tier")
      .eq("user_id", snap.user_id).in("status", ["active", "trialing"]).maybeSingle();
    const tier = (sub as any)?.tier ?? "free";
    if (!ALLOWED_TIERS.has(tier)) {
      return new Response(JSON.stringify({ ok: true, skipped: "tier_too_low", tier, snapshot_id: snap.id }), { headers: { "content-type": "application/json" } });
    }

    const { data: brand } = await supabase
      .from("saas_tracked_brands").select("name, brand_description, brand_keywords, brand_value_props")
      .eq("id", snap.brand_id).single();
    const setup: BrandSetup = {
      description: (brand as any)?.brand_description ?? "",
      keywords: ((brand as any)?.brand_keywords ?? []) as string[],
      value_props: ((brand as any)?.brand_value_props ?? []) as string[],
    };

    if (setup.keywords.length === 0 && setup.value_props.length === 0 && !setup.description) {
      return new Response(JSON.stringify({
        ok: true, skipped: "brand_setup_empty",
        snapshot_id: snap.id,
        hint: "Configure brand_description / brand_keywords / brand_value_props sur /app/brands/[id]/setup pour activer Brand Alignment.",
      }), { headers: { "content-type": "application/json" } });
    }

    const { data: responses } = await supabase
      .from("saas_snapshot_responses")
      .select("response_text, brand_mentioned")
      .eq("snapshot_id", snap.id);
    const respList = ((responses as Array<{ response_text: string | null; brand_mentioned: boolean }> | null) ?? []);
    const mentionedResponses = respList.filter(r => r.brand_mentioned);

    const agg = aggregateMatches(setup, mentionedResponses);

    // Score = % keywords matched + % value_props matched, mean
    const kwTotal = setup.keywords.length;
    const vpTotal = setup.value_props.length;
    const kwScore = kwTotal > 0 ? (agg.matched_keywords.length / kwTotal) * 100 : null;
    const vpScore = vpTotal > 0 ? (agg.matched_value_props.length / vpTotal) * 100 : null;
    const scores = [kwScore, vpScore].filter((x): x is number => x !== null);
    const alignment_score = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;

    // Sonnet pour themes inattendus
    let unexpected_themes: string[] = [];
    let summary = "";
    let cost = 0;
    if (mentionedResponses.length > 0) {
      const corpusSnippets = mentionedResponses.slice(0, 12)
        .map(r => (r.response_text || "").slice(0, 600))
        .filter(t => t.length > 0)
        .join("\n---\n");
      const userPrompt = `DESCRIPTION DE LA MARQUE :\n${setup.description || "(non fournie)"}\n\nKEYWORDS DE LA MARQUE : ${setup.keywords.join(", ") || "(none)"}\n\nVALUE PROPS : ${setup.value_props.join(" | ") || "(none)"}\n\nEXTRAITS DE RÉPONSES LLM (${mentionedResponses.length} total, ${Math.min(12, mentionedResponses.length)} affichés) :\n\n${corpusSnippets}\n\nIdentifie les themes inattendus (récurrents dans les réponses, absents de la description). Retourne JSON.`;
      try {
        const result = await callSonnet(SYSTEM_PROMPT, userPrompt);
        cost = result.cost_usd;
        const parsed = parseSonnetOutput(result.text);
        unexpected_themes = parsed.unexpected_themes;
        summary = parsed.summary;
      } catch (e) {
        console.error("[saas_compute_alignment] Sonnet:", (e as Error).message);
      }
    }

    const gaps = {
      matched_keywords: agg.matched_keywords,
      missing_keywords: agg.missing_keywords,
      matched_value_props: agg.matched_value_props,
      missing_value_props: agg.missing_value_props,
      unexpected_themes,
    };

    await supabase.from("saas_brand_snapshots").update({
      alignment_score,
      alignment_gaps: gaps,
      alignment_summary: summary || null,
      alignment_computed_at: new Date().toISOString(),
    }).eq("id", snap.id);

    await supabase.from("saas_usage_log").insert({
      user_id: snap.user_id,
      event_type: "alignment_computed",
      cost_usd: Math.round(cost * 1000000) / 1000000,
      metadata: {
        snapshot_id: snap.id,
        brand_id: snap.brand_id,
        alignment_score,
        keywords_total: kwTotal,
        keywords_matched: agg.matched_keywords.length,
        value_props_total: vpTotal,
        value_props_matched: agg.matched_value_props.length,
        unexpected_themes_count: unexpected_themes.length,
        tier,
        model: SONNET_MODEL,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: snap.id,
      alignment_score,
      gaps,
      summary,
      cost_usd: cost,
      tier,
    }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_compute_alignment ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});