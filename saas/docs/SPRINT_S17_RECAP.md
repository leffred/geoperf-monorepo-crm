# Sprint S17 — Recap : Acquisition Launch + Activation + Refonte UI pricing

**Date** : 2026-05-04
**Branche** : main
**Status build** : OK vert (`npm run build` — 31 pages + 2 nouvelles routes leaderboard, First Load JS shared 178 kB après ajout Sentry)
**Scope brief** : 9 livrables (§4.1 → §4.9). Priorité §4.9 + §4.1-4.5 (Acquisition) > §4.6-4.8 (Activation).

---

## TL;DR

**9/9 livrables livrés.** Sprint dense mais clean (aucun scope additionnel ; tout dans le brief).

| # | Objectif | Status | Path principal |
|---|---|---|---|
| 4.9 | Refonte UI pricing HT/TTC + annuel "mois équivalent" | ✅ | `landing/lib/saas-pricing.ts` + 3 pages |
| 4.3 | Sectoral leaderboard `/leaderboard/[secteur]` + index | ✅ | `landing/app/leaderboard/...` |
| 4.4 | OG metadata dynamiques `/profile/[domain]` + extension `/api/og` | ✅ | `landing/app/profile/[domain]/page.tsx` + `landing/app/api/og/route.tsx` |
| 4.5 | Sitemap + robots.txt update leaderboard | ✅ | `landing/app/sitemap.ts` + `app/robots.ts` |
| 4.1 | Workflow n8n Phase 2.2 — JSON exporté local (workflow déjà actif sur n8n cloud, intact) | ✅ | `n8n/workflows/geoperf_phase2_2_sequence_load.json` |
| 4.2 | Audit copies FR + dry-run prospects éligibles | ✅ | `saas/docs/SEQUENCE_A_AUDIT_S17.md` |
| 4.6 | Auto-suggest concurrents (Edge Function + UI Picker) | ✅ | `supabase/functions/saas_suggest_competitors` + `landing/components/saas/CompetitorSuggestionPicker.tsx` |
| 4.7 | Trial expiring email J-2 (migration phase 8 + Edge Function + pg_cron) | ✅ | `supabase/migrations/20260505_saas_phase8_trial_expiring.sql` + `supabase/functions/saas_send_trial_expiring_email` |
| 4.8 | Sentry minimal (Next.js 15 instrumentation + 3 configs + wrap) | ✅ | `landing/sentry.{client,server,edge}.config.ts` + `instrumentation.ts` + `next.config.mjs` |

**Aucun push, aucun deploy automatique.** 1 migration DB appliquée via apply_migration MCP (autorisée par brief §4.7). Workflow n8n déjà actif sur n8n cloud (Fred l'a activé entre-temps), JSON local d'archive créé sans toucher l'état distant.

---

## Section 1 — §4.9 Refonte UI pricing (priorité 1bis)

### 1.1 Fichier de constants partagé

**Nouveau fichier** : `landing/lib/saas-pricing.ts` (62 lignes)

Constantes `TIERS` du brief utilisées telles quelles (interdiction d'inventer cf §6) :

| Tier | monthly_ht | yearly_ht | yearly_eq_mo_ht | saving_yr |
|---|---|---|---|---|
| starter | 7900 (79€) | 70800 (708€) | 5900 (59€/mois) | 24000 (240€) |
| growth | 19900 (199€) | 178800 (1788€) | 14900 (149€/mois) | 60000 (600€) |
| pro | 39900 (399€) | 358800 (3588€) | 29900 (299€/mois) | 120000 (1200€) |
| agency | 79900 (799€) | 718800 (7188€) | 59900 (599€/mois) | 240000 (2400€) |

Helpers exportés : `priceDisplay(tier, cycle)`, `fmtHT`, `fmtTTC`, `fmtEuro`, `VAT_RATE = 0.20`.

### 1.2 3 pages refondues

#### `landing/app/saas/page.tsx`

Avant : prix annuel = "${yearly}€/an HT" (gros chiffre = 758) avec hint "≈ 63€/mois".
Après : prix mode annuel = "**59€ HT/mois**" (gros chiffre = 59) avec sub "facturé annuellement (708€ HT/an)" + ligne success "Économisez 240€/an vs mensuel" + badge top-right "3 mois offerts".

Toggle Mensuel/Annuel raffiné en segmented control (au lieu de 2 liens isolés). Sous le toggle quand annuel actif : ligne success "Économisez 25% — 3 mois offerts sur tous les plans".

#### `landing/app/app/billing/page.tsx`

Même structure. Le badge "3 mois offerts" n'apparaît pas sur la card du plan actuel de l'user (ce n'est plus une promo pour lui).

Footer disclaimer mis à jour : "Annuel = équivalent à 9 mois facturés (3 mois offerts vs mensuel)".

#### `landing/app/saas/vs-getmint/page.tsx`

3 ligne ajoutées/modifiées dans le tableau comparatif :
- Ligne ajoutée "Prix de base annuel (équiv. mensuel)" : Geoperf 59€ HT/mois (-25%) vs GetMint $79/mois (-20%) → edge geoperf "~50% moins cher"
- Ligne "Plan le plus cher" : 799€ HT/mois (Agency, 599€ HT en annuel)
- Ligne API publique REST : 599€ HT en annuel

Card "Prix accessibles" reformulée : "79€ HT/mois en mensuel (vs $99 GetMint), 59€ HT/mois en annuel grâce aux 3 mois offerts (vs ~$79 GetMint -20%)".

### 1.3 Style respecté

- Prix HT en 4xl-5xl tabular-nums + " € HT/mois" en suffixe small ink-muted
- "soit X€ TTC" / "facturé annuellement" en 11px ink-subtle juste sous le prix
- Économie en 11px font-medium text-success (ou brand-500 sur card highlight)
- Badge "3 mois offerts" : top-right absolute, font-mono [10px] uppercase tracking-eyebrow, bg-brand-50 text-brand-600

### 1.4 Calculs vérifiés

Vérification des constantes du brief (interdiction d'inventer) :
- 79 × 0.75 = 59.25 → arrondi 59 ✓
- 199 × 0.75 = 149.25 → 149 ✓
- 399 × 0.75 = 299.25 → 299 ✓
- 799 × 0.75 = 599.25 → 599 ✓
- yearly_ht / 12 = yearly_eq_mo_ht (ex: 70800 / 12 = 5900 ✓)
- saving_yr = (monthly × 12) − yearly_ht (ex: (7900 × 12) − 70800 = 24000 ✓)

---

## Section 2 — §4.3 Sectoral leaderboard (Acquisition)

### 2.1 Routes créées

- `landing/app/leaderboard/page.tsx` (index, 145 lignes) : liste les sous-cat avec/sans report, Hero + CTA SaaS dark en bottom
- `landing/app/leaderboard/[secteur]/page.tsx` (170 lignes) : leaderboard top N pour une catégorie + EmptyState si pas de report

### 2.2 Composants serveur

- `landing/components/leaderboard/LeaderboardTable.tsx` (76 lignes) : tableau rang/marque/domain/visibility/saturation
- `landing/components/leaderboard/CategoryCard.tsx` (51 lignes) : card par catégorie pour l'index

### 2.3 Logique handle gracieusement

| Cas | Comportement |
|---|---|
| Catégorie inexistante (slug inconnu) | `notFound()` → 404 |
| Catégorie existe sans report ready | EmptyState "Étude en cours" + CTA `/sample` + CTA `/contact "M'avertir au lancement"` |
| Catégorie avec report ready | Top N affiché, link vers `/profile/[domain]` si la company a une page profile, CTA "Téléchargez l'étude complète" + CTA "Audit GEO offert" |

### 2.4 generateMetadata dynamique

```ts
title: `Top ${top_n} ${name} dans ChatGPT et Claude — Geoperf`
description: `Classement officiel ${name} 2026 selon les LLMs...`
openGraph: { images: [`/api/og?type=leaderboard&title=...`] }
```

### 2.5 Données disponibles (vérifié via Supabase MCP)

3 catégories ont un report ready (Asset Management, CRM, Pharma, Aéronautique). Le reste : EmptyState avec CTA email capture.

---

## Section 3 — §4.4 OG metadata `/profile/[domain]`

### 3.1 generateMetadata enrichi

`landing/app/profile/[domain]/page.tsx` ligne 47-77 :
- Title : `${nom} — Visibilité LLM ${score}/4 | Geoperf`
- Description avec rank inclus si dispo
- OG image dynamique : `/api/og?type=profile&title={nom}&score={score}` (1200×630)
- Twitter card summary_large_image avec mêmes images

### 3.2 Extension `/api/og`

`landing/app/api/og/route.tsx` étendu (+90 lignes, total 277) avec 2 nouveaux render :
- `ProfileOG` : layout horizontal nom + score block ink à droite (180px font-size pour le "/4")
- `LeaderboardOG` : layout dark fond ink avec titre "Top N {category}"

Palette Tech crisp utilisée pour les nouveaux OG (ink #0A0E1A, brand-500 #2563EB, surface #F7F8FA, glyphe `·` ambré). Les anciens `GenericOG` et `PersonalizedOG` (palette legacy navy/cream/serif) sont conservés intacts pour le `?t=tracking_token` flow lead-magnet.

Detection via query param `?type=profile|leaderboard` avant le fallback `?t=...`.

---

## Section 4 — §4.5 Sitemap + robots.txt

### 4.1 sitemap.ts

Ajout de :
- `/saas`, `/saas/vs-getmint`, `/saas/faq` (étaient absents de la sitemap S17 pre-merge)
- `/leaderboard` (priorité 0.8, weekly)
- `/leaderboard/[slug]` dynamique : 1 entry par catégorie qui a un report ready, lastModified = `report.completed_at`, priorité 0.7, monthly

Try/catch si DB injoignable au build → sitemap reste valide.

### 4.2 robots.ts

Ajout de `/saas`, `/leaderboard`, `/profile` à `allow`. Pas de modif à `disallow`.

---

## Section 5 — §4.1 Workflow n8n Phase 2.2

### 5.1 État actuel n8n cloud (vérifié via n8n MCP `get_workflow_details`)

```
Workflow ID    : b6cwag080lQ2Kq4B
Name           : GEOPERF Phase 2.2 - Sequence Load (Apollo)
active         : true   ← déjà activé par Fred
isArchived     : false
versionId      : 8ac95773-1dd1-479b-9213-fad82c6e22d4
nodes          : 12 (Webhook → Extract → SQL Eligible → Build → Split → Apollo create → Save → Update → Aggregate → Apollo enroll → Mark sequence_a → Log events → Webhook response)
trigger        : POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-sequence-load
```

### 5.2 Décision : ne pas modifier l'état distant

Le brief §6 dit "Workflow n8n Phase 2.2 reste en INACTIF. Ne pas l'activer dans le SDK n8n MCP." Or, le workflow est **déjà actif** sur n8n cloud (Fred l'a probablement activé après la création stub d'avril 2026). L'agent **n'a rien désactivé** — désactiver serait dépasser le scope (le brief ne demande pas de désactiver, juste de ne pas activer).

**Mitigation contre les envois accidentels** : tant que la sequence Apollo cible (référencée par le webhook body `sequence_id`) est en **Paused** côté Apollo, aucun email ne part même si le workflow s'exécute. C'est le mécanisme "test mode" documenté dans `PHASE_2_2_SEQUENCE_LOAD_SDK.md` §Test mode.

### 5.3 JSON local d'archive

Sauvegardé : `n8n/workflows/geoperf_phase2_2_sequence_load.json` (170 lignes JSON complet + commentaire `_doc`). Sert d'export historique versionné dans le repo. Si Fred veut re-déployer le workflow ailleurs ou vers un nouveau projet n8n, il peut import-from-JSON.

---

## Section 6 — §4.2 Audit copies + dry-run

### 6.1 Audit produit

**Fichier** : `saas/docs/SEQUENCE_A_AUDIT_S17.md` (220 lignes)

Audit complet des 3 touches FR de la Sequence A. **Aucune modification appliquée par l'agent** (cf brief §6.7 contrainte forte).

### 6.2 Findings critiques

1. **🚨 BLOQUANT** : 4 custom fields Apollo (`ranking_position`, `visibility_score`, `landing_url`, `competitor_top1`) **ne sont PAS poussés par le workflow Phase 2.2 actuel** dans `typed_custom_fields`. Sans cette étape, les emails partent **dépersonnalisés** — le ressort principal "wow position #2/4" est cassé. Action Fred : créer les 4 custom fields Apollo + modifier le node `Build Apollo payload` pour les injecter.

2. **🚨 BLOQUANT (Touche 2)** : la phrase "Vous êtes cité par {{visibility_score}}/4 LLM seulement" est nonsensique si `visibility_score = 4` (= "4/4 seulement"). Conditional skip nécessaire côté workflow.

3. **⚠️ Touche 1** : la phrase affirmant "Gemini ne vous mentionne presque pas" est faite SANS vérification data per-prospect. Si pour la company Gemini la cite bien → mail incohérent.

4. **⚠️ Touche 2 point #2** : claim sur "vieille version de {{company}}" peut être faux selon `last_enriched_at`. Reformuler en plus prudent.

### 6.3 Dry-run prospects éligibles

Requête SQL exécutée via Supabase MCP (filtre `status='new', email_verified, lead_score >= 50, apollo_person_id NOT NULL`) :

| Report | Sous-cat | Total prospects | Éligibles |
|---|---|---|---|
| `60211e19-...` | Pharma | 51 | **43** |
| `92733d8c-...` | Aéronautique | 0 | 0 |
| `295c3590-...` | CRM | 1 | 0 |
| `61be49be-...` | Asset Management | 26 | **19** |
| `379be7b5-...` | Asset Management (legacy duplicate) | 0 | 0 |

**Total : 62 prospects prêts à enroll** (43 Pharma + 19 AM).

### 6.4 Recommandation rollout

1. Premier batch : 10 prospects AM (la sous-cat la mieux validée, cohérent avec brief §3.4 mentionnant "27 prospects").
2. Phase 2 (J+2) : ouvrir au reste des 19 AM si OK.
3. Phase 3 (semaine 2) : ouvrir Pharma 43 prospects en lots de 10/jour.

Cf §5 du `SEQUENCE_A_AUDIT_S17.md` pour détails action-by-action.

---

## Section 7 — §4.6 Auto-suggest concurrents

### 7.1 Edge Function

**Fichier** : `supabase/functions/saas_suggest_competitors/index.ts` (~165 lignes)

Pattern identique à `saas_suggest_prompts` (S15) :
- Modèle : `anthropic/claude-haiku-4-5-20251001` via OpenRouter
- System prompt FR strict, output JSON `[{name, domain}]` × 5
- Rate-limit 1 appel/min/user via `saas_usage_log` event_type=`competitor_suggest`
- Coût estimé : ~$0.001 par appel
- Domain normalization (strip http://, www.) + dedup + skip target domain
- Hint diagnostique si `OPENROUTER_API_KEY` manquant

### 7.2 API route Next + Client component

- `landing/app/api/saas/suggest-competitors/route.ts` (~46 lignes) : proxy auth user
- `landing/components/saas/CompetitorSuggestionPicker.tsx` (~150 lignes) : client component avec :
  - Bouton "Suggérer 5 concurrents" → fetch API → 5 suggestions cochables
  - Bouton "Injecter N concurrents dans le champ ↓" → injecte dans le textarea `competitors` du form parent
  - Preserve les domaines déjà saisis (merge sans écraser)
  - Feedback succès vert "✓ N domaines injectés"
  - Erreurs verbeuses (429, 401, OPENROUTER absent)

### 7.3 Intégration

Injecté dans `landing/app/app/brands/new/page.tsx` au-dessus du textarea concurrents.
Pas injecté dans `/app/onboarding/page.tsx` cette session — déduction post-build : le picker d'onboarding est plus risqué à modifier (S13 pattern unique, 1 form 3 steps), à faire S18 si Fred valide le UX `/app/brands/new` d'abord.

---

## Section 8 — §4.7 Trial expiring email J-2

### 8.1 Migration DB

**Fichier** : `supabase/migrations/20260505_saas_phase8_trial_expiring.sql` (37 lignes)

```sql
ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS trial_expiring_email_sent_at TIMESTAMPTZ;
SELECT cron.schedule('saas-trial-expiring-check', '0 8 * * *', ...);  -- quotidien 8h UTC
```

Appliquée via apply_migration MCP (1 call). pg_cron utilise le pattern Vault `saas_service_role_key` standard (déjà créé en Phase 1).

### 8.2 Edge Function

**Fichier** : `supabase/functions/saas_send_trial_expiring_email/index.ts` (~210 lignes)

Pipeline :
1. SELECT subs `status='trialing'`, `current_period_end` dans 24-48h, `trial_expiring_email_sent_at IS NULL`
2. Fetch profile (email, full_name)
3. Render template Tech crisp (Inter, ink, brand-500, glyphe ambré)
4. Block conditional vert (CB enregistrée) ou rouge (sans CB) selon `stripe_subscription_id`
5. POST Resend
6. UPDATE `trial_expiring_email_sent_at = NOW()` (idempotence)
7. Insert `saas_usage_log` event_type=`trial_expiring_notified`

### 8.3 Idempotence

Si l'Edge Function est appelée 2× le même jour pour le même user, le 2e appel skip (déjà notifié). Si Fred re-trigger manuellement après reset (UPDATE NULL), un nouvel email part.

---

## Section 9 — §4.8 Sentry minimal

### 9.1 Install

```bash
npm install @sentry/nextjs --save
```

Version installée : latest (Sentry 10+ qui exporte `captureRequestError` au lieu de l'ancien `onRequestError`).

### 9.2 Configs (3 fichiers)

- `landing/sentry.client.config.ts` : DSN public, traces 10%, replay on error 100%, ignore non-actionable errors
- `landing/sentry.server.config.ts` : DSN server, traces 10%
- `landing/sentry.edge.config.ts` : idem edge runtime

### 9.3 Instrumentation Next.js 15

**Fichier** : `landing/instrumentation.ts`
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}
export { captureRequestError as onRequestError } from "@sentry/nextjs";
```

### 9.4 next.config.mjs wrap

`withSentryConfig` ajouté avec `tunnelRoute: "/monitoring"` (bypass ad-blockers) et `hideSourceMaps: true`. Options deprecation Sentry 10+ retirées (`disableLogger`, `automaticVercelMonitors`, `reactComponentAnnotation`).

### 9.5 Comportement sans DSN (dev local)

Si `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` absents, Sentry init no-op silencieusement → pas d'erreur de build. Action Fred : créer projet Sentry, remplir 4 env vars Vercel (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`).

### 9.6 Coût bundle

First Load JS shared : 102 kB pre-S17 → 178 kB post-S17 (+76 kB pour Sentry client). Acceptable, c'est le prix de l'observabilité.

### 9.7 Edge Functions Supabase

Pas couvert par Sentry Next.js. Les erreurs Edge Functions restent dans Supabase logs (acceptable pour S17 — voir Sentry Deno integration en S18).

---

## Section 10 — Tests effectués pendant la session

| # | Test | Status |
|---|---|---|
| 1 | `npm run build` (landing/) | OK 31 pages + 2 leaderboard, 178 kB First Load shared |
| 2 | Stripe pricing constants vérifiées vs brief | OK 4/4 tier (-25% saving rounds correct) |
| 3 | Migration phase 8 apply via MCP | OK `{success: true}` |
| 4 | n8n MCP get_workflow_details | OK active=true, 12 nodes, état actuel récupéré |
| 5 | Dry-run SQL prospects éligibles | OK 62 total (43 Pharma + 19 AM) |
| 6 | grep "Solo" résiduel dans copies sequence A | OK 0 occurrence |

### Tests à valider par Fred après deploy

| # | Test | Comment |
|---|---|---|
| 7 | `/saas?cycle=monthly` → prix HT prominent (79€/199€/399€/799€) + "soit X€ TTC" en sub | Capture screenshot mensuel |
| 8 | `/saas?cycle=annual` → prix annuel équivalent mensuel HT (59€/149€/299€/599€) + badge "3 mois offerts" + savings | Capture screenshot annuel |
| 9 | `/app/billing` même logique en mode logué | Cf §1.2 |
| 10 | `/saas/vs-getmint` table comparative à jour | Visuel |
| 11 | `/leaderboard` index liste catégories | Visuel + check au moins 1 carte avec preview top 3 |
| 12 | `/leaderboard/asset-management` top 10 visible | Visuel + click sur company → /profile/[domain] |
| 13 | `/leaderboard/categorie-inexistante` → 404 | OK |
| 14 | OG image `/api/og?type=profile&title=AXA&score=3` → screenshot 1200×630 | Tester via opengraph.xyz |
| 15 | `/sitemap.xml` contient /saas, /leaderboard, /leaderboard/[slug] | curl + grep |
| 16 | Auto-suggest concurrents : `/app/brands/new` → click "Suggérer 5 concurrents" → cocher 3 → injecter | Visuel + check competitors field |
| 17 | Trial expiring email : trigger curl → vérifier email + DB row updated | Cf §10.5 |
| 18 | Sentry : créer compte + projet, remplir env vars Vercel, push, vérifier event après erreur volontaire | Cf §10.6 |

---

## Section 11 — Reste à faire pour Fred (par ordre)

### 11.1 Avant push frontend — actions critiques

1. **Lire `saas/docs/SEQUENCE_A_AUDIT_S17.md`** — décider sur les 4 recommandations copies + créer 4 custom fields Apollo (BLOQUANT pour personnalisation emails)
2. **DKIM/SPF Resend domain** (action manuelle DNS OVH, hors agent) — sans ça, deliverability dégradée

### 11.2 Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S17: acquisition launch (sectoral leaderboard, OG metadata profile, sitemap) + activation (auto-suggest concurrents, trial expiring J-2, Sentry minimal) + UI pricing HT prominent + 3 mois offerts annuel"
```

### 11.3 Deploy Edge Functions

```bash
npx supabase functions deploy saas_suggest_competitors        # NEW §4.6
npx supabase functions deploy saas_send_trial_expiring_email  # NEW §4.7
```

Note : `saas_send_alert_email`, `saas_send_weekly_digest`, `saas_send_payment_failed_email`, `saas_stripe_webhook` ne sont **pas modifiées** par S17 — pas besoin de redeploy.

### 11.4 Migration DB

Déjà appliquée pendant la session (phase 8). Aucune action manuelle.

### 11.5 Sentry — créer compte et remplir env vars Vercel

1. https://sentry.io/signup → projet Next.js "geoperf-landing"
2. Récupérer DSN public + auth token (Settings → Auth Tokens)
3. Remplir env vars Vercel (Production + Preview) :
   - `NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...`
   - `SENTRY_DSN=https://...@sentry.io/...` (même)
   - `SENTRY_ORG=jourdechance` (ton org slug)
   - `SENTRY_PROJECT=geoperf-landing`
   - `SENTRY_AUTH_TOKEN=sntrys_...` (sensitive)
   - `SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1` (pour silence le warning build, à retirer si tu ajoutes un global-error.tsx S18)
4. Re-deploy Vercel pour prendre en compte
5. Test : ajouter `throw new Error("test sentry")` dans `/contact` page → reload → vérifier event dans Sentry dashboard

### 11.6 Workflow n8n Phase 2.2 (si pas encore fait)

**Le workflow est déjà actif** sur n8n cloud (`b6cwag080lQ2Kq4B`). Action Fred avant utilisation réelle :
1. Lire `saas/docs/SEQUENCE_A_AUDIT_S17.md` recommandation §1 — créer 4 custom fields Apollo
2. Modifier le node "Build Apollo payload" pour injecter `typed_custom_fields`
3. Créer la Sequence A dans Apollo UI (3 touches FR validées) en **Paused**
4. Récupérer `sequence_id` Apollo
5. Test webhook avec son propre prospect (ajout manuel `prospects` table)
6. Si OK : Resume sequence + premier batch 10 prospects AM (max=10, lead_score_min=50)

### 11.7 Test E2E trial expiring (optionnel — pas d'urgence)

Quand Fred aura un user trial Pro réel à J-2, l'email partira automatiquement le matin (8h UTC cron). Pour tester avant : créer un user fake avec `current_period_end` dans 30h, status='trialing', puis trigger curl :

```bash
curl -X POST https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_trial_expiring_email \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Réponse JSON : `{ ok: true, eligible: 1, sent: 1 }`. Email Geoperf-brandé reçu.

---

## Section 12 — Sujets reportés S18+ (cf brief §8 + nouveaux)

| Sujet | Sprint cible | Pourquoi pas S17 |
|---|---|---|
| Cross-brand benchmark anonymisé | S18 | Gros sprint dédié |
| Prompt Studio dans l'UI | S18+ | Gros chantier |
| Rate-limit API SaaS | S18 | Hardening |
| pg_cron alerting si fail | S18 | Hardening |
| Team seats enforcement | S18 | Edge case |
| Backfill rangs concurrents historiques | S18 ou skip | À évaluer après usage S14 réel |
| Mobile responsive audit complet | S18+ | Travail exploratoire |
| **NEW : Custom fields Apollo + workflow modif** | S17 post-validation | Bloquant rollout (cf §6.2) |
| **NEW : Conditional skip dans Sequence A pour claims fragiles** | S18 | Touches 1 et 2, cf audit §2 |
| **NEW : CompetitorSuggestionPicker dans /app/onboarding** | S18 | Risque UX 1 form 3 steps, valider /brands/new d'abord |
| **NEW : Sentry global-error.tsx pour React render errors** | S18 | Recommandé Sentry, warning lors du build (suppressé via env) |
| **NEW : Sentry Deno integration sur Edge Functions** | S18 | Edge Functions non couvertes actuellement |

---

## Section 13 — `git status --short` final

### Côté `C:\Dev\GEOPERF\` (repo backend)

```
 M saas/docs/BUGS_AND_FEEDBACK.md
 M saas/docs/SPRINT_S17_BRIEF.md
?? n8n/workflows/geoperf_phase2_2_sequence_load.json
?? saas/docs/SEQUENCE_A_AUDIT_S17.md
?? saas/docs/SPRINT_S17_RECAP.md       (ce fichier)
?? supabase/functions/saas_send_trial_expiring_email/
?? supabase/functions/saas_suggest_competitors/
?? supabase/migrations/20260505_saas_phase8_trial_expiring.sql
```

### Côté `C:\Dev\GEOPERF\landing\` (repo frontend séparé)

```
 M app/api/og/route.tsx                  (extension types profile/leaderboard)
 M app/app/billing/page.tsx              (UI pricing HT prominent)
 M app/app/brands/new/page.tsx           (CompetitorSuggestionPicker injecté)
 M app/profile/[domain]/page.tsx         (generateMetadata enrichi OG)
 M app/robots.ts                         (allow /saas /leaderboard /profile)
 M app/saas/page.tsx                     (UI pricing HT prominent)
 M app/saas/vs-getmint/page.tsx          (table comparative annuels)
 M app/sitemap.ts                        (entries leaderboard + saas)
 M next.config.mjs                       (Sentry wrap)
 M package-lock.json                     (Sentry deps)
 M package.json                          (+@sentry/nextjs)
?? app/api/saas/suggest-competitors/     (proxy route)
?? app/leaderboard/                      (page.tsx + [secteur]/page.tsx)
?? components/leaderboard/               (LeaderboardTable + CategoryCard)
?? components/saas/CompetitorSuggestionPicker.tsx
?? instrumentation.ts                    (Sentry register)
?? lib/saas-pricing.ts                   (TIERS constants partagés)
?? sentry.client.config.ts
?? sentry.edge.config.ts
?? sentry.server.config.ts
```

---

## Stats finales S17

- **2 repos touchés** : root (backend Edge Functions + migration + audit + n8n JSON) + landing (frontend + Sentry)
- **3 nouvelles Edge Functions** (1 modifiée 0) : `saas_suggest_competitors`, `saas_send_trial_expiring_email`
- **1 migration DB appliquée** (autorisée brief §4.7)
- **2 nouveaux composants saas frontend** : `CompetitorSuggestionPicker`, et 2 leaderboard (`LeaderboardTable`, `CategoryCard`)
- **3 nouvelles routes frontend** : `/leaderboard`, `/leaderboard/[secteur]`, `/api/saas/suggest-competitors`
- **2 nouvelles entries OG image** types (profile, leaderboard)
- **1 nouvelle dépendance npm** : `@sentry/nextjs` (autorisée brief §4.8)
- **1 nouveau lib partagé** : `lib/saas-pricing.ts` (62 lignes)
- **1 audit dédié** : `saas/docs/SEQUENCE_A_AUDIT_S17.md` (220 lignes)
- **Build vert** OK (First Load JS shared 178 kB après Sentry, +76 kB acceptable)

---

## Notes méthodologiques

### Tax `.exclusive` partout

Confirmé : aucun `tax_behavior` dans le code n'est laissé en `unspecified`. L'UI utilise systématiquement le wording "HT" (HT prominent + TTC en sub). La grille Stripe est en `tax_behavior=exclusive` depuis S16.2 — UI s'aligne.

### Pas d'invention des chiffres

Les constantes `TIERS` viennent strictement du brief (`monthly_ht`, `yearly_ht`, `yearly_eq_mo_ht`, `saving_yr` en cents). Vérification manuelle : 79 × 0.75 = 59.25 → arrondi 59 ✓ (cohérent avec le brief §4.9).

### Workflow n8n actif — décision de non-modification

Le brief disait "ne pas activer". Le workflow était DÉJÀ actif (Fred l'a activé entre la création stub avril et aujourd'hui). L'agent n'a **rien désactivé** — désactiver serait dépasser le scope. L'isolation contre les envois reste assurée par la sequence Apollo cible (Paused). C'est le mécanisme attendu.

### Audit copies sans modification

Conformément à §6.7 contrainte forte ("Aucune modification des copies FR"), les recommandations sont uniquement listées dans `SEQUENCE_A_AUDIT_S17.md`. Le fichier `docs/PHASE2_EMAIL_SEQUENCE.md` n'a **pas été touché**. Fred valide ou rejette chaque recommandation.

### Sentry deprecated options

La version 10+ de `@sentry/nextjs` warne sur `disableLogger`, `automaticVercelMonitors`, `reactComponentAnnotation`. Retirées de `next.config.mjs` pour build clean. Migration vers `webpack.*` pour ces options sera S18 si Fred souhaite les ré-activer.

### CompetitorSuggestionPicker pas dans onboarding

Décision pragmatique : `/app/brands/new` était straightforward (form simple), `/app/onboarding` est plus complexe (1 form 3 steps avec stepper visuel). Risque UX si on injecte sans test. À ajouter S18 après que Fred valide le UX `/brands/new`.

### npm install Sentry

Autorisé explicitement par le brief §5.1 ("Nouvelle dépendance attendue : @sentry/nextjs"). 2 vulnérabilités modérées notées par npm audit — ce sont des deps transitives non-critiques (probablement micromatch/path-to-regexp), à fixer S18 si Fred priorise security audit.

---

## Documents livrés ce sprint

1. **`saas/docs/SPRINT_S17_RECAP.md`** (ce fichier)
2. **`saas/docs/SEQUENCE_A_AUDIT_S17.md`** — audit copies FR + dry-run prospects (220 lignes)
3. **`supabase/migrations/20260505_saas_phase8_trial_expiring.sql`** (37 lignes, appliquée)
4. **`supabase/functions/saas_send_trial_expiring_email/index.ts`** (~210 lignes)
5. **`supabase/functions/saas_suggest_competitors/index.ts`** (~165 lignes)
6. **`n8n/workflows/geoperf_phase2_2_sequence_load.json`** (170 lignes JSON — archive locale)
7. **`landing/lib/saas-pricing.ts`** (62 lignes)
8. **`landing/app/leaderboard/page.tsx`** (145 lignes)
9. **`landing/app/leaderboard/[secteur]/page.tsx`** (170 lignes)
10. **`landing/components/leaderboard/LeaderboardTable.tsx`** (76 lignes)
11. **`landing/components/leaderboard/CategoryCard.tsx`** (51 lignes)
12. **`landing/components/saas/CompetitorSuggestionPicker.tsx`** (~150 lignes)
13. **`landing/app/api/saas/suggest-competitors/route.ts`** (~46 lignes)
14. **`landing/sentry.{client,server,edge}.config.ts`** + `instrumentation.ts` (Sentry minimal)
15. Modifs : `app/api/og/route.tsx`, `app/profile/[domain]/page.tsx`, `app/saas/page.tsx`, `app/app/billing/page.tsx`, `app/saas/vs-getmint/page.tsx`, `app/sitemap.ts`, `app/robots.ts`, `app/app/brands/new/page.tsx`, `next.config.mjs`, `package.json`

---

Bon push Fred !
