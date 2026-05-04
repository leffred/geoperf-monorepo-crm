# Sprint S16 — Brief : Pre-Launch Cleanup

**Date brief** : 2026-05-04
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-04 après audit Launch Readiness)
**Effort estimé** : 1 nuit Claude Code dense (5-7h focus dev — incluant findings PPT Fred)
**Pré-requis** : S15 mergé et déployé (dashboard synthétique + 6 quick wins). Audit `LAUNCH_READINESS_AUDIT.md` lu. Findings `BUGS_AND_FEEDBACK.md` Round 1 lus.

---

## 1. Pourquoi ce sprint

L'audit Launch Readiness du 2026-05-04 a identifié **5 findings CRITICAL** qui bloquent un rollout commercial sans friction. Le SaaS est fonctionnellement viable pour les cas nominaux mais pète sur les edge cases : paiement annuel, paiement échoué, trial Pro, downgrade.

**En parallèle**, Fred a lancé une session de tests en incognito post-S15 et identifié **6 findings supplémentaires** documentés dans `saas/docs/BUGS_AND_FEEDBACK.md` (Round 1). Dont **2 P0 critiques** qui cassent le parcours signup → 1ère brand : impossible de créer une brand en plan Free actuellement. C'est plus grave que l'audit ne le laissait penser.

**Ce sprint = 100% quality / cleanup.** Aucune nouvelle feature. L'objectif : passer de "prototype riche" à "produit prêt pour facturer 50-100 premiers clients".

**Anti-pattern à éviter** : ajouter des features. Si l'agent voit un truc à améliorer hors scope, il le note dans le recap pour S17, il ne le code pas.

---

## 2. Périmètre

### In scope (5 CRITICAL + 3 IMPORTANT, dans cet ordre)

1. **§4.1** Stripe yearly prices câblées et fonctionnelles (CRITICAL #1)
2. **§4.2** Retrait du fallback hardcoded digest filter (CRITICAL #2)
3. **§4.3** Webhook Stripe gère `invoice.payment_failed` + email template (CRITICAL #3)
4. **§4.4** Trial Pro status `trialing` correctement mappé + types (CRITICAL #4)
5. **§4.5** Downgrade Pro→Starter avec free fallback safety net (CRITICAL #5)
6. **§4.6** Privacy/Terms : remplir TVA, ajouter Stripe sous-traitant, mentionner DPA (IMPORTANT)
7. **§4.7** Email templates : unifier la palette legacy → Tech crisp (IMPORTANT)
8. **§4.8** Documentation `STRIPE_SETUP.md` mise à jour avec yearly prices (IMPORTANT)

### Out of scope (S17 ou plus tard)

- ❌ Workflow n8n Phase 2.2 sequence_load (sprint S17 "Acquisition Launch")
- ❌ Lever `test_mode` Apollo (S17, après validation copies FR par Fred)
- ❌ Sectoral leaderboard public (S17)
- ❌ Sentry / monitoring infra (S17, voir §4.10 du brief en mention)
- ❌ Rate-limit API (S17)
- ❌ pg_cron alerting (S17)
- ❌ OG metadata dynamiques `/profile/[domain]` (S17)
- ❌ Trial expiring email à J-2 (S17)
- ❌ Team seats enforcement (S17)
- ❌ DKIM/SPF Resend (action manuelle Fred + DNS, hors agent)

---

## 3. État courant à connaître

### 3.1 Findings audit — chemins exacts à toucher

**Backend (Edge Functions)** :
- `supabase/functions/saas_create_checkout_session/index.ts` lignes 28-35 (yearly prices)
- `supabase/functions/saas_stripe_webhook/index.ts` lignes 51-56 (mapStripeStatus), lignes 115-167 (event switch), lignes 140-170 (subscription.deleted)
- `supabase/functions/saas_send_weekly_digest/index.ts` ligne 29 (fallback hardcoded)

**Frontend** :
- `landing/lib/saas-auth.ts` ligne 28 (type SaasSubscription)
- `landing/app/app/billing/page.tsx` ligne 67-80 (UI annual toggle), ligne 72 (banner trialing)
- `landing/app/privacy/page.tsx` (TVA + Stripe sous-traitant + DPA)
- `landing/app/terms/page.tsx` (TVA)

### 3.2 Stripe — ce qui existe

D'après `saas/docs/STRIPE_SETUP.md` (à vérifier) et audit :
- Prices monthly : ✅ existants (Starter, Growth, Pro, Agency) avec env vars Vercel `STRIPE_PRICE_*_MONTHLY`
- Prices yearly : ❌ inexistants côté Stripe, env vars `STRIPE_PRICE_*_YEARLY` pas remplies
- Webhook secret : ✅ configuré
- Customer portal : ✅ configuré

### 3.3 Resend — ce qui existe

- API key configurée en env var (`RESEND_API_KEY`)
- Sender `alerts@geoperf.com` (cf `ALERTS_EMAIL_FROM`)
- Sender `hello@geoperf.com` (welcome email)
- ⚠️ DKIM/SPF non confirmés (Fred doit valider Resend UI)
- Templates HTML inline (palette legacy navy/amber pour welcome+alert, Tech crisp pour digest)

---

## 4. Livrables

### 4.1 Stripe yearly prices câblées (CRITICAL #1)

**Phase A — Action manuelle Fred (à faire AVANT le sprint)** :

L'agent ne peut pas créer les prices Stripe lui-même. **Fred doit faire ça en amont** dans le Stripe Dashboard ou via CLI :

```bash
# Starter yearly : 79 × 12 × 0.8 = 758 EUR
stripe prices create --product prod_starter --unit-amount 75800 --currency eur --recurring interval=year --lookup-key geoperf_starter_yearly

# Growth yearly : 199 × 12 × 0.8 = 1910 EUR
stripe prices create --product prod_growth --unit-amount 191000 --currency eur --recurring interval=year --lookup-key geoperf_growth_yearly

# Pro yearly : 399 × 12 × 0.8 = 3830 EUR
stripe prices create --product prod_pro --unit-amount 383000 --currency eur --recurring interval=year --lookup-key geoperf_pro_yearly

# Agency yearly : 799 × 12 × 0.8 = 7670 EUR
stripe prices create --product prod_agency --unit-amount 767000 --currency eur --recurring interval=year --lookup-key geoperf_agency_yearly
```

Puis remplir 4 env vars Vercel :
- `STRIPE_PRICE_STARTER_YEARLY=price_xxx`
- `STRIPE_PRICE_GROWTH_YEARLY=price_xxx`
- `STRIPE_PRICE_PRO_YEARLY=price_xxx`
- `STRIPE_PRICE_AGENCY_YEARLY=price_xxx`

**Phase B — Code à vérifier par l'agent** :

Lire `supabase/functions/saas_create_checkout_session/index.ts`. Confirmer que :
- La fonction lit bien `STRIPE_PRICE_${tier.toUpperCase()}_${cycle.toUpperCase()}` selon `body.cycle`
- Si l'env var est `undefined`, retourne une erreur claire (`{ error: "Plan ${tier} ${cycle} not configured" }`) plutôt qu'une 500 muette
- Le webhook persiste bien `billing_cycle` (déjà OK selon audit, mais double-checker)

**Phase C — Test smoke** :

Une fois les env vars Vercel set par Fred :
1. Aller sur `/saas?cycle=annual` en incognito
2. Cliquer "Démarrer Starter"
3. Vérifier qu'on arrive sur le checkout Stripe avec le bon montant (758€)
4. Compléter en mode test card `4242 4242 4242 4242`
5. Vérifier dans Supabase que `saas_subscriptions.billing_cycle = 'annual'` et `tier = 'starter'`

**Si Phase A pas faite par Fred** : l'agent code la Phase B + documente dans le recap que la Phase A est en attente.

### 4.2 Retrait du fallback hardcoded digest filter (CRITICAL #2)

**Fichier** : `supabase/functions/saas_send_weekly_digest/index.ts` ligne 29

**Avant** :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "flefebvre@jourdechance.com")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
```

**Après** :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
```

**Changement** : retirer le fallback `"flefebvre@jourdechance.com"`. Si l'env var n'est pas set ou est vide, le filtre est désactivé et tous les users `digest_weekly_enabled=true` reçoivent le digest.

**Action complémentaire** : si le secret `DIGEST_TEST_EMAIL_FILTER` est encore set dans Supabase secrets (via `npx supabase secrets list`), Fred devra l'unset après ce déploiement :
```bash
npx supabase secrets unset DIGEST_TEST_EMAIL_FILTER
```
Le mentionner dans le recap.

### 4.3 Webhook `invoice.payment_failed` (CRITICAL #3)

**Fichier** : `supabase/functions/saas_stripe_webhook/index.ts`

**Ajout case dans le switch** :

```typescript
case "invoice.payment_failed": {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = invoice.customer as string;
  const subscriptionId = invoice.subscription as string;
  
  // 1. Mettre à jour la subscription en past_due
  const { data: profile } = await supabase
    .from("saas_profiles")
    .select("id, email, full_name")
    .eq("stripe_customer_id", customerId)
    .single();
  
  if (!profile) {
    console.warn(`[webhook] payment_failed: no profile for customer ${customerId}`);
    break;
  }
  
  await supabase
    .from("saas_subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("user_id", profile.id)
    .eq("stripe_subscription_id", subscriptionId);
  
  // 2. Trigger l'envoi d'un email "Paiement échoué"
  await fetch(`${SUPABASE_URL}/functions/v1/saas_send_payment_failed_email`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
  }).catch(e => console.error("[webhook] payment_failed email dispatch:", e));
  
  break;
}
```

**Nouveau fichier** : `supabase/functions/saas_send_payment_failed_email/index.ts`

Template inline reprend la même structure que `saas_send_alert_email` mais avec un wording dédié :
- Subject : `Action requise — Paiement Geoperf échoué`
- Body : montant, raison probable (CB expirée, refus banque), lien vers la facture Stripe (`hosted_invoice_url`), CTA "Mettre à jour ma carte" → `/app/billing`
- Sévérité high : couleur rouge, ton urgent mais pas alarmiste
- Mention : "Si nous ne recevons pas le paiement d'ici X jours, votre accès Pro sera suspendu et votre marque retombera en plan Free"

**Logging** : insert dans `saas_usage_log` avec `event_type = 'payment_failed_notified'`.

### 4.4 Trial Pro status `trialing` (CRITICAL #4)

**Fichier 1** : `supabase/functions/saas_stripe_webhook/index.ts` lignes 51-56

Modifier `mapStripeStatus()` pour préserver `trialing` :

```typescript
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SaasSubStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":  // NEW : preserve trialing au lieu de mapper à active
      return stripeStatus;
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return "incomplete";
    default:
      return "active";
  }
}
```

**Fichier 2** : `landing/lib/saas-auth.ts` ligne 28 (ou similaire)

Étendre le type :
```typescript
export type SaasSubStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";
```

**Fichier 3** : `landing/app/app/billing/page.tsx`

Vérifier que la condition `subscription.status === 'trialing'` (ligne 72 de l'audit) affiche bien le banner "Trial actif, X jours restants jusqu'au {date}".

Si le banner utilise un cast `as string` (cf S13 recap §"Trial Pro — TS error résolu"), retirer ce cast maintenant que le type est propre.

### 4.5 Free fallback downgrade (CRITICAL #5)

**Fichier** : `supabase/functions/saas_stripe_webhook/index.ts` ligne 132 et suivantes (case `customer.subscription.updated`)

**Logique à ajouter** : après l'upsert de la subscription mise à jour, vérifier que l'user a au moins une subscription active. Si aucune, créer une free fallback.

```typescript
// Fin du case customer.subscription.updated, après upsert
const { data: activeSubs } = await supabase
  .from("saas_subscriptions")
  .select("id, tier, status")
  .eq("user_id", profile.id)
  .in("status", ["active", "trialing", "past_due"]);

if (!activeSubs || activeSubs.length === 0) {
  // Aucune subscription active : créer free fallback (defensive)
  await supabase.from("saas_subscriptions").insert({
    user_id: profile.id,
    tier: "free",
    status: "active",
    billing_cycle: "monthly",
    stripe_subscription_id: null,
  });
  console.warn(`[webhook] downgrade orphan: free fallback created for ${profile.email}`);
}
```

Idem dans le case `customer.subscription.deleted` si pas déjà fait.

**Test** : créer un user Pro en mode Stripe test, downgrade via portal Stripe vers Starter, puis cancel le Starter immédiatement, vérifier qu'une row `saas_subscriptions` avec `tier=free, status=active` existe.

### 4.6 Privacy/Terms — TVA + DPA + Stripe sous-traitant

**Fichier 1** : `landing/app/privacy/page.tsx`

- Ligne 28 (à confirmer) : remplacer "TVA intracommunautaire : FR (à compléter)" par le vrai numéro de TVA de Jourdechance SAS
- Ajouter Stripe à la liste des sous-traitants (ligne sous-traitants) : "Stripe Inc. (US) — traitement paiements, conformité PCI-DSS, transfert encadré par SCC"
- Ajouter une section "Data Processing Agreement" : "Un DPA standard est disponible sur demande à `dpa@geoperf.com` pour les clients Pro et Agency"

**Fichier 2** : `landing/app/terms/page.tsx`

- Compléter TVA si mentionnée
- Section CGV SaaS : préciser durée d'engagement (mois ou an), conditions de résiliation (préavis 0 jour, accès maintenu jusqu'à fin de période payée), refund policy (pas de remboursement prorata sauf cas exceptionnel)

**Fichier 3** : `landing/app/app/billing/page.tsx` — ajout RGPD au checkout

Avant le bouton "Démarrer Starter/Growth/Pro/Agency", ajouter un texte légal court :
```
En cliquant, j'accepte les Conditions Générales et la Politique de Confidentialité.
Mes données seront traitées par Stripe (paiement) et stockées sur Supabase Frankfurt (EU).
```

Pas de checkbox obligatoire (UX killer), juste une mention texte.

### 4.7 Unification palette emails (legacy → Tech crisp)

**Fichiers** :
- `supabase/functions/saas_send_welcome_email/index.ts`
- `supabase/functions/saas_send_alert_email/index.ts`

**Conversion** :

| Avant (legacy) | Après (Tech crisp) |
|---|---|
| `#042C53` (navy) | `#0A0E1A` (ink) |
| `#EF9F27` (amber) | conservé pour glyphe `·` uniquement |
| `#F1EFE8` (cream) | `#F7F8FA` (surface) |
| `#2C2C2A` (text) | `#0A0E1A` (ink) |
| Source Serif Pro | Inter (font-weight 500) |
| IBM Plex Mono | JetBrains Mono |
| `#5F5E5A` (stone) | `#5B6478` (ink-muted) |

Garder `#2563EB` (brand-500) pour les CTA et accents.
Garder `#B91C1C` (red high), `#1D9E75` (green positive) pour les sévérités.

**Test** : envoyer un welcome email + une alerte test, vérifier qu'ils ont la même cohérence visuelle que le digest hebdo.

### 4.8 Documentation `STRIPE_SETUP.md`

**Fichier** : `saas/docs/STRIPE_SETUP.md`

Ajouter une section "Yearly prices (S13+)" avec :
- Liste des 4 lookup keys (`geoperf_starter_yearly`, etc.)
- Liste des 4 env vars Vercel
- Snippets `stripe prices create` (cf §4.1 phase A)
- Note "Si les yearly prices ne sont pas créées, le checkout annuel échoue avec une erreur 'Plan X annual not configured'"

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
```
Doit passer vert. Aucune nouvelle dépendance.

### 5.2 Tests fonctionnels

**§4.1 Stripe yearly** (suppose Phase A faite par Fred) :
1. `/saas?cycle=annual` → click "Démarrer Starter" → checkout Stripe ouvert avec 758€
2. Compléter avec carte test → vérifier `saas_subscriptions.billing_cycle = 'annual', tier = 'starter'`
3. Si env vars yearly absentes : vérifier que l'erreur retournée est claire (pas une 500 muette)

**§4.2 Digest filter** :
4. Trigger manuel digest avec `DIGEST_TEST_EMAIL_FILTER` unset → tous les users `digest_weekly_enabled=true` reçoivent (ou skip si pas de data)
5. Vérifier `console.log` ou response `test_filter_active: false`

**§4.3 Payment failed** :
6. En mode Stripe test, déclencher un `invoice.payment_failed` via le test clock ou en utilisant carte `4000 0000 0000 0341` (decline) → vérifier que `saas_subscriptions.status = 'past_due'` ET qu'un email arrive

**§4.4 Trial Pro** :
7. Login user Starter, click "Essayer 14 jours" Pro, compléter checkout → vérifier que :
   - `saas_subscriptions.status = 'trialing'` en DB
   - Banner "Trial actif, X jours restants" affiché sur `/app/billing`

**§4.5 Free fallback** :
8. User Pro test → downgrade via portal Stripe vers... rien (cancel immédiat) → vérifier qu'une `saas_subscriptions` `tier=free, status=active` est créée

**§4.6 Légal** :
9. `/privacy` → TVA visible, DPA mentionné, Stripe dans sous-traitants
10. `/app/billing` → texte RGPD avant le bouton checkout

**§4.7 Emails** :
11. Trigger welcome + alerte test → vérifier visuellement la cohérence Tech crisp avec le digest

### 5.3 Check-list Fred (cf `LAUNCH_READINESS_AUDIT.md` §"Check-list à valider par Fred lui-même")

12 points qualitatifs que l'agent ne peut pas tester. À faire par Fred après livraison du sprint, en mode incognito.

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. Migrations SQL (s'il y en a) sauvées AVANT `apply_migration` MCP.
2. Fichiers >150 lignes : bash heredoc obligatoire (pas pour ce sprint normalement, mais à respecter).
3. `npm run build` vert AVANT toute proposition de push.
4. Pas de toucher aux workflows n8n.
5. brand-500 = #2563EB (bleu).
6. **Aucune nouvelle feature**. Si l'agent voit un truc à ajouter, il le note dans le recap pour S17.
7. Ne pas toucher au code de l'outreach engine ni du lead-magnet (Phase 1, Phase 2 sourcing). Hors scope.

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S16: pre-launch cleanup - 5 critical fixes (Stripe yearly, digest filter, payment_failed webhook, trial mapping, free fallback) + legal/email polish"
```

### 7.2 Edge Functions à deployer
```bash
npx supabase functions deploy saas_create_checkout_session  # si modifié
npx supabase functions deploy saas_stripe_webhook          # §4.3, §4.4, §4.5
npx supabase functions deploy saas_send_weekly_digest      # §4.2
npx supabase functions deploy saas_send_payment_failed_email  # NEW §4.3
npx supabase functions deploy saas_send_welcome_email      # §4.7
npx supabase functions deploy saas_send_alert_email        # §4.7
```

### 7.3 Env vars / secrets
- Vérifier les 4 `STRIPE_PRICE_*_YEARLY` côté Vercel (Fred)
- `npx supabase secrets unset DIGEST_TEST_EMAIL_FILTER` (Fred, après deploy §4.2)

---

## 8. Reporté S17+

| Sujet | Sprint cible | Pourquoi pas S16 |
|---|---|---|
| Workflow n8n Phase 2.2 sequence_load | S17 "Acquisition Launch" | Sprint dédié au funnel commercial |
| Lever test_mode Apollo + envoi sequence A | S17 | Bloqué sur validation copies FR par Fred |
| Sectoral leaderboard public | S17 | Page SEO, gros impact acquisition |
| Sentry / monitoring infra | S17 | 2-4h, important mais pas bloquant |
| Rate-limit API SaaS | S17 | Risque connu, pas critique à 0 user |
| pg_cron alerting si fail | S17 | Pas de user impacté tant que pas en prod |
| OG metadata `/profile/[domain]` | S17 | SEO, attendre data réelle |
| Trial expiring email J-2 | S17 | UX, pas critique pour les premiers users |
| Team seats enforcement | S17 | Edge case pour Growth+ |
| DKIM/SPF Resend | Action manuelle Fred (immédiat) | Hors scope agent, à faire en parallèle de S16 |

---

## 9. Livrable de fin de sprint

`saas/docs/SPRINT_S16_RECAP.md` au format S15 :
- TL;DR check-list 8 objectifs (§4.1 à §4.8) avec status livré/skipped
- Fichiers modifiés / créés (`git status --short` racine + landing)
- Mention explicite : Phase A Stripe yearly faite par Fred ou en attente
- Reste à faire : push, deploy 6 Edge Functions, unset secret digest, Fred fait les 12 tests Fred check-list

---

## 10. Mention spéciale "audit complet"

L'audit `LAUNCH_READINESS_AUDIT.md` recense aussi des findings **NICE-TO-HAVE** non inclus dans S16. Si l'agent finit S16 en avance et a du temps, il peut piocher dans cette liste **dans cet ordre** :

1. **Sentry minimal** : `npm install @sentry/nextjs`, init dans `landing/app/layout.tsx` + `instrumentation.ts`. 1h.
2. **OG metadata `/profile/[domain]`** : `generateMetadata` dynamique avec title/description/og:image. 1-2h.
3. **Trial expiring email J-2** : trigger Postgres + nouvelle Edge Function `saas_send_trial_expiring`. 1-2h.

Mais **ne PAS** toucher à : workflow n8n, sectoral leaderboard, rate-limit, Phase 2.2.

---

Bon sprint ! 🚀
