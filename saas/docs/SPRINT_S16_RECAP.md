# Sprint S16 — Recap général : Pre-Launch Cleanup

**Date** : 2026-05-04
**Branche** : main
**Status build** : OK vert (`npm run build` — 31 pages, dashboard 267 B server-only)
**Scope brief** : 5 CRITICAL findings + 3 IMPORTANT du `LAUNCH_READINESS_AUDIT`. 100% quality / cleanup, aucune nouvelle feature.

---

## TL;DR

Sprint cleanup focused. **8/8 objectifs livrés**, plus 1 bug latent résolu en marge :

| # | Objectif | Status | Path / impact |
|---|---|---|---|
| 4.1 | Stripe yearly prices câblées (CRITICAL #1) | OK Phase B livrée — Phase A faite par Fred (vérifié via Stripe MCP) | `saas_create_checkout_session/index.ts` lignes 58-80 |
| 4.2 | Retrait fallback hardcoded digest filter (CRITICAL #2) | OK | `saas_send_weekly_digest/index.ts` ligne 29 |
| 4.3 | Webhook `invoice.payment_failed` + email (CRITICAL #3) | OK | `saas_stripe_webhook/index.ts` + nouvelle Edge Function `saas_send_payment_failed_email` |
| 4.4 | Trial Pro `trialing` préservé + types (CRITICAL #4) | OK | `mapStripeStatus` + `SaasSubStatus` type + 8 Edge Functions patched .in([active,trialing]) |
| 4.5 | Free fallback safety net downgrade (CRITICAL #5) | OK | `saas_stripe_webhook` cases `subscription.updated` + `subscription.deleted` |
| 4.6 | Privacy/Terms TVA + DPA + Stripe + RGPD billing (IMPORTANT) | OK | privacy/page + terms/page + billing/page |
| 4.7 | Email palette legacy → Tech crisp (IMPORTANT) | OK | `saas_send_welcome_email` + `saas_send_alert_email` |
| 4.8 | Doc `STRIPE_SETUP.md` yearly section (IMPORTANT) | OK | section 8 + 9 ajoutées |

**Aucun push, aucun deploy Edge Function, aucune migration DB.**

### Bonus livré en marge

- **Bug latent post-§4.4** : 8 Edge Functions filtraient `.eq("status", "active")` pour résoudre le tier — un user `trialing` aurait retomberait sur `tier='free'`. Patché systématiquement vers `.in("status", ["active", "trialing"])` pour préserver l'accès Pro pendant le trial.
- **Free fallback safety net** étendue aux 3 cases (created, updated, deleted) avec critère élargi à `["active", "trialing", "past_due"]` (un past_due peut redevenir active après retry Stripe).

---

## Section 1 — §4.1 Stripe yearly prices (CRITICAL #1)

### Phase A — DÉJÀ FAITE par Fred (vérifié via Stripe MCP)

Vérification au démarrage du sprint via `mcp__claude_ai_Stripe__list_prices` : **les 4 prices yearly EUR sont créés** sur les 4 products SaaS (S7) avec les bons montants :

| Tier | Stripe price_id | Amount | Product |
|---|---|---|---|
| Starter | `price_1TSYCGAGQi1Bp59Fw86eSTC7` | 758,40 EUR/an | `prod_UQnQMss20BeNtT` (Starter monthly 79€) |
| Growth  | `price_1TSYCMAGQi1Bp59FVzFGnLcj` | 1 910,40 EUR/an | `prod_UQnQWl9e50Bc4G` (Growth monthly 199€) |
| Pro     | `price_1TSYCTAGQi1Bp59FGAZRkb8g` | 3 830,40 EUR/an | `prod_UQnQPqR4LgoKdv` (Pro monthly 399€) |
| Agency  | `price_1TSYCaAGQi1Bp59Fb6TroVkf` | 7 670,40 EUR/an | `prod_UQnQbvWYnASNxF` (Agency monthly 799€) |

**Reste à vérifier par Fred** : les 4 secrets Supabase `STRIPE_PRICE_*_YEARLY` sont-ils remplis avec ces price_ids ? Commande de check :
```bash
npx supabase secrets list | grep YEARLY
```
Si manquant :
```bash
npx supabase secrets set STRIPE_PRICE_STARTER_YEARLY=price_1TSYCGAGQi1Bp59Fw86eSTC7
npx supabase secrets set STRIPE_PRICE_GROWTH_YEARLY=price_1TSYCMAGQi1Bp59FVzFGnLcj
npx supabase secrets set STRIPE_PRICE_PRO_YEARLY=price_1TSYCTAGQi1Bp59FGAZRkb8g
npx supabase secrets set STRIPE_PRICE_AGENCY_YEARLY=price_1TSYCaAGQi1Bp59Fb6TroVkf
```

### Phase B — code livré

`supabase/functions/saas_create_checkout_session/index.ts` (lignes 58-80) renvoie désormais :
- HTTP 400 + JSON `{error: "Invalid billing_cycle ..."}` si cycle invalide
- HTTP 400 + JSON `{error: "Invalid tier ..."}` si tier inconnu
- HTTP **503** + JSON `{error: "Plan 'X' annual not configured", hint: "Set env var STRIPE_PRICE_X_YEARLY..."}` si l'env var price_id est manquante

→ Plus de 500 muette. L'admin/Fred voit immédiatement quelle env var est absente. Le frontend pourrait afficher un toast au lieu d'un crash (S17 nice-to-have).

### Phase C — test E2E (à faire par Fred après confirmation env vars)

```
1. /saas?cycle=annual → click "Démarrer Starter"
2. Checkout Stripe ouvert avec montant 758,40 EUR HT
3. Carte test 4242 4242 4242 4242
4. SELECT tier, billing_cycle, status FROM saas_subscriptions WHERE user_id = '<id>'
   → ('starter', 'annual', 'active')
```

---

## Section 2 — §4.2 Retrait fallback digest filter

**Avant** :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "flefebvre@jourdechance.com")
```

**Après** :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "")
```

→ Sans env var, le filtre est désactivé et **tous** les users `digest_weekly_enabled=true` (et tier ≠ free) reçoivent le digest. Pour réactiver un filtre ad-hoc, set la variable explicitement :
```bash
npx supabase secrets set DIGEST_TEST_EMAIL_FILTER="email1@x.com,email2@y.com"
```

**Action complémentaire pour Fred après deploy** :
```bash
# Vérifier que le secret n'est pas resté set d'une session de test précédente
npx supabase secrets list | grep DIGEST_TEST_EMAIL_FILTER
# Si présent et non désiré :
npx supabase secrets unset DIGEST_TEST_EMAIL_FILTER
```

---

## Section 3 — §4.3 Webhook `invoice.payment_failed` + Edge Function email

### 3.1 Webhook étendu

`saas_stripe_webhook/index.ts` case `invoice.payment_failed` :
- Update `saas_subscriptions.status='past_due'` (existant)
- **NEW** : lookup `saas_profiles` via `stripe_customer_id`, fire-and-forget l'Edge Function `saas_send_payment_failed_email` avec :
  - `user_id`, `email`, `full_name`
  - `amount_due`, `currency`
  - `hosted_invoice_url` (Stripe-hosted, fallback sur `/app/billing` si absent)
  - `next_payment_attempt` (unix timestamp)
- Si pas de profile pour le customer (cas race condition / customer orphelin) → warn log, pas d'email

### 3.2 Nouvelle Edge Function `saas_send_payment_failed_email/index.ts` (165 lignes)

Template Tech crisp inline dès la création (palette ink/surface/Inter, glyphe `·` ambré préservé) :
- Subject : `Action requise — Paiement Geoperf échoué (123,45 €)`
- Eyebrow rouge `Action requise`, H1 ink
- Bloc rouge `border-left:2px solid #B91C1C` avec rappel de la prochaine tentative Stripe
- CTA noir → `/app/billing`
- Mention `hosted_invoice_url` Stripe en lien secondaire
- Idempotence via Resend (pas de retry side-effect côté Geoperf, on log juste)
- Insert `saas_usage_log` event_type=`payment_failed_notified`

### 3.3 Test fonctionnel (Fred)

```
1. Stripe Dashboard → Test mode → utiliser carte 4000 0000 0000 0341 (decline insufficient funds)
2. Démarrer un checkout Starter
3. Stripe envoie invoice.payment_failed après échec
4. Vérifier saas_subscriptions.status = 'past_due'
5. Vérifier email reçu sur la boîte du user de test
6. Vérifier saas_usage_log row event_type='payment_failed_notified'
```

---

## Section 4 — §4.4 Trial Pro `trialing` (CRITICAL #4)

### 4.1 mapStripeStatus

Avant : `if (s === "active" || s === "trialing") return "active"` — collapsait les deux états.

Après : `trialing` est conservé tel quel. Aussi : `incomplete_expired` mappé sur `canceled` (cohérence Stripe).

### 4.2 Type frontend `SaasSubStatus`

Nouveau type exporté dans `lib/saas-auth.ts` :
```typescript
export type SaasSubStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";
```

`SaasSubscription.status` utilise désormais ce type. Le cast `as string | undefined` dans `/app/billing/page.tsx` ligne 72 est retiré : `const isTrialing = ctx.subscription?.status === "trialing"`.

### 4.3 Bug latent post-§4.4 résolu (8 fichiers)

`loadSaasContext()` filtrait `eq("status", "active")` quand il chargeait la subscription de l'account_owner. Avec `trialing` désormais persisté tel quel, un user en trial Pro aurait `ctx.subscription === null` → `tier='free'` → perte d'accès aux features Pro pendant le trial.

**Fix** : élargi en `.in("status", ["active", "trialing"])` dans `loadSaasContext` ET dans 8 Edge Functions où le tier est résolu côté serveur :

| Fichier | Ligne | Fix |
|---|---|---|
| `landing/lib/saas-auth.ts` | 131 | `.in("status", ["active", "trialing"])` |
| `supabase/functions/saas_compute_alignment/index.ts` | 160 | idem |
| `supabase/functions/saas_api_v1_router/index.ts` | 62 | idem |
| `supabase/functions/saas_analyze_sentiment/index.ts` | 145 | idem |
| `supabase/functions/saas_generate_content_draft/index.ts` | 166 | idem |
| `supabase/functions/saas_dispatch_integration_webhooks/index.ts` | 234 | idem |
| `supabase/functions/saas_send_alert_email/index.ts` | 162 | idem |
| `supabase/functions/saas_run_brand_snapshot/index.ts` | 324 | idem |
| `supabase/functions/saas_run_all_scheduled/index.ts` | 64 | idem |

Patché en batch via `sed`. Vérifié post-patch via grep.

---

## Section 5 — §4.5 Free fallback safety net (CRITICAL #5)

### 5.1 case `subscription.updated`

Avant : seul `subscription.deleted` créait une free fallback. Si Stripe envoyait un `subscription.updated` qui faisait passer la sub en `canceled` (ex : downgrade immédiat via portal), aucun fallback ne se créait → user orphelin temporairement avec `ctx.subscription === null` puis `tier='free'` mais sans row `saas_subscriptions` correspondante.

Après l'upsert dans `subscription.updated`, on vérifie qu'il existe au moins une sub `active|trialing|past_due` ; sinon insert `tier=free, status=active, billing_cycle=monthly, stripe_subscription_id=null`.

### 5.2 case `subscription.deleted` durci

Le check existait mais filtrait juste sur `status='active'`. Élargi à `["active", "trialing", "past_due"]` pour ne pas créer de free dupliqué si l'user a un past_due qui peut redevenir active après retry Stripe.

Le UNIQUE INDEX partiel `WHERE status='active'` empêche les doublons défensivement.

### 5.3 Test (Fred)

```
1. Créer un user Pro en mode Stripe test
2. Portal Stripe → Cancel immediately (sans switch vers un autre plan)
3. Webhook fire customer.subscription.updated puis .deleted
4. SELECT tier, status FROM saas_subscriptions WHERE user_id = '<id>'
   → résultat attendu : 1 row (tier='pro', status='canceled') + 1 row (tier='free', status='active')
```

---

## Section 6 — §4.6 Privacy/Terms + RGPD billing

### 6.1 Privacy

`landing/app/privacy/page.tsx` :
- Date dernière mise à jour : 4 mai 2026
- Section 1 : ajout TVA intracommunautaire `FR XX 838114619` avec **placeholder explicite "(numéro complet à confirmer)"** — Fred doit éditer pour mettre la vraie clé de contrôle (2 chiffres avant le SIREN). Je n'ai pas inventé.
- Section 6 (renommée "Hébergement et sous-traitants") : refonte de la liste plate en `<ul>` détaillé avec **Stripe Inc.** ajouté explicitement (PCI-DSS niveau 1, transfert encadré par SCC), **Resend** ajouté (envoi emails transactionnels), formulation enrichie pour les autres sous-traitants
- **Nouvelle section 7 "Data Processing Agreement (DPA)"** : DPA standard art.28 RGPD disponible sur demande pour Pro/Agency, contact `dpa@geoperf.com`, délai 5 jours ouvrés
- Sections 7-10 renumérotées 8-11

### 6.2 Terms

`landing/app/terms/page.tsx` :
- Date dernière mise à jour : 4 mai 2026
- Section 1 : TVA `FR XX 838114619` avec placeholder
- Section 7 : ajout du lien DPA pour Pro/Agency
- **Nouvelle section 8 "Conditions du SaaS Geoperf"** :
  - Abonnement et durée (cycles monthly/annual, tacite reconduction)
  - Résiliation (via portal Stripe, effective fin de période payée, bascule auto sur Free)
  - Remboursements (non-remboursable sauf défaut technique > 7j ou erreur facturation)
  - Paiement et facturation (Stripe PCI-DSS, factures HT/TTC dans portail, autoliquidation UE)
  - Trial Pro (14 jours, prélèvement auto sauf résiliation avant fin de trial)
- Section 8 ancienne renommée 9

### 6.3 RGPD billing checkout

`landing/app/app/billing/page.tsx` ligne 167 : ajout d'une ligne juste avant la grille des cards :

> En souscrivant, vous acceptez les **Conditions Générales** et la **Politique de Confidentialité**. Vos données de paiement sont traitées par **Stripe** (PCI-DSS) ; les données SaaS sont stockées sur **Supabase Frankfurt (UE)**.

Pas de checkbox obligatoire (UX killer évité), mention texte simple comme demandé par le brief.

---

## Section 7 — §4.7 Email palette legacy → Tech crisp

### 7.1 Conversion

`saas_send_welcome_email/index.ts` + `saas_send_alert_email/index.ts` : deux templates HTML inline convertis :

| Avant (legacy) | Après (Tech crisp) |
|---|---|
| `body bg #F1EFE8` (cream) | `body bg #F7F8FA` (surface) |
| `body color #2C2C2A` | `body color #0A0E1A` (ink) |
| `h1 color #042C53` (navy) | `h1 color #0A0E1A` (ink) |
| `h1 font Source Serif Pro serif` | `h1 font Inter sans-serif font-weight 500 letter-spacing -0.025em` |
| `eyebrow color #0C447C IBM Plex Mono` | `eyebrow color #2563EB JetBrains Mono` |
| `cta bg #042C53` (navy) | `cta bg #0A0E1A` (ink) |
| `body-block border-left #EF9F27` (amber) | `body-block border-left #2563EB` (brand-500) |
| `text/footer color #5F5E5A` (stone) | `text/footer color #5B6478` (ink-muted) |
| Step counter `bg #042C53 color #EF9F27` | Step counter `bg #0A0E1A color #FFFFFF` |
| Logo `font Source Serif Pro` | Logo `font Inter font-weight 500` |
| Lien interne `color #0C447C` | Lien interne `color #2563EB` |

### 7.2 Glyphe `·` ambré conservé

Le glyphe `·` reste à #EF9F27 sur les 2 templates (sur le wordmark `Ge·perf` du footer uniquement) — signature visuelle préservée volontairement, cohérent avec la palette du PDF white-paper post-S13 et du digest hebdo S15.

### 7.3 Sévérités alert email

Avant : `low: #0C447C` (navy legacy).
Après : `low: #2563EB` (brand-500). `high: #B91C1C` et `medium: #EF9F27` conservés (signaux universels rouge/amber).

---

## Section 8 — §4.8 Doc STRIPE_SETUP.md

`saas/docs/STRIPE_SETUP.md` : sections 8 et 9 ajoutées (le doc historique S1 reste tel quel pour traçabilité, avec un avertissement explicite que la grille a évolué).

### Section 8 — Grille tiers v2 + yearly

- Table des 4 monthly prices (Starter 79, Growth 199, Pro 399, Agency 799) avec env vars
- Table des 4 yearly prices (Starter 758, Growth 1910, Pro 3830, Agency 7670) avec lookup keys + env vars
- Snippets `stripe prices create` complets (4 commandes copy-pasteable, montants exacts en cents)
- Snippets `supabase secrets set` pour les 4 env vars
- Section "Comportement si env var manquante (S16 fix)" documente la nouvelle erreur HTTP 503 + payload JSON

### Section 9 — Webhook events handlés

Tableau des 5 events handlés post-S16 (`checkout.session.completed`, `subscription.created/updated/deleted`, `invoice.payment_failed`) avec l'action de chaque case et la mention que `mapStripeStatus` préserve désormais `trialing`.

---

## Section 9 — Tests effectués pendant la session

| # | Test | Status |
|---|---|---|
| 1 | Stripe MCP `list_prices` → 4 yearly EUR observés sur les bons products | OK Phase A confirmée faite |
| 2 | `npm run build` (landing/) | OK 31 pages, billing 267 B (UI legal text + types) |
| 3 | grep `eq("status", "active")` post-sed → 0 résidu dans les Edge Functions tier-resolution | OK |
| 4 | grep `trialing` dans saas-auth → type `SaasSubStatus` exporté + lib utilise `.in([active, trialing])` | OK |

### Tests à valider par Fred

| # | Test | Comment |
|---|---|---|
| 5 | Confirmer que les 4 env vars `STRIPE_PRICE_*_YEARLY` sont set sur Supabase Edge Functions | `npx supabase secrets list \| grep YEARLY` (cf §1.1 ci-dessus) |
| 6 | Test E2E Stripe yearly checkout avec carte test | Cf §1.3 |
| 7 | Test E2E payment_failed avec carte test 4000 0000 0000 0341 | Cf §3.3 |
| 8 | Test trial Pro : login → billing → "Essayer 14 jours" → checkout → vérifier banner | UI du `/app/billing` doit afficher "Trial actif, X jours restants" |
| 9 | Test free fallback : downgrade Pro→cancel via portal Stripe | Cf §5.3 |
| 10 | Visualiser 1 welcome email + 1 alerte test pour valider Tech crisp cohérent avec digest hebdo | Trigger via `/app/settings` "Envoyer un email de test" |
| 11 | `/privacy` → vérifier section 6 (Stripe), section 7 (DPA), TVA section 1 | Visuel + grep pour Stripe Inc. + dpa@geoperf.com |
| 12 | `/terms` → vérifier section 8 CGV SaaS | Visuel |
| 13 | `/app/billing` → ligne RGPD au-dessus de la grille | Visuel |
| 14 | Compléter le placeholder TVA `XX` dans privacy + terms (vraie clé contrôle) | Action manuelle Fred |
| 15 | Unset `DIGEST_TEST_EMAIL_FILTER` si encore set | Cf §2 ci-dessus |

---

## Section 10 — Reste à faire pour Fred (deploy)

### 10.1 Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S16: pre-launch cleanup - 5 critical fixes (Stripe yearly, digest filter, payment_failed, trialing mapping, free fallback) + legal/email polish + DPA + Tech crisp emails"
```

Vercel auto-redeploy en 1-2 min.

### 10.2 Deploy Edge Functions (12 fonctions)

```bash
# CRITICAL §4.1 §4.4 §4.5 §4.3
npx supabase functions deploy saas_create_checkout_session
npx supabase functions deploy saas_stripe_webhook
npx supabase functions deploy saas_send_payment_failed_email   # NEW

# §4.2 + §4.7 emails
npx supabase functions deploy saas_send_weekly_digest
npx supabase functions deploy saas_send_welcome_email
npx supabase functions deploy saas_send_alert_email

# §4.4 ricochet (8 fonctions patched .in([active, trialing]))
npx supabase functions deploy saas_compute_alignment
npx supabase functions deploy saas_api_v1_router
npx supabase functions deploy saas_analyze_sentiment
npx supabase functions deploy saas_generate_content_draft
npx supabase functions deploy saas_dispatch_integration_webhooks
npx supabase functions deploy saas_run_brand_snapshot
npx supabase functions deploy saas_run_all_scheduled
```

> Ordre de déploiement recommandé : commencer par `saas_stripe_webhook` (CRITICAL pour les nouveaux paiements) + `saas_send_payment_failed_email` (sa dépendance), puis les emails palette, puis les 8 ricochets.

### 10.3 Confirmer secrets Supabase

```bash
# 1. Yearly prices
npx supabase secrets list | grep YEARLY
# Si absents : cf snippets §1.1

# 2. Test filter digest (peut être resté set d'une session précédente)
npx supabase secrets list | grep DIGEST_TEST
# Si présent et non désiré : npx supabase secrets unset DIGEST_TEST_EMAIL_FILTER
```

### 10.4 Compléter manuellement les pages légales

`/privacy` et `/terms` ont un placeholder `FR XX 838114619` pour la TVA — Fred doit éditer pour mettre la vraie clé de contrôle (2 chiffres avant le SIREN). Les fichiers à modifier : `landing/app/privacy/page.tsx` ligne ~22, `landing/app/terms/page.tsx` ligne ~28.

### 10.5 Pas de migration DB

Sprint S16 = 100% code/cleanup. Aucune migration SQL produite.

---

## Section 11 — Sujets reportés S17+ (cf brief §8)

| Sujet | Sprint cible | Pourquoi pas S16 |
|---|---|---|
| Workflow n8n Phase 2.2 sequence_load | S17 "Acquisition Launch" | Sprint dédié au funnel commercial |
| Lever test_mode Apollo + envoi sequence A | S17 | Bloqué sur validation copies FR par Fred |
| Sectoral leaderboard public | S17 | Page SEO + acquisition |
| Sentry / monitoring infra | S17 | Nice-to-have S16 §10 #1 mais pas piochée (cf §13 ci-dessous) |
| Rate-limit API SaaS | S17 | Risque connu, pas critique à 0 user |
| pg_cron alerting si fail | S17 | Pas de user impacté tant que pas en prod |
| OG metadata `/profile/[domain]` | S17 | SEO, attendre data réelle |
| Trial expiring email J-2 | S17 | UX, pas critique pour les premiers users |
| Team seats enforcement | S17 | Edge case Growth+ |
| DKIM/SPF Resend (UI Resend) | Action manuelle Fred | Hors scope agent |
| Toast UX si yearly price 503 | S17 | Cosmetic |
| AI Overviews + Copilot LLMs | S17+ | Slugs OpenRouter introuvables (cf S15 recap) |

---

## Section 12 — `git status --short` final

### Côté `C:\Dev\GEOPERF\` (repo backend)

```
 M saas/docs/STRIPE_SETUP.md
 M supabase/functions/saas_analyze_sentiment/index.ts
 M supabase/functions/saas_api_v1_router/index.ts
 M supabase/functions/saas_compute_alignment/index.ts
 M supabase/functions/saas_create_checkout_session/index.ts
 M supabase/functions/saas_dispatch_integration_webhooks/index.ts
 M supabase/functions/saas_generate_content_draft/index.ts
 M supabase/functions/saas_run_all_scheduled/index.ts
 M supabase/functions/saas_run_brand_snapshot/index.ts
 M supabase/functions/saas_send_alert_email/index.ts
 M supabase/functions/saas_send_weekly_digest/index.ts
 M supabase/functions/saas_send_welcome_email/index.ts
 M supabase/functions/saas_stripe_webhook/index.ts
?? saas/docs/SPRINT_S16_BRIEF.md
?? saas/docs/SPRINT_S16_RECAP.md
?? saas/docs/LAUNCH_READINESS_AUDIT.md
?? supabase/functions/saas_send_payment_failed_email/
```

### Côté `C:\Dev\GEOPERF\landing\` (repo frontend séparé)

```
 M app/app/billing/page.tsx
 M app/privacy/page.tsx
 M app/terms/page.tsx
 M lib/saas-auth.ts
```

### Fichiers untracked à racine NON liés au sprint (à ignorer ou nettoyer par Fred)

```
?? extract_and_output.py
?? extract_pptx_text.py
?? inline_extract.py
?? run_extract.sh
?? unzip_pptx.py
?? saas/docs/_bugs_ppt_extract.txt
?? "supabase/functions/saas_create_checkout_session/bugs et features.pptx"
```

Ce sont des artefacts d'une session précédente (extraction d'un .pptx de bugs). Hors scope sprint, je n'y ai pas touché. Fred peut les supprimer ou les ignorer.

---

## Stats finales S16

- **2 repos touchés** : root (13 fichiers Edge Functions modifiés + 1 nouveau, 1 doc, 1 brief, 1 recap, 1 audit) + landing (4 fichiers)
- **1 nouvelle Edge Function** : `saas_send_payment_failed_email/index.ts` (165 lignes)
- **0 nouvelle dépendance npm**
- **0 migration DB** (sprint quality, pas de schéma touché)
- **0 deploy automatique**
- **8/8 livrables livrés** + 1 bug latent résolu en marge (8 Edge Functions ricochet `.in([active, trialing])`)
- **Build vert** OK

---

## Section 13 — Nice-to-have §10 du brief : non piochés

Le brief §10 autorisait, "si fini en avance", à piocher dans :
1. **Sentry minimal** — `npm install @sentry/nextjs` + init. 1h.
2. **OG metadata `/profile/[domain]`** — 1-2h.
3. **Trial expiring email J-2** — 1-2h.

**Décision** : aucun pioché. Raison : §4.4 a déclenché un patch ricochet sur 8 Edge Functions (bug latent legitimement bloquant pour le rollout). Cet effort imprévu a consommé le slack temporel disponible. Les 3 nice-to-have restent en S17 comme indiqué dans la table out-of-scope du brief.

---

## Notes méthodologiques

### `mapStripeStatus` et l'effet domino

Le passage de `trialing → active` à `trialing → trialing` était trivial dans `saas_stripe_webhook`, mais la conséquence logique non documentée dans le brief était : **toute query qui filtre `eq("status", "active")` pour résoudre le tier d'un user devient inexacte pour un trial Pro**. J'ai grep'é tout le repo et corrigé 8 Edge Functions + 1 lib frontend en batch via sed. Sans ce fix, un user en trial Pro aurait visuellement vu son banner "Trial actif" sur `/app/billing` mais aurait perdu l'accès à toutes les features Pro côté serveur (snapshots Pro avec 6 LLMs, sentiment Pro, content drafts, intégrations Pro+, API key) — un bug user-visible critique. À documenter explicitement dans le check-list de revue de PR pour S17+.

### TVA placeholder vs invention

Le brief disait "remplacer 'TVA intracommunautaire : FR (à compléter)' par le vrai numéro". Je ne connais pas la clé de contrôle du SIREN 838114619 (formule modulo 97 sur 12 + SIREN, mais le résultat doit être validé administrativement). J'ai préféré laisser **un placeholder explicite "FR XX 838114619 (numéro complet à confirmer)"** plutôt que d'inventer un numéro qui pourrait être invalide et exposer Jourdechance à un manquement RGPD/CGV. Fred doit éditer manuellement.

### CGV trial sans engagement non tenable

Le brief mentionnait dans la CGV un email de rappel J-2 trial. C'est un nice-to-have S17 non livré — j'ai retiré cette mention de la section 8 CGV pour ne pas créer un engagement légal non tenu. Quand l'email J-2 sera implémenté, on pourra remettre la phrase.

### Free fallback — defensive double-check

J'ai ajouté la free fallback **dans les 3 cases** (created, updated, deleted) avec critère élargi `["active", "trialing", "past_due"]`. Le UNIQUE INDEX partiel `WHERE status='active'` empêche les doublons par construction, donc le check est défensif sans risque de dégradation. Pattern volontairement répété parce que les 3 cases peuvent atterrir en orphelin selon comment Stripe orchestre le downgrade (Stripe peut envoyer .updated puis .deleted, ou seulement .updated avec status=canceled, selon la séquence portal).

### Email palette — sévérité low brand-500

Sur l'alert email j'ai migré `low: #0C447C (navy)` → `low: #2563EB (brand-500)`. Choix : navy était la couleur primaire legacy mais elle disparaît du Tech crisp (remplacée par ink #0A0E1A pour les surfaces sombres et brand-500 #2563EB pour les accents). Mettre `low` sur brand-500 cohère visuellement avec les eyebrows JetBrains Mono brand-500 utilisés partout.

---

## Documents livrés ce sprint

1. **`saas/docs/SPRINT_S16_RECAP.md`** (ce fichier)
2. **`supabase/functions/saas_send_payment_failed_email/index.ts`** (165 lignes) — nouvelle Edge Function
3. Modifs :
   - `landing/app/app/billing/page.tsx` (RGPD checkout + cast removed)
   - `landing/app/privacy/page.tsx` (TVA + Stripe + DPA)
   - `landing/app/terms/page.tsx` (TVA + CGV SaaS section 8)
   - `landing/lib/saas-auth.ts` (`SaasSubStatus` + `.in([active, trialing])`)
   - `supabase/functions/saas_create_checkout_session/index.ts` (erreur 503 explicite)
   - `supabase/functions/saas_stripe_webhook/index.ts` (mapStripeStatus + payment_failed enrichi + free fallback updated)
   - `supabase/functions/saas_send_weekly_digest/index.ts` (retrait fallback hardcoded)
   - `supabase/functions/saas_send_welcome_email/index.ts` (Tech crisp)
   - `supabase/functions/saas_send_alert_email/index.ts` (Tech crisp + sev low brand-500)
   - 8 Edge Functions ricochet (sed `.in([active, trialing])`)
   - `saas/docs/STRIPE_SETUP.md` (sections 8-9)

---

Bon push Fred !
