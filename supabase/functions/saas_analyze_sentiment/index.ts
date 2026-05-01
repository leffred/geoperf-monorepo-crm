// GEOPERF SaaS — saas_analyze_sentiment
// Spec : SPRINTS_S8_S9_S10_PLAN.md S9.1
// Trigger : POST { snapshot_id }
//
// Pipeline :
//   1. Load snapshot + brand + user tier
//   2. Skip si tier ∈ {free, starter} (Sentiment = Growth+)
//   3. Skip si déjà analysé (sentiment_analyzed_at != NULL — idempotent)
//   4. Load saas_snapshot_responses où brand_mentioned=true
//   5. Si 0 responses : marque le snapshot avec distribution { not_mentioned: total }, no Haiku call
//   6. Sinon, batch les responses (max 30) dans 1 prompt Haiku → JSON [{response_id, sentiment, score, summary}]
//   7. UPDATE saas_snapshot_responses ligne par ligne
//   8. UPDATE saas_brand_snapshots avec avg_sentiment_score + sentiment_distribution + sentiment_analyzed_at
//   9. Insert saas_usage_log event_type=sentiment_analyzed avec cost
//
// Coût attendu : ~$0.001 par snapshot (Haiku batch). Skip silencieux si tier insuffisant.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const TEST_MODE = Deno.env.get("SAAS_TEST_MODE") === "true";

const HAIKU_MODEL = "anthropic/claude-haiku-4-5";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Tier-gating : Sentiment réservé Growth+
const ALLOWED_TIERS = new Set(["growth", "pro", "agency"]);

type Sentiment = "positive" | "neutral" | "negative" | "mixed" | "not_mentioned";

interface ResponseRow {
  id: string;
  llm: string;
  prompt_text: string;
  response_text: string | null;
  brand_mentioned: boolean;
}

const SYSTEM_PROMPT = `Tu es un analyste qui classifie le sentiment d'une marque dans des réponses LLM. Pour chaque réponse fournie, classe le sentiment envers la marque cible :
- positive : la marque est mentionnée favorablement (forces, leadership, qualité reconnue)
- neutral : mention factuelle sans jugement (apparait dans une liste, fait technique)
- negative : critique, faiblesses pointées, ou comparaison défavorable
- mixed : aspects positifs ET négatifs présents

Tu réponds UNIQUEMENT en JSON strict, format :
[{"response_id": "uuid", "sentiment": "positive|neutral|negative|mixed", "score": -1.0..1.0, "summary": "1 phrase qui justifie le sentiment"}]

score : -1.0 = très négatif, -0.5 = critique, 0 = neutre, 0.5 = favorable, 1.0 = élogieux. Pour "mixed" → score souvent autour de 0.`;

function buildUserPrompt(brandName: string, responses: ResponseRow[]): string {
  const items = responses.map((r) => {
    const text = (r.response_text || "").slice(0, 800);
    return `--- response_id: ${r.id} (LLM: ${r.llm}) ---\nPrompt: ${r.prompt_text}\nRéponse: ${text}\n`;
  }).join("\n");
  return `Marque cible : ${brandName}\n\nClassifie le sentiment de la marque dans chacune des ${responses.length} réponses ci-dessous.\n\n${items}\n\nRetourne le JSON array strict.`;
}

interface ParsedSentiment {
  response_id: string;
  sentiment: Exclude<Sentiment, "not_mentioned">;
  score: number;
  summary: string;
}

function parseHaikuOutput(raw: string): ParsedSentiment[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr)) throw new Error("expected JSON array");
  const ALLOWED = new Set<string>(["positive", "neutral", "negative", "mixed"]);
  return arr.filter((x: any) => x && typeof x.response_id === "string" && ALLOWED.has(x.sentiment))
    .map((x: any) => ({
      response_id: String(x.response_id),
      sentiment: x.sentiment,
      score: Math.max(-1, Math.min(1, Number(x.score ?? 0))),
      summary: String(x.summary ?? "").slice(0, 500),
    }));
}

async function callHaiku(system: string, user: string): Promise<{ text: string; cost_usd: number; raw: unknown }> {
  if (TEST_MODE) {
    return {
      text: JSON.stringify([]),
      cost_usd: 0.0001,
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
      "X-Title": "Geoperf SaaS Sentiment",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 4000,
      temperature: 0.2,
      usage: { include: true },
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${HAIKU_MODEL} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, raw: data };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { snapshot_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.snapshot_id) return new Response(JSON.stringify({ error: "snapshot_id required" }), { status: 400 });

  try {
    const { data: snap, error: snapErr } = await supabase
      .from("saas_brand_snapshots")
      .select("id, brand_id, user_id, status, raw_response_count, sentiment_analyzed_at")
      .eq("id", body.snapshot_id)
      .maybeSingle();
    if (snapErr || !snap) return new Response(JSON.stringify({ error: `snapshot not found: ${snapErr?.message}` }), { status: 404 });
    if (snap.status !== "completed") return new Response(JSON.stringify({ error: `snapshot status=${snap.status}` }), { status: 400 });
    if (snap.sentiment_analyzed_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already_analyzed", snapshot_id: snap.id }), { headers: { "content-type": "application/json" } });
    }

    // Tier-gate via owner (snapshot user_id = account_owner_id)
    const { data: sub } = await supabase
      .from("saas_subscriptions").select("tier")
      .eq("user_id", snap.user_id).eq("status", "active").maybeSingle();
    const tier = (sub as any)?.tier ?? "free";
    if (!ALLOWED_TIERS.has(tier)) {
      return new Response(JSON.stringify({ ok: true, skipped: "tier_too_low", tier, snapshot_id: snap.id }), { headers: { "content-type": "application/json" } });
    }

    const { data: brand } = await supabase
      .from("saas_tracked_brands").select("name").eq("id", snap.brand_id).single();
    const brandName = (brand as any)?.name ?? "?";

    // Load responses : on n'analyse que celles où la brand est mentionnée
    const { data: responses } = await supabase
      .from("saas_snapshot_responses")
      .select("id, llm, prompt_text, response_text, brand_mentioned")
      .eq("snapshot_id", snap.id);
    const respList = (responses as ResponseRow[] | null) ?? [];
    const totalResponses = respList.length;
    const mentionedList = respList.filter(r => r.brand_mentioned);

    // Distribution finale (à remplir)
    const distribution: Record<Sentiment, number> = {
      positive: 0, neutral: 0, negative: 0, mixed: 0,
      not_mentioned: totalResponses - mentionedList.length,
    };
    let avgScore = 0;
    let cost = 0;

    if (mentionedList.length > 0) {
      // Batch (limit 30 pour rester sous max_tokens)
      const BATCH_SIZE = 30;
      const allParsed: ParsedSentiment[] = [];
      for (let i = 0; i < mentionedList.length; i += BATCH_SIZE) {
        const batch = mentionedList.slice(i, i + BATCH_SIZE);
        const userPrompt = buildUserPrompt(brandName, batch);
        const result = await callHaiku(SYSTEM_PROMPT, userPrompt);
        cost += result.cost_usd;
        try {
          const parsed = parseHaikuOutput(result.text);
          allParsed.push(...parsed);
        } catch (e) {
          console.error(`[saas_analyze_sentiment] parse batch ${i}:`, (e as Error).message, "raw:", result.text.slice(0, 300));
        }
      }

      // Update responses ligne par ligne (pas de bulk update différencié possible en supabase-js)
      let scoreSum = 0;
      let scoredCount = 0;
      for (const p of allParsed) {
        await supabase.from("saas_snapshot_responses").update({
          sentiment: p.sentiment,
          sentiment_score: p.score,
          sentiment_summary: p.summary,
        }).eq("id", p.response_id).eq("snapshot_id", snap.id);
        distribution[p.sentiment] = (distribution[p.sentiment] ?? 0) + 1;
        scoreSum += p.score;
        scoredCount += 1;
      }
      avgScore = scoredCount > 0 ? scoreSum / scoredCount : 0;

      // Pour les mentioned non couvertes (Haiku rate-limited, parse fail), marker "neutral"
      const coveredIds = new Set(allParsed.map(p => p.response_id));
      const uncovered = mentionedList.filter(r => !coveredIds.has(r.id));
      for (const r of uncovered) {
        await supabase.from("saas_snapshot_responses").update({
          sentiment: "neutral", sentiment_score: 0, sentiment_summary: "Auto-fallback: non analysé par Haiku",
        }).eq("id", r.id);
        distribution.neutral += 1;
      }
    }

    // Mark not_mentioned responses
    const notMentionedIds = respList.filter(r => !r.brand_mentioned).map(r => r.id);
    if (notMentionedIds.length > 0) {
      await supabase.from("saas_snapshot_responses").update({
        sentiment: "not_mentioned", sentiment_score: null,
      }).in("id", notMentionedIds).is("sentiment", null);
    }

    // Update snapshot
    await supabase.from("saas_brand_snapshots").update({
      avg_sentiment_score: Math.round(avgScore * 100) / 100,
      sentiment_distribution: distribution,
      sentiment_analyzed_at: new Date().toISOString(),
    }).eq("id", snap.id);

    // Log usage
    await supabase.from("saas_usage_log").insert({
      user_id: snap.user_id,
      event_type: "sentiment_analyzed",
      cost_usd: Math.round(cost * 1000000) / 1000000,
      metadata: {
        snapshot_id: snap.id,
        brand_id: snap.brand_id,
        responses_analyzed: mentionedList.length,
        distribution,
        tier,
        model: HAIKU_MODEL,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: snap.id,
      avg_sentiment_score: Math.round(avgScore * 100) / 100,
      distribution,
      analyzed: mentionedList.length,
      cost_usd: cost,
      tier,
    }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_analyze_sentiment ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});