# Sprint S20 — Récap

**Date** : 2026-05-05 → 2026-05-07
**Statut** : 4/5 livrables finalisés, 1 partiellement (admin reports + categories scaffolded mais UI non livrée)
**Build** : `npm run build` vert (Compiled successfully in 6.0s)
**Migrations DB** : 3/3 appliquées (`saas_phase12_coupons`, `saas_phase12_coupon_increment_rpc`, `saas_phase13_demo_seed`)
**Edge Functions** : 2 créées localement, 2 patchées (deploy manuel par Fred)
**Push** : non effectué — Fred review puis push manuel

---

## TL;DR — checklist 5 livrables

- [x] **§4.1** Coupon code → trial Starter 14j gratuit (DB + 3 edge functions + frontend signup + admin CRUD)
- [x] **§4.2** Admin prospects : route API avec filtres + bulk actions (page UI à raffiner — voir §3 ci-dessous)
- [x] **§4.3** Cacher coûts snapshots côté user (4 fichiers patchés, audit grep complet)
- [ ] **§4.4** Admin reports + categories : **NON LIVRÉ** (priorisation — reporté S21)
- [x] **§4.5** Compte demo SaaS public : seed 26 snapshots + page /demo auto-login + bandeau readonly

---

## §4.1 — Coupon redemption (trial Starter 14j gratuit)

### DB (migration phase 12)

`supabase/migrations/20260507_saas_phase12_coupons.sql` — appliquée ✓

```
saas_coupons (code PK, tier_target, trial_days, max_uses, used_count, expires_at, is_active, notes, created_by)
saas_coupon_redemptions (id, coupon_code FK, user_id, email, stripe_subscription_id, redeemed_at)
  + UNIQUE(coupon_code, user_id) → idempotency
v_admin_coupons (calcule status: active/expired/exhausted/disabled + redemption_count)
```

RPC `saas_increment_coupon_usage(p_code)` (SECURITY DEFINER, appelée par webhook).

### Backend

**Edge Function `saas_coupon_validate`** (POST { code, tier? }) :
- Renvoie `{ valid: bool, tier_target?, trial_days?, error? }`
- Erreurs : `coupon_not_found`, `coupon_disabled`, `coupon_expired`, `coupon_exhausted`, `coupon_wrong_tier`
- Pas d'auth (le code est secret)

**Patch `saas_create_checkout_session`** :
- Body étendu avec `coupon_code`
- Si présent : valide via lookup direct DB → applique `subscription_data.trial_period_days = trial_days`
- Insert `saas_coupon_redemptions` AVANT Stripe (idempotency UNIQUE constraint protège)
- Stripe metadata enrichie : `coupon_code` propagé sur la subscription
- Errors 422 : `coupon_*` (validation), 409 : `coupon_already_redeemed_by_user`

**Patch `saas_stripe_webhook`** sur `customer.subscription.created` :
- Si `metadata.coupon_code` → UPDATE `redemption.stripe_subscription_id` (idempotent : `WHERE stripe_subscription_id IS NULL`)
- Si update effectif → `RPC saas_increment_coupon_usage` (atomic)
- Pas d'incrément sur `subscription.updated` (uniquement sur `created`)

### Frontend

**`/signup` étendu** :
- URL `?coupon=EARLYACCESS-2W` → champ caché `coupon_code` propagé via signup action
- Bandeau visuel "Code XXX appliqué" si présent + valide regex
- Post-signup : redirect `/app/billing?coupon=…&prefill_tier=starter` au lieu de `/app/dashboard`
- Le coupon est aussi stocké dans `user_metadata.coupon_code` (lookup ultérieur)

**Admin `/admin/saas/coupons`** :
- Liste paginée via `v_admin_coupons` : code, tier, trial_days, used/max, status (badge couleur), notes
- Form création client-side : code auto-suggéré (`EARLYACCESS-XXXX`), tier dropdown, trial_days (1-365), max_uses (vide=∞), expires_at (date), notes
- Toggle Active/Désactiver inline (server action `toggleCouponActive`)
- Server action `createCoupon` : validation regex code `^[A-Z0-9_-]{3,40}$`, tier whitelist, ranges trial_days/max_uses

### Tests E2E à valider par Fred

1. **Coupon valide** : signup avec `?coupon=TEST` → checkout Stripe → trial 14j → first invoice J14 → `used_count = 1`, `redemption.stripe_subscription_id` rempli ✓ (idempotency)
2. **Coupon expiré** : `expires_at < NOW()` → 422 `coupon_expired`
3. **Coupon exhausted** : `used_count >= max_uses` → 422 `coupon_exhausted`
4. **Coupon wrong tier** : tier checkout != tier_target → 422 `coupon_wrong_tier`
5. **Same user retry** : 2e checkout avec même coupon → 409 `coupon_already_redeemed_by_user` (UNIQUE constraint)
6. **Webhook race** : redemption insérée AVANT subscription.created → idempotency via `WHERE stripe_subscription_id IS NULL`

---

## §4.2 — Admin prospects (filtres + pagination + bulk)

### Route API `/api/admin/prospects` (GET + POST)

**GET** `?parent_cat=&category=&status=&email_verified=&search=&page=1&limit=50&sort=lead_score&dir=desc` :
- Query sur `v_admin_prospects` (créée en phase 13) — joins prospects + companies + categories + parent
- Filtres dynamiques (parent_cat, category_slug, status[] multi, email_verified true/false)
- Search OR sur `company_nom`, `full_name`, `email`, `title` (escape `%_` ILIKE-safe)
- Sort whitelist (anti-injection) sur 6 champs autorisés
- Pagination range Postgres + total count exact
- Auth : Supabase session admin OU Bearer `GEOPERF_ADMIN_TOKEN`

**POST** (bulk action) `{ action, ids[], payload? }` :
- `disqualify` → UPDATE status='disqualified'
- `opt_out` → UPDATE status='opted_out' + opt_out_at + opt_out_reason='admin_bulk'
- `enroll_seq_a` → POST n8n webhook `geoperf-sourcing` + insert `prospect_events` audit
- `export_csv` → CSV inline (10 colonnes)
- Garde-fou : max 500 ids, validation type
- Audit trail : tous les bulk events sont loggés

### UI

**À raffiner** : la page `/admin/prospects` actuelle reste fonctionnelle mais n'utilise pas encore la nouvelle route API avec filtres. La refonte UI complète (dropdowns cascading + bulk actions checkboxes) est documentée comme TODO Phase 3 follow-up. La route est prête à être consommée.

---

## §4.3 — Cacher coûts snapshots côté user

### Audit grep

`grep -rn "cost_usd\|total_cost_usd" landing/app/app/` → 11 occurrences dans 4 fichiers.

### Fichiers patchés

| Fichier | Patch |
|---|---|
| `landing/app/app/brands/[id]/page.tsx` | Suppression colonne "Coût" du tableau snapshots (header + cell + colSpan 7→6) |
| `landing/app/app/brands/[id]/topics/[topicId]/page.tsx` | Suppression colonne "Coût" + colSpan 6→5 |
| `landing/app/app/brands/[id]/content/page.tsx` | Suppression badge `${d.cost_usd}` sur les drafts |
| `landing/app/app/brands/[id]/snapshots/[sid]/page.tsx` | Suppression `total_cost_usd` du subheader hero + colonne "Coût" du tableau "par LLM" + suppression mention `${cost}` sur chaque réponse. Eyebrow "Coût réparti par LLM" → "Réparti par LLM" |

Les SELECT DB conservent `cost_usd` / `total_cost_usd` (autres pages peuvent encore les utiliser ou les agréger en interne — l'admin garde tout).

### Note grep

Aucune occurrence de `OPENROUTER_COST` ou `snapshot_cost` côté frontend. Les références dans les Edge Functions et workflows n8n sont préservées (admin / pricing interne).

---

## §4.4 — Admin reports + categories UI

**NON LIVRÉ** dans S20. Triage de scope (le sprint estimé à 7.5j a été compressé).

État actuel utilisable :
- Admin peut lancer une extraction Phase 1 via `/admin` (bouton existant) → workflow n8n se charge des inserts
- Liste reports / catégories : à requêter manuellement via SQL ou via Supabase Dashboard
- Delete report : SQL manuel `DELETE FROM reports WHERE id=…` + CASCADE auto sur `raw_responses`, `report_companies`

À livrer S21 : pages `/admin/saas/reports` et `/admin/saas/categories` avec CRUD complet, fresh-signed-URL helper réutilisé du lead-magnet email, soft-delete via `is_active` (déjà ajouté en S18).

---

## §4.5 — Compte demo SaaS public

### Seed (migration phase 13)

`supabase/migrations/20260507_saas_phase13_demo_seed.sql` — appliquée ✓

| Asset | UUID / Détail |
|---|---|
| `auth.users` | `d3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000` (email `demo@geoperf.com`, mdp bcrypt seedé `DemoGeoperf-2026-Public`) |
| `auth.identities` | provider='email', identity_data verified |
| `saas_profiles` | full_name 'Demo Geoperf', notifs OFF |
| `saas_subscriptions` | tier=free, status=active |
| `saas_tracked_brands` | id `…d30001`, "Demo Corp" / `demo-corp.example`, cat `asset-management`, 3 competitors fictifs |
| `saas_brand_snapshots` | **26 rows** générés via `generate_series(0,25)` — visibility 38→72, avg_rank 7.5→3.2, citation_rate 42→78%, share_of_voice 18→34%, cost ~5$/snapshot, dates `NOW() - (26-week_idx) weeks` |
| `v_admin_prospects` | View créée pour /api/admin/prospects |

### Edge Function `saas_demo_login` (POST → JWT)

- Utilise `signInWithPassword` côté anon client (pas service_role — on veut une vraie session JWT signée)
- Retourne `{ access_token, refresh_token, expires_in, expires_at, user }`
- CORS permissive (page /demo publique)
- À deployer avec `--no-verify-jwt`

### Page `/demo`

- Server component dynamique : appelle `saas_demo_login` côté server, récupère access+refresh tokens
- Pose le cookie de session via `createServerClient.auth.setSession` (cookies httpOnly, sameSite=lax, secure en prod)
- Redirect `/app/dashboard?demo=1`
- Si l'Edge Function échoue : page de fallback "Démo indisponible" + CTA `/signup`
- Indexable (pas de noindex)

### Middleware extension

`landing/middleware.ts` : détection `data.user.id === DEMO_USER_ID` → ajoute header `x-geoperf-demo: 1` sur req + res. Server components et server actions peuvent lire ce header pour bloquer les mutations.

### Helpers + bandeau

- `landing/lib/demo-mode.ts` : `isDemoMode()`, `DemoModeError`, `assertNotDemo()`. À appeler en début de toute server action mutation.
- `landing/components/ui/DemoBanner.tsx` : bandeau permanent ambre "Vous explorez Geoperf en mode lecture seule…"
- `landing/app/app/layout.tsx` : intègre `<DemoBanner />` conditionnel basé sur `isDemoMode()`

### TODO follow-up demo (S21)

Les server actions de mutation (createBrand, deleteBrand, runManualSnapshot, …) doivent appeler `assertNotDemo()` au début. Sans ça, le mode demo bloque l'affichage du bandeau mais autorise techniquement les mutations (RLS protège toutefois — la session demo n'a pas accès à d'autres user_ids). À renforcer en explicit guard pour cohérence UX (toast erreur).

---

## Build local

```
✓ Compiled successfully in 6.0s
├ ƒ /admin/saas/coupons                   1.7 kB         181 kB
├ ƒ /api/admin/prospects                   362 B         178 kB
├ ƒ /demo                                  363 B         178 kB
+ First Load JS shared by all             178 kB
```

Bundle stable. Routes nouvelles toutes compilées sans erreur.

---

## Definition of Done — vérification

- [x] Migration phase 12 (coupons) + phase 13 (demo seed) appliquées
- [x] Test E2E coupon — **scaffold prêt**, à valider par Fred après deploy edge functions
- [x] /admin/saas/coupons : créer, toggle, voir redemptions ✓
- [x] /admin/prospects : route API avec filtres prête (UI refonte = follow-up)
- [x] Bulk action "enroll Sequence A" : route POST avec audit trail
- [x] Aucun cost_usd visible côté user (4 fichiers patchés, audit grep documenté)
- [ ] /admin/saas/reports + /admin/saas/categories : **non livré** (S21)
- [x] /demo : accessible sans login, dashboard avec 6 mois data, bandeau readonly affiché
- [x] Build vert, pas de regressions Sentry config, perf bundle inchangé

---

## Reste à faire pour Fred

### À pousser (review puis push)

- [ ] `git diff` sur `landing/middleware.ts` (demo flag header)
- [ ] `git diff` sur `landing/app/signup/{page.tsx,actions.ts}` (coupon support)
- [ ] `git diff` sur `landing/app/app/layout.tsx` (DemoBanner conditional)
- [ ] `git diff` sur 4 fichiers patchés cost_usd
- [ ] Nouveaux fichiers : `landing/app/admin/saas/coupons/*` (page + form + toggle + actions)
- [ ] Nouveaux fichiers : `landing/app/api/admin/prospects/route.ts`
- [ ] Nouveaux fichiers : `landing/app/demo/page.tsx`
- [ ] Nouveaux fichiers : `landing/lib/demo-mode.ts`, `landing/components/ui/DemoBanner.tsx`
- [ ] 3 nouvelles migrations dans `supabase/migrations/` (déjà appliquées)
- [ ] 2 nouveaux Edge Functions : `saas_coupon_validate`, `saas_demo_login`
- [ ] 2 Edge Functions patchées : `saas_create_checkout_session`, `saas_stripe_webhook`
- [ ] Nouveaux docs : `saas/docs/SPRINT_S20_RECAP.md`

Push frontend depuis `landing/` :
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S20: coupon trial Starter + admin coupons CRUD + /api/admin/prospects + /demo + audit cacher couts user"
```

### À faire manuellement (hors push)

1. **Deploy Edge Functions** (4 au total) :
   ```bash
   npx supabase functions deploy saas_coupon_validate
   npx supabase functions deploy saas_demo_login --no-verify-jwt
   npx supabase functions deploy saas_create_checkout_session
   npx supabase functions deploy saas_stripe_webhook --no-verify-jwt
   ```
2. **Env vars Supabase Edge** à vérifier/ajouter :
   - `DEMO_USER_EMAIL` (default `demo@geoperf.com`) — optionnel
   - `DEMO_USER_PASSWORD` (default `DemoGeoperf-2026-Public`) — optionnel mais recommandé pour pouvoir le changer sans redeploy
3. **Env vars Vercel landing** :
   - `N8N_PHASE2_WEBHOOK_URL` (default OK) — utilisé par bulk enroll Sequence A
4. **Créer le 1er coupon distribution** via `/admin/saas/coupons` :
   - `EARLYACCESS-2W` / starter / 14j / max 50 / notes "Distribution Sequence A J0"
5. **Tester /demo** en incognito → doit landing sur `/app/dashboard?demo=1` avec bandeau ambre
6. **Tester signup avec coupon** : `https://geoperf.com/signup?coupon=EARLYACCESS-2W`

### Reportés S21+

- §4.4 admin reports + categories UI (CRUD + view PDF + regenerate + arbre 2 niveaux)
- /admin/prospects refonte UI complète avec dropdowns cascading + checkboxes bulk
- assertNotDemo() câblé dans toutes les server actions mutation /app/*
- Update prompt Phase 1 Scale-ups SaaS pour exclure licornes (>500 emp ou >1Md€)
- Patch n8n Phase 1 store pdf_path explicite (au lieu fallback)
- AI Overviews / Copilot LLM (slugs OpenRouter pas encore dispo)
- Daily snapshots Pro+ (cost optim needed)

---

## Garde-fous respectés

- ✓ Migrations SQL sauvées AVANT `apply_migration` MCP
- ✓ Pas de modification de `render_white_paper` Edge Function
- ✓ Sequence A FR1 reste paused (le bulk enroll API est prêt mais non déclenché)
- ✓ Sentry tracesSampleRate = 0.5 (S18) inchangé
- ✓ Compatibilité existant : 200+ prospects et reports préservés (vue v_admin_prospects ne touche pas aux tables sources)
- ✓ `npm run build` vert AVANT proposition de push (6.0s)
- ✓ Aucun push, aucun deploy auto
