// GEOPERF SaaS — Crée une Stripe Checkout Session pour upgrade
// Spec : saas/SPEC.md section 7.2
// Trigger : POST {tier: 'solo'|'pro'|'agency'} avec Authorization: Bearer <user JWT>
// Output : {checkout_url}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

// S7 (2026-04-30) : grille à 5 tiers. STRIPE_PRICE_SOLO conservé en alias starter
// pour les comptes legacy avant migration tier 'solo' → 'starter'.
const TIER_TO_PRICE: Record<string, string | undefined> = {
  starter: Deno.env.get("STRIPE_PRICE_STARTER") ?? Deno.env.get("STRIPE_PRICE_SOLO"),
  growth:  Deno.env.get("STRIPE_PRICE_GROWTH"),
  pro:     Deno.env.get("STRIPE_PRICE_PRO"),
  agency:  Deno.env.get("STRIPE_PRICE_AGENCY"),
  // Legacy : un user qui aurait l'ancien tier 'solo' demandé checkout = on l'envoie vers Starter
  solo:    Deno.env.get("STRIPE_PRICE_STARTER") ?? Deno.env.get("STRIPE_PRICE_SOLO"),
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

  const { tier } = await req.json().catch(() => ({}));
  const priceId = TIER_TO_PRICE[tier];
  if (!priceId) return new Response("Invalid tier", { status: 400 });

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

  // Crée la session checkout
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/app/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/app/billing?canceled=true`,
    automatic_tax: { enabled: true },
    metadata: { user_id: user.id, tier },
    subscription_data: {
      metadata: { user_id: user.id, tier },
    },
  });

  return new Response(JSON.stringify({ checkout_url: session.url }), {
    headers: { "content-type": "application/json" },
  });
});
