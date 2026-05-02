// GEOPERF SaaS — Stripe webhook handler
// Spec : saas/SPEC.md section 5.4
// Trigger : Stripe webhooks (configure URL = https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_stripe_webhook)
//
// Events gérés :
//   - checkout.session.completed       → link customer_id ↔ user_id (via metadata.user_id)
//   - customer.subscription.created    → upsert saas_subscriptions
//   - customer.subscription.updated    → update tier/status/period_end/cancel_at_period_end
//   - customer.subscription.deleted    → status='canceled'
//   - invoice.payment_failed           → status='past_due'
//
// Sécurité : vérifie stripe-signature header avec STRIPE_WEBHOOK_SECRET.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-11-20.acacia",
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

// Map Stripe price_id → {tier, billing_cycle}
// S7 (2026-04-30) : 4 tiers payants (starter/growth/pro/agency)
// S13 (2026-05-01) : ajout des yearly prices (-20%)
type TierResolution = { tier: "starter" | "growth" | "pro" | "agency"; billing_cycle: "monthly" | "annual" };
function resolveTierFromPriceId(priceId: string): TierResolution | null {
  // Monthly
  if (priceId === Deno.env.get("STRIPE_PRICE_STARTER")) return { tier: "starter", billing_cycle: "monthly" };
  if (priceId === Deno.env.get("STRIPE_PRICE_GROWTH"))  return { tier: "growth",  billing_cycle: "monthly" };
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO"))     return { tier: "pro",     billing_cycle: "monthly" };
  if (priceId === Deno.env.get("STRIPE_PRICE_AGENCY"))  return { tier: "agency",  billing_cycle: "monthly" };
  // Yearly (S13)
  if (priceId === Deno.env.get("STRIPE_PRICE_STARTER_YEARLY")) return { tier: "starter", billing_cycle: "annual" };
  if (priceId === Deno.env.get("STRIPE_PRICE_GROWTH_YEARLY"))  return { tier: "growth",  billing_cycle: "annual" };
  if (priceId === Deno.env.get("STRIPE_PRICE_PRO_YEARLY"))     return { tier: "pro",     billing_cycle: "annual" };
  if (priceId === Deno.env.get("STRIPE_PRICE_AGENCY_YEARLY"))  return { tier: "agency",  billing_cycle: "annual" };
  // Legacy STRIPE_PRICE_SOLO mappé sur starter monthly
  if (priceId === Deno.env.get("STRIPE_PRICE_SOLO")) return { tier: "starter", billing_cycle: "monthly" };
  return null;
}

function mapStripeStatus(s: string): "active" | "past_due" | "canceled" | "incomplete" {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled") return "canceled";
  return "incomplete";
}

async function upsertSubscription(stripeSub: Stripe.Subscription, userId: string) {
  const priceId = stripeSub.items.data[0]?.price?.id ?? null;
  const resolution = priceId ? resolveTierFromPriceId(priceId) : null;
  if (!resolution) {
    console.warn(`Unknown price_id ${priceId} for sub ${stripeSub.id}, skipping`);
    return;
  }

  const { error } = await supabase
    .from("saas_subscriptions")
    .upsert(
      {
        user_id: userId,
        tier: resolution.tier,
        billing_cycle: resolution.billing_cycle,
        status: mapStripeStatus(stripeSub.status),
        stripe_subscription_id: stripeSub.id,
        stripe_price_id: priceId,
        current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: stripeSub.cancel_at_period_end,
      },
      { onConflict: "stripe_subscription_id" }
    );

  if (error) throw new Error(`upsertSubscription failed: ${error.message}`);
}

async function findUserIdByCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabase
    .from("saas_profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error("Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (!userId) throw new Error("Missing metadata.user_id on checkout session");
        // Lier customer ↔ user (1ère fois seulement)
        if (session.customer) {
          await supabase
            .from("saas_profiles")
            .update({ stripe_customer_id: session.customer as string })
            .eq("id", userId);
        }
        // La subscription elle-même sera créée via customer.subscription.created qui suit
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await findUserIdByCustomer(sub.customer as string);
        if (!userId) throw new Error(`No user found for customer ${sub.customer}`);
        await upsertSubscription(sub, userId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // Marque comme canceled (préserve l'historique au lieu de DELETE)
        await supabase
          .from("saas_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);

        // Si le user n'a plus de subscription active, recrée un free.
        // Le UNIQUE INDEX partiel WHERE status='active' empêche tout doublon.
        const userId = await findUserIdByCustomer(sub.customer as string);
        if (userId) {
          const { data: activeRows } = await supabase
            .from("saas_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .eq("status", "active")
            .limit(1);
          if (!activeRows || activeRows.length === 0) {
            await supabase
              .from("saas_subscriptions")
              .insert({ user_id: userId, tier: "free", status: "active" });
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          await supabase
            .from("saas_subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", invoice.subscription as string);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(`Handler error for ${event.type}:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
