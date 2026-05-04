// GEOPERF SaaS — saas_suggest_prompts
// Spec : SPRINT_S15_BRIEF.md section 4.4
// Trigger : POST { user_id, name, domain, category, competitors[] }
//
// Pipeline :
//   1. Rate-limit côté simple : 1 appel par minute par user_id (table saas_usage_log)
//   2. Appel Haiku via OpenRouter
//   3. Parse strict du JSON output (5 entries: {category, template})
//   4. Retour { ok, prompts: [...], cost_usd, latency_ms }
//
// Coût : ~$0.001 par création de marque.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface SuggestedPrompt {
  category: "direct_search" | "competitive" | "use_case";
  template: string;
}

const SYSTEM_PROMPT = `Tu es un expert SEO/GEO B2B.
Génère exactement 5 prompts en français qui seraient typiquement posés par un acheteur B2B
cherchant des solutions dans la catégorie donnée.

Format STRICT : retourne un JSON array de 5 objets, sans markdown, sans commentaire.
Chaque objet : {"category": "direct_search" | "competitive" | "use_case", "template": "..."}

- direct_search : prompt qui cherche directement des leaders du secteur (ex : "Quelles sont les meilleures plateformes ...")
- competitive : prompt qui compare entre acteurs (ex : "Comparer X et Y pour ...")
- use_case : prompt qui part d'un besoin métier (ex : "Comment mettre en place ... pour PME")

Le template peut contenir les variables suivantes : {brand}, {category}, {competitors}, {competitors[0]}, {competitors[1]}, {competitors[2]}.
N'inclus pas la marque cible {brand} dans les prompts direct_search ou use_case (sauf 1 sur 5 max).
Pour competitive, utilise {competitors[0]}, {competitors[1]} si fournis.

Sortie attendue strictement :
[{"category":"...","template":"..."},...]`;

async function callHaiku(name: string, domain: string, category: string, competitors: string[]): Promise<{ text: string; cost_usd: number; latency_ms: number }> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const userPrompt = `Marque cible : ${name}
Domaine : ${domain}
Catégorie : ${category}
Concurrents connus : ${competitors.length > 0 ? competitors.join(", ") : "(aucun fourni)"}

Génère 5 prompts pertinents pour cette catégorie B2B.`;

  const t0 = Date.now();
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "Geoperf SaaS Prompt Suggest",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5-20251001",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 800,
      temperature: 0.4,
      usage: { include: true },
    }),
  });
  const latency_ms = Date.now() - t0;
  if (!resp.ok) {
    throw new Error(`OpenRouter HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, latency_ms };
}

function parsePrompts(text: string): SuggestedPrompt[] {
  // Strip markdown fences si Haiku en a mis quand même
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`output not JSON: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("output not an array");
  const result: SuggestedPrompt[] = [];
  for (const p of parsed) {
    if (typeof p !== "object" || p === null) continue;
    const obj = p as Record<string, unknown>;
    const cat = String(obj.category ?? "");
    const tpl = String(obj.template ?? "").trim();
    if (!tpl) continue;
    const validCat: SuggestedPrompt["category"] =
      cat === "direct_search" || cat === "competitive" || cat === "use_case"
        ? cat as SuggestedPrompt["category"]
        : "direct_search";
    result.push({ category: validCat, template: tpl });
    if (result.length >= 5) break;
  }
  if (result.length === 0) throw new Error("no valid prompts parsed");
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { user_id?: string; name?: string; domain?: string; category?: string; competitors?: string[] };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }

  if (!body.user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400 });
  if (!body.name) return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
  if (!body.category) return new Response(JSON.stringify({ error: "category required" }), { status: 400 });

  // Rate-limit : 1 appel/min par user
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("saas_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", body.user_id)
    .eq("event_type", "prompt_suggest")
    .gte("created_at", oneMinAgo);
  if ((count ?? 0) > 0) {
    return new Response(JSON.stringify({ error: "rate_limited", retry_after_seconds: 60 }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
  }

  try {
    const competitors = (body.competitors ?? []).filter(c => typeof c === "string" && c.length > 0).slice(0, 5);
    const { text, cost_usd, latency_ms } = await callHaiku(body.name, body.domain ?? "", body.category, competitors);
    const prompts = parsePrompts(text);

    await supabase.from("saas_usage_log").insert({
      user_id: body.user_id,
      event_type: "prompt_suggest",
      cost_usd,
      metadata: {
        name: body.name,
        category: body.category,
        prompts_count: prompts.length,
        latency_ms,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      prompts,
      cost_usd,
      latency_ms,
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_suggest_prompts ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
