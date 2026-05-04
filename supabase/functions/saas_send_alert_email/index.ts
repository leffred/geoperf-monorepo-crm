// GEOPERF SaaS — saas_send_alert_email
// Spec : saas/SPEC.md section 5.5
// Trigger : POST { alert_id }
//
// Pipeline :
//   1. Load alert + brand + profile + sub
//   2. Skip si tier='free' (alertes email = Solo+)
//   3. Skip si profile.email_notifs_enabled=false
//   4. Skip si alert.email_sent_at déjà set (idempotence)
//   5. Render template HTML selon alert_type
//   6. POST Resend /emails (from: alerts@geoperf.com)
//   7. Update saas_alerts.email_sent_at
//   8. Insert saas_usage_log event_type=alert_sent (cost=0, gratuit chez Resend en early stage)
//
// Pas de SAAS_TEST_MODE ici : si RESEND_API_KEY absent, on ne tente même pas l'envoi (skip silencieux).

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

type AlertType = "rank_drop" | "rank_gain" | "competitor_overtake" | "new_source" | "citation_loss" | "citation_gain" | "competitor_emerged";
type Severity = "high" | "medium" | "low";

// ============== TEMPLATES ==============
const SEV_LABEL: Record<Severity, string> = { high: "Important", medium: "À regarder", low: "Info" };
const SEV_COLOR: Record<Severity, string> = { high: "#B91C1C", medium: "#EF9F27", low: "#0C447C" };

const TYPE_LABELS: Record<AlertType, string> = {
  rank_drop: "Rang en baisse",
  rank_gain: "Rang en progression",
  competitor_overtake: "Nouveau concurrent visible",
  competitor_emerged: "Concurrent émergent",
  new_source: "Nouvelles sources autorités",
  citation_loss: "Taux de citation en chute",
  citation_gain: "Taux de citation en hausse",
};

const TYPE_EMOJI: Record<AlertType, string> = {
  rank_drop: "↓",
  rank_gain: "↑",
  competitor_overtake: "⚠",
  competitor_emerged: "◇",
  new_source: "★",
  citation_loss: "↓",
  citation_gain: "↑",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
}

interface AlertRow {
  id: string;
  brand_id: string;
  user_id: string;
  snapshot_id: string;
  alert_type: AlertType;
  severity: Severity;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  email_sent_at: string | null;
}

interface BrandRow { id: string; name: string; domain: string; }
interface ProfileRow { email: string; full_name: string | null; email_notifs_enabled: boolean; }

function renderEmail(alert: AlertRow, brand: BrandRow, profile: ProfileRow): { subject: string; html: string; text: string } {
  const sevLabel = SEV_LABEL[alert.severity];
  const sevColor = SEV_COLOR[alert.severity];
  const typeLabel = TYPE_LABELS[alert.alert_type];
  const emoji = TYPE_EMOJI[alert.alert_type];
  const brandUrl = `${APP_URL}/app/brands/${brand.id}`;
  const settingsUrl = `${APP_URL}/app/settings`;

  const subject = `[${sevLabel}] ${brand.name} — ${alert.title}`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title>
<style>
body { margin:0; padding:0; background:#F1EFE8; font-family: -apple-system, "Segoe UI", "Inter", sans-serif; color:#2C2C2A; }
.wrap { max-width:560px; margin:0 auto; padding:24px 16px; }
.card { background:#FFFFFF; padding:32px 28px; }
.eyebrow { font-family: "IBM Plex Mono", monospace; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#0C447C; margin:0 0 8px; }
h1 { font-family: "Source Serif Pro", Georgia, serif; font-size:22px; line-height:1.3; color:#042C53; font-weight:500; margin:0 0 8px; }
p { font-size:14px; line-height:1.6; margin:0 0 12px; }
.brand-line { font-size:12px; color:#5F5E5A; margin-bottom:24px; }
.severity-pill { display:inline-block; padding:4px 10px; font-family: "IBM Plex Mono", monospace; font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#FFFFFF; background:${sevColor}; }
.body-block { border-left:2px solid #EF9F27; padding-left:16px; margin:16px 0; font-size:14px; line-height:1.6; }
.cta { display:inline-block; background:#042C53; color:#FFFFFF !important; padding:12px 24px; font-size:14px; font-weight:500; text-decoration:none; margin-top:16px; }
.footer { font-size:11px; color:#5F5E5A; padding:24px 16px 0; text-align:center; line-height:1.6; }
.footer a { color:#5F5E5A; text-decoration:underline; }
.logo { font-family: "Source Serif Pro", Georgia, serif; font-size:20px; color:#042C53; font-weight:500; }
.logo .dot { color:#EF9F27; }
</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="eyebrow">Alerte ${escapeHtml(typeLabel)}</p>
      <h1>${emoji} ${escapeHtml(alert.title)}</h1>
      <p class="brand-line">${escapeHtml(brand.name)} · <span style="font-family:monospace;">${escapeHtml(brand.domain)}</span> · <span class="severity-pill">${escapeHtml(sevLabel)}</span></p>
      <div class="body-block">${escapeHtml(alert.body)}</div>
      <a href="${brandUrl}" class="cta">Voir le détail dans Geoperf →</a>
    </div>
    <div class="footer">
      <p class="logo">Ge<span class="dot">·</span>perf</p>
      <p>Geoperf monitore la visibilité de ${escapeHtml(brand.name)} dans les LLM (ChatGPT, Claude, Gemini, Perplexity).</p>
      <p style="margin-top:12px;">
        <a href="${settingsUrl}">Préférences notifications</a> ·
        <a href="${APP_URL}/app/dashboard">Dashboard</a>
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `[${sevLabel}] ${brand.name} — ${alert.title}`,
    "",
    alert.body,
    "",
    `Voir le détail : ${brandUrl}`,
    "",
    `Préférences notifications : ${settingsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ============== HANDLER ==============
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { alert_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.alert_id) return new Response(JSON.stringify({ error: "alert_id required" }), { status: 400 });

  try {
    const { data: alert, error: alertErr } = await supabase
      .from("saas_alerts")
      .select("id, brand_id, user_id, snapshot_id, alert_type, severity, title, body, metadata, email_sent_at")
      .eq("id", body.alert_id)
      .maybeSingle();
    if (alertErr || !alert) {
      return new Response(JSON.stringify({ error: `alert not found: ${alertErr?.message}` }), { status: 404 });
    }

    if (alert.email_sent_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already_sent", alert_id: alert.id }), { headers: { "content-type": "application/json" } });
    }

    const [{ data: brand }, { data: profile }, { data: sub }] = await Promise.all([
      supabase.from("saas_tracked_brands").select("id, name, domain").eq("id", alert.brand_id).maybeSingle(),
      supabase.from("saas_profiles").select("email, full_name, email_notifs_enabled").eq("id", alert.user_id).maybeSingle(),
      supabase.from("saas_subscriptions").select("tier, status").eq("user_id", alert.user_id).eq("status", "active").maybeSingle(),
    ]);

    if (!brand) return new Response(JSON.stringify({ error: "brand not found" }), { status: 404 });
    if (!profile) return new Response(JSON.stringify({ error: "profile not found" }), { status: 404 });

    const tier = sub?.tier ?? "free";
    if (tier === "free") {
      return new Response(JSON.stringify({ ok: true, skipped: "tier_free", alert_id: alert.id }), { headers: { "content-type": "application/json" } });
    }
    if (!profile.email_notifs_enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "user_opt_out", alert_id: alert.id }), { headers: { "content-type": "application/json" } });
    }
    if (!RESEND_API_KEY) {
      console.warn("[saas_send_alert_email] RESEND_API_KEY missing, skipping send");
      return new Response(JSON.stringify({ ok: true, skipped: "no_resend_key", alert_id: alert.id }), { headers: { "content-type": "application/json" } });
    }

    const { subject, html, text } = renderEmail(alert as any, brand as any, profile as any);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ALERTS_FROM,
        to: [profile.email],
        subject,
        html,
        text,
        tags: [
          { name: "alert_type", value: alert.alert_type },
          { name: "severity", value: alert.severity },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 400);
      console.error(`[saas_send_alert_email] Resend ${resp.status}: ${errText}`);
      throw new Error(`Resend HTTP ${resp.status}: ${errText}`);
    }

    const resendData = await resp.json();

    await supabase.from("saas_alerts").update({ email_sent_at: new Date().toISOString() }).eq("id", alert.id);

    await supabase.from("saas_usage_log").insert({
      user_id: alert.user_id,
      event_type: "alert_sent",
      cost_usd: 0,
      metadata: {
        alert_id: alert.id,
        brand_id: alert.brand_id,
        alert_type: alert.alert_type,
        severity: alert.severity,
        resend_email_id: resendData.id ?? null,
        to: profile.email,
      },
    });

    return new Response(JSON.stringify({ ok: true, alert_id: alert.id, resend_email_id: resendData.id ?? null, to: profile.email }), {
      headers: { "content-type": "application/json" },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_send_alert_email ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});