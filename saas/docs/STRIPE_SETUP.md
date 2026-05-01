# Stripe — Setup checklist Sprint S1

> Ces étapes sont **manuelles** dans le dashboard Stripe Jourdechance SAS.
> À faire avant que les Edge Functions soient déployables.

## 1. Créer les produits + prix

Dashboard Stripe → **Products** → **Add product** (3 fois) :

| Product name | Price ID env var | Amount | Interval | Currency |
|---|---|---|---|---|
| Geoperf Solo | `STRIPE_PRICE_SOLO` | 149,00 | Monthly | EUR |
| Geoperf Pro | `STRIPE_PRICE_PRO` | 349,00 | Monthly | EUR |
| Geoperf Agency | `STRIPE_PRICE_AGENCY` | 899,00 | Monthly | EUR |

Pour chacun : **Tax behavior = Exclusive** (TVA ajoutée au moment du paiement).

Note les `price_id` (format `price_1ABC...`) qui apparaissent après création.

## 2. Activer Stripe Tax

Dashboard → **Tax** → **Activate Stripe Tax**.
Régions : **France + reste UE**.
Origin address : 31 rue Diaz, 92100 Boulogne Billancourt, France, Jourdechance SAS.

Sans ça, `automatic_tax: { enabled: true }` dans `saas_create_checkout_session` plante.

## 3. Configurer le webhook endpoint

Dashboard → **Developers → Webhooks → Add endpoint** :

- **URL** : `https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_stripe_webhook`
- **Events to send** :
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Récupère le **signing secret** (format `whsec_...`).

## 4. Configurer le Customer Portal

Dashboard → **Settings → Billing → Customer portal** → **Activate** :

- ✅ Allow customers to update payment methods
- ✅ Allow customers to update billing address
- ✅ Allow customers to view invoice history
- ✅ Allow customers to cancel subscriptions (cancel at period end)
- ✅ Allow customers to switch plans (entre Solo/Pro/Agency)

## 5. Set les secrets Supabase

```bash
# Mode test d'abord :
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_test_...
supabase secrets set STRIPE_PRICE_SOLO=price_test_...
supabase secrets set STRIPE_PRICE_PRO=price_test_...
supabase secrets set STRIPE_PRICE_AGENCY=price_test_...
supabase secrets set APP_URL=https://geoperf.com

# Au switch live (Sprint S6) : remplacer par les sk_live_ / whsec_live_ / price_live_
```

## 6. Déployer les Edge Functions

```bash
supabase functions deploy saas_stripe_webhook --no-verify-jwt
supabase functions deploy saas_create_checkout_session
supabase functions deploy saas_create_portal_session
```

⚠️ **`saas_stripe_webhook` doit avoir `--no-verify-jwt`** (Stripe n'envoie pas de JWT Supabase, la sécurité passe par la signature `stripe-signature` vérifiée dans le code).

Les deux autres requièrent un JWT user (auth Supabase) — ne pas mettre `--no-verify-jwt`.

## 7. Tester end-to-end

1. Crée un user de test via `/signup` (ou Supabase Auth dashboard)
2. Frontend appelle `saas_create_checkout_session` avec `{tier: 'solo'}` → reçoit `checkout_url`
3. Visite la `checkout_url`, paie avec carte test `4242 4242 4242 4242` (n'importe quelle date future, n'importe quel CVC)
4. Vérifier dans Supabase :
   - `saas_profiles.stripe_customer_id` est rempli
   - `saas_subscriptions` a une row `tier='solo' status='active'`
5. Stripe dashboard → Webhooks → vérifier que les events arrivent en `200 OK`
6. Tester portal : appelle `saas_create_portal_session` → reçoit `portal_url` → visite → cancel → vérifier que le webhook met `status='canceled'` et qu'une nouvelle row `free active` est créée
