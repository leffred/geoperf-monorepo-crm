// GEOPERF SaaS — saas_generate_content_draft
// Spec : SPRINTS_S8_S9_S10_PLAN.md S9.3
// Trigger : POST { brand_id, draft_type, focus_topic_id?, source_snapshot_id? }
//
// Pipeline :
//   1. Auth user via Bearer JWT (le caller envoie son JWT)
//   2. Tier-gate Pro+ obligatoire
//   3. Quota : Pro = 10 drafts/mois (function SQL saas_drafts_count_this_month)
//   4. Charge brand + dernier snapshot completed (avec recos + top sources)
//   5. Identifie les gaps (sources autorité que les concurrents citent + pas la marque)
//   6. Sonnet 4.6 prompt structuré → JSON {title, body, target_keywords, target_authority_sources}
//   7. Insert saas_content_drafts status='draft'
//   8. Log usage cost
//
// Coût : ~$0.05 par draft (Sonnet 4.6).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const TEST_MODE = Deno.env.get("SAAS_TEST_MODE") === "true";

const SONNET_MODEL = "anthropic/claude-sonnet-4-6";
const ALLOWED_TIERS = new Set(["pro", "agency"]);
const PRO_MONTHLY_QUOTA = 10;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type DraftType = "blog_post" | "press_release" | "linkedin_post" | "tweet";
const ALLOWED_DRAFT_TYPES: Set<string> = new Set<string>(["blog_post", "press_release", "linkedin_post", "tweet"]);

const DRAFT_FORMAT_GUIDE: Record<DraftType, string> = {
  blog_post: "Format : article de blog 600-900 mots, structuré (intro / 3-4 sections / conclusion). Ton expert mais accessible.",
  press_release: "Format : communiqué de presse classique 250-400 mots. Structure : titre, sous-titre, dateline, paragraphe d'accroche, citation, contexte, à propos.",
  linkedin_post: "Format : post LinkedIn 150-250 mots, accroche forte ligne 1, paragraphes courts, 1 question ouverte, 3-5 hashtags pertinents en fin.",
  tweet: "Format : 1 tweet 240-280 caractères max, accroche directe, 1-2 hashtags. Pas de tableau, pas de listes longues.",
};

const SYSTEM_PROMPT = `Tu es un copywriter expert en GEO (Generative Engine Optimization) — l'optimisation de la visibilité d'une marque dans les LLM.

Ton rôle : générer un draft de contenu qui :
1. Mentionne la marque cible naturellement (sans bourrage)
2. Cible les keywords identifiés
3. Est format-adapté (blog post, press release, LinkedIn post, ou tweet)
4. Apporte une vraie valeur informative (les LLM citent des contenus utiles, pas des pubs)
5. Suggère 2-3 sources autorité (médias / sites) où ce contenu pourrait être pitché

Tu réponds UNIQUEMENT en JSON strict :
{
  "title": "Titre accrocheur (max 100 chars)",
  "body": "Contenu complet du draft. Markdown léger autorisé : **gras**, listes -. PAS de h1 (le title sert).",
  "target_keywords": ["keyword1","keyword2","keyword3"],
  "target_authority_sources": [
    {"domain": "ft.com", "why": "Couvre déjà les concurrents sur ce thème"},
    {"domain": "lesechos.fr", "why": "Audience décideurs B2B fr"}
  ]
}`;

async function callSonnet(system: string, user: string): Promise<{ text: string; cost_usd: number; raw: unknown }> {
  if (TEST_MODE) {
    return {
      text: JSON.stringify({
        title: "[Mock] Article généré en test mode",
        body: "Mock body. Activer SAAS_TEST_MODE=false pour générer un vrai draft.",
        target_keywords: ["mock"],
        target_authority_sources: [{ domain: "example.com", why: "mock" }],
      }),
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
      "X-Title": "Geoperf SaaS Content Studio",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 3000,
      temperature: 0.7,
      usage: { include: true },
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${SONNET_MODEL} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const cost_usd = Number(data.usage?.cost ?? data.usage?.total_cost ?? 0) || 0;
  return { text, cost_usd, raw: data };
}

function parseSonnetOutput(raw: string): {
  title: string;
  body: string;
  target_keywords: string[];
  target_authority_sources: Array<{ domain: string; why?: string }>;
} {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  const obj = JSON.parse(cleaned);
  return {
    title: String(obj?.title ?? "").slice(0, 200) || "(sans titre)",
    body: String(obj?.body ?? "").slice(0, 8000),
    target_keywords: Array.isArray(obj?.target_keywords) ? obj.target_keywords.slice(0, 10).map((x: unknown) => String(x).slice(0, 60)) : [],
    target_authority_sources: Array.isArray(obj?.target_authority_sources)
      ? obj.target_authority_sources.slice(0, 5).map((x: any) => ({
          domain: String(x?.domain ?? "").slice(0, 80),
          why: x?.why ? String(x.why).slice(0, 200) : undefined,
        }))
      : [],
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });

  // Auth user via Bearer (le frontend envoie le JWT du user)
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401 });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  let body: { brand_id?: string; draft_type?: string; focus_topic_id?: string; source_snapshot_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.brand_id || !body.draft_type) return new Response(JSON.stringify({ error: "brand_id + draft_type required" }), { status: 400 });
  if (!ALLOWED_DRAFT_TYPES.has(body.draft_type)) return new Response(JSON.stringify({ error: "invalid draft_type" }), { status: 400 });
  const draftType = body.draft_type as DraftType;

  try {
    // Vérifie que la brand appartient au compte du caller
    const { data: brand } = await adminClient
      .from("saas_tracked_brands")
      .select("id, user_id, name, domain, category_slug, brand_description, brand_keywords, brand_value_props, competitor_domains")
      .eq("id", body.brand_id).maybeSingle();
    if (!brand) return new Response(JSON.stringify({ error: "brand not found" }), { status: 404 });

    // L'owner_id du brand doit être le user OU un compte dont user est membre
    const { data: acct } = await adminClient
      .from("v_saas_user_account").select("account_owner_id, role").eq("user_id", user.id).maybeSingle();
    const ownerId = (acct as any)?.account_owner_id ?? user.id;
    if ((brand as any).user_id !== ownerId) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }

    // Tier-gate
    const { data: sub } = await adminClient
      .from("saas_subscriptions").select("tier").eq("user_id", ownerId).in("status", ["active", "trialing"]).maybeSingle();
    const tier = (sub as any)?.tier ?? "free";
    if (!ALLOWED_TIERS.has(tier)) {
      return new Response(JSON.stringify({ error: "tier_too_low", tier, hint: "Content Studio est réservé Pro+." }), { status: 403 });
    }

    // Quota mensuel pour Pro
    if (tier === "pro") {
      const { data: countRow } = await adminClient.rpc("saas_drafts_count_this_month", { p_user_id: ownerId });
      const used = Number(countRow ?? 0);
      if (used >= PRO_MONTHLY_QUOTA) {
        return new Response(JSON.stringify({ error: "quota_exceeded", used, limit: PRO_MONTHLY_QUOTA, hint: "Upgrade Agency pour drafts illimités." }), { status: 429 });
      }
    }

    // Charge dernier snapshot completed pour contexte
    const snapshotIdInput = body.source_snapshot_id ?? null;
    let snapQuery = adminClient.from("saas_brand_snapshots")
      .select("id, visibility_score, citation_rate, share_of_voice, sentiment_distribution, alignment_gaps")
      .eq("brand_id", brand.id).eq("status", "completed")
      .order("created_at", { ascending: false }).limit(1);
    if (snapshotIdInput) snapQuery = adminClient.from("saas_brand_snapshots")
      .select("id, visibility_score, citation_rate, share_of_voice, sentiment_distribution, alignment_gaps")
      .eq("id", snapshotIdInput).eq("brand_id", brand.id);
    const { data: snapshots } = await snapQuery;
    const lastSnapshot = (snapshots as any[] | null)?.[0] ?? null;

    // Top sources cited (pour suggérer authority targets)
    let topSourceDomains: string[] = [];
    if (lastSnapshot?.id) {
      const { data: respSrc } = await adminClient
        .from("saas_snapshot_responses").select("sources_cited").eq("snapshot_id", lastSnapshot.id);
      const counts: Record<string, number> = {};
      for (const r of (respSrc as any[] | null) ?? []) {
        for (const s of (r.sources_cited ?? []) as Array<{ domain?: string }>) {
          const dom = (s?.domain || "").toLowerCase();
          if (dom) counts[dom] = (counts[dom] ?? 0) + 1;
        }
      }
      topSourceDomains = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d);
    }

    // Build prompt
    const focusTopicLine = body.focus_topic_id ? `Topic ciblé : ${body.focus_topic_id}` : "";
    const userPrompt = `${DRAFT_FORMAT_GUIDE[draftType]}

MARQUE : ${(brand as any).name} (${(brand as any).domain})
CATÉGORIE : ${((brand as any).category_slug || "").replace(/-/g, " ")}
DESCRIPTION : ${(brand as any).brand_description || "(non fournie)"}
KEYWORDS À INCLURE : ${(((brand as any).brand_keywords as string[]) || []).join(", ") || "(libre)"}
VALUE PROPS : ${(((brand as any).brand_value_props as string[]) || []).join(" | ") || "(libres)"}
CONCURRENTS PRINCIPAUX : ${(((brand as any).competitor_domains as string[]) || []).slice(0, 3).join(", ") || "(non listés)"}
${focusTopicLine}

CONTEXTE GEO (si snapshot dispo) :
- Visibility score actuel : ${lastSnapshot?.visibility_score ?? "n/a"} / 100
- Citation rate : ${lastSnapshot?.citation_rate ?? "n/a"}%
- Top sources autorité fréquentes dans ce secteur : ${topSourceDomains.slice(0, 6).join(", ") || "(non identifiées)"}

Génère un draft ${draftType} qui aiderait cette marque à gagner en visibilité dans les LLM. Retourne le JSON spécifié.`;

    const result = await callSonnet(SYSTEM_PROMPT, userPrompt);
    let parsed;
    try {
      parsed = parseSonnetOutput(result.text);
    } catch (e) {
      console.error("[saas_generate_content_draft] parse:", (e as Error).message, "raw:", result.text.slice(0, 300));
      return new Response(JSON.stringify({ error: "Sonnet returned invalid JSON", raw_excerpt: result.text.slice(0, 200) }), { status: 502 });
    }

    const target_authority_sources_strings = parsed.target_authority_sources.map(s =>
      s.why ? `${s.domain} — ${s.why}` : s.domain
    );

    const { data: inserted, error: insErr } = await adminClient.from("saas_content_drafts").insert({
      brand_id: brand.id,
      user_id: ownerId,
      topic_id: body.focus_topic_id ?? null,
      draft_type: draftType,
      title: parsed.title,
      body: parsed.body,
      target_keywords: parsed.target_keywords,
      target_authority_sources: target_authority_sources_strings,
      status: "draft",
      cost_usd: result.cost_usd,
      llm_used: SONNET_MODEL,
      source_snapshot_id: lastSnapshot?.id ?? null,
    }).select("id").single();
    if (insErr || !inserted) {
      throw new Error(`insert draft: ${insErr?.message}`);
    }

    await adminClient.from("saas_usage_log").insert({
      user_id: ownerId,
      event_type: "content_draft_generated",
      cost_usd: Math.round(result.cost_usd * 1000000) / 1000000,
      metadata: {
        draft_id: (inserted as any).id,
        brand_id: brand.id,
        draft_type: draftType,
        tier,
        model: SONNET_MODEL,
        keywords_count: parsed.target_keywords.length,
        sources_suggested: parsed.target_authority_sources.length,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      draft_id: (inserted as any).id,
      draft_type: draftType,
      title: parsed.title,
      cost_usd: result.cost_usd,
      tier,
    }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_generate_content_draft ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});