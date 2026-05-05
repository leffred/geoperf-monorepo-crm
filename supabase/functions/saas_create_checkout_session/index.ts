// GEOPERF SaaS — Crée une Stripe Checkout Session pour upgrade
// Spec : saas/SPEC.md section 7.2
// Trigger : POST {tier, billing_cycle?, trial?} avec Authorization: Bearer <user JWT>
//   - tier : 'starter' | 'growth' | 'pro' | 'agency' (legacy 'solo' = alias starter)
//   - billing_cycle : 'monthly' (default) | 'annual' (-20%, S13)
//   - trial : true → 14 jours gratuits sur Pro uniquement (S13)
// Output : {checkout_url}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

// S7 (2026-04-30) : grille à 5 tiers + S13 (2026-05-01) : annual -20%
// Map tier+cycle → STRIPE_PRICE_* env var
const TIER_CYCLE_TO_PRICE: Record<string, Record<string, string | undefined>> = {
  monthly: {
    starter: Deno.env.get("STRIPE_PRICE_STARTER") ?? Deno.env.get("STRIPE_PRICE_SOLO"),
    growth:  Deno.env.get("STRIPE_PRICE_GROWTH"),
    pro:     Deno.env.get("STRIPE_PRICE_PRO"),
    agency:  Deno.env.get("STRIPE_PRICE_AGENCY"),
    solo:    Deno.env.get("STRIPE_PRICE_STARTER") ?? Deno.env.get("STRIPE_PRICE_SOLO"),
  },
  annual: {
    starter: Deno.env.get("STRIPE_PRICE_STARTER_YEARLY"),
    growth:  Deno.env.get("STRIPE_PRICE_GROWTH_YEARLY"),
    pro:     Deno.env.get("STRIPE_PRICE_PRO_YEARLY"),
    agency:  Deno.env.get("STRIPE_PRICE_AGENCY_YEARLY"),
    solo:    Deno.env.get("STRIPE_PRICE_STARTER_YEARLY"),
  },
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://geoperf.com";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing auth", { status: 401 });
  }

  // Récupère le user via le JWT (RLS-safe : auth.getUser valide la signature)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response("Unauthorized", { status: 401 });

  const { tier, billing_cycle = "monthly", trial = false, coupon_code } = await req.json().catch(() => ({}));
  if (billing_cycle !== "monthly" && billing_cycle !== "annual") {
    return new Response(JSON.stringify({ error: "Invalid billing_cycle (must be 'monthly' or 'annual')" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  const cycleMap = TIER_CYCLE_TO_PRICE[billing_cycle];
  if (!cycleMap || !(tier in cycleMap)) {
    return new Response(JSON.stringify({ error: `Invalid tier '${tier}' (valid: starter, growth, pro, agency)` }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  const priceId = cycleMap[tier];
  if (!priceId) {
    // S16 (CRITICAL #1) : env var price_id manquante (ex: STRIPE_PRICE_PRO_YEARLY non configuré).
    // Distingue clairement d'une 500 muette pour faciliter le debug côté Vercel.
    return new Response(JSON.stringify({
      error: `Plan '${tier}' ${billing_cycle} not configured`,
      hint: `Set env var STRIPE_PRICE_${tier.toUpperCase()}_${billing_cycle === "annual" ? "YEARLY" : "MONTHLY"} on the Edge Function.`,
    }), { status: 503, headers: { "content-type": "application/json" } });
  }

  // Trial 14 jours réservé au tier Pro (S13)
  let trialDays: number | undefined = (trial === true && tier === "pro") ? 14 : undefined;

  // S20 §4.1 : coupon — validate + override trial_days. Insert redemption row.
  let couponNormalized: string | null = null;
  if (coupon_code) {
    couponNormalized = String(coupon_code).trim().toUpperCase();
    const adminClientForCoupon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    const { data: coupon, error: couponErr } = await adminClientForCoupon
      .from("saas_coupons")
      .select("code, tier_target, trial_days, max_uses, used_count, expires_at, is_active")
      .eq("code", couponNormalized)
      .maybeSingle();
    if (couponErr || !coupon) {
      return new Response(JSON.stringify({ error: "coupon_not_found" }), {
        status: 422, headers: { "content-type": "application/json" },
      });
    }
    if (!coupon.is_active) {
      return new Response(JSON.stringify({ error: "coupon_disabled" }), {
        status: 422, headers: { "content-type": "application/json" },
      });
    }
    if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
      return new Response(JSON.stringify({ error: "coupon_expired" }), {
        status: 422, headers: { "content-type": "application/json" },
      });
    }
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return new Response(JSON.stringify({ error: "coupon_exhausted" }), {
        status: 422, headers: { "content-type": "application/json" },
      });
    }
    if (coupon.tier_target !== tier && coupon.tier_target !== "solo") {
      return new Response(JSON.stringify({ error: "coupon_wrong_tier", tier_target: coupon.tier_target }), {
        status: 422, headers: { "content-type": "application/json" },
      });
    }
    // Override trial_days fournis par le coupon (fallback 14j si NULL)
    trialDays = (coupon.trial_days ?? 14) || 14;

    // Idempotence : insert redemption avant Stripe (UNIQUE (coupon_code, user_id) protect double)
    const { error: redempErr } = await adminClientForCoupon
      .from("saas_coupon_redemptions")
      .insert({ coupon_code: coupon.code, user_id: user.id, email: user.email ?? "" });
    if (redempErr) {
      // Detection unique_violation 23505 → already_redeemed
      const code = (redempErr as unknown as { code?: string }).code;
      if (code === "23505") {
        return new Response(JSON.stringify({ error: "coupon_already_redeemed_by_user" }), {
          status: 409, headers: { "content-type": "application/json" },
        });
      }
      console.error("[checkout] redemption insert err:", redempErr.message);
      return new Response(JSON.stringify({ error: `redemption_insert_failed: ${redempErr.message}` }), {
        status: 500, headers: { "content-type": "application/json" },
      });
    }
  }

  // Récupère ou crée le Stripe customer pour ce user
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
  const { data: profile } = await adminClient
    .from("saas_profiles")
    .select("stripe_customer_id, email, full_name")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email ?? user.email,
      name: profile?.full_name ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;
    await adminClient
      .from("saas_profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  // S16.2 fix : avant de créer une nouvelle session, cancel les subs Stripe actives
  // existantes du customer. Sinon Stripe permet plusieurs subs en parallèle pour
  // le même customer → l'user est facturé N fois. Stripe ne fait PAS le cancel
  // automatique — c'est au code Geoperf de gérer le upgrade/downgrade.
  //
  // Trade-off accepté : si l'user abandonne le checkout après ce cancel, il perd
  // son ancien plan. Acceptable pour la phase actuelle — la priorité est zéro
  // double-billing. À raffiner plus tard avec Stripe Customer Portal pour les
  // upgrades/downgrades in-place.
  try {
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    const subsToCancel = existingSubs.data.filter(s =>
      s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "incomplete"
    );
    for (const sub of subsToCancel) {
      await stripe.subscriptions.cancel(sub.id).catch(e => {
        console.warn(`[checkout] cancel old sub ${sub.id} failed:`, e instanceof Error ? e.message : String(e));
      });
    }
  } catch (e) {
    console.warn("[checkout] list/cancel old subs warning:", e instanceof Error ? e.message : String(e));
    // Ne pas bloquer le checkout — laisser l'user passer même si cancel a échoué.
  }

  // Crée la session checkout
  // Note `customer_update.address: "auto"` requis quand `automatic_tax` est on
  // et que le customer n'a pas d'adresse pré-remplie : Stripe utilise l'adresse
  // de facturation saisie au checkout et la persiste sur le customer pour les
  // factures futures (sinon erreur "Automatic tax calculation requires a valid
  // address on the Customer").
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    billing_address_collection: "required",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/app/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/app/billing?canceled=true`,
    automatic_tax: { enabled: true },
    metadata: {
      user_id: user.id, tier, billing_cycle, trial: String(!!trialDays),
      ...(couponNormalized ? { coupon_code: couponNormalized } : {}),
    },
    subscription_data: {
      metadata: {
        user_id: user.id, tier, billing_cycle,
        ...(couponNormalized ? { coupon_code: couponNormalized } : {}),
      },
      ...(trialDays ? { trial_period_days: trialDays } : {}),
    },
  });

  return new Response(JSON.stringify({ checkout_url: session.url }), {
    headers: { "content-type": "application/json" },
  });
});
