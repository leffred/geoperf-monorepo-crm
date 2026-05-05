// GEOPERF — saas_send_lead_magnet_email
// S19 §4.1.d : envoi email PDF lead-magnet via Resend.
// Trigger : POST { email, report_id, sous_categorie?, sous_categorie_slug? }
//
// Pipeline :
//   1. Load report (verifie status=ready, recupere pdf_url + sous_categorie + slug_public)
//   2. Render template HTML inline (Tech crisp brande Geoperf)
//   3. POST Resend
//   4. UPDATE lead_magnet_downloads.email_sent_at (idempotent : sur le download le plus
//      recent matchant email+report_id sans email_sent_at)
//
// Pas de SAAS_TEST_MODE : si RESEND_API_KEY absent → skip silencieusement.
// Pas de gate par tier : tout user lead-magnet recoit le PDF.
// Garde-fou : ne touche PAS au render_white_paper (le PDF existe deja).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const HELLO_FROM = Deno.env.get("HELLO_EMAIL_FROM") ?? "Geoperf <hello@geoperf.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://geoperf.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface ReportRow {
  id: string;
  sous_categorie: string;
  slug_public: string | null;
  pdf_url: string | null;
  status: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as Record<string, string>)[c]
  );
}

function renderEmail(args: {
  email: string;
  report: ReportRow;
  pdfUrl: string;
  unsubUrl: string;
}): { subject: string; html: string; text: string } {
  const { report, pdfUrl, unsubUrl } = args;
  const sousCatLabel = escapeHtml(report.sous_categorie);
  const subject = `Votre étude ${report.sous_categorie} 2026 — Geoperf`;

  const ctaSignup = `${APP_URL}/signup?source=etude`;
  const ctaContact = `${APP_URL}/contact`;
  const ctaOther = `${APP_URL}/etude-sectorielle`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>
body { margin:0; padding:0; background:#F7F8FA; font-family: -apple-system, "Inter", "Segoe UI", sans-serif; color:#0A0E1A; }
.wrap { max-width:560px; margin:0 auto; padding:32px 16px; }
.card { background:#FFFFFF; padding:36px 32px; }
.eyebrow { font-family: "JetBrains Mono", "IBM Plex Mono", monospace; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#2563EB; margin:0 0 12px; }
h1 { font-family: "Inter", sans-serif; font-size:26px; line-height:1.3; color:#0A0E1A; font-weight:500; letter-spacing:-0.025em; margin:0 0 16px; }
p { font-size:15px; line-height:1.65; margin:0 0 14px; }
.intro { font-size:15px; color:#0A0E1A; margin-bottom:24px; }
.cta { display:inline-block; background:#0A0E1A; color:#FFFFFF !important; padding:14px 28px; font-size:15px; font-weight:500; text-decoration:none; margin:8px 0 24px; }
.cta-secondary { display:inline-block; background:#FFFFFF; color:#0A0E1A !important; padding:12px 22px; font-size:14px; font-weight:500; text-decoration:none; border:1px solid #E5E7EB; margin:0 6px 8px 0; }
.divider { height:1px; background:#E5E7EB; margin:28px 0 24px; }
.next-title { font-family: "JetBrains Mono", monospace; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#5B6478; margin:0 0 16px; }
.subtle { font-size:13px; color:#5B6478; line-height:1.6; }
.footer { font-size:11px; color:#5B6478; padding:24px 16px 0; text-align:center; line-height:1.6; }
.footer a { color:#5B6478; text-decoration:underline; }
.logo { font-family: "Inter", sans-serif; font-size:22px; color:#0A0E1A; font-weight:500; }
.logo .dot { color:#EF9F27; }
</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow">Étude sectorielle ${sousCatLabel}</p>
      <h1>Voici votre étude.</h1>
      <p class="intro">Vous trouverez ci-dessous le rapport Geoperf 2026 sur <strong>${sousCatLabel}</strong>. Bonne lecture.</p>

      <a href="${pdfUrl}" class="cta">Télécharger le PDF →</a>

      <p class="subtle">Le lien reste valide 7 jours. Si vous voulez le recevoir à nouveau, demandez-le sur <a href="${ctaOther}" style="color:#2563EB;">geoperf.com/etude-sectorielle</a>.</p>

      <div class="divider"></div>

      <p class="next-title">Et après ?</p>
      <p>Trois façons simples de prolonger l&#39;analyse :</p>
      <p style="margin-top:8px;">
        <a href="${ctaContact}" class="cta-secondary">Demander un audit GEO</a>
        <a href="${ctaSignup}" class="cta-secondary">Tester Geoperf SaaS gratuitement</a>
        <a href="${ctaOther}" class="cta-secondary">Une autre étude sectorielle</a>
      </p>
    </div>
    <div class="footer">
      <p class="logo">Ge<span class="dot">·</span>perf</p>
      <p>Vous avez reçu cet email parce que vous avez demandé l&#39;étude ${sousCatLabel} sur geoperf.com.</p>
      <p style="margin-top:6px;"><a href="${unsubUrl}">Se désinscrire</a> · <a href="${APP_URL}/privacy">Confidentialité</a></p>
      <p style="margin-top:12px;">Geoperf est édité par Jourdechance SAS, SIREN 838 114 619. Données hébergées Frankfurt (UE).</p>
    </div>
  </div>
</body></html>`;

  const text = [
    subject,
    "",
    `Voici votre étude ${report.sous_categorie} 2026.`,
    "",
    `Télécharger le PDF : ${pdfUrl}`,
    "",
    "(Le lien reste valide 7 jours.)",
    "",
    "Et après ?",
    `- Audit GEO : ${ctaContact}`,
    `- Geoperf SaaS gratuit : ${ctaSignup}`,
    `- Une autre étude : ${ctaOther}`,
    "",
    `Se désinscrire : ${unsubUrl}`,
    `Confidentialité : ${APP_URL}/privacy`,
    "",
    `Reçu de la part de ${HELLO_FROM} (Jourdechance SAS, SIREN 838 114 619).`,
  ].join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { email?: string; report_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.email || !body.report_id) {
    return new Response(JSON.stringify({ error: "email + report_id required" }), { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  try {
    const { data: report, error: reportErr } = await supabase
      .from("reports")
      .select("id, sous_categorie, slug_public, pdf_url, status")
      .eq("id", body.report_id)
      .maybeSingle();
    if (reportErr || !report) {
      return new Response(JSON.stringify({ error: `report not found: ${reportErr?.message ?? "no row"}` }), { status: 404 });
    }
    if (report.status !== "ready" || !report.pdf_url) {
      return new Response(JSON.stringify({ error: `report not ready (status=${report.status})` }), { status: 409 });
    }

    if (!RESEND_API_KEY) {
      console.warn("[saas_send_lead_magnet_email] RESEND_API_KEY missing, skipping send");
      return new Response(JSON.stringify({ ok: true, skipped: "no_resend_key", email, report_id: report.id }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Unsubscribe URL : pour le moment lien vers /privacy. Pas d'opt-out automatise
    // sur lead_magnet_downloads car table sans user — la resiliation passe par
    // reponse a hello@geoperf.com (RGPD doc dans /privacy).
    const unsubUrl = `${APP_URL}/privacy#unsubscribe`;

    const { subject, html, text } = renderEmail({
      email,
      report: report as ReportRow,
      pdfUrl: report.pdf_url!,
      unsubUrl,
    });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: HELLO_FROM,
        to: [email],
        subject,
        html,
        text,
        tags: [
          { name: "type", value: "lead_magnet" },
          { name: "sous_cat", value: report.slug_public ?? "unknown" },
        ],
      }),
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 400);
      console.error(`[saas_send_lead_magnet_email] Resend ${resp.status}: ${errText}`);
      throw new Error(`Resend HTTP ${resp.status}: ${errText}`);
    }
    const resendData = await resp.json();

    // Best-effort : marquer le download le plus recent matchant email+report_id
    await supabase
      .from("lead_magnet_downloads")
      .update({ email_sent_at: new Date().toISOString(), resend_email_id: resendData.id ?? null })
      .eq("email", email)
      .eq("report_id", report.id)
      .is("email_sent_at", null);

    return new Response(
      JSON.stringify({ ok: true, email, report_id: report.id, resend_email_id: resendData.id ?? null }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_send_lead_magnet_email ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
