// GEOPERF SaaS — saas_run_all_scheduled
// Spec : saas/SPEC.md section 5.6
// Trigger : pg_cron toutes les heures à xx:15 (cf. 20260429_saas_phase1_cron.sql)
//
// Pipeline :
//   1. Lister brands éligibles à un snapshot :
//      - is_active = true
//      - cadence='weekly'  ET (last_snapshot_at IS NULL OU < now()-7 jours)
//      - cadence='monthly' ET (last_snapshot_at IS NULL OU < now()-30 jours)
//      - User a une subscription active
//   2. Fan-out vers saas_run_brand_snapshot avec rate-limit 10 simultanées
//   3. Retourne le résumé (combien lancées, combien skipped, etc.)
//
// Pas d'appel LLM ici. Pas de cost à logger.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_CONCURRENCY = 10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface EligibleBrand {
  id: string;
  user_id: string;
  name: string;
  cadence: "weekly" | "monthly";
  last_snapshot_at: string | null;
}

async function findEligibleBrands(): Promise<EligibleBrand[]> {
  // v_saas_brand_latest expose last_snapshot_at par brand pour les marques actives.
  // On filtre côté SQL via une CTE pour réduire le payload.
  const { data, error } = await supabase.rpc("saas_eligible_brands_for_run");
  if (error) {
    // Fallback : si la RPC n'existe pas, lecture directe via la vue.
    console.warn("[saas_run_all_scheduled] RPC fallback:", error.message);
    const { data: fb, error: fbErr } = await supabase
      .from("v_saas_brand_latest")
      .select("id, user_id, name, cadence, last_snapshot_at, is_active")
      .eq("is_active", true);
    if (fbErr) throw new Error(`fallback read v_saas_brand_latest: ${fbErr.message}`);
    const now = Date.now();
    return (fb ?? []).filter((b: any) => {
      const ageMs = b.last_snapshot_at ? now - new Date(b.last_snapshot_at).getTime() : Infinity;
      const threshold = b.cadence === "weekly" ? 7 * 86400000 : 30 * 86400000;
      return ageMs >= threshold;
    });
  }
  return (data ?? []) as EligibleBrand[];
}

async function activeUserIds(brandUserIds: string[]): Promise<Set<string>> {
  if (brandUserIds.length === 0) return new Set();
  const unique = Array.from(new Set(brandUserIds));
  const { data, error } = await supabase
    .from("saas_subscriptions")
    .select("user_id")
    .in("user_id", unique)
    .eq("status", "active");
  if (error) throw new Error(`active subs: ${error.message}`);
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      try {
        results[idx] = { status: "fulfilled", value: await tasks[idx]() };
      } catch (e) {
        results[idx] = { status: "rejected", reason: e };
      }
    }
  };
  await Promise.all(Array(Math.min(concurrency, tasks.length)).fill(0).map(() => worker()));
  return results;
}

async function triggerSnapshot(brandId: string): Promise<{ brand_id: string; status: number; body: string }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/saas_run_brand_snapshot`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ brand_id: brandId, mode: "scheduled" }),
  });
  const text = await resp.text();
  return { brand_id: brandId, status: resp.status, body: text.slice(0, 500) };
}

Deno.serve(async (_req) => {
  const startedAt = new Date().toISOString();
  try {
    const eligible = await findEligibleBrands();
    if (eligible.length === 0) {
      return new Response(JSON.stringify({ ok: true, started_at: startedAt, eligible: 0, triggered: 0 }), { headers: { "content-type": "application/json" } });
    }

    const activeUsers = await activeUserIds(eligible.map(b => b.user_id));
    const toRun = eligible.filter(b => activeUsers.has(b.user_id));
    const skipped = eligible.length - toRun.length;

    const tasks = toRun.map(b => () => triggerSnapshot(b.id));
    const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);

    const success = results.filter(r => r.status === "fulfilled" && (r as PromiseFulfilledResult<{ status: number }>).value.status === 200).length;
    const failed = results.length - success;

    return new Response(JSON.stringify({
      ok: true,
      started_at: startedAt,
      eligible: eligible.length,
      skipped_inactive_users: skipped,
      triggered: tasks.length,
      success,
      failed,
      results: results.map((r, i) => ({
        brand_id: toRun[i].id,
        brand_name: toRun[i].name,
        cadence: toRun[i].cadence,
        outcome: r.status === "fulfilled"
          ? { http_status: (r as PromiseFulfilledResult<{ status: number }>).value.status }
          : { error: String((r as PromiseRejectedResult).reason).slice(0, 200) },
      })),
    }), { headers: { "content-type": "application/json" } });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas_run_all_scheduled ERROR]", msg);
    return new Response(JSON.stringify({ error: msg, started_at: startedAt }), { status: 500 });
  }
});