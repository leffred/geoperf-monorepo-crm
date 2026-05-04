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

---

## 8. Grille tiers v2 (Sprint S7) + yearly prices (Sprint S13/S16)

> ⚠️ La table §1 ci-dessus correspond à l'ancienne grille (Solo/Pro/Agency).
> La grille **actuelle** est : Free / Starter / Growth / Pro / Agency, avec cycles **monthly** ET **annual** (-20%).

### Monthly prices (S7)

| Tier | Env var | Amount HT | Interval |
|---|---|---|---|
| Starter | `STRIPE_PRICE_STARTER` | 79 €/mois | Monthly |
| Growth  | `STRIPE_PRICE_GROWTH`  | 199 €/mois | Monthly |
| Pro     | `STRIPE_PRICE_PRO`     | 399 €/mois | Monthly |
| Agency  | `STRIPE_PRICE_AGENCY`  | 799 €/mois | Monthly |

`STRIPE_PRICE_SOLO` est conservé en alias legacy → mappé sur `STRIPE_PRICE_STARTER` côté code (cf `saas_create_checkout_session/index.ts` lignes 22-26).

### Yearly prices (S13, recâblés en S16)

Les yearly prices appliquent un rabais de **-20%** par rapport à 12× le monthly :

| Tier | Lookup key | Env var | Amount HT |
|---|---|---|---|
| Starter | `geoperf_starter_yearly` | `STRIPE_PRICE_STARTER_YEARLY` | 758 €/an (≈ 63 €/mois équivalent) |
| Growth  | `geoperf_growth_yearly`  | `STRIPE_PRICE_GROWTH_YEARLY`  | 1 910 €/an (≈ 159 €/mois) |
| Pro     | `geoperf_pro_yearly`     | `STRIPE_PRICE_PRO_YEARLY`     | 3 830 €/an (≈ 319 €/mois) |
| Agency  | `geoperf_agency_yearly`  | `STRIPE_PRICE_AGENCY_YEARLY`  | 7 670 €/an (≈ 639 €/mois) |

#### Création via Stripe CLI

```bash
# Starter yearly : 79 × 12 × 0.8 = 758,40 EUR
stripe prices create \
  --product <prod_starter_id> \
  --unit-amount 75840 \
  --currency eur \
  --recurring interval=year \
  --lookup-key geoperf_starter_yearly

# Growth yearly : 199 × 12 × 0.8 = 1910,40 EUR
stripe prices create --product <prod_growth_id> --unit-amount 191040 --currency eur --recurring interval=year --lookup-key geoperf_growth_yearly

# Pro yearly : 399 × 12 × 0.8 = 3830,40 EUR
stripe prices create --product <prod_pro_id> --unit-amount 383040 --currency eur --recurring interval=year --lookup-key geoperf_pro_yearly

# Agency yearly : 799 × 12 × 0.8 = 7670,40 EUR
stripe prices create --product <prod_agency_id> --unit-amount 767040 --currency eur --recurring interval=year --lookup-key geoperf_agency_yearly
```

> Les `<prod_*_id>` correspondent aux mêmes products que pour les monthly prices, cf Stripe Dashboard ou `stripe products list`.

#### Set les secrets Supabase yearly

```bash
supabase secrets set STRIPE_PRICE_STARTER_YEARLY=price_xxx
supabase secrets set STRIPE_PRICE_GROWTH_YEARLY=price_xxx
supabase secrets set STRIPE_PRICE_PRO_YEARLY=price_xxx
supabase secrets set STRIPE_PRICE_AGENCY_YEARLY=price_xxx
```

> Pour Vercel/frontend les yearly prices ne sont pas exposés directement — c'est le checkout côté Edge Function qui résout `tier + cycle → price_id` à la volée.

#### Comportement si env var manquante (S16 fix)

`saas_create_checkout_session` retourne désormais une **erreur HTTP 503 explicite** au lieu d'une 500 muette quand un yearly price n'est pas configuré :

```json
{
  "error": "Plan 'pro' annual not configured",
  "hint": "Set env var STRIPE_PRICE_PRO_YEARLY on the Edge Function."
}
```

Le frontend `/saas?cycle=annual` doit donc faire un fallback gracieux ou logguer cette erreur (S17 : afficher un toast UX au lieu d'une page d'erreur générique).

### Test smoke yearly

```
1. /saas?cycle=annual → click "Démarrer Starter"
2. Checkout Stripe ouvert avec montant 758 EUR
3. Carte test 4242 4242 4242 4242
4. Vérifier saas_subscriptions : tier='starter' billing_cycle='annual' status='active'
```

---

## 9. Webhook events handlés (S16 update)

| Event | Action |
|---|---|
| `checkout.session.completed` | Lie `stripe_customer_id` ↔ `user_id` via metadata |
| `customer.subscription.created` | Upsert sub + free fallback safety net si orphelin |
| `customer.subscription.updated` | Upsert sub + free fallback safety net si downgrade orphelin |
| `customer.subscription.deleted` | `status='canceled'` + free fallback |
| `invoice.payment_failed` | `status='past_due'` + email "Paiement échoué" via `saas_send_payment_failed_email` |

Le `mapStripeStatus` préserve désormais `trialing` (S16 CRITICAL #4) au lieu de le collapser sur `active`. Cela permet au UI `/app/billing` d'afficher le banner "Trial actif, X jours restants".
