// GEOPERF SaaS — saas_coupon_validate
// S20 §4.1 : valide un code coupon avant le checkout.
// Trigger : POST { code, tier } → { valid: boolean, tier_target?, trial_days?, error? }
//
// Erreurs possibles (toutes en 200 avec valid:false pour UI claire) :
//   - coupon_not_found
//   - coupon_disabled
//   - coupon_expired
//   - coupon_exhausted
//   - coupon_wrong_tier (le tier choisi par l'user ne matche pas tier_target)
//
// Pas d'auth required : la validation est publique (le code lui-meme est secret).
// Note : l'effet de bord (insert redemption + apply trial) se fait dans saas_create_checkout_session.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const VALID_TIERS = new Set(["starter", "growth", "pro", "agency"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let body: { code?: string; tier?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }
  const code = String(body.code ?? "").trim().toUpperCase();
  const tier = body.tier ? String(body.tier).trim().toLowerCase() : null;
  if (!code) {
    return new Response(JSON.stringify({ valid: false, error: "code_required" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const { data: coupon, error } = await supabase
    .from("saas_coupons")
    .select("code, tier_target, trial_days, max_uses, used_count, expires_at, is_active")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: `db error: ${error.message}` }), { status: 500 });
  }
  if (!coupon) {
    return new Response(JSON.stringify({ valid: false, error: "coupon_not_found" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (!coupon.is_active) {
    return new Response(JSON.stringify({ valid: false, error: "coupon_disabled" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
    return new Response(JSON.stringify({ valid: false, error: "coupon_expired" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return new Response(JSON.stringify({ valid: false, error: "coupon_exhausted" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (tier && VALID_TIERS.has(tier) && tier !== coupon.tier_target) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "coupon_wrong_tier",
        tier_target: coupon.tier_target,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      valid: true,
      tier_target: coupon.tier_target,
      trial_days: coupon.trial_days,
    }),
    { headers: { "content-type": "application/json" } }
  );
});
