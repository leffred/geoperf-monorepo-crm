// GEOPERF SaaS — saas_detect_alerts
// Spec : saas/SPEC.md section 5.3
// Trigger : POST { snapshot_id }
//
// Pipeline :
//   1. Load snapshot N + previous completed snapshot N-1 (même brand)
//   2. Compare metrics + competitors + sources
//   3. Détecter alertes :
//      - rank_drop      : avg_rank N - avg_rank N-1 > +2 (rank plus haut = pire)
//      - rank_gain      : avg_rank N-1 - avg_rank N > +2
//      - competitor_overtake : un concurrent passe devant pour la 1re fois
//      - new_source     : domaine source qui apparaît pour la 1re fois en N
//      - citation_loss  : citation_rate baisse de >20 points
//      - citation_gain  : citation_rate augmente de >20 points
//   4. Upsert saas_alerts (idempotent via UNIQUE INDEX snapshot_id,alert_type)
//   5. L'envoi d'email est géré par un trigger Postgres AFTER INSERT ON saas_alerts
//      WHERE email_sent_at IS NULL (migration 20260429_saas_phase1_alert_email_trigger.sql).
//      On a abandonné EdgeRuntime.waitUntil ici car le runtime Supabase tue le process avant
//      la fin du fetch (cf. fix S2 cascade). Pattern fiable = trigger DB-side via pg_net.
//
// Pas d'appel LLM ici → pas de cost à logger.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface Snap {
  id: string;
  brand_id: string;
  user_id: string;
  status: string;
  visibility_score: number | null;
  avg_rank: number | null;
  citation_rate: number | null;
  share_of_voice: number | null;
  created_at: string;
}

interface AlertRow {
  brand_id: string;
  user_id: string;
  snapshot_id: string;
  alert_type: "rank_drop" | "rank_gain" | "competitor_overtake" | "new_source" | "citation_loss" | "citation_gain";
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}

function severityForRankDelta(delta: number): "high" | "medium" | "low" {
  const a = Math.abs(delta);
  if (a >= 5) return "high";
  if (a >= 3) return "medium";
  return "low";
}

// Sert pour citation_loss ET citation_gain — magnitude absolue du delta
function severityForCitationDelta(magnitude: number): "high" | "medium" | "low" {
  const m = Math.abs(magnitude);
  if (m >= 40) return "high";
  if (m >= 25) return "medium";
  return "low";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  let body: { snapshot_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 }); }
  if (!body.snapshot_id) return new Response(JSON.stringify({ error: "snapshot_id required" }), { status: 400 });

  try {
    const { data: snap, error: snapErr } = await supabase
      .from("saas_brand_snapshots")
      .select("id, brand_id, user_id, status, visibility_score, avg_rank, citation_rate, share_of_voice, created_at")
      .eq("id", body.snapshot_id)
      .maybeSingle();
    if (snapErr || !snap) return new Response(JSON.stringify({ error: `snapshot not found: ${snapErr?.message}` }), { status: 404 });
    if (snap.status !== "completed") return new Response(JSON.stringify({ error: `snapshot status=${snap.status}` }), { status: 400 });

    // Snapshot précédent complété pour la même brand
    const { data: prev } = await supabase
      .from("saas_brand_snapshots")
      .select("id, brand_id, user_id, status, visibility_score, avg_rank, citation_rate, share_of_voice, created_at")
      .eq("brand_id", snap.brand_id)
      .eq("status", "completed")
      .lt("created_at", snap.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!prev) {
      return new Response(JSON.stringify({ ok: true, alerts_inserted: 0, reason: "no previous snapshot to compare" }), { headers: { "content-type": "application/json" } });
    }

    const alerts: AlertRow[] = [];
    const alertBase = { brand_id: snap.brand_id, user_id: snap.user_id, snapshot_id: snap.id };

    // 1. Rank delta (rank monte = pire ; rank baisse = meilleur)
    if (snap.avg_rank !== null && prev.avg_rank !== null) {
      const delta = snap.avg_rank - prev.avg_rank;
      if (delta > 2) {
        alerts.push({
          ...alertBase,
          alert_type: "rank_drop",
          severity: severityForRankDelta(delta),
          title: `Rang moyen en baisse de ${delta.toFixed(1)} positions`,
          body: `Le rang moyen est passé de ${prev.avg_rank.toFixed(1)} à ${snap.avg_rank.toFixed(1)}. La marque perd en visibilité dans les classements LLM.`,
          metadata: { prev_avg_rank: prev.avg_rank, new_avg_rank: snap.avg_rank, delta },
        });
      } else if (delta < -2) {
        alerts.push({
          ...alertBase,
          alert_type: "rank_gain",
          severity: severityForRankDelta(delta),
          title: `Rang moyen en progression de ${Math.abs(delta).toFixed(1)} positions`,
          body: `Le rang moyen passe de ${prev.avg_rank.toFixed(1)} à ${snap.avg_rank.toFixed(1)}. Bonne nouvelle.`,
          metadata: { prev_avg_rank: prev.avg_rank, new_avg_rank: snap.avg_rank, delta },
        });
      }
    }

    // 2. Citation rate delta (loss = drop > 20pts ; gain = gain > 20pts — symétrique)
    if (snap.citation_rate !== null && prev.citation_rate !== null) {
      const drop = prev.citation_rate - snap.citation_rate;
      if (drop > 20) {
        alerts.push({
          ...alertBase,
          alert_type: "citation_loss",
          severity: severityForCitationDelta(drop),
          title: `Taux de citation en chute de ${drop.toFixed(1)} points`,
          body: `La marque est citée dans ${snap.citation_rate.toFixed(1)}% des prompts contre ${prev.citation_rate.toFixed(1)}% au snapshot précédent.`,
          metadata: { prev_citation_rate: prev.citation_rate, new_citation_rate: snap.citation_rate, drop },
        });
      } else if (drop < -20) {
        const gain = -drop;
        alerts.push({
          ...alertBase,
          alert_type: "citation_gain",
          severity: severityForCitationDelta(gain),
          title: `Taux de citation en hausse de ${gain.toFixed(1)} points`,
          body: `La marque est désormais citée dans ${snap.citation_rate.toFixed(1)}% des prompts contre ${prev.citation_rate.toFixed(1)}% au snapshot précédent. Bonne nouvelle.`,
          metadata: { prev_citation_rate: prev.citation_rate, new_citation_rate: snap.citation_rate, gain },
        });
      }
    }

    // 3. Competitor overtake / new source : besoin du détail des responses des deux snapshots
    const [{ data: curResp }, { data: prevResp }] = await Promise.all([
      supabase.from("saas_snapshot_responses").select("competitors_mentioned, sources_cited").eq("snapshot_id", snap.id),
      supabase.from("saas_snapshot_responses").select("competitors_mentioned, sources_cited").eq("snapshot_id", prev.id),
    ]);

    const curCompetitorCounts: Record<string, number> = {};
    const prevCompetitorSet = new Set<string>();
    const curSourceDomains = new Set<string>();
    const prevSourceDomains = new Set<string>();

    for (const r of curResp ?? []) {
      for (const c of (r.competitors_mentioned ?? []) as string[]) {
        curCompetitorCounts[c] = (curCompetitorCounts[c] ?? 0) + 1;
      }
      for (const s of (r.sources_cited ?? []) as Array<{ domain?: string }>) {
        if (s?.domain) curSourceDomains.add(s.domain);
      }
    }
    for (const r of prevResp ?? []) {
      for (const c of (r.competitors_mentioned ?? []) as string[]) prevCompetitorSet.add(c);
      for (const s of (r.sources_cited ?? []) as Array<{ domain?: string }>) {
        if (s?.domain) prevSourceDomains.add(s.domain);
      }
    }

    // 3a. Competitor overtake : un concurrent qui n'apparaissait pas en N-1 mais > 30% de mentions en N
    const totalCurResponses = curResp?.length ?? 0;
    if (totalCurResponses > 0) {
      for (const [comp, count] of Object.entries(curCompetitorCounts)) {
        const ratio = count / totalCurResponses;
        if (ratio >= 0.3 && !prevCompetitorSet.has(comp)) {
          alerts.push({
            ...alertBase,
            alert_type: "competitor_overtake",
            severity: ratio >= 0.5 ? "high" : "medium",
            title: `Nouveau concurrent visible : ${comp}`,
            body: `${comp} apparaît dans ${(ratio * 100).toFixed(0)}% des réponses LLM ce snapshot et n'était pas mentionné au précédent. À surveiller.`,
            metadata: { competitor: comp, mentions: count, ratio: Math.round(ratio * 100) / 100 },
          });
        }
      }
    }

    // 3b. New authority sources
    const newSources: string[] = [];
    for (const dom of curSourceDomains) {
      if (!prevSourceDomains.has(dom)) newSources.push(dom);
    }
    if (newSources.length >= 3) {
      alerts.push({
        ...alertBase,
        alert_type: "new_source",
        severity: newSources.length >= 6 ? "medium" : "low",
        title: `${newSources.length} nouvelles sources autorités détectées`,
        body: `Les LLM citent maintenant : ${newSources.slice(0, 8).join(", ")}${newSources.length > 8 ? "…" : ""}. Voir si ces médias couvrent la marque.`,
        metadata: { new_sources: newSources.slice(0, 20), total_new: newSources.length },
      });
    }

    let inserted = 0;
    if (alerts.length > 0) {
      // upsert avec onConflict (snapshot_id, alert_type) = no-op si déjà inséré
      // (UNIQUE INDEX uq_saas_alerts_snapshot_type, migration 20260429_saas_phase1_completion_cascade.sql)
      const { error, count } = await supabase
        .from("saas_alerts")
        .upsert(alerts, { onConflict: "snapshot_id,alert_type", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(`upsert alerts: ${error.message}`);
      inserted = count ?? alerts.length;
      // L'envoi d'email est désormais déclenché automatiquement par le trigger Postgres
      // saas_alert_email_dispatch (migration 20260429_saas_phase1_alert_email_trigger.sql)
      // qui tire AFTER INSERT ON saas_alerts via pg_net. Aucun appel chain explicite ici.
    }

    return new Response(JSON.stringify({
      ok: true,
      snapshot_id: snap.id,
      alerts_inserted: inserted,
      alerts_detected: alerts.length,
      previous_snapshot_id: prev.id,
      breakdown: alerts.reduce((acc, a) => { acc[a.alert_type] = (acc[a.alert_type] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    }), { headers: { "content-type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_detect_alerts ERROR]", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});