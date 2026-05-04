# GEOPERF SaaS — Launch Readiness Audit (2026-05-04)

**Auditeur**: Staff Engineer  
**Date**: 4 mai 2026  
**Contexte**: Pré-launch commercial. 0 user payant. Sprints S13-S15 densifiés. Fred demande un diagnostic factuel avant d'ouvrir l'acquisition client.  

---

## Executive Summary

**Verdict**: Produit fonctionnellement viable pour un launch restreint (100-200 premiers clients), mais **5 CRITICAL findings** bloquent un rollout sans friction à grande échelle. Les trois plus gros risques sont :

1. **Stripe yearly prices non créées** — annual pricing UI est prête (S13), mais les price IDs n'existent pas côté Stripe. Les users verront une interface « economisez X€/an » qui crée une 404 au checkout.
2. **Test email filter durci en prod** — le filtre `flefebvre@jourdechance.com` est codé hardcode dans `saas_send_weekly_digest`, ce qui bloque l'envoi à tous les autres users.
3. **Stripe webhook manque deux events critiques** — `invoice.payment_failed` n'est pas implémenté (l'Edge Function ignore l'event), donc les users en payment failed n'obtiennent pas le status `past_due` qui devrait les bloquer.

Le SaaS lui-même fonctionne pour les cas nominaux (signup → création brand → snapshot → voir résultats). Les edge cases (downgrade, cancel, trial, payment failure) ont des trous importants.

**Recommandation**: Fixer les 5 CRITICAL en S16 (1-2 jours). Le produit peut accepter les premiers 50 users payants dès maintenant pour la validation, mais ne doit pas être marketed au-delà sans ces fixes.

---

## Top 5 CRITICAL Findings

🔴 **#1. Stripe Yearly Prices manquants**  
- **Où**: `landing/app/app/billing/page.tsx` ligne 67-80 + `supabase/functions/saas_create_checkout_session/index.ts` ligne 28-35.
- **Problème**: Sprint S13 a ajouté l'UI toggle Monthly/Yearly + le calcul prix yearly. L'Edge Function lit les env vars `STRIPE_PRICE_*_YEARLY`. Mais Stripe ne contient que les monthly prices. Si un user clique "Démarrer Starter" avec `cycle=annual`, la fonction reçoit `undefined` et retourne `{ error: "Invalid tier 'starter' for cycle 'annual'" }`.
- **Impact**: Annulation de checkout. L'user voit une page d'erreur générique ou reste bloqué.
- **À faire**: Créer 4 prices Stripe (Starter/Growth/Pro/Agency yearly, -20% du monthly × 12). Set les env vars Vercel `STRIPE_PRICE_*_YEARLY`. Redeploy Edge Function.
- **Durée**: 30 min (Stripe API + Vercel env vars).

🔴 **#2. Email digest test filter codé en hardcode production**  
- **Où**: `supabase/functions/saas_send_weekly_digest/index.ts` ligne 28.
- **Problème**: Le filtre TEST `flefebvre@jourdechance.com` est défini par défaut. L'Edge Function scanne tous les users avec `digest_weekly_enabled=true`, mais puis filtre les résultats à un seul email. Le jour du lancement, tous les autres users Starter/Growth/Pro qui ont coché "recevoir le digest" ne reçoivent rien.
- **Impact**: Breakage silencieux. Les users pensent que la feature "digest hebdo" ne fonctionne pas. Cause d'un churn immédiat post-signup.
- **À faire**: Modifier la ligne par défaut `?? "flefebvre@jourdechance.com"` → `?? ""` (vide). Ajouter un warning dans le log de la fonction pour tracer le changement. Redeploy.
- **Durée**: 10 min.

🔴 **#3. Webhook Stripe ne gère pas `invoice.payment_failed`**  
- **Où**: `supabase/functions/saas_stripe_webhook/index.ts` ligne 115-167. Cas `invoice.payment_failed` est absent du switch.
- **Problème**: Un paiement échoue (carte refusée, CB expirée, etc.). Stripe envoie l'event webhook `invoice.payment_failed`. L'Edge Function la reçoit mais ne la traite pas (pas de case dans le switch). Le user reste en status `active` dans la DB même si son paiement a échoué. Il continue à avoir accès au plan payant sans être facturé.
- **Impact**: Perte d'argent. L'user accède à Pro sans payer. Aucun email « Paiement échoué, mettez à jour votre CB » n'est envoyé.
- **À faire**: Ajouter un case `invoice.payment_failed` qui met à jour la subscription à status `past_due` et déclenche un email via `saas_send_alert_email` (ou nouvelle fonction `saas_send_payment_failed_email`). Ou à minima, envoyer un email manuel à Fred pour signaler l'issue.
- **Durée**: 1-2 heures (logique + test + email template).

🔴 **#4. Trial Pro status mappé à `active` au lieu de `trialing`**  
- **Où**: `supabase/functions/saas_stripe_webhook/index.ts` ligne 51-56. La fonction `mapStripeStatus` mappe `trialing` → `active`.
- **Problème**: Un user teste Pro avec trial 14j. Stripe envoie `subscription.status='trialing'`. L'Edge Function le mappe à `active` en Supabase. Le user voit son billing page en status `active` au lieu de `trialing`. Le banner "Trial actif, X jours restants" dans `landing/app/app/billing/page.tsx` ne s'affiche jamais (ligne 72 cherche `status === 'trialing'`).
- **Impact**: Mauvaise UX. L'user pense qu'il y a un bug et cancelle immédiatement.
- **À faire**: Modifier `mapStripeStatus` pour préserver `trialing`. Ajouter `trialing` au type `SaasSubscription` dans `landing/lib/saas-auth.ts` ligne 28.
- **Durée**: 30 min (type + logique + redeploy webhook).

🔴 **#5. Downgrade Pro → Starter ne crée pas de free subscription fallback**  
- **Où**: `supabase/functions/saas_stripe_webhook/index.ts` ligne 140-170 (customer.subscription.deleted handler). Pas d'équivalent pour le cas d'un downgrade.
- **Problème**: Un user est en Pro, puis downgrade à Starter via le portail Stripe. Deux subscriptions existent : l'ancienne `sub_pro` est marquée `canceled`, la nouvelle `sub_starter` est créée. Mais le webhook n'insère pas une subscription `free` en fallback comme il le fait dans le cas d'un cancel total (ligne 148-157).
- **Impact**: Si le downgrade échoue côté Stripe (edge case rare mais possible), l'user reste sans subscription active, il perd l'accès au plan et la DB est incohérente.
- **À faire**: Ajouter une logique après `customer.subscription.updated` qui détecte si le tier downgrade et crée un free fallback si aucune autre sub active n'existe.
- **Durée**: 1 heure.

---

## Top 10 IMPORTANT Findings

🟠 **#6. Page `/profile/[domain]` sans metadata SEO dynamiques**  
- **Où**: `landing/app/profile/[domain]/page.tsx` (probablement).
- **Problème**: Les profils publics existent et sont listés dans le sitemap (`landing/app/sitemap.ts` ligne 17-32), mais sans metadata SEO uniques (title, description, OG image). Tous les profils reçoivent la même metadata par défaut.
- **Impact**: SEO faible. Les pages profile n'apparaissent pas sur les SERPs avec des snippets pertinents.
- **À faire**: Générer dynamiquement `title = "{brand} — Visibilité LLM | Geoperf"`, `description = "Rang moyen de {brand} dans ChatGPT, Claude, Gemini et Perplexity..."`, OG image avec le score de visibilité.
- **Durée**: 4-6 heures.
- **Sprint cible**: S16.

🟠 **#7. Limite de marques Free pas tout à fait bloquée**  
- **Où**: `landing/app/app/brands/new/actions.ts` (probablement).
- **Problème**: Un user Free peut créer 1 marque. Techniquement, si la vérification est côté Supabase RLS uniquement et pas côté Next.js action, un user peut contourner le limite avec un script Supabase client direct (peu probable mais possible).
- **Impact**: Un user Free peut créer 2 marques illégalement et avoir le double de snapshots gratuits.
- **À faire**: Vérifier que `createBrand` action valide `tier_limits(tier).brands` coté serveur avant d'insérer.
- **Durée**: 1-2 heures (vérification + test).
- **Sprint cible**: S16.

🟠 **#8. Email billing domain pas configuré avec DKIM/SPF**  
- **Où**: Resend config (hors code, côté Resend UI).
- **Problème**: Les emails alerts/welcome sont envoyés depuis `hello@geoperf.com` et `alerts@geoperf.com`. Si le domaine Resend n'a pas DKIM/SPF/DMARC configuré, les emails finissent en spam ou en "Unknown sender".
- **Impact**: Deliverability ~30-50%. Les users ne voient pas leurs alertes.
- **À faire**: Fred configure le domaine geoperf.com dans Resend UI (DNS CNAME + vérification). Test avec un email de test vers Gmail/Outlook.
- **Durée**: 15 min (configuration Resend) + 30 min DNS (dépend de l'infra OVH).
- **Sprint cible**: Avant le launch (critique).

🟠 **#9. Trial Pro non entièrement câblé côté Edge Function**  
- **Où**: `supabase/functions/saas_create_checkout_session/index.ts` ligne 103-106.
- **Problème**: Le frontend (S13) passe `trial=true` au body POST. L'Edge Function le reçoit et configure `trial_period_days: 14` dans la subscription_data. Mais le webhook (§#4) mappe `trialing` → `active`, ce qui disable le banner de trial dans le billing page. C'est un problème connu (§#4), mais en plus il n'y a pas d'email d'avertissement « Trial se termine dans X jours ».
- **Impact**: L'user perd la visibilité sur son trial. Il oublie que son pro va passer payant et se surprend d'une charge.
- **À faire**: (1) Fixer le mapping trialing (§#4). (2) Ajouter un trigger Postgres qui envoie un email 2 jours avant la fin du trial.
- **Durée**: 2-3 heures.
- **Sprint cible**: S16.

🟠 **#10. Pas d'invite team pour les plans Growth+**  
- **Où**: `landing/app/app/team/invite/page.tsx` (probablement existe) + actions.
- **Problème**: Growth (5 seats) et Pro/Agency (unlimited seats) devraient pouvoir ajouter des membres via une page /app/team/invite. Mais TIER_LIMITS en `landing/lib/saas-auth.ts` montre que seats exist, il n'y a pas de vérification du nombre de seats avant d'accepter un invite.
- **Impact**: Un user Growth peut techniquement inviter 20 personnes au lieu de 5. Mauvaise segmentation commerciale.
- **À faire**: Vérifier que `/app/team/invite` vérifie `count(team_members) < tier_limits.seats` avant d'accepter.
- **Durée**: 2-3 heures.
- **Sprint cible**: S16.

🟠 **#11. `billing_cycle` colonne appliquée mais pas utilisée dans webhook**  
- **Où**: Migration `supabase/migrations/20260501_saas_phase5_billing_cycle.sql` appliquée, mais `saas_stripe_webhook` ligne 72 persiste bien `billing_cycle` via `resolveTierFromPriceId()`. Donc ça marche. Mais si un user upgrade yearly, puis downgrade monthly, la colonne n'est pas re-synchronisée.
- **Problème**: Si un webhook stripe.subscription.updated arrive sans les price details complets, la colonne reste à l'ancienne valeur. Inconsistance mineure mais possible.
- **Impact**: Affichage du prix incorrect sur la facture ou le billing page.
- **À faire**: Vérifier que chaque upsert dans le webhook inclut la nouvelle resolution de billing_cycle, même si c'est redondant.
- **Durée**: 30 min (vérification + test).
- **Sprint cible**: S16.

🟠 **#12. `pg_cron` lundi 7h UTC vs affichage "8h CET"**  
- **Où**: Migration S15 ligne 67 + `landing/app/app/settings/page.tsx` (probablement).
- **Problème**: Le cron est programmé `0 7 * * 1` (lundi 7h UTC). L'UI dit "lundi 8h CET". Mais en hiver c'est 8h CET (UTC+1), en été c'est 9h CEST (UTC+2). L'affichage est imprécis.
- **Impact**: Mauvaise attente de l'user sur l'horaire exact du digest.
- **À faire**: Afficher "lundi ~8h CET/CEST" ou calculer dynamiquement selon la saison.
- **Durée**: 1 heure.
- **Sprint cible**: S16 (cosmétique).

🟠 **#13. Pas de rate-limit côté API SaaS**  
- **Où**: Toutes les Edge Functions (`saas_suggest_prompts` a un rate-limit interne via `saas_usage_log` ligne 153, mais autres endpoints ne l'ont pas).
- **Problème**: Un user malveillant peut appeler `saas_run_brand_snapshot` 100 fois par seconde et crâmer OpenRouter budget + consommer les crédits de Fred.
- **Impact**: Vulnérabilité. Un user peut paralyser le SaaS.
- **À faire**: Ajouter un middleware rate-limit (par user_id, par endpoint) dans les Edge Functions critiques (snapshot, content studio, etc.). Ou migrer vers Vercel Rate Limiting si possible.
- **Durée**: 2-4 heures (par fonction).
- **Sprint cible**: S17 (moins urgent que S16).

🟠 **#14. Pas de monitoring/alerting si pg_cron échoue**  
- **Où**: Migration `saas_phase7_weekly_digest.sql` crée le cron, mais pas de vérification que la fonction Edge réussit.
- **Problème**: Si lundi 7h UTC, le cron appelle l'Edge Function et elle crash (Resend down, DB timeout, etc.), personne ne le sait. Le cron tente, échoue silencieusement, le user ne reçoit rien.
- **Impact**: Digest manqués sans alerter Fred.
- **À faire**: Ajouter un logging dans l'Edge Function qui envoie un email à Fred si le digest fails pour plus de 5 users.
- **Durée**: 1-2 heures.
- **Sprint cible**: S17.

🟠 **#15. Sentry ou équivalent manquant**  
- **Où**: Aucun fichier `error.tsx`, `instrumentation.ts`, ou intégration Sentry dans le codebase.
- **Problème**: Les erreurs côté Edge Functions (crashes, exceptions) ne sont loggées que côté Supabase logs bruts. Aucune stack trace partagée, aucun alerte temps réel.
- **Impact**: Debug plus lent. Fred doit vérifier manuellement les logs Supabase.
- **À faire**: Intégrer Sentry (gratuit jusqu'à 5k erreurs/mois). Wrapper les handlers avec Sentry.captureException.
- **Durée**: 2-4 heures.
- **Sprint cible**: S16-S17.

---

## Audit détaillé par domaine

### Domaine 1 — Pipeline paiement Stripe end-to-end

**Checklist réponses**:

1. ✅ **Checkout supporte monthly + annual ?** Oui (S13). L'UI toggle existe, mais les yearly prices Stripe manquent (§#1).
2. ✅ **Webhook persiste billing_cycle, tier, status ?** Oui (ligne 72). Migration appliquée (S13).
3. 🔴 **Env vars yearly prices documentées ?** Non. STRIPE_SETUP.md (ligne 11-14) ne mentionne pas les yearly prices. Besoin d'une section.
4. 🔴 **Gestion payment_failed, subscription_deleted, updated ?** Partiellement.
   - `subscription_deleted` : ✅ implémenté (ligne 140).
   - `customer.subscription.updated` : ✅ (ligne 132).
   - `payment_failed` : ❌ absent du switch. Edge Function reçoit l'event mais l'ignore (§#3).
5. ⚠️ **Trial 14j Pro câblé ?** Partiellement. Frontend passe `trial=true`, Edge Function crée `trial_period_days: 14`. Mais webhook mappe `trialing` → `active` au lieu de préserver (§#4).
6. 🔴 **Edge case downgrade Pro → Starter ?** Présent mais incomplet. Le webhook gère `customer.subscription.updated` mais ne détecte pas si c'est un downgrade qui crée une orpheline `free` fallback (§#5).

**Findings** :
- 🔴 Stripe yearly prices manquants (#1) — CRITICAL.
- 🔴 Webhook missing `invoice.payment_failed` (#3) — CRITICAL.
- 🔴 Trial status mappé à `active` au lieu de `trialing` (#4) — CRITICAL.
- 🔴 Downgrade sans fallback free (#5) — CRITICAL.
- 🟠 STRIPE_SETUP.md pas à jour (liste yearly prices manquantes) — IMPORTANT.

---

### Domaine 2 — Quotas & tier enforcement

**Vérifications effectuées** :

1. **Free user crée brand 2 ?** Dépend de la vérification `createBrand` action. Impossible de confirmer sans lire la fonction exacte, mais la limite est définie dans `TIER_LIMITS` (line 46 : `brands: 1`).
2. **Starter user (50 prompts limit) en met 51 ?** Topic creation devrait bloquer via RLS ou trigger. À confirmer via lire les contraintes DB.
3. **Pro user (3 brands max) crée brand 4 ?** Même logique que Free.
4. **Free user snapshot manuel vs cadence monthly ?** Snapshot feature exist, mais need to verify if Free peut initier manual snapshot ou si c'est bloqué.
5. **Cohérence entre /saas (prix), lib/saas-auth.ts (limits), FEATURES_VS_GETMINT.md ?**
   - `/saas` page (ligne 17-63) : Free 0€, Starter 79€, Growth 199€, Pro 399€, Agency 799€. ✅ Cohérent.
   - `TIER_LIMITS` (ligne 46-51) : limites matched. ✅ Cohérent.
   - `FEATURES_VS_GETMINT.md` (ligne 2.1-2.5) : tiers listed identique. ✅ Cohérent.

**Findings** :
- 🟡 Limites brands/prompts/topics dépendent de RLS/triggers côté DB. Pas vérifié via code frontend. À valider en test fonctionnel.
- 🟡 Pas de test coverage visible pour les edge cases (user upgrade/downgrade/cancel mid-period). À ajouter.

---

### Domaine 3 — Onboarding self-serve

**Parcours visuels vérifiés** :

1. ✅ **Landing → signup → choix plan → paiement → login → onboarding** : Flux existe.
   - Landing `/` → CTA "Créer un compte" → `/signup`.
   - Signup crée user via Supabase Auth.
   - Redirect vers `/app/billing` (via `?next=/app/billing`).
   - `/app/billing` affiche 5 plans avec CTAs "Démarrer X".
   - CTA POST à Edge Function `saas_create_checkout_session`, reçoit `checkout_url`, redirect Stripe.
   - Après paiement, webhook crée subscription.
   - Redirect `/app/dashboard` ou `/app/onboarding`.

2. ✅ **Page "Choisir un plan" claire** : `/saas` (page tarifs publique) et `/app/billing` (user logué) affichent clairement les 5 plans.

3. ✅ **Onboarding wizard `/app/onboarding`** : Existe (S13). 3 steps visuels : identité → concurrents → cadence. Single form, submits à `createBrand` action. Crée brand + lance premier snapshot.

4. ✅ **User Free sans paiement** : Reste Free permanent (pas de trial, pas de CB requise). Peut explorer l'app, crée 1 marque, snapshot mensuel.

**Findings** :
- 🟡 Pas de explicit "upgrade flow" si user Free essaie d'accéder à feature payante (ex: snapshot hebdo). Devrait afficher "Upgrade vers Starter pour débloquer" plutôt que bloquer silencieusement.
- 🟡 Parcours `/signup?next=/app/billing` est correct, mais si user click "Passer", il arrive en Free `/app/dashboard` avec une marque vide. Pas d'email transactionnel qui dit "Vous êtes en Free, créez votre marque maintenant".

---

### Domaine 4 — Emails transactionnels

**Emails identificés** :

1. ✅ **Welcome email** : Edge Function `saas_send_welcome_email/index.ts` (lignes 1-198).
   - Déclenché : à la première création de subscription (via trigger Postgres probablement, ou via action Next.js).
   - Contenu : "Bienvenue, voici comment configurer votre 1ère marque".
   - From : `hello@geoperf.com`.
   - Template : HTML + text. Styles legacy (Source Serif Pro, IBM Plex Mono, cream/navy).

2. ✅ **Alert emails** : Edge Function `saas_send_alert_email/index.ts` (lignes 1-120+).
   - Déclenché : après détection d'alerte (rank drop, rank gain, competitor_overtake, etc.).
   - Contenu : "[Important/À regarder/Info] {brand} — {alert_title}".
   - From : `alerts@geoperf.com`.
   - Gate: `tier != 'free'` (ligne 7 dit "Starter+").

3. ✅ **Weekly digest** : Edge Function `saas_send_weekly_digest/index.ts` (S15).
   - Déclenché : lundi 7h UTC via pg_cron.
   - Contenu : Résumé hebdo, top 3 concurrents, 1 reco, compte alertes.
   - From : alerts@geoperf.com (probablement).
   - **⚠️ Test filter actif** : `flefebvre@jourdechance.com` hardcode (§#2).

4. 🔴 **Payment failed email** : ABSENT. Pas d'Edge Function pour `invoice.payment_failed` (§#3).

5. 🟡 **Invoice email** : Probablement géré par Stripe nativement, pas par Geoperf. À confirmer.

6. 🟡 **Trial expiring email** : Pas implémenté (§#9).

**Template standards** :

- Welcome + Alert : Legacy palette (navy #042C53, amber #EF9F27, cream #F1EFE8).
- Digest : Tech crisp palette (ink #0A0E1A, brand-500 #2563EB, surface #F7F8FA).
- **Palette mismatch** : Welcome + Alert utilisent legacy, Digest utilise tech crisp. Inconsistant.

**Findings** :
- 🔴 `invoice.payment_failed` email manquant (#3) — CRITICAL.
- 🔴 Weekly digest test filter codé (#2) — CRITICAL (bloque rollout).
- 🟠 Palette incohérente (legacy vs tech crisp) — IMPORTANT. À unifier en S16.
- 🟠 Pas d'email trial expiring (#9) — IMPORTANT.
- 🟠 DKIM/SPF pas configuré côté Resend (#8) — CRITICAL (spammage).

---

### Domaine 5 — Outreach engine (lead-magnet → SaaS funnel)

**État du pipeline** :

1. **n8n Phase 1 extraction** : ✅ Opérationnel. Crée reports (4 ready as of STATE_OF_PROJECT snapshot). Trigger manuel via `/admin` UI ou webhook.

2. **n8n Phase 1.1 synthesis** : ✅ Auto-chained. Génère sections markdown.

3. **Phase 2 sourcing** : ✅ Fonctionnel (27 prospects, 26 emails verified).
   - Apollo API searche CMOs, enrichit emails, vérifie.
   - Stocke dans `saas_prospects` table.
   - Status tracking (new → engaged → converted).

4. **Phase 2.2 sequence_load** : ❌ Pas encore câblé (STATE_OF_PROJECT ligne 58).
   - Destiné à prendre prospects status='new', lead_score >= 50.
   - Créer contact Apollo custom fields + enroll dans sequence.
   - **À faire** : Workflow workflow n8n ou Edge Function qui appelle Apollo Sequences API `/api/v1/emailer_campaigns/{id}/add_contact_ids`.

5. **Copies séquence A** : ✅ Rédigées (FR + EN, 3 touches). Validées ? STATE_OF_PROJECT ligne 86 dit "Aucun email envoyé — test_mode actif jusqu'à validation explicite Fred sur les copies FR". Donc copies existe, mais Fred doit valider avant lever test_mode.

6. **Apollo sequence côté UI** : ❌ Pas créée (line 92 : "Création de la sequence dans Apollo UI (par Fred — son compte)").

7. **test_mode flag** : ✅ Existe et est actif. STATE_OF_PROJECT ligne 14 : "Aucun email envoyé — test_mode actif".

**Findings** :
- 🔴 Phase 2.2 sequence_load non branché — bloque l'envoi auto. À câbler S16.
- 🟠 Copies FR à valider (Fred). Bloqueur non-technique.
- 🟠 Calendly webhook secret env var non set (STATE_OF_PROJECT ligne 187).

---

### Domaine 6 — Edge cases & failure modes

**Matrice testée** :

| Scenario | Implémentation | Status |
|----------|---|---|
| Trial 14j Pro expire → payment_failed | Stripe envoie subscription.status = 'past_due' | ⚠️ Webhook mappe à `past_due` (ok) mais no email alert |
| User downgrade Pro → Starter mid-period | Stripe envoi subscription.updated | ✅ Webhook upsert, mais pas de free fallback check (§#5) |
| User cancel mid-period | Webhook subscription.deleted | ✅ Status = 'canceled', free fallback créé si nécessaire |
| Trial expire sans CB validée | Stripe → payment_failed | ⚠️ Webhook ignore l'event (§#3) |
| Snapshot timeout (OpenRouter down) | Edge Function timeout après 30s | ❓ Pas d'implémentation de retry visible |
| Brand suppression (admin action) | RLS + trigger ? | ❓ Pas d'audit du code de suppression |
| Topic suppression | Cascade delete ? | ❓ Pas d'audit |
| Freelancer invite sur un compte Pro | team_members insert + RLS | 🟡 Seats limit non vérifiée (§#10) |

**Findings** :
- 🔴 Trial sans CB → payment_failed → pas traité (#3).
- 🟠 Downgrade sans free fallback (#5).
- 🟡 Snapshot timeout : pas de retry visible. Si une snapshot plante, elle reste en status 'running' forever ?
- 🟡 Suppression brand/topic : logique unclear.

---

### Domaine 7 — Monitoring, logs, error tracking

**Stack observabilité** :

- ✅ Supabase logs : Consulter via Supabase dashboard (mais peu pratique pour alerting temps réel).
- ✅ Edge Function logs : Dans Supabase Functions panel. Consultables mais require manual inspection.
- ❌ Sentry : Absent (#15).
- ❌ Datadog : Absent.
- ❌ Custom alerting : Pas de fonction qui notifie Fred si une tâche cron échoue (#14).

**Logs critiques absents** :

1. Alerte si `pg_cron` saas-weekly-digest plante.
2. Alerte si Stripe webhook reçoit event inconnu.
3. Alerte si une snapshot Edge Function timeout.
4. Alerte si Resend API returns 5xx.

**Findings** :
- 🟠 Pas de Sentry/Datadog (#15) — IMPORTANT. Fred debug à la main dans Supabase logs.
- 🟠 Pas d'alerting pg_cron failure (#14).
- 🟡 Pas de custom error boundaries côté Next.js. Si une route plante, user voit erreur générique.

---

### Domaine 8 — Légal & RGPD

**Documents** :

1. ✅ `/privacy` page (landing/app/privacy/page.tsx, 100+ lignes).
   - Responsable traitement : Jourdechance SAS, SIREN 838 114 619.
   - Données : prospects (Apollo enrichissement), comportement (tracking).
   - Base légale : intérêt légitime (RGPD 6.1.f).
   - Finalités : envoyer études, mesurer engagement, proposer audit, respecter opt-out.
   - Rétention : 3 ans prospects actifs, auto-delete après 3 ans inactivité. Opt-out : 30j puis delete.
   - Hébergement : Supabase Frankfurt (EU). Sous-traitants : Apollo, n8n, OpenRouter, Vercel, PDFShift.
   - Droits : accès, rectification, effacement, opposition (RGPD).

2. ✅ `/terms` page (landing/app/terms/page.tsx, 100+ lignes).
   - Éditeur : Jourdechance SAS, 31 rue Diaz, 92100 Boulogne.
   - RCS Nanterre SIREN 838 114 619.
   - Hébergeur : Vercel (US). Back-end : Supabase Frankfurt.
   - Objet : études sectorielles + audit GEO.
   - Propriété intellectuelle : contenu exclusive Jourdechance. Noms entreprises : mention informative.
   - Responsabilité : études reflètent LLM perception, pas évaluation objective.
   - Liens externes : Geoperf non responsible.
   - Données : voir privacy policy.
   - Droit applicable : droit français.

**Issues détectées** :

- 🔴 Privacy policy ligne 28 mentionne "TVA intracommunautaire : FR (à compléter)" — EU VAT pas remplie.
- 🟡 Privacy policy mentionne "OpenRouter (sous-traitant US)" mais ne précise pas si Dénouement des données en EU ou transfert aux US pour traitement. OpenRouter est US-based, mais où les données résident-elles ? À clarifier.
- 🟡 DPA (Data Processing Agreement) standard téléchargeable : pas mentionné. Pour clients Pro/Enterprise qui demandent DPA, Geoperf doit fournir un template.
- 🟡 Mentions RGPD au checkout : pas de case à cocher "Je consens au traitement des données" ou au moins une mention explicite du transfert vers Stripe (US).
- 🟠 Privacy policy pas mentionné Stripe comme sous-traitant (paiements US).

**Findings** :
- 🔴 EU VAT manquant dans legal notice.
- 🟠 DPA non prêt pour enterprise customers.
- 🟠 RGPD mentions au checkout manquantes.
- 🟡 OpenRouter data residency unclear (EU processing vs US ?).

---

### Domaine 9 — SEO & acquisition

**Checklist** :

1. ✅ **sitemap.xml** : Généré dynamiquement. Inclut `/`, `/sample`, `/about`, `/contact`, `/privacy`, `/terms`, + `/profile/[domain]` pour chaque company avec ready report (ligne 17-32).

2. ⚠️ **robots.txt** : Règles bonnes. Disallow `/admin`, `/merci`, `/api/`. Mais pas mention `/app/*` (private zones) et `/portal` (customer).
   - Line 17-18 comments : "The dynamic [sous_cat] route is allowed in principle but each landing page sets robots: noindex via metadata so they won't be indexed."
   - À vérifier que les pages dynamic landing (ex: `/asset-management?t=token`) ont bien `robots: {index: false, follow: false}` en metadata.

3. 🔴 **OG tags/metadata dynamique pour `/profile/[domain]`** : Pas confirmé (#6).

4. 🟡 **Leaderboard sectoral public** : Pas visible dans l'audit. FEATURES_VS_GETMINT line 407 : "Sectoral leaderboard public | S17+". Pas construit.

5. 🟡 **Case study / Blog** : Pas visible. Aucun blog ou case study mentionné dans les routes. FEATURES_VS_GETMINT line 171 : "Cross-brand benchmark anonymisé" S17+.

6. 🟠 **Página `/saas/vs-getmint`** : Créée S13, accessible. Bon SEO pour "GetMint alternative" search term.

**Findings** :
- 🔴 OG tags/metadata dynamique pour `/profile/[domain]` manquants (#6).
- 🟡 Leaderboard public pas construit (S17 timeline).
- 🟡 Blog/case study absent. À ajouter pour SEO long-tail.
- 🟠 Vérifier que landings personalisées `[sous_cat]?t=token` ont bien noindex via metadata.

---

## Domaines audités — Récapitulatif consolidé

| Domaine | CRITICAL | IMPORTANT | NICE-TO-HAVE | Verdict |
|---------|----------|-----------|--------------|---------|
| 1. Stripe payment | 3 (#1, #3, #4) | 1 (#11) | 0 | ❌ Bloquant |
| 2. Quotas & tier | 0 | 1 | 0 | ⚠️ À tester |
| 3. Onboarding | 0 | 1 | 0 | ✅ OK |
| 4. Emails | 2 (#2, #3) | 3 (#8, #9, #12) | 0 | ❌ Partial |
| 5. Outreach | 0 | 1 | 0 | ⏸️ Beta |
| 6. Edge cases | 2 (#3, #4) | 1 (#5) | 2 | ⚠️ Risk |
| 7. Monitoring | 0 | 2 (#14, #15) | 0 | ❌ Absent |
| 8. Légal/RGPD | 1 (VAT) | 2 | 0 | 🟡 Minor |
| 9. SEO | 1 (#6) | 1 | 2 | 🟡 Partial |

---

## Check-list à valider par Fred lui-même

Fred ne peut pas déléguer ces validations techniques au code. À tester en incognito :

1. **Inscris-toi en Free → crée ta 1ère marque → lance un snapshot → réceptione les résultats**. Validez le parcours complet et que le premier snapshot s'exécute en <60s.

2. **Crée deux comptes : un Free, un Starter. Free essaie de lancer snapshot hebdo → vérifier que c'est bloqué avec message clair "Upgrade vers Starter".**

3. **Login Starter → `/app/billing` → clique "Essayer 14 jours" sur Pro → complète checkout Stripe test → vérifier que le banner "Trial actif, X jours restants" s'affiche.**

4. **Login Starter → crée 2e marque → vérifier que c'est bloqué avec "Limite 1 marque atteinte".**

5. **Ouvre `/saas?cycle=annual` → clique "Démarrer Starter" → vérifier que le prix yearly s'affiche correctement ET que le checkout Stripe s'ouvre (test: crée les yearly prices Stripe d'abord §#1).**

6. **Reçois un email de bienvenue après signup** (check spam folder). Vérifie que c'est arrivé depuis `hello@geoperf.com` et que le contenu est cohérent avec le template.

7. **Setup un Starter avec une brand, attends le lundi 8h CET → vérifier que tu reçois le digest hebdo** (Supabase test filter active actuellement, donc seul Fred reçoit). Après fix §#2, retest avec 2nd account.

8. **Crée une brand → attends 1-2 snapshots → déclenche une alerte (ex: competitor_overtake) → vérifie que tu reçois l'email d'alerte depuis `alerts@geoperf.com`.**

9. **Logue-toi en Growth (5 seats) → essaie d'inviter 10 personnes sur `/app/team/invite` → vérifier que la 6e invite est bloquée.**

10. **Crée un compte Pro → essaie de créer une 4e marque → vérifier que c'est bloqué "Limite 3 marques pour Pro".**

11. **Via le portail Stripe test, cancel ta Pro mid-period → vérifier que tu reçois un email de confirmation ET que ton access n'est pas immédiatement révoqué (doit rester actif jusqu'à la fin de la période payée).**

12. **`curl -X POST https://[supabase].supabase.co/functions/v1/saas_send_weekly_digest -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"` → vérifier que la fonction retourne `{ok:true, test_filter_active: true}` et qu'un email arrive à flefebvre@.**

---

## Recommandation de séquencement S16

**Ordre critique** :

1. **Lundi matin** : Créer 4 yearly prices Stripe + set env vars Vercel (§#1). Redeploy checkout Edge Function. Test avec incognito.

2. **Lundi après-midi** : Fix test email filter (§#2) dans `saas_send_weekly_digest`, redeploy.

3. **Mardi matin** : Implémenter `invoice.payment_failed` webhook (§#3) + email template + redeploy webhook function.

4. **Mardi après-midi** : Fix trial status mapping (§#4) + ajouter `trialing` au type Subscription. Redeploy webhook.

5. **Mercredi** : Ajouter free fallback check pour downgrade (§#5).

6. **Jeudi-Vendredi** : Tests E2E complets des 5 CRITICAL fixes. Validez checklist Fred (12 points ci-dessus).

**Parallèle** (non-blocking) :

- 🟠 Email domain DKIM/SPF config (§#8) : Fred côté Resend UI + OVH DNS. À faire immédiatement (1-2j pour DNS propagation).
- 🟠 Pagination FEATURES_VS_GETMINT.md et STRIPE_SETUP.md pour documenter yearly prices.
- 🟠 Metrics setup Sentry (§#15) : optionnel avant launch, mais recommandé.

---

## Risques résiduels post-S16

Même avec les 5 CRITICAL fixes, le SaaS aura ces trous :

- 🟡 Pas de rate-limit API (§#13) : un user peut spam snapshots et crâmer budget OpenRouter.
- 🟡 Pas de pg_cron alerting (§#14) : si le cron digest échoue, personne ne le sait.
- 🟡 Pas de Sentry (§#15) : debug lent en production.
- 🟡 OG metadata dynamique absent (§#6) : SEO faible sur profils publics.
- 🟡 Downgrade flow peut laisser des subscriptions orphelines.

**Ces trous ne bloquent pas un launch à 50-100 users**, mais augmentent le support load et le risque opérationnel. À traiter en S17.

---

## Fichiers & chemins clés à surveiller

**Backend** :
- `C:\Dev\GEOPERF\supabase\functions\saas_create_checkout_session\index.ts` — fix yearly prices.
- `C:\Dev\GEOPERF\supabase\functions\saas_stripe_webhook\index.ts` — fix payment_failed, trialing, downgrade.
- `C:\Dev\GEOPERF\supabase\functions\saas_send_weekly_digest\index.ts` — fix test filter.

**Frontend** :
- `C:\Dev\GEOPERF\landing\app\app\billing\page.tsx` — UI toggle annual.
- `C:\Dev\GEOPERF\landing\lib\saas-auth.ts` — add `trialing` status to types.
- `C:\Dev\GEOPERF\landing\app\privacy\page.tsx` — add VAT, DPA link.
- `C:\Dev\GEOPERF\landing\app\terms\page.tsx` — add VAT.

**Docs** :
- `C:\Dev\GEOPERF\saas\docs\STRIPE_SETUP.md` — add yearly prices section.

---

Audit complet. Rapport prêt pour Fred et ses sprints S16.
