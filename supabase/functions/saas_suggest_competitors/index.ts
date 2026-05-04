// GEOPERF SaaS — saas_suggest_competitors
// Spec : SPRINT_S17_BRIEF.md §4.6 (BUGS_AND_FEEDBACK #1.6)
// Trigger : POST { user_id, brand_name, domain, category }
//
// Pattern identique à saas_suggest_prompts (S15) :
//   1. Rate-limit 1 appel/min/user via saas_usage_log
//   2. Appel Haiku via OpenRouter
//   3. Parse strict JSON [{name, domain}]
//   4. Insert saas_usage_log event_type=competitor_suggest
//   5. Return { ok, suggestions, cost_usd, latency_ms }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface Suggestion {
  name: string;
  domain: string;
}

const SYSTEM_PROMPT = `Tu es un analyste B2B francophone. Tu connais les marchés français, européens et anglo-saxons.

Pour la marque cible donnée, identifie EXACTEMENT 5 concurrents directs dans la même catégorie. Privilégie des concurrents pertinents pour le marché français quand c'est applicable, mais inclus aussi 1-2 acteurs internationaux majeurs si la catégorie est globalisée.

Format STRICT : retourne un JSON array de 5 objets, sans markdown, sans commentaire.
Chaque objet : {"name": "Nom de la marque", "domain": "domaine-principal.com"}

Règles :
- Le domain doit être le domaine principal (sans http://, sans www., sans path)
- Pas inclure la marque cible elle-même
- Pas de doublon
- Privilégier des marques actives en 2026

Sortie attendue strictement :
[{"name":"...","domain":"..."},{"name":"...","domain":"..."},{"name":"...","domain":"..."},{"name":"...","domain":"..."},{"name":"...","domain":"..."}]`;

async function callHaiku(brandName: string, domain: string, category: string): Promise<{ text: string; cost_usd: number; latency_ms: number }> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const userPrompt = `Marque cible : ${brandName}
Domaine : ${domain || "(non fourni)"}
Catégorie : ${category}

Identifie 5 concurrents directs.`;

  const t0 = Date.now();
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "Geoperf SaaS Competitor Suggest",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4-5-20251001",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.3,
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

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function parseCompetitors(text: string, targetDomain: string): Suggestion[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`output not JSON: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("output not an array");

  const targetNorm = normalizeDomain(targetDomain);
  const seen = new Set<string>();
  const result: Suggestion[] = [];
  for (const p of parsed) {
    if (typeof p !== "object" || p === null) continue;
    const obj = p as Record<string, unknown>;
    const name = String(obj.name ?? "").trim();
    const domain = normalizeDomain(String(obj.domain ?? ""));
    if (!name || !domain || !domain.includes(".")) continue;
    if (domain === targetNorm) continue;     // skip target itself
    if (seen.has(domain)) continue;          // skip duplicates
    seen.add(domain);
    result.push({ name, domain });
    if (result.length >= 5) break;
  }
  if (result.length === 0) throw new Error("no valid suggestions parsed");
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { user_id?: string; brand_name?: string; domain?: string; category?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }

  if (!body.user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400 });
  if (!body.brand_name) return new Response(JSON.stringify({ error: "brand_name required" }), { status: 400 });
  if (!body.category) return new Response(JSON.stringify({ error: "category required" }), { status: 400 });

  // Rate-limit 1 appel/min/user
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("saas_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", body.user_id)
    .eq("event_type", "competitor_suggest")
    .gte("created_at", oneMinAgo);
  if ((count ?? 0) > 0) {
    return new Response(JSON.stringify({ error: "rate_limited", retry_after_seconds: 60 }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
  }

  try {
    const { text, cost_usd, latency_ms } = await callHaiku(body.brand_name, body.domain ?? "", body.category);
    const suggestions = parseCompetitors(text, body.domain ?? "");

    await supabase.from("saas_usage_log").insert({
      user_id: body.user_id,
      event_type: "competitor_suggest",
      cost_usd,
      metadata: {
        brand_name: body.brand_name,
        category: body.category,
        suggestions_count: suggestions.length,
        latency_ms,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      suggestions,
      cost_usd,
      latency_ms,
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_suggest_competitors ERROR]", msg);
    return new Response(JSON.stringify({ error: msg, hint: msg.includes("OPENROUTER") ? "Check OPENROUTER_API_KEY secret on saas_suggest_competitors Edge Function" : undefined }), { status: 500 });
  }
});
