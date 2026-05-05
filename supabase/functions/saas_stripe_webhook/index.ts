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

function mapStripeStatus(s: string): "active" | "trialing" | "past_due" | "canceled" | "incomplete" {
  // S16 (CRITICAL #4) : preserve 'trialing' instead of collapsing to 'active'.
  // Le frontend / lib/saas-auth.ts s'appuie dessus pour afficher le banner trial actif.
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
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

        // S20 §4.1 : si la sub est issue d'un coupon, incrementer used_count + lier redemption.
        // On ne fait l'increment qu'une seule fois (sur subscription.created), pas sur updates.
        if (event.type === "customer.subscription.created") {
          const couponCode = sub.metadata?.coupon_code;
          if (couponCode) {
            // Idempotency : update redemption seulement si stripe_subscription_id NULL
            const { data: redemption, error: redempErr } = await supabase
              .from("saas_coupon_redemptions")
              .update({ stripe_subscription_id: sub.id })
              .eq("coupon_code", couponCode)
              .eq("user_id", userId)
              .is("stripe_subscription_id", null)
              .select("id")
              .maybeSingle();

            if (!redempErr && redemption) {
              // Increment used_count seulement si on a effectivement update une redemption (1ere fois)
              await supabase.rpc("saas_increment_coupon_usage", { p_code: couponCode }).then(
                ({ error: rpcErr }) => {
                  if (rpcErr) {
                    // Fallback : direct UPDATE si la fonction n existe pas
                    supabase
                      .from("saas_coupons")
                      .select("used_count")
                      .eq("code", couponCode)
                      .single()
                      .then(({ data: c }) => {
                        if (c) {
                          supabase
                            .from("saas_coupons")
                            .update({ used_count: (c.used_count ?? 0) + 1 })
                            .eq("code", couponCode);
                        }
                      });
                  }
                }
              );
            }
          }
        }

        // S16.2 fix : avant UPSERT, déclasser les anciennes subs free actives du user.
        // Sinon le UNIQUE INDEX partial `(user_id) WHERE status='active'` rejette
        // la nouvelle sub payante quand elle passe à active (event subscription.updated),
        // → webhook throws 500, sub bloquée à 'incomplete'.
        const newStatus = mapStripeStatus(sub.status);
        if (newStatus === "active" || newStatus === "trialing" || newStatus === "past_due") {
          await supabase
            .from("saas_subscriptions")
            .update({ status: "canceled", updated_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("tier", "free")
            .eq("status", "active");
        }

        await upsertSubscription(sub, userId);

        // S16 (CRITICAL #5) : free fallback safety net.
        // Si la subscription est passée à canceled / past_due / unpaid via update,
        // et que l'user n'a aucune sub active/trialing/past_due, créer une free fallback.
        // Le UNIQUE INDEX partiel WHERE status='active' empêche tout doublon.
        const { data: activeRows } = await supabase
          .from("saas_subscriptions")
          .select("id")
          .eq("user_id", userId)
          .in("status", ["active", "trialing", "past_due"])
          .limit(1);
        if (!activeRows || activeRows.length === 0) {
          await supabase
            .from("saas_subscriptions")
            .insert({ user_id: userId, tier: "free", status: "active", billing_cycle: "monthly", stripe_subscription_id: null });
          console.warn(`[webhook] subscription.updated downgrade orphan: free fallback for user ${userId}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // Marque comme canceled (préserve l'historique au lieu de DELETE)
        await supabase
          .from("saas_subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", sub.id);

        // Si le user n'a plus de subscription active/trialing/past_due, recrée un free.
        // Le UNIQUE INDEX partiel WHERE status='active' empêche tout doublon.
        const userId = await findUserIdByCustomer(sub.customer as string);
        if (userId) {
          const { data: activeRows } = await supabase
            .from("saas_subscriptions")
            .select("id")
            .eq("user_id", userId)
            .in("status", ["active", "trialing", "past_due"])
            .limit(1);
          if (!activeRows || activeRows.length === 0) {
            await supabase
              .from("saas_subscriptions")
              .insert({ user_id: userId, tier: "free", status: "active", billing_cycle: "monthly", stripe_subscription_id: null });
            console.warn(`[webhook] subscription.deleted downgrade orphan: free fallback for user ${userId}`);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const subscriptionId = invoice.subscription as string | null;

        if (subscriptionId) {
          await supabase
            .from("saas_subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_subscription_id", subscriptionId);
        }

        // S16 (CRITICAL #3) : envoyer un email "paiement échoué" à l'user.
        // Lookup profile via stripe_customer_id, puis fire & forget l'Edge Function dédiée.
        const { data: profile } = await supabase
          .from("saas_profiles")
          .select("id, email, full_name")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (!profile) {
          console.warn(`[webhook] payment_failed: no profile for customer ${customerId}`);
          break;
        }

        const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SR_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        fetch(`${SUPABASE_URL_ENV}/functions/v1/saas_send_payment_failed_email`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SR_ENV}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            amount_due: invoice.amount_due,
            currency: invoice.currency,
            hosted_invoice_url: invoice.hosted_invoice_url,
            next_payment_attempt: invoice.next_payment_attempt,
          }),
        }).catch((e) => console.error("[webhook] payment_failed email dispatch:", e instanceof Error ? e.message : String(e)));
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
