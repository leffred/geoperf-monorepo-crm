// GEOPERF SaaS — saas_send_welcome_email
// Spec : saas/SPEC.md section 9 (Sprint S6) + brief NIGHT_BRIEF_S5_S6.md S6.1
// Trigger : POST { user_id }
//
// Pipeline :
//   1. Load profile (email, full_name, welcome_email_sent_at)
//   2. Skip si welcome_email_sent_at déjà set (idempotence)
//   3. Skip si profile.email_notifs_enabled=false (l'user a opt-out toutes les notifs)
//   4. Render template HTML on-brand
//   5. POST Resend from `hello@geoperf.com`
//   6. Update saas_profiles.welcome_email_sent_at
//   7. Insert saas_usage_log event_type=welcome_sent (cost=0)
//
// Pas de SAAS_TEST_MODE : si RESEND_API_KEY absent → skip silencieusement.
// Pas de gate par tier : tous les users (free inclus) reçoivent le welcome.

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

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  email_notifs_enabled: boolean;
  welcome_email_sent_at: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

function renderEmail(profile: ProfileRow): { subject: string; html: string; text: string } {
  const firstName = (profile.full_name?.split(" ")[0] || profile.email.split("@")[0]) ?? "";
  const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : "Bonjour,";
  const subject = "Bienvenue chez Geoperf — votre monitoring LLM est prêt";

  const ctaUrl = `${APP_URL}/app/brands/new`;
  const dashboardUrl = `${APP_URL}/app/dashboard`;
  const settingsUrl = `${APP_URL}/app/settings`;

  // S16 (§4.7) : palette legacy navy/cream/Source Serif → Tech crisp ink/surface/Inter.
  // Glyphe `·` ambré conservé sur le wordmark uniquement (signature visuelle).
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
.steps { margin:24px 0 28px; padding:0; list-style:none; counter-reset:step; }
.steps li { counter-increment:step; padding-left:48px; position:relative; margin-bottom:18px; }
.steps li::before { content: counter(step, decimal-leading-zero); position:absolute; left:0; top:-2px; font-family: "JetBrains Mono", monospace; font-size:11px; letter-spacing:1.5px; color:#FFFFFF; background:#0A0E1A; padding:6px 9px; }
.steps li strong { display:block; font-family: "Inter", sans-serif; font-size:15px; color:#0A0E1A; font-weight:500; letter-spacing:-0.01em; margin-bottom:2px; }
.steps li span { font-size:14px; color:#5B6478; line-height:1.55; }
.cta { display:inline-block; background:#0A0E1A; color:#FFFFFF !important; padding:14px 28px; font-size:15px; font-weight:500; text-decoration:none; margin:8px 0 24px; }
.subtle { font-size:13px; color:#5B6478; line-height:1.6; }
.footer { font-size:11px; color:#5B6478; padding:24px 16px 0; text-align:center; line-height:1.6; }
.footer a { color:#5B6478; text-decoration:underline; }
.logo { font-family: "Inter", sans-serif; font-size:22px; color:#0A0E1A; font-weight:500; }
.logo .dot { color:#EF9F27; }
</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow">Bienvenue dans Geoperf</p>
      <h1>${greeting}</h1>
      <p class="intro">Geoperf surveille en continu la perception de votre marque par les principaux LLM (ChatGPT, Claude, Gemini, Perplexity). Voici comment démarrer en 3 étapes :</p>

      <ol class="steps">
        <li>
          <strong>Ajoutez votre 1ère marque</strong>
          <span>Renseignez son nom, son domaine, sa catégorie et 2-3 concurrents. Le 1er snapshot se lance immédiatement.</span>
        </li>
        <li>
          <strong>Snapshot mensuel automatique</strong>
          <span>Le plan gratuit interroge ChatGPT chaque mois sur 30 prompts pertinents. Vous pouvez monter à 4 LLM hebdomadaires en upgradant vers Solo.</span>
        </li>
        <li>
          <strong>Recommandations actionnables</strong>
          <span>Après chaque snapshot, Claude Haiku analyse les résultats et vous propose 3 à 5 actions concrètes pour améliorer votre visibilité.</span>
        </li>
      </ol>

      <a href="${ctaUrl}" class="cta">Suivre ma 1ère marque →</a>

      <p class="subtle">Vous pouvez à tout moment consulter votre <a href="${dashboardUrl}" style="color:#2563EB;">dashboard</a> ou ajuster vos <a href="${settingsUrl}" style="color:#2563EB;">préférences notifications</a>.</p>
    </div>
    <div class="footer">
      <p class="logo">Ge<span class="dot">·</span>perf</p>
      <p>Une question ? Répondez simplement à cet email — c'est ${escapeHtml(HELLO_FROM)} qui le lit.</p>
      <p style="margin-top:12px;"><a href="${APP_URL}">geoperf.com</a></p>
    </div>
  </div>
</body></html>`;

  const text = [
    subject,
    "",
    greeting,
    "",
    "Geoperf surveille en continu la perception de votre marque par les principaux LLM (ChatGPT, Claude, Gemini, Perplexity).",
    "",
    "1. Ajoutez votre 1ère marque (nom, domaine, catégorie, 2-3 concurrents).",
    "2. Snapshot mensuel automatique : 30 prompts envoyés à ChatGPT (Solo+ : 4 LLM hebdo).",
    "3. Recommandations actionnables générées par Claude Haiku après chaque snapshot.",
    "",
    `Suivre ma 1ère marque : ${ctaUrl}`,
    `Dashboard : ${dashboardUrl}`,
    `Préférences notifications : ${settingsUrl}`,
    "",
    "Une question ? Répondez à cet email.",
  ].join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { user_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400 });

  try {
    const { data: profile, error: profileErr } = await supabase
      .from("saas_profiles")
      .select("id, email, full_name, email_notifs_enabled, welcome_email_sent_at")
      .eq("id", body.user_id)
      .maybeSingle();
    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: `profile not found: ${profileErr?.message}` }), { status: 404 });
    }
    if (profile.welcome_email_sent_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already_sent", user_id: profile.id }), { headers: { "content-type": "application/json" } });
    }
    if (!profile.email_notifs_enabled) {
      // L'user a opt-out toutes les notifs avant même son welcome — on respecte
      return new Response(JSON.stringify({ ok: true, skipped: "user_opt_out", user_id: profile.id }), { headers: { "content-type": "application/json" } });
    }
    if (!RESEND_API_KEY) {
      console.warn("[saas_send_welcome_email] RESEND_API_KEY missing, skipping send");
      return new Response(JSON.stringify({ ok: true, skipped: "no_resend_key", user_id: profile.id }), { headers: { "content-type": "application/json" } });
    }

    const { subject, html, text } = renderEmail(profile as ProfileRow);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: HELLO_FROM,
        to: [profile.email],
        subject,
        html,
        text,
        tags: [{ name: "type", value: "welcome" }],
      }),
    });

    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 400);
      console.error(`[saas_send_welcome_email] Resend ${resp.status}: ${errText}`);
      throw new Error(`Resend HTTP ${resp.status}: ${errText}`);
    }
    const resendData = await resp.json();

    await supabase.from("saas_profiles").update({ welcome_email_sent_at: new Date().toISOString() }).eq("id", profile.id);

    await supabase.from("saas_usage_log").insert({
      user_id: profile.id,
      event_type: "welcome_sent",
      cost_usd: 0,
      metadata: { resend_email_id: resendData.id ?? null, to: profile.email },
    });

    return new Response(JSON.stringify({ ok: true, user_id: profile.id, resend_email_id: resendData.id ?? null, to: profile.email }), {
      headers: { "content-type": "application/json" },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_send_welcome_email ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});