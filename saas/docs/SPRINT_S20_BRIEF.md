# SPRINT S20 — BRIEF

> Pre-launch acquisition + admin tooling. Acquisition outbound demarre Sequence A J0,
> ce sprint outille la conversion (coupon trial) + le pilotage (admin reports/prospects/categories)
> + l onboarding (compte demo).

---

## TL;DR

5 livrables :
1. **Coupon code** → trial Starter 14j gratuit (frontend signup + backend Stripe + admin CRUD)
2. **Admin prospects** : filtres cat/ss-cat + status + search + pagination
3. **Cacher couts snapshots** cote user (visible admin uniquement)
4. **Admin /saas/reports + /saas/categories** : CRUD complet via UI (plus besoin SQL manuel)
5. **Compte demo SaaS public** : 6 mois historique, read-only, page /demo auto-login

---

## Contexte fin S19

| Metric | Valeur |
|---|---|
| Prospects sources (3 nouvelles ss-cat) | 81, 95% email verified |
| Disqualifies licornes >500emp | 26 |
| Pool ICP pur pret Sequence A | **62** (55 nouveaux + 7 Agences digitales) |
| Edge Functions deployees S19+ | 5 (lead-magnet email, CRM hook, etc.) |
| PDFs lead-magnet en bucket | 10 reports (signed URL fresh genere a chaque envoi depuis hotfix S19+) |

Sequence A demarre J0 (Apollo enroll des 62 prospects). S20 outille le bout de la chaine
(prospect clique sur l email → arrive sur signup avec coupon → trial Starter 14j).

---

## Objectifs sprint

- **Conversion** : pourquoi un prospect signerait Starter alors qu il a Free ? Reponse : code coupon distribue par Frederic en 1-1 / Sequence A → Starter gratuit 14j (≈ valeur 30€ HT, mais *paye* en email validé)
- **Pilotage** : tu dois pouvoir piloter 200+ prospects sur 8 sous-cat sans SQL
- **Onboarding** : page demo publique pour CTO/CMO sceptiques qui veulent voir le produit avant signup

---

## Livrables

### §4.1 Coupon redemption — trial Starter 14j gratuit

**Modele DB (migration phase 12)** :

```sql
CREATE TABLE saas_coupons (
  code text PRIMARY KEY,                     -- ex: "EARLYACCESS-2W"
  tier_target text NOT NULL,                  -- 'starter' | 'growth' | 'pro' | 'agency'
  trial_days integer NOT NULL DEFAULT 14,    -- duree du trial offert
  max_uses integer,                           -- NULL = illimite
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,                     -- NULL = pas d expiration
  is_active boolean NOT NULL DEFAULT true,
  notes text,                                 -- contexte interne (ex: "Distribution Sequence A J0")
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT tier_target_check CHECK (tier_target IN ('starter','growth','pro','agency'))
);

CREATE TABLE saas_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code text NOT NULL REFERENCES saas_coupons(code),
  user_id uuid REFERENCES auth.users(id),
  email text NOT NULL,
  stripe_subscription_id text,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_per_coupon UNIQUE (coupon_code, user_id)
);

CREATE INDEX idx_coupon_redemptions_code ON saas_coupon_redemptions(coupon_code);
```

**Frontend** :
- Champ "Code de parrainage (optionnel)" sur `/signup` et sur `/pricing` (CTA Starter)
- Validation au blur via `/api/saas/coupon/validate?code=...` → retourne `{ valid, tier_target, trial_days, error? }`
- Si valide + tier_target = "starter" → CTA Starter passe a "Demarrer 14 jours gratuits avec code XXX"
- Token URL `?coupon=EARLYACCESS-2W` pre-rempli (utile pour distribution Sequence A)

**Backend Edge Function `saas_create_checkout_session`** :
- Si `coupon_code` valide en body :
  - Verifier `is_active`, `expires_at IS NULL OR expires_at > now()`, `used_count < max_uses OR max_uses IS NULL`
  - Verifier `tier_target` matche le tier choisi
  - Inserer ligne dans `saas_coupon_redemptions` avant Stripe (idempotency par `unique_user_per_coupon`)
  - Passer `subscription_data: { trial_period_days: trial_days, metadata: { coupon_code } }` au checkout
- Si invalid : 422 + error message clair (`coupon_expired`, `coupon_exhausted`, `coupon_wrong_tier`)

**Webhook `subscription.created`** :
- Si `metadata.coupon_code` present → UPDATE `saas_coupons SET used_count = used_count + 1 WHERE code = ?`
- UPDATE `saas_coupon_redemptions SET stripe_subscription_id = ? WHERE coupon_code = ? AND user_id = ?`

**Admin `/admin/saas/coupons`** :
- Table : code, tier, trial_days, used/max, expires_at, status (active/expired/exhausted), actions
- Bouton "Nouveau coupon" : form (code auto-suggere `EARLYACCESS-XXX`, tier dropdown, trial_days default 14, max_uses, expires_at, notes)
- Toggle is_active inline
- Drawer "Voir redemptions" : liste des emails ayant utilise ce coupon + status sub
- Page accessible uniquement aux admins (RLS + check `auth.users.app_metadata.role = 'admin'`)

**Tests E2E** :
1. Coupon valide → trial 14j applique sur Stripe sub
2. Coupon expire → erreur claire UI
3. Coupon exhausted (max_uses atteint) → erreur claire
4. Coupon mauvais tier (Growth alors que choisi Starter) → erreur
5. Meme user retentant 2x → 409 (unique constraint)
6. Decompte `used_count` apres webhook
7. Annulation pendant trial → pas de charge

---

### §4.2 Admin prospects — filtres cat/ss-cat

**Page `/admin/prospects`** (existante a refondre) :

| Element | Detail |
|---|---|
| Filtres en haut | Cat parent (dropdown) → cascade ss-cat (dropdown) → status (multi) → email_verified (toggle) |
| Search bar | Plein texte sur company.nom, full_name, email, title |
| Tri | lead_score DESC par defaut, sortable sur created_at, status, company |
| Pagination | 50/page, paginees server-side |
| Colonnes | company, full_name, title, email, lead_score, status, ss-cat, created_at |
| Bulk actions | Disqualifier selection, export CSV, enroll in Sequence A (call n8n webhook), opt-out |
| Compteurs | "X / Y prospects" en header (filtre actif vs total) |

**Backend** :
- Route `/api/admin/prospects` : query Supabase avec filtres dynamiques
- Service role key (RLS bypass), check role admin sur server
- Reuse view `v_admin_prospects` (a creer si absente, joins prospects + companies + categories)

---

### §4.3 Cacher couts snapshots cote user

**Audit** : grep `cost_usd`, `total_cost_usd`, `snapshot_cost`, `OPENROUTER_COST` dans `landing/components/saas/*` et `landing/app/app/**/*`.

**Targets** (a confirmer apres grep) :
- Dashboard snapshots history : retirer colonne cout
- Email digest hebdo : retirer mention cout
- /app/billing : ne montrer que tier + amount Stripe, pas cout interne LLM

**Garder visible** :
- /admin/saas/reports (cout par PDF)
- /admin/saas/snapshots (cout par snapshot)
- /admin/saas/dashboard (cout total mensuel par tenant)

---

### §4.4 Admin reports + categories UI

**`/admin/saas/reports`** :
- Liste paginee (50/page) : id, ss-cat, status, completed_at, nb_companies, total_cost_usd, pdf link
- Filtres : status (running/ready/error), ss-cat (dropdown), date range
- Actions par row :
  - **View PDF** → genere fresh signed URL (utilise meme helper que Edge Function) et open new tab
  - **Delete** → confirm modal, CASCADE supprime raw_responses + report_companies, SET NULL lead_magnet_downloads
  - **Regenerate** → POST n8n webhook Phase 1 avec category_slug + top_n=30
- Bouton "Lancer extraction" en haut (deja existe) → enrichi avec preset cats favorites

**`/admin/saas/categories`** :
- Vue arbre 2 niveaux (parent → enfants)
- Bouton "Nouvelle categorie" + selecteur parent
- Form : nom, slug (auto-genere depuis nom, editable), parent (dropdown), ordre, is_active toggle
- Edit en place (click sur row)
- Pas de delete dur (FK contraintes via reports/companies). Soft via is_active=false
- Action "Generer 1er report" depuis liste si is_active + 0 reports existants

---

### §4.5 Compte demo SaaS public

**Strategie** : creer un user `demo@geoperf.com` (auth pre-confirme), brand "Demo Corp" (domain demo.example.com), seed 6 mois de snapshots fictifs sur 4 LLM (donnees anonymisees a partir de cat Asset Management ou Pharma).

**Page `/demo`** :
- Pas de login form — direct redirect vers `/app` avec une session JWT short-lived (24h) signe par Supabase
- Bandeau permanent en haut : "Mode demo en lecture seule. Pour creer votre compte, [Demarrer gratuit →](/signup)"
- Disable toutes mutations dans /app/* :
  - Boutons "Snapshot manuel", "Modifier brand", "Supprimer alerte" → grises avec tooltip "Indisponible en mode demo"
  - CTA upgrade redirige vers /pricing
  - Submission forms = noop + toast "Mode demo"

**Backend** :
- Migration phase 13 : seed user + brand + ~30 snapshots (1 par semaine x 4 LLM x 6 mois ≈ 26 snapshots)
- Edge Function `saas_demo_login` : retourne JWT 24h pour user demo
- Middleware `/app/*` : if user.id == DEMO_USER_ID → set readonly flag → block mutations

**SEO** :
- /demo en index (priority 0.9 dans sitemap)
- Meta description "Decouvrez Geoperf en demo sans inscription"
- Le bandeau "passez en SaaS payant" est un CTA premium

---

## Hors scope S20

- AI Overviews + Copilot (slugs OpenRouter toujours pas dispo, S21+)
- Daily snapshots Pro+ (cost optimization needed, S21)
- Prompt Studio UI (creer ses propres prompts dans l app, S22)
- Cross-brand benchmark anonymise (S22+)
- Patches n8n Phase 1/2 pendings (cf `BUGS_AND_FEEDBACK.md`) → hotfix au fil de l eau
- Update prompt Phase 1 Scale-ups SaaS pour exclure licornes — a faire en quick win independant

---

## Definition of Done

- [ ] Migration phase 12 (coupons) + phase 13 (demo seed) appliquees
- [ ] Test E2E coupon `EARLYACCESS-2W` :
  - signup avec code → checkout Stripe → trial 14j → first invoice J14 → used_count = 1
  - meme email retentant → 409
  - coupon expire → erreur UI
- [ ] /admin/saas/coupons : creer, toggle, voir 1 redemption — fonctionnel
- [ ] /admin/prospects avec 200+ prospects existants : filtres cat (Finance/Marketing/SaaS) + status + search OK
- [ ] Bulk action "enroll in Sequence A" sur 5 prospects → call n8n webhook Phase 2.2
- [ ] Aucun `cost_usd` ni mention de cout LLM cote user (audit Sentry + screen testing Free/Starter/Growth/Pro)
- [ ] /admin/saas/reports : view PDF avec fresh signed URL, delete CASCADE clean
- [ ] /admin/saas/categories : creer nouvelle ss-cat → trigger 1er report direct depuis UI
- [ ] /demo : accessible sans login, dashboard avec 6 mois data, tentative mutation = toast bloque
- [ ] Sentry pas de regressions, perf Lighthouse /admin > 80

---

## Estimation

| Livrable | J |
|---|---|
| §4.1 coupon (DB + frontend + Stripe + admin + tests) | 2.0 |
| §4.2 admin prospects filter | 1.0 |
| §4.3 cacher couts | 0.5 |
| §4.4 admin reports + categories | 1.5 |
| §4.5 compte demo (seed data le plus complexe) | 1.5 |
| Tests E2E, deploy, doc | 1.0 |
| **Total** | **7.5j** |

---

## Risques & mitigations

| Risque | Mitigation |
|---|---|
| Webhook subscription.created arrive avant checkout.session.completed → race used_count | Idempotency via stripe_subscription_id sur table redemptions |
| Coupon abuse : signup multiple par 1 prospect | Rate-limit par IP (1/min) + email validation Resend (deja DMARC strict) |
| Compte demo : data fictive peu credible | Seed depuis vraie cat anonymisee (Asset Management dome → renommer en "DemoSector") |
| Page /demo SEO penalise pour duplicate content avec /app | Add `noindex` sur /app, garder index sur /demo + add canonical /demo |
| Filtres prospects → query lente 200+ rows | Index composites `(category_id, status, lead_score DESC)` deja en place phase 10 |

---

## Distribution coupons (post-S20)

Coupons que tu pourras creer en admin a J+1 du deploy S20 :

| Code | Tier | Trial | Max uses | Notes |
|---|---|---|---|---|
| EARLYACCESS-2W | starter | 14j | 50 | Distribution Sequence A J0 |
| FOUNDER-FRIEND | starter | 30j | 20 | Reseau perso Frederic |
| ETUDE-CRM-ESSAI | starter | 14j | 100 | CTA dans email lead-magnet (cf §4.1.f S19) |
| AGENCY-PILOT | agency | 14j | 5 | Agences pilots ciblees |

(Tu pourras les creer toi-meme depuis l UI.)

---

## Tags

`backend` (Edge Functions, migrations) · `frontend` (admin + signup + demo) · `stripe` (coupons + checkout extension) · `seed-data` (demo)
