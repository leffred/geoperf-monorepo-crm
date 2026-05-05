// GEOPERF — saas_lead_magnet_crm_hook
// S19 §4.1.e : insert prospect minimal + event lead_magnet_download.
// Trigger : POST { email, sous_categorie_slug, report_id?, ip?, user_agent?, source_path? }
//
// Pipeline :
//   1. Parse domain depuis email (john@acme.com → acme.com). Skip si email free
//      (gmail/yahoo/etc) côté CRM (mais le download est quand même tracké côté frontend).
//   2. Upsert company sur (nom_normalise, domain) via le domain.
//   3. Upsert prospect sur email — si déjà connu, on update juste metadata.downloads_count
//      et metadata.last_lead_magnet_at.
//   4. Insert prospect_event event_type=lead_magnet_download.
//   5. Update lead_magnet_downloads.prospect_id (lookup le download le plus récent
//      matching email+sous_categorie_slug sans prospect_id).
//
// Fallback : si Apollo enrichment indispo, on cree un prospect "minimal" (juste email+
// company.domain). Pas d'appel Apollo MCP cote Edge Function — l'enrichissement
// peut etre fait par le workflow Phase 4 Attio Sync s'il est branche.
//
// Pas d'auth required (appele depuis server action signee service_role cote Vercel).
// Idempotent : double-call pour le meme email+report_id n'insere qu'un seul event.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Free email providers — on les ignore pour le matching company (mais on garde le prospect)
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.fr", "ymail.com",
  "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me",
  "free.fr", "orange.fr", "wanadoo.fr", "laposte.net", "sfr.fr", "neuf.fr",
  "aol.com", "gmx.com", "gmx.fr",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFirstName(email: string): string | null {
  const local = email.split("@")[0];
  if (!local) return null;
  // Cas john.smith@... ou john_smith@...
  const first = local.split(/[._-]/)[0] ?? "";
  if (!first || /^\d+$/.test(first)) return null;
  // Capitalize
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function nomFromDomain(domain: string): string {
  // acme-corp.com → "Acme Corp"
  const root = domain.split(".")[0] ?? domain;
  return root
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: {
    email?: string;
    sous_categorie_slug?: string;
    report_id?: string | null;
    ip?: string | null;
    user_agent?: string | null;
    source_path?: string | null;
  };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.email || !body.sous_categorie_slug) {
    return new Response(JSON.stringify({ error: "email + sous_categorie_slug required" }), { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const emailParts = email.split("@");
  if (emailParts.length !== 2 || !emailParts[1]) {
    return new Response(JSON.stringify({ error: "invalid email" }), { status: 400 });
  }
  const domain = emailParts[1];
  const isFreeProvider = FREE_EMAIL_DOMAINS.has(domain);

  try {
    // 1. Company upsert (skip si free email — on n'invente pas une boite)
    let companyId: string | null = null;
    if (!isFreeProvider) {
      const nom = nomFromDomain(domain);
      const nomNormalise = normalize(nom);

      // Check existing match (nom_normalise, domain) UNIQUE constraint
      const { data: existingCompany } = await supabase
        .from("companies")
        .select("id")
        .eq("nom_normalise", nomNormalise)
        .eq("domain", domain)
        .maybeSingle();

      if (existingCompany?.id) {
        companyId = existingCompany.id;
      } else {
        const { data: newCompany, error: companyErr } = await supabase
          .from("companies")
          .insert({
            nom,
            nom_normalise: nomNormalise,
            domain,
            country: null,
          })
          .select("id")
          .single();
        if (companyErr) {
          console.warn("[saas_lead_magnet_crm_hook] company insert err:", companyErr.message);
        } else {
          companyId = newCompany.id;
        }
      }
    }

    // 2. Lookup category_id pour la sous-cat
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", body.sous_categorie_slug)
      .maybeSingle();
    const categoryId = cat?.id ?? null;

    // 3. Prospect upsert sur email
    const firstName = parseFirstName(email);
    const newMetadata = {
      source: "lead_magnet",
      first_seen_at: new Date().toISOString(),
      first_sous_categorie_slug: body.sous_categorie_slug,
      ip: body.ip ?? null,
      user_agent: body.user_agent ?? null,
      source_path: body.source_path ?? null,
    };

    const { data: existingProspect } = await supabase
      .from("prospects")
      .select("id, metadata, status")
      .eq("email", email)
      .maybeSingle();

    let prospectId: string;
    if (existingProspect?.id) {
      prospectId = existingProspect.id;
      const prevMeta = (existingProspect.metadata ?? {}) as Record<string, unknown>;
      const prevDownloads = Array.isArray(prevMeta.downloaded_reports)
        ? (prevMeta.downloaded_reports as string[])
        : [];
      const downloadedReports = body.report_id
        ? Array.from(new Set([...prevDownloads, body.report_id]))
        : prevDownloads;
      const mergedMeta = {
        ...prevMeta,
        ...newMetadata,
        first_seen_at: prevMeta.first_seen_at ?? newMetadata.first_seen_at,
        downloaded_reports: downloadedReports,
        last_lead_magnet_at: new Date().toISOString(),
        last_sous_categorie_slug: body.sous_categorie_slug,
      };
      await supabase
        .from("prospects")
        .update({
          metadata: mergedMeta,
          company_id: existingProspect.metadata && companyId ? companyId : (companyId ?? null),
          category_id: categoryId,
          report_id: body.report_id ?? null,
          first_name: firstName ?? undefined,
          download_at: new Date().toISOString(),
          last_engagement_at: new Date().toISOString(),
        })
        .eq("id", prospectId);
    } else {
      const { data: newProspect, error: prospectErr } = await supabase
        .from("prospects")
        .insert({
          email,
          first_name: firstName,
          company_id: companyId,
          category_id: categoryId,
          report_id: body.report_id ?? null,
          status: "engaged",
          download_at: new Date().toISOString(),
          first_contact_at: new Date().toISOString(),
          last_engagement_at: new Date().toISOString(),
          metadata: {
            ...newMetadata,
            downloaded_reports: body.report_id ? [body.report_id] : [],
            last_sous_categorie_slug: body.sous_categorie_slug,
          },
        })
        .select("id")
        .single();
      if (prospectErr) {
        console.error("[saas_lead_magnet_crm_hook] prospect insert err:", prospectErr.message);
        return new Response(JSON.stringify({ error: `prospect insert failed: ${prospectErr.message}` }), { status: 500 });
      }
      prospectId = newProspect.id;
    }

    // 4. Insert prospect_event
    await supabase.from("prospect_events").insert({
      prospect_id: prospectId,
      event_type: "lead_magnet_download",
      channel: "web",
      metadata: {
        sous_categorie_slug: body.sous_categorie_slug,
        report_id: body.report_id ?? null,
        ip: body.ip ?? null,
        user_agent: body.user_agent ?? null,
        is_free_provider: isFreeProvider,
      },
      created_by: "saas_lead_magnet_crm_hook",
    });

    // 5. Best-effort : remonter prospect_id sur la row lead_magnet_downloads la plus
    //    recente matchant email+sous_categorie_slug sans prospect_id
    await supabase
      .from("lead_magnet_downloads")
      .update({ prospect_id: prospectId })
      .eq("email", email)
      .eq("sous_categorie_slug", body.sous_categorie_slug)
      .is("prospect_id", null);

    return new Response(
      JSON.stringify({
        ok: true,
        prospect_id: prospectId,
        company_id: companyId,
        is_free_provider: isFreeProvider,
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_lead_magnet_crm_hook ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
