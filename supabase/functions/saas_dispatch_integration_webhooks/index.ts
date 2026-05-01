// GEOPERF SaaS — saas_dispatch_integration_webhooks
// Spec : SPRINTS_S8_S9_S10_PLAN.md S10.3
// Trigger : POST { alert_id }
//
// Pipeline :
//   1. Load alert + brand + profile + tier (account_owner = alert.user_id)
//   2. Tier-gate par integration type :
//        - slack   : Growth+
//        - teams   : Pro+
//        - discord : Growth+ (treat like slack)
//        - webhook_custom : Pro+ (raw access)
//   3. Pour chaque integration active du user :
//        - Filtre events[] : matche "alert_type" OU "alert_type_severity"
//        - Build payload format-spécifique (Slack block kit / Teams card / Discord embed / raw JSON)
//        - POST sur webhook_url
//        - Update last_sent_at + send_count, ou last_error + fail_count
//   4. Loggé dans saas_usage_log event_type=integration_webhook_sent

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://geoperf.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type IntegrationType = "slack" | "teams" | "discord" | "webhook_custom";

const TIER_GATE: Record<IntegrationType, ReadonlySet<string>> = {
  slack:          new Set(["growth", "pro", "agency"]),
  discord:        new Set(["growth", "pro", "agency"]),
  teams:          new Set(["pro", "agency"]),
  webhook_custom: new Set(["pro", "agency"]),
};

const SEV_COLOR_HEX: Record<string, string> = {
  high: "#B91C1C",
  medium: "#EF9F27",
  low: "#0C447C",
};

const TYPE_LABEL: Record<string, string> = {
  rank_drop: "Rang en baisse",
  rank_gain: "Rang en progression",
  competitor_overtake: "Nouveau concurrent",
  new_source: "Nouvelles sources",
  citation_loss: "Citation en chute",
  citation_gain: "Citation en hausse",
};

interface AlertRow {
  id: string;
  brand_id: string;
  user_id: string;
  snapshot_id: string;
  alert_type: string;
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function eventMatches(events: string[], alertType: string, severity: string): boolean {
  if (!events || events.length === 0) return true;
  // Match exact alert_type, exact alert_type_severity, ou wildcard *
  return events.includes(alertType) ||
    events.includes(`${alertType}_${severity}`) ||
    events.includes("*");
}

function buildSlackPayload(alert: AlertRow, brandName: string): unknown {
  const brandUrl = `${APP_URL}/app/brands/${alert.brand_id}`;
  const sevColor = SEV_COLOR_HEX[alert.severity] ?? SEV_COLOR_HEX.low;
  const typeLabel = TYPE_LABEL[alert.alert_type] ?? alert.alert_type;
  return {
    attachments: [{
      color: sevColor,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🔔 ${alert.title}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Marque*\n${brandName}` },
            { type: "mrkdwn", text: `*Type*\n${typeLabel}` },
            { type: "mrkdwn", text: `*Sévérité*\n${alert.severity.toUpperCase()}` },
            { type: "mrkdwn", text: `*Date*\n<!date^${Math.floor(new Date(alert.created_at).getTime() / 1000)}^{date_short_pretty} {time}|${alert.created_at}>` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: alert.body },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Ouvrir dans Geoperf", emoji: true },
              url: brandUrl,
              style: alert.severity === "high" ? "danger" : "primary",
            },
          ],
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Geoperf · <${APP_URL}/app/integrations|Configurer les intégrations>` },
          ],
        },
      ],
    }],
  };
}

function buildTeamsPayload(alert: AlertRow, brandName: string): unknown {
  // Teams MessageCard format (legacy mais largement supporté)
  const brandUrl = `${APP_URL}/app/brands/${alert.brand_id}`;
  const themeColor = SEV_COLOR_HEX[alert.severity]?.replace("#", "") ?? "0C447C";
  const typeLabel = TYPE_LABEL[alert.alert_type] ?? alert.alert_type;
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor,
    summary: `Geoperf · ${alert.title}`,
    title: `🔔 ${alert.title}`,
    sections: [{
      activityTitle: brandName,
      activitySubtitle: `${typeLabel} · ${alert.severity.toUpperCase()}`,
      facts: [
        { name: "Marque", value: brandName },
        { name: "Type", value: typeLabel },
        { name: "Sévérité", value: alert.severity.toUpperCase() },
        { name: "Date", value: new Date(alert.created_at).toLocaleString("fr-FR") },
      ],
      text: alert.body,
    }],
    potentialAction: [{
      "@type": "OpenUri",
      name: "Ouvrir dans Geoperf",
      targets: [{ os: "default", uri: brandUrl }],
    }],
  };
}

function buildDiscordPayload(alert: AlertRow, brandName: string): unknown {
  const brandUrl = `${APP_URL}/app/brands/${alert.brand_id}`;
  const colorInt = parseInt((SEV_COLOR_HEX[alert.severity] ?? SEV_COLOR_HEX.low).replace("#", ""), 16);
  const typeLabel = TYPE_LABEL[alert.alert_type] ?? alert.alert_type;
  return {
    username: "Geoperf",
    embeds: [{
      title: `🔔 ${alert.title}`,
      description: alert.body,
      color: colorInt,
      url: brandUrl,
      fields: [
        { name: "Marque", value: brandName, inline: true },
        { name: "Type", value: typeLabel, inline: true },
        { name: "Sévérité", value: alert.severity.toUpperCase(), inline: true },
      ],
      footer: { text: "Geoperf — monitoring LLM" },
      timestamp: alert.created_at,
    }],
  };
}

function buildCustomPayload(alert: AlertRow, brandName: string): unknown {
  // Raw JSON payload : alert + brand info, format prévisible pour parsing custom côté client
  return {
    type: "geoperf.alert",
    version: 1,
    timestamp: alert.created_at,
    alert: {
      id: alert.id,
      type: alert.alert_type,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      metadata: alert.metadata,
    },
    brand: {
      id: alert.brand_id,
      name: brandName,
      url: `${APP_URL}/app/brands/${alert.brand_id}`,
    },
    snapshot_id: alert.snapshot_id,
  };
}

async function postWebhook(url: string, payload: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${text}` };
    }
    return { ok: true, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { alert_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.alert_id) return new Response(JSON.stringify({ error: "alert_id required" }), { status: 400 });

  try {
    const { data: alert } = await supabase
      .from("saas_alerts")
      .select("id, brand_id, user_id, snapshot_id, alert_type, severity, title, body, metadata, created_at")
      .eq("id", body.alert_id)
      .maybeSingle();
    if (!alert) return new Response(JSON.stringify({ error: "alert not found" }), { status: 404 });
    const a = alert as AlertRow;

    const { data: brand } = await supabase.from("saas_tracked_brands").select("name").eq("id", a.brand_id).maybeSingle();
    const brandName = (brand as any)?.name ?? "?";

    // Tier de l'owner
    const { data: sub } = await supabase.from("saas_subscriptions")
      .select("tier").eq("user_id", a.user_id).eq("status", "active").maybeSingle();
    const tier = (sub as any)?.tier ?? "free";

    // Charge integrations actives pour ce user
    const { data: integrations } = await supabase
      .from("saas_integrations")
      .select("id, type, name, webhook_url, events, is_active")
      .eq("user_id", a.user_id)
      .eq("is_active", true);
    const integList = (integrations as any[] | null) ?? [];

    const results: Array<{ id: string; type: string; status: number; ok: boolean; skipped?: string }> = [];
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const i of integList) {
      const t = i.type as IntegrationType;
      // Tier-gate
      if (!TIER_GATE[t]?.has(tier)) {
        results.push({ id: i.id, type: t, status: 0, ok: false, skipped: "tier_too_low" });
        totalSkipped++;
        continue;
      }
      // Event filter
      if (!eventMatches(i.events as string[], a.alert_type, a.severity)) {
        results.push({ id: i.id, type: t, status: 0, ok: false, skipped: "event_filter" });
        totalSkipped++;
        continue;
      }

      let payload: unknown;
      switch (t) {
        case "slack":   payload = buildSlackPayload(a, brandName); break;
        case "teams":   payload = buildTeamsPayload(a, brandName); break;
        case "discord": payload = buildDiscordPayload(a, brandName); break;
        case "webhook_custom": payload = buildCustomPayload(a, brandName); break;
      }

      const r = await postWebhook(i.webhook_url, payload);
      results.push({ id: i.id, type: t, status: r.status, ok: r.ok });

      if (r.ok) {
        totalSent++;
        await supabase.from("saas_integrations").update({
          last_sent_at: new Date().toISOString(),
          send_count: (i.send_count ?? 0) + 1,
          last_error: null,
        }).eq("id", i.id);
      } else {
        totalFailed++;
        await supabase.from("saas_integrations").update({
          last_error: r.error?.slice(0, 500) ?? "unknown",
          fail_count: (i.fail_count ?? 0) + 1,
        }).eq("id", i.id);
      }
    }

    if (totalSent > 0 || totalFailed > 0) {
      await supabase.from("saas_usage_log").insert({
        user_id: a.user_id,
        event_type: "integration_webhook_sent",
        cost_usd: 0,
        metadata: {
          alert_id: a.id,
          alert_type: a.alert_type,
          severity: a.severity,
          tier,
          sent: totalSent,
          failed: totalFailed,
          skipped: totalSkipped,
          breakdown: results,
        },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      alert_id: a.id,
      tier,
      total_integrations: integList.length,
      sent: totalSent,
      failed: totalFailed,
      skipped: totalSkipped,
      results,
    }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_dispatch_integration_webhooks ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});