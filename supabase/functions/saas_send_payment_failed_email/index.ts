// GEOPERF SaaS — saas_send_payment_failed_email
// Spec : SPRINT_S16_BRIEF section 4.3 (CRITICAL #3)
// Trigger : POST { user_id, email, full_name, amount_due, currency, hosted_invoice_url, next_payment_attempt }
//
// Pipeline :
//   1. Vérifie payload minimal (email + amount_due requis)
//   2. Render template Tech crisp inline (Inter, brand-500, surface, glyphe ambré préservé)
//   3. POST Resend /emails (severity high, ton urgent mais pas alarmiste)
//   4. Insert saas_usage_log event_type=payment_failed_notified
//
// Pas de SAAS_TEST_MODE : si RESEND_API_KEY absent, skip silencieux.

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

function fmtAmount(amountMinorUnits: number, currency: string): string {
  const major = amountMinorUnits / 100;
  const cur = currency.toUpperCase();
  const symbol = cur === "EUR" ? "€" : cur === "USD" ? "$" : cur;
  return `${major.toFixed(2)} ${symbol}`;
}

function fmtNextAttempt(unixSec: number | null): string {
  if (!unixSec) return "dans les prochains jours";
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

interface Body {
  user_id?: string;
  email?: string;
  full_name?: string | null;
  amount_due?: number;
  currency?: string;
  hosted_invoice_url?: string | null;
  next_payment_attempt?: number | null;
}

function renderEmail(b: Body): { subject: string; html: string; text: string } {
  const amount = fmtAmount(b.amount_due ?? 0, b.currency ?? "eur");
  const nextAttempt = fmtNextAttempt(b.next_payment_attempt ?? null);
  const billingUrl = `${APP_URL}/app/billing`;
  const invoiceUrl = b.hosted_invoice_url ?? billingUrl;

  const subject = `Action requise — Paiement Geoperf échoué (${amount})`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F8FA;font-family:-apple-system,Inter,sans-serif;color:#0A0E1A;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#FFFFFF;padding:32px 28px;">
      <p style="font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#B91C1C;margin:0 0 8px;">Action requise</p>
      <h1 style="font-family:Inter,sans-serif;font-size:22px;line-height:1.3;font-weight:500;letter-spacing:-0.025em;color:#0A0E1A;margin:0 0 16px;">Ton paiement Geoperf a échoué</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px;">Bonjour${b.full_name ? " " + escapeHtml(b.full_name.split(" ")[0]) : ""},</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px;">Le paiement de <strong>${escapeHtml(amount)}</strong> n'a pas pu être prélevé. Causes les plus fréquentes : carte expirée, plafond de paiement atteint, ou refus banque.</p>
      <div style="border-left:2px solid #B91C1C;padding-left:16px;margin:20px 0;font-size:14px;line-height:1.6;color:#0A0E1A;background:#FEF2F2;padding-top:12px;padding-bottom:12px;">
        Stripe va retenter automatiquement le ${escapeHtml(nextAttempt)}. Si le paiement échoue à nouveau, ton accès Pro/Agency sera suspendu et ton compte basculera en plan Free.
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">Mets à jour ta carte maintenant pour éviter toute interruption :</p>
      <a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#0A0E1A;color:#FFFFFF;padding:12px 24px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:12px;">Mettre à jour ma carte</a>
      <p style="font-size:12px;color:#5B6478;margin:16px 0 0;">Tu peux aussi consulter ${b.hosted_invoice_url ? `<a href="${escapeHtml(invoiceUrl)}" style="color:#2563EB;">la facture détaillée</a>` : "la facture"} sur Stripe.</p>
    </div>
    <div style="font-size:11px;color:#5B6478;padding:24px 16px 0;text-align:center;line-height:1.6;">
      <p style="font-family:Inter,sans-serif;font-size:18px;color:#0A0E1A;font-weight:500;margin:0 0 12px;">Ge<span style="color:#EF9F27;">·</span>perf</p>
      <p>Une question ? Réponds à cet email, on te répond sous 24h.</p>
    </div>
  </div>
</body></html>`;

  const text = [
    subject,
    "",
    `Bonjour${b.full_name ? " " + b.full_name.split(" ")[0] : ""},`,
    "",
    `Le paiement de ${amount} n'a pas pu être prélevé.`,
    `Causes fréquentes : carte expirée, plafond, refus banque.`,
    "",
    `Stripe retente le ${nextAttempt}. Si le 2e paiement échoue, ton accès Pro/Agency sera suspendu.`,
    "",
    `Mets à jour ta carte : ${billingUrl}`,
    b.hosted_invoice_url ? `Facture : ${b.hosted_invoice_url}` : "",
    "",
    "Une question ? Réponds à cet email.",
    "",
    "— Geoperf",
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: Body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }

  if (!body.email) return new Response(JSON.stringify({ error: "email required" }), { status: 400 });
  if (typeof body.amount_due !== "number") return new Response(JSON.stringify({ error: "amount_due required" }), { status: 400 });

  if (!RESEND_API_KEY) {
    console.warn("[saas_send_payment_failed_email] RESEND_API_KEY missing");
    return new Response(JSON.stringify({ ok: true, skipped: "no_resend_key" }), { headers: { "content-type": "application/json" } });
  }

  try {
    const { subject, html, text } = renderEmail(body);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ALERTS_FROM,
        to: [body.email],
        subject,
        html,
        text,
        tags: [{ name: "kind", value: "payment_failed" }],
      }),
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 400);
      console.error(`[payment_failed] Resend ${resp.status}: ${errText}`);
      return new Response(JSON.stringify({ error: `Resend HTTP ${resp.status}`, detail: errText }), { status: 500 });
    }
    const resendData = await resp.json();

    if (body.user_id) {
      await supabase.from("saas_usage_log").insert({
        user_id: body.user_id,
        event_type: "payment_failed_notified",
        cost_usd: 0,
        metadata: {
          resend_email_id: resendData.id ?? null,
          to: body.email,
          amount_due: body.amount_due,
          currency: body.currency,
          hosted_invoice_url: body.hosted_invoice_url ?? null,
        },
      });
    }

    return new Response(JSON.stringify({ ok: true, resend_email_id: resendData.id ?? null, to: body.email }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_send_payment_failed_email ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
