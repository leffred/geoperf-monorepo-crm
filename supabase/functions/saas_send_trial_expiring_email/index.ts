// GEOPERF SaaS — saas_send_trial_expiring_email
// Spec : SPRINT_S17_BRIEF.md §4.7
// Trigger : POST {} (vide) — déclenché par pg_cron quotidien 8h UTC.
//
// Pipeline :
//   1. SELECT subs trialing dont current_period_end est dans 24-48h ET
//      trial_expiring_email_sent_at IS NULL
//   2. Pour chaque, fetch profile (email, full_name)
//   3. Render template Tech crisp (Inter, ink, brand-500, glyphe ambré)
//   4. POST Resend
//   5. UPDATE saas_subscriptions.trial_expiring_email_sent_at = NOW() (idempotence)
//   6. Insert saas_usage_log event_type=trial_expiring_notified

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERTS_FROM = Deno.env.get("ALERTS_EMAIL_FROM") ?? "Geoperf Alerts <alerts@geoperf.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://geoperf.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
}

interface TrialEntry {
  user_id: string;
  email: string;
  full_name: string | null;
  tier: string;
  trial_end: Date;
  has_payment_method: boolean;
}

function renderEmail(entry: TrialEntry): { subject: string; html: string; text: string } {
  const firstName = entry.full_name?.split(" ")[0] ?? "";
  const greeting = firstName ? `Bonjour ${escapeHtml(firstName)},` : "Bonjour,";
  const dateStr = entry.trial_end.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const daysLeft = Math.max(1, Math.ceil((entry.trial_end.getTime() - Date.now()) / 86400000));
  const subject = `Ton trial Geoperf ${entry.tier.toUpperCase()} se termine dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`;
  const billingUrl = `${APP_URL}/app/billing`;

  const cbStatusBlock = entry.has_payment_method
    ? `<div style="border-left:2px solid #1D9E75;padding-left:16px;margin:20px 0;font-size:14px;line-height:1.6;background:#ECFDF5;padding-top:12px;padding-bottom:12px;">
        <strong>Carte enregistrée — facturation automatique le ${escapeHtml(dateStr)}.</strong> Aucune action requise. Tu peux annuler à tout moment depuis le portail Stripe avant cette date.
       </div>`
    : `<div style="border-left:2px solid #B91C1C;padding-left:16px;margin:20px 0;font-size:14px;line-height:1.6;background:#FEF2F2;padding-top:12px;padding-bottom:12px;">
        <strong>Aucune carte enregistrée.</strong> Sans action de ta part avant le ${escapeHtml(dateStr)}, ton compte basculera automatiquement en plan Free (1 marque, 1 LLM, snapshot mensuel).
       </div>`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F8FA;font-family:-apple-system,Inter,'Segoe UI',sans-serif;color:#0A0E1A;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#FFFFFF;padding:32px 28px;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#2563EB;margin:0 0 8px;">Trial Pro · ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}</p>
      <h1 style="font-family:Inter,sans-serif;font-size:22px;line-height:1.3;font-weight:500;letter-spacing:-0.025em;color:#0A0E1A;margin:0 0 16px;">Ton trial Geoperf se termine bientôt</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px;">${greeting}</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px;">
        Ton essai gratuit <strong>${escapeHtml(entry.tier.toUpperCase())}</strong> se termine le <strong>${escapeHtml(dateStr)}</strong>.
        Pendant ces 14 jours, tu as eu accès à toutes les features premium : 6 LLMs, snapshots hebdo, Sentiment, Brand Alignment, Content Studio, Citations Flow.
      </p>
      ${cbStatusBlock}
      <p style="font-size:14px;line-height:1.6;margin:16px 0 16px;">
        Pour ${entry.has_payment_method ? "vérifier ou modifier ta carte" : "ajouter une carte et conserver l'accès Pro"}, rends-toi sur ton espace de facturation :
      </p>
      <a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#0A0E1A;color:#FFFFFF !important;padding:12px 24px;font-size:14px;font-weight:500;text-decoration:none;">
        ${entry.has_payment_method ? "Gérer mon abonnement" : "Ajouter ma carte"}
      </a>
      <p style="font-size:12px;color:#5B6478;margin:20px 0 0;">
        Une question avant de décider ? Réponds à cet email — je le lis personnellement.
      </p>
    </div>
    <div style="font-size:11px;color:#5B6478;padding:24px 16px 0;text-align:center;line-height:1.6;">
      <p style="font-family:Inter,sans-serif;font-size:18px;color:#0A0E1A;font-weight:500;margin:0 0 12px;">Ge<span style="color:#EF9F27;">·</span>perf</p>
      <p>Geoperf · Une marque Jourdechance SAS · Boulogne-Billancourt</p>
    </div>
  </div>
</body></html>`;

  const text = [
    subject,
    "",
    greeting,
    "",
    `Ton essai gratuit ${entry.tier.toUpperCase()} se termine le ${dateStr}.`,
    "",
    entry.has_payment_method
      ? `Carte enregistrée — facturation automatique le ${dateStr}. Annulation possible avant cette date depuis le portail Stripe.`
      : `Aucune carte enregistrée — sans action, ton compte bascule en Free le ${dateStr}.`,
    "",
    `${entry.has_payment_method ? "Gérer mon abonnement" : "Ajouter ma carte"} : ${billingUrl}`,
    "",
    "Une question ? Réponds à cet email.",
    "",
    "— Geoperf",
  ].join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });

  // Window : trials qui expirent dans 24-48h, pas encore notifiés
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);

  const { data: subs, error: subsErr } = await supabase
    .from("saas_subscriptions")
    .select("user_id, tier, current_period_end, stripe_subscription_id")
    .eq("status", "trialing")
    .gte("current_period_end", in24h.toISOString())
    .lte("current_period_end", in48h.toISOString())
    .is("trial_expiring_email_sent_at", null);

  if (subsErr) {
    return new Response(JSON.stringify({ error: `subs fetch: ${subsErr.message}` }), { status: 500 });
  }

  const summary = { eligible: subs?.length ?? 0, sent: 0, skipped: 0, errors: 0 };

  for (const sub of (subs ?? []) as Array<{ user_id: string; tier: string; current_period_end: string; stripe_subscription_id: string | null }>) {
    try {
      const { data: profile } = await supabase
        .from("saas_profiles")
        .select("email, full_name")
        .eq("id", sub.user_id)
        .maybeSingle();
      if (!profile?.email) {
        summary.skipped++;
        continue;
      }

      // S'il y a un stripe_subscription_id, on suppose que la CB est attachée
      // (Stripe exige une CB au moment du checkout même en trial).
      const has_payment_method = !!sub.stripe_subscription_id;

      const entry: TrialEntry = {
        user_id: sub.user_id,
        email: (profile as any).email,
        full_name: (profile as any).full_name,
        tier: sub.tier,
        trial_end: new Date(sub.current_period_end),
        has_payment_method,
      };

      if (!RESEND_API_KEY) {
        console.warn("[saas_send_trial_expiring_email] RESEND_API_KEY missing");
        summary.errors++;
        continue;
      }

      const { subject, html, text } = renderEmail(entry);
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: ALERTS_FROM,
          to: [entry.email],
          subject,
          html,
          text,
          tags: [{ name: "kind", value: "trial_expiring" }],
        }),
      });
      if (!resp.ok) {
        const errText = (await resp.text()).slice(0, 400);
        console.error(`[trial_expiring] Resend ${resp.status}: ${errText}`);
        summary.errors++;
        continue;
      }
      const resendData = await resp.json();

      await supabase
        .from("saas_subscriptions")
        .update({ trial_expiring_email_sent_at: new Date().toISOString() })
        .eq("user_id", sub.user_id)
        .eq("status", "trialing");

      await supabase.from("saas_usage_log").insert({
        user_id: sub.user_id,
        event_type: "trial_expiring_notified",
        cost_usd: 0,
        metadata: {
          resend_email_id: resendData.id ?? null,
          to: entry.email,
          tier: sub.tier,
          trial_end: sub.current_period_end,
          has_payment_method,
        },
      });
      summary.sent++;
    } catch (e) {
      console.error("[trial_expiring user error]", sub.user_id, e instanceof Error ? e.message : String(e));
      summary.errors++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    window: { from: in24h.toISOString(), to: in48h.toISOString() },
    ...summary,
  }), { headers: { "content-type": "application/json" } });
});
