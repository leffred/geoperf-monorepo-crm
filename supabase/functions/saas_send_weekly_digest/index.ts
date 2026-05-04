// GEOPERF SaaS — saas_send_weekly_digest
// Spec : SPRINT_S15_BRIEF.md section 4.5
// Trigger : POST {} (vide) — declenche par pg_cron chaque lundi 7h UTC
//
// Pipeline :
//   1. SELECT users avec digest_weekly_enabled=true (filtre TEST_EMAIL_FILTER actif)
//   2. Pour chaque user, calcul de la semaine ecoulee (lundi 0h -> dimanche 23h59 UTC) :
//      - Visibility delta vs semaine S-1 (par marque)
//      - Top 3 concurrents qui ont gagne le plus de mentions
//      - Top 1 reco actionable (priority high non lue)
//      - Nb d alertes generees dans la semaine
//   3. Skip si rien a dire (0 snapshot + 0 alerte)
//   4. POST Resend /emails avec template digest
//   5. Insert saas_usage_log event_type=digest_sent
//
// IMPORTANT : pendant la validation, TEST_EMAIL_FILTER limite l envoi a
// flefebvre@jourdechance.com uniquement. Retirer avant rollout prod.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERTS_FROM = Deno.env.get("ALERTS_EMAIL_FROM") ?? "Geoperf Alerts <alerts@geoperf.com>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://geoperf.com";

// PRE-PROD FILTER : a retirer avant rollout. Cf SPRINT_S15_BRIEF section 6.7.
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "flefebvre@jourdechance.com")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
}

function deltaIcon(delta: number): string {
  if (delta > 0.5) return "↑";
  if (delta < -0.5) return "↓";
  return "→";
}

function fmtDelta(n: number, unit = "pt"): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} ${unit}`;
}

function startOfPrevMondayUTC(now: Date): { thisStart: Date; thisEnd: Date; prevStart: Date; prevEnd: Date } {
  const d = new Date(now);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dow + 6) % 7;
  const thisMon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMon, 0, 0, 0, 0));
  const prevMon = new Date(thisMon.getTime() - 7 * 86400000);
  const prevSunEnd = new Date(thisMon.getTime() - 1);
  const prevPrevSunEnd = new Date(prevMon.getTime() - 1);
  return {
    thisStart: prevMon,
    thisEnd: prevSunEnd,
    prevStart: new Date(prevMon.getTime() - 7 * 86400000),
    prevEnd: prevPrevSunEnd,
  };
}

interface Profile { id: string; email: string; full_name: string | null; }
interface BrandSummary {
  brand_id: string;
  brand_name: string;
  visibility_now: number | null;
  visibility_prev: number | null;
  citation_now: number | null;
  citation_prev: number | null;
  sov_now: number | null;
}

async function buildDigestForUser(profile: Profile, period: ReturnType<typeof startOfPrevMondayUTC>) {
  const { data: brands } = await supabase
    .from("saas_tracked_brands")
    .select("id, name")
    .eq("user_id", profile.id)
    .eq("is_active", true);
  if (!brands || brands.length === 0) return null;

  const { data: snaps } = await supabase
    .from("saas_brand_snapshots")
    .select("id, brand_id, visibility_score, citation_rate, share_of_voice, created_at")
    .eq("user_id", profile.id)
    .eq("status", "completed")
    .gte("created_at", period.prevStart.toISOString())
    .lte("created_at", period.thisEnd.toISOString())
    .order("created_at", { ascending: true });
  const snapList = (snaps ?? []) as Array<{
    id: string; brand_id: string; visibility_score: number | null;
    citation_rate: number | null; share_of_voice: number | null; created_at: string;
  }>;

  const summaries: BrandSummary[] = [];
  for (const b of brands) {
    const thisWeek = snapList
      .filter(s => s.brand_id === b.id && s.created_at >= period.thisStart.toISOString() && s.created_at <= period.thisEnd.toISOString())
      .slice(-1)[0];
    const prevWeek = snapList
      .filter(s => s.brand_id === b.id && s.created_at >= period.prevStart.toISOString() && s.created_at < period.thisStart.toISOString())
      .slice(-1)[0];
    if (!thisWeek && !prevWeek) continue;
    summaries.push({
      brand_id: b.id,
      brand_name: b.name,
      visibility_now: thisWeek?.visibility_score ?? null,
      visibility_prev: prevWeek?.visibility_score ?? null,
      citation_now: thisWeek?.citation_rate ?? null,
      citation_prev: prevWeek?.citation_rate ?? null,
      sov_now: thisWeek?.share_of_voice ?? null,
    });
  }

  const { data: alerts } = await supabase
    .from("saas_alerts")
    .select("id, alert_type, severity, created_at")
    .eq("user_id", profile.id)
    .gte("created_at", period.thisStart.toISOString())
    .lte("created_at", period.thisEnd.toISOString());
  const alertCount = (alerts ?? []).length;

  const { data: recos } = await supabase
    .from("saas_recommendations")
    .select("id, title, priority, snapshot_id")
    .eq("user_id", profile.id)
    .eq("is_read", false)
    .order("priority", { ascending: true })
    .limit(1);
  const topReco = (recos ?? [])[0] ?? null;

  const lastSnapIds = summaries
    .map(s => snapList.find(x => x.brand_id === s.brand_id && x.created_at >= period.thisStart.toISOString())?.id)
    .filter(Boolean) as string[];
  let topCompetitors: Array<{ name: string; mentions: number }> = [];
  if (lastSnapIds.length > 0) {
    const { data: respRows } = await supabase
      .from("saas_snapshot_responses")
      .select("competitors_mentioned")
      .in("snapshot_id", lastSnapIds);
    const counts: Record<string, number> = {};
    for (const r of (respRows ?? []) as Array<{ competitors_mentioned: string[] | null }>) {
      for (const c of r.competitors_mentioned ?? []) {
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
    topCompetitors = Object.entries(counts)
      .map(([name, mentions]) => ({ name, mentions }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 3);
  }

  if (summaries.length === 0 && alertCount === 0) {
    return null;
  }

  return { summaries, alertCount, topReco, topCompetitors };
}

function renderDigestEmail(profile: Profile, digest: NonNullable<Awaited<ReturnType<typeof buildDigestForUser>>>): { subject: string; html: string; text: string } {
  const main = digest.summaries[0];
  const visDelta = (main && main.visibility_now !== null && main.visibility_prev !== null)
    ? Number(main.visibility_now) - Number(main.visibility_prev) : 0;
  const subject = `Ta semaine Geoperf — ${deltaIcon(visDelta)} ${fmtDelta(visDelta)}`;

  const summaryRows = digest.summaries.map(s => {
    const dv = (s.visibility_now !== null && s.visibility_prev !== null) ? Number(s.visibility_now) - Number(s.visibility_prev) : null;
    const dc = (s.citation_now !== null && s.citation_prev !== null) ? Number(s.citation_now) - Number(s.citation_prev) : null;
    const dvSpan = dv !== null ? `<span style="color:${dv >= 0 ? "#1D9E75" : "#B91C1C"};">${deltaIcon(dv)} ${fmtDelta(dv)}</span>` : "";
    const dcSpan = dc !== null ? `<span style="color:${dc >= 0 ? "#1D9E75" : "#B91C1C"};">${deltaIcon(dc)} ${fmtDelta(dc, "%")}</span>` : "";
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #E6E8EE;font-size:14px;">${escapeHtml(s.brand_name)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #E6E8EE;font-family:JetBrains Mono,monospace;font-size:12px;text-align:right;">
          ${s.visibility_now !== null ? Number(s.visibility_now).toFixed(0) : "—"} ${dvSpan}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #E6E8EE;font-family:JetBrains Mono,monospace;font-size:12px;text-align:right;">
          ${s.citation_now !== null ? Number(s.citation_now).toFixed(0) + "%" : "—"} ${dcSpan}
        </td>
      </tr>`;
  }).join("");

  const competitorsBlock = digest.topCompetitors.length > 0 ? `
    <h2 style="font-family:Inter,sans-serif;font-size:14px;font-weight:500;letter-spacing:-0.01em;color:#0A0E1A;margin:32px 0 12px;">Concurrents qui montent</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #E6E8EE;">
      ${digest.topCompetitors.map((c, i) => `
        <tr>
          <td style="padding:10px 16px;font-size:13px;border-bottom:${i < digest.topCompetitors.length - 1 ? "1px solid #E6E8EE" : "none"};">
            <span style="font-family:JetBrains Mono,monospace;color:#8C94A6;">${i + 1}.</span> ${escapeHtml(c.name)}
          </td>
          <td style="padding:10px 16px;font-family:JetBrains Mono,monospace;font-size:12px;text-align:right;color:#5B6478;border-bottom:${i < digest.topCompetitors.length - 1 ? "1px solid #E6E8EE" : "none"};">${c.mentions} mentions</td>
        </tr>`).join("")}
    </table>` : "";

  const recoBlock = digest.topReco ? `
    <h2 style="font-family:Inter,sans-serif;font-size:14px;font-weight:500;letter-spacing:-0.01em;color:#0A0E1A;margin:32px 0 12px;">Action recommandee</h2>
    <div style="border-left:2px solid #2563EB;padding-left:16px;font-size:14px;color:#0A0E1A;">${escapeHtml(digest.topReco.title)}</div>` : "";

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F8FA;font-family:-apple-system,Inter,sans-serif;color:#0A0E1A;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="background:#FFFFFF;padding:32px 28px;">
      <p style="font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#2563EB;margin:0 0 8px;">Digest hebdo Geoperf</p>
      <h1 style="font-family:Inter,sans-serif;font-size:24px;line-height:1.3;font-weight:500;letter-spacing:-0.025em;color:#0A0E1A;margin:0 0 24px;">Cette semaine sur ${main ? escapeHtml(main.brand_name) : "tes marques"}</h1>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E6E8EE;">
        <thead><tr style="background:#F7F8FA;">
          <th style="padding:10px 16px;text-align:left;font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#5B6478;border-bottom:1px solid #E6E8EE;">Marque</th>
          <th style="padding:10px 16px;text-align:right;font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#5B6478;border-bottom:1px solid #E6E8EE;">Visibility</th>
          <th style="padding:10px 16px;text-align:right;font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#5B6478;border-bottom:1px solid #E6E8EE;">Citation</th>
        </tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
      ${competitorsBlock}
      ${recoBlock}
      <a href="${APP_URL}/app/dashboard" style="display:inline-block;background:#0A0E1A;color:#FFFFFF;padding:12px 24px;font-size:14px;font-weight:500;text-decoration:none;margin-top:32px;">Voir le dashboard complet</a>
    </div>
    <div style="font-size:11px;color:#5B6478;padding:24px 16px 0;text-align:center;line-height:1.6;">
      <p style="font-family:Inter,sans-serif;font-size:18px;color:#0A0E1A;font-weight:500;margin:0 0 12px;">Ge<span style="color:#EF9F27;">·</span>perf</p>
      <p>${digest.alertCount} alerte${digest.alertCount !== 1 ? "s" : ""} cette semaine. <a href="${APP_URL}/app/alerts" style="color:#5B6478;">Voir tout</a>.</p>
      <p style="margin-top:12px;"><a href="${APP_URL}/app/settings" style="color:#5B6478;">Desactiver le digest hebdo</a></p>
    </div>
  </div>
</body></html>`;

  const text = [
    subject,
    "",
    `Cette semaine sur ${main ? main.brand_name : "tes marques"}`,
    "",
    ...digest.summaries.map(s => `- ${s.brand_name} : visibility ${s.visibility_now?.toFixed(0) ?? "—"}, citation ${s.citation_now?.toFixed(0) ?? "—"}%`),
    "",
    digest.topCompetitors.length > 0 ? `Concurrents qui montent : ${digest.topCompetitors.map(c => `${c.name} (${c.mentions})`).join(", ")}` : "",
    digest.topReco ? `Action recommandee : ${digest.topReco.title}` : "",
    "",
    `${digest.alertCount} alertes cette semaine.`,
    `Dashboard : ${APP_URL}/app/dashboard`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });

  const now = new Date();
  const period = startOfPrevMondayUTC(now);

  let q = supabase
    .from("saas_profiles")
    .select("id, email, full_name, digest_weekly_enabled")
    .eq("digest_weekly_enabled", true);
  if (TEST_EMAIL_FILTER.length > 0) {
    q = q.in("email", TEST_EMAIL_FILTER);
  }
  const { data: profiles, error: profErr } = await q;
  if (profErr) {
    return new Response(JSON.stringify({ error: `profile fetch: ${profErr.message}` }), { status: 500 });
  }

  const summary = { total_users: profiles?.length ?? 0, sent: 0, skipped_empty: 0, skipped_free: 0, errors: 0 };

  for (const profile of (profiles ?? []) as Array<Profile & { digest_weekly_enabled: boolean }>) {
    try {
      const { data: sub } = await supabase
        .from("saas_subscriptions")
        .select("tier, status")
        .eq("user_id", profile.id)
        .eq("status", "active")
        .maybeSingle();
      const tier = sub?.tier ?? "free";
      if (tier === "free") { summary.skipped_free++; continue; }

      const digest = await buildDigestForUser(profile, period);
      if (!digest) { summary.skipped_empty++; continue; }

      if (!RESEND_API_KEY) {
        console.warn("[saas_send_weekly_digest] RESEND_API_KEY missing");
        summary.errors++;
        continue;
      }

      const { subject, html, text } = renderDigestEmail(profile, digest);
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
          tags: [{ name: "kind", value: "weekly_digest" }],
        }),
      });
      if (!resp.ok) {
        const errText = (await resp.text()).slice(0, 400);
        console.error(`[digest] Resend ${resp.status}: ${errText}`);
        summary.errors++;
        continue;
      }
      const resendData = await resp.json();

      await supabase.from("saas_usage_log").insert({
        user_id: profile.id,
        event_type: "digest_sent",
        cost_usd: 0,
        metadata: {
          resend_email_id: resendData.id ?? null,
          to: profile.email,
          period_start: period.thisStart.toISOString(),
          period_end: period.thisEnd.toISOString(),
          brands_count: digest.summaries.length,
          alerts_count: digest.alertCount,
        },
      });
      summary.sent++;
    } catch (e) {
      console.error("[digest user error]", profile.email, e instanceof Error ? e.message : String(e));
      summary.errors++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    test_filter_active: TEST_EMAIL_FILTER.length > 0,
    test_filter_emails: TEST_EMAIL_FILTER,
    period: { start: period.thisStart.toISOString(), end: period.thisEnd.toISOString() },
    ...summary,
  }), { headers: { "content-type": "application/json" } });
});
