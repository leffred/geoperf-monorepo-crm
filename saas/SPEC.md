# GEOPERF SaaS — Monitoring du référencement LLM

> Spec complète pour démarrage dev. Destinée à CC CLI.
> Owner : Frederic Lefebvre · `flefebvre@jourdechance.com`
> Date : 2026-04-29 · Status : LOCKED v1.0

---

## 1. Contexte produit

**Geoperf SaaS** est une extension de Geoperf (lead-magnet B2B existant). Là où le lead-magnet produit un LB sectoriel ponctuel, le SaaS offre un **monitoring continu de la visibilité d'une marque dans les LLM** (ChatGPT, Claude, Gemini, Perplexity).

**Proposition de valeur** :
1. Voir l'évolution semaine par semaine de son ranking dans les réponses LLM
2. Identifier les concurrents qui gagnent du terrain
3. Recevoir des recommandations actionnables (quelles authority sources cibler pour améliorer son ranking)
4. Alertes sur changement majeur (drop, mention concurrent, nouvelle source autorité)

**Cible** : décideurs marketing + agences SEO/marketing (tier Agency).

**Funnel** : acquisition via les LB sectoriels (Phase 1 existante) → utilisateur s'inscrit en freemium → upgrade vers payant.

---

## 2. Pricing (verrouillé)

| Tier | Prix HT/mois | Marques | Cadence | LLMs | Historique | Recos | Alertes | Export | White-label |
|---|---|---|---|---|---|---|---|---|---|
| **Free** | 0€ | 1 | Mensuelle | 1 (ChatGPT) | 3 derniers snapshots | Non | Non | Non | Non |
| **Solo** | 149€ | 1 | Hebdomadaire | 4 (tous) | Illimité | Oui | Oui | CSV/PDF | Non |
| **Pro** | 349€ | 3 | Hebdomadaire | 4 | Illimité | Oui | Oui | CSV/PDF | Non |
| **Agency** | 899€ | 10 | Hebdomadaire | 4 | Illimité | Oui | Oui | CSV/PDF | Oui |

**Logique freemium** : pas de kick temporel. Le freemium reste actif indéfiniment mais bridé en valeur perçue. L'upgrade se déclenche par frustration utile (user voit ce qu'il rate).

**Calculs économie unitaire** (modèles principaux ~0,01€/appel) :
- Free : 30 prompts × 1 LLM × 1/mois = 30 appels = ~0,30€/mois → cramé
- Solo : 30 prompts × 4 LLM × 4/mois = 480 appels = ~5€/mois → marge brute 96%
- Pro : 3 × Solo = ~15€/mois → marge brute 96%
- Agency : 10 × Solo = ~50€/mois → marge brute 94%

---

## 3. Architecture cible

```
┌─────────────────────────────────────────────────────────┐
│ Frontend Next.js 15 (geoperf.com)                       │
│  /app          → marketing public (existant)            │
│  /signup       → inscription freemium                   │
│  /app/dashboard → dashboard user (NEW)                  │
│  /app/brands   → gestion marques suivies (NEW)          │
│  /app/billing  → portail Stripe (NEW)                   │
│  /admin        → admin Geoperf (existant, étendu)       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ Supabase project qfdvdcvqknoqfxetttch (Frankfurt EU)    │
│  Auth          → magic link + password (existant)       │
│  Postgres      → tables SaaS (multi-tenant via RLS)     │
│  Edge Functions:                                         │
│    - run_brand_snapshot (extract+analyze 1 marque)      │
│    - generate_recommendations (Haiku reco)              │
│    - stripe_webhook (subscription sync)                 │
│    - send_alert_email (drop/concurrent gain)            │
│  Cron pg_cron  → trigger snapshots hebdo/mensuels       │
│  Storage       → exports CSV/PDF utilisateurs           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ OpenRouter (4 LLM)  +  Stripe  +  Resend (email)        │
└─────────────────────────────────────────────────────────┘
```

**Décision** : on **n'utilise PAS n8n pour le SaaS**. Le pipeline d'extraction passe en Edge Function Supabase (`run_brand_snapshot`). Justification :
- Scaling : 100+ marques × hebdo = 400+ runs/semaine. n8n cloud devient un goulot et un coût.
- Isolation : un run user ne doit jamais bloquer la production des LB sectoriels (qui restent sur n8n).
- Observabilité : logs Supabase natifs > debug n8n cloud.
- Coût : Edge Functions = inclus dans le plan Supabase Pro existant.

**Ce que n8n garde** : les LB sectoriels (Phase 1/1.1 existante). Inchangé.

**Réutilisation logique** : les prompts (`prompts/phase1/`) et la logique de scoring (`raw_responses` parsing) sont copiés-collés du n8n vers le code Deno de l'Edge Function. Pas de réécriture de la logique métier.

---

## 4. Schéma Postgres multi-tenant

> Toutes les nouvelles tables vivent sous le préfixe `saas_` pour ne pas polluer le schéma reporting-engine existant (`reports`, `companies`, `prospects`, etc.).

### 4.1 Tables

```sql
-- Migration : 20260429_saas_phase1_schema.sql

-- Profils utilisateur (1:1 avec auth.users)
CREATE TABLE saas_profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT,
  company         TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Abonnements (synced depuis Stripe webhook)
CREATE TYPE saas_tier AS ENUM ('free', 'solo', 'pro', 'agency');
CREATE TYPE saas_subscription_status AS ENUM ('active', 'past_due', 'canceled', 'incomplete');

CREATE TABLE saas_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES saas_profiles(id) ON DELETE CASCADE,
  tier                  saas_tier NOT NULL DEFAULT 'free',
  status                saas_subscription_status NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id       TEXT,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON saas_subscriptions(user_id);

-- Marques suivies par les users
CREATE TABLE saas_tracked_brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES saas_profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  domain          TEXT NOT NULL,                  -- ex : "axa.fr"
  category_slug   TEXT NOT NULL,                  -- ex : "asset-management" (FK saute si pas dans categories)
  competitor_domains TEXT[] NOT NULL DEFAULT '{}', -- pour focus prompts
  cadence         TEXT NOT NULL DEFAULT 'weekly', -- 'weekly' | 'monthly'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, domain)
);
CREATE INDEX ON saas_tracked_brands(user_id);
CREATE INDEX ON saas_tracked_brands(is_active, cadence);

-- Snapshots = un run d'extraction pour 1 marque à 1 instant
CREATE TYPE saas_snapshot_status AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE saas_brand_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES saas_tracked_brands(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES saas_profiles(id) ON DELETE CASCADE,
  status            saas_snapshot_status NOT NULL DEFAULT 'queued',
  llms_used         TEXT[] NOT NULL,        -- ex : ['gpt-4o','claude-sonnet-4-6','gemini-2.5-pro','perplexity']
  prompts_count     INT NOT NULL,
  visibility_score  NUMERIC(5,2),           -- 0-100, agrégé multi-LLM
  avg_rank          NUMERIC(5,2),           -- rang moyen quand cité
  citation_rate     NUMERIC(5,2),           -- % prompts où cité
  share_of_voice    NUMERIC(5,2),           -- % vs concurrents
  total_cost_usd    NUMERIC(8,4),
  raw_response_count INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
CREATE INDEX ON saas_brand_snapshots(brand_id, created_at DESC);
CREATE INDEX ON saas_brand_snapshots(user_id);
CREATE INDEX ON saas_brand_snapshots(status);

-- Réponses brutes par LLM (1:N depuis snapshot)
CREATE TABLE saas_snapshot_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id       UUID NOT NULL REFERENCES saas_brand_snapshots(id) ON DELETE CASCADE,
  llm               TEXT NOT NULL,
  prompt_text       TEXT NOT NULL,
  response_text     TEXT,
  response_json     JSONB,
  brand_mentioned   BOOLEAN NOT NULL DEFAULT false,
  brand_rank        INT,                    -- 1=premier, NULL=non cité
  competitors_mentioned TEXT[] NOT NULL DEFAULT '{}',
  sources_cited     JSONB,                  -- [{url, domain, title}]
  cost_usd          NUMERIC(8,6),
  latency_ms        INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON saas_snapshot_responses(snapshot_id);

-- Recommandations générées par snapshot (Haiku)
CREATE TYPE saas_reco_priority AS ENUM ('high', 'medium', 'low');

CREATE TABLE saas_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     UUID NOT NULL REFERENCES saas_brand_snapshots(id) ON DELETE CASCADE,
  brand_id        UUID NOT NULL REFERENCES saas_tracked_brands(id) ON DELETE CASCADE,
  priority        saas_reco_priority NOT NULL,
  category        TEXT NOT NULL,            -- 'authority_source' | 'content_gap' | 'competitor_threat' | 'positioning'
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  authority_sources JSONB,                  -- [{domain, why, example_url}]
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON saas_recommendations(brand_id, created_at DESC);

-- Alertes (événements notables détectés snapshot par snapshot)
CREATE TYPE saas_alert_type AS ENUM ('rank_drop', 'rank_gain', 'competitor_overtake', 'new_source', 'citation_loss', 'citation_gain');

CREATE TABLE saas_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES saas_tracked_brands(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES saas_profiles(id) ON DELETE CASCADE,
  snapshot_id     UUID NOT NULL REFERENCES saas_brand_snapshots(id) ON DELETE CASCADE,
  alert_type      saas_alert_type NOT NULL,
  severity        saas_reco_priority NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  metadata        JSONB,
  email_sent_at   TIMESTAMPTZ,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON saas_alerts(user_id, is_read);

-- Quotas / usage tracking (pour enforcement tier)
CREATE TABLE saas_usage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES saas_profiles(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,            -- 'snapshot_run' | 'export' | 'reco_generated'
  metadata        JSONB,
  cost_usd        NUMERIC(8,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON saas_usage_log(user_id, created_at DESC);
```

### 4.2 RLS policies

```sql
-- Toutes les tables saas_* : RLS activé, accès limité au user propriétaire
ALTER TABLE saas_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_tracked_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_brand_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_snapshot_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_usage_log ENABLE ROW LEVEL SECURITY;

-- Pattern : user voit ses propres rows
CREATE POLICY "users own profile" ON saas_profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "users own brands" ON saas_tracked_brands
  FOR ALL USING (auth.uid() = user_id);

-- Snapshots : SELECT only pour le user (writes via service_role uniquement)
CREATE POLICY "users read own snapshots" ON saas_brand_snapshots
  FOR SELECT USING (auth.uid() = user_id);

-- Responses : héritage par snapshot
CREATE POLICY "users read own responses" ON saas_snapshot_responses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM saas_brand_snapshots s
            WHERE s.id = snapshot_id AND s.user_id = auth.uid())
  );

CREATE POLICY "users read own recos" ON saas_recommendations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM saas_brand_snapshots s
            WHERE s.id = snapshot_id AND s.user_id = auth.uid())
  );

CREATE POLICY "users own alerts" ON saas_alerts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users read own subscription" ON saas_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```

### 4.3 Vues SQL utiles

```sql
-- Évolution visibility score d'une marque (pour graph dashboard)
CREATE VIEW v_saas_brand_evolution AS
SELECT
  b.id AS brand_id,
  b.user_id,
  b.name,
  s.created_at::date AS snapshot_date,
  s.visibility_score,
  s.avg_rank,
  s.citation_rate,
  s.share_of_voice
FROM saas_tracked_brands b
JOIN saas_brand_snapshots s ON s.brand_id = b.id
WHERE s.status = 'completed'
ORDER BY s.created_at DESC;

-- Vue résumé pour dashboard (latest snapshot par marque)
CREATE VIEW v_saas_brand_latest AS
SELECT DISTINCT ON (b.id)
  b.*,
  s.id AS latest_snapshot_id,
  s.visibility_score,
  s.avg_rank,
  s.citation_rate,
  s.share_of_voice,
  s.created_at AS last_snapshot_at,
  (SELECT COUNT(*) FROM saas_alerts a WHERE a.brand_id = b.id AND NOT a.is_read) AS unread_alerts,
  (SELECT COUNT(*) FROM saas_recommendations r
   JOIN saas_brand_snapshots ss ON ss.id = r.snapshot_id
   WHERE ss.brand_id = b.id AND NOT r.is_read) AS unread_recos
FROM saas_tracked_brands b
LEFT JOIN saas_brand_snapshots s ON s.brand_id = b.id AND s.status = 'completed'
ORDER BY b.id, s.created_at DESC;
```

---

## 5. Edge Functions Supabase

> Toutes en Deno, dans `supabase/functions/saas_*`.

### 5.1 `saas_run_brand_snapshot`

**Trigger** : appelée par pg_cron (hebdo/mensuel) ou manuellement par user via `/app/brands/:id/refresh`.

**Input** : `{ brand_id: UUID, mode: 'manual'|'scheduled' }`

**Logique** :
1. Charger `saas_tracked_brands` + tier user (depuis `saas_subscriptions`)
2. Vérifier quota (cadence respectée, marque incluse dans tier)
3. Créer row `saas_brand_snapshots` status=`running`
4. Charger 30 prompts (templates dans `saas/prompts/brand_monitoring/*.md`, params : `{brand}`, `{category}`, `{competitors}`)
5. Pour chaque LLM autorisé par tier :
   - Appel OpenRouter en parallèle (Promise.allSettled)
   - Parser response : détection mention marque, rank, concurrents, sources citées
   - Insert `saas_snapshot_responses`
6. Aggréger : `visibility_score`, `avg_rank`, `citation_rate`, `share_of_voice`
7. Update snapshot status=`completed`
8. Trigger `saas_generate_recommendations` (chained) + `saas_detect_alerts`

**Coût attendu** : Solo ~1,30€/run, Free ~0,30€/run.

### 5.2 `saas_generate_recommendations`

**Input** : `{ snapshot_id: UUID }`

**Logique** : prompt Haiku 4.5 avec le snapshot complet (responses + scores) → demande de générer 3-5 recos priorisées.

**Output** : insert dans `saas_recommendations` avec `category`, `priority`, `authority_sources`.

**Prompt** (template à raffiner) :
> Tu es expert en GEO (Generative Engine Optimization). Voici les résultats d'un monitoring LLM pour la marque {brand} dans la catégorie {category}. Score visibilité : {score}. Concurrents principaux dans les réponses LLM : {competitors}. Sources autorité citées : {sources}.
>
> Génère 3-5 recommandations actionnables, format JSON :
> ```json
> [{
>   "priority": "high|medium|low",
>   "category": "authority_source|content_gap|competitor_threat|positioning",
>   "title": "...",
>   "body": "...",
>   "authority_sources": [{"domain": "...", "why": "...", "example_url": "..."}]
> }]
> ```

### 5.3 `saas_detect_alerts`

**Input** : `{ snapshot_id: UUID }`

**Logique** : compare le snapshot N avec snapshot N-1 :
- `rank_drop` si avg_rank baisse de >2 positions
- `rank_gain` si avg_rank monte de >2 positions
- `competitor_overtake` si un concurrent passe devant pour la première fois
- `new_source` si une source autorité jamais citée apparaît
- `citation_rate` baisse de >20pts → `citation_loss`
- `citation_rate` monte de >20pts → `citation_gain` (symétrique, signal positif)

Pour chaque alerte détectée → insert `saas_alerts` + trigger `saas_send_alert_email` (uniquement si tier ≥ Solo).

### 5.4 `saas_stripe_webhook`

**Trigger** : webhook Stripe (`/functions/v1/saas_stripe_webhook`).

**Events à gérer** :
- `customer.subscription.created` / `updated` → upsert `saas_subscriptions`
- `customer.subscription.deleted` → status=`canceled`
- `invoice.payment_failed` → status=`past_due`
- `checkout.session.completed` → activation initial (link customer_id ↔ user_id via metadata)

**Sécurité** : vérifier `stripe-signature` header avec `STRIPE_WEBHOOK_SECRET`.

### 5.5 `saas_send_alert_email`

**Input** : `{ alert_id: UUID }`

**Logique** : charge l'alerte + brand + user → render template HTML (selon `alert_type`) → envoie via Resend → update `email_sent_at`.

### 5.6 `saas_run_all_scheduled`

**Trigger** : pg_cron une fois par heure.

**Logique** :
1. Trouver toutes les `saas_tracked_brands` éligibles à un nouveau snapshot :
   - `cadence='weekly'` ET dernier snapshot > 7 jours
   - `cadence='monthly'` ET dernier snapshot > 30 jours
   - `is_active=true`
   - Tier user actif
2. Pour chacune, invoquer `saas_run_brand_snapshot` (queue avec rate limit 10 simultanés max).

**Cron config** :
```sql
SELECT cron.schedule(
  'saas-run-scheduled-snapshots',
  '15 * * * *',  -- toutes les heures à xx:15
  $$ SELECT net.http_post(
    url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_run_all_scheduled',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  ); $$
);
```

---

## 6. Frontend Next.js

> Codebase existante : `landing/`. On étend, on ne refait pas.

### 6.1 Routing

| Path | Auth | Description |
|---|---|---|
| `/saas` | Public | Landing dédiée SaaS (pricing, features, demo) |
| `/signup` | Public | Création compte (magic link Supabase) |
| `/login` | Public | Login |
| `/app/dashboard` | User | Dashboard principal (toutes marques user) |
| `/app/brands` | User | Liste + ajout/édition marques |
| `/app/brands/[id]` | User | Détail marque : graphs, snapshots, recos, alertes |
| `/app/brands/[id]/snapshots/[sid]` | User | Détail d'un snapshot (réponses brutes par LLM) |
| `/app/billing` | User | Bouton "Manage subscription" → Stripe Customer Portal |
| `/app/settings` | User | Profil + notifs |
| `/admin/saas` | Admin | Vue d'ensemble subscriptions, MRR, churn (étend `/admin` existant) |

### 6.2 Composants clés

- `<BrandEvolutionChart />` : Recharts line chart, axe X dates, axe Y visibility_score (0-100), source `v_saas_brand_evolution`
- `<SnapshotCard />` : carte résumé d'un snapshot (score, rank, citation_rate, sparkline)
- `<RecommendationList />` : liste des recos triées par priority, click → modal détail avec authority_sources
- `<CompetitorMatrix />` : tableau marques vs LLMs (qui cite qui), uniquement Pro+
- `<TierBadge />` : pill couleur selon `tier`
- `<UpgradePrompt />` : modal contextuel ("Cette feature nécessite Solo")
- `<AlertBanner />` : alertes non lues en haut du dashboard

### 6.3 Stack supplémentaire

- **Supabase JS Client** (déjà installé probablement) — auth + queries directes via RLS
- **Stripe** : `@stripe/stripe-js` côté client + npm `stripe` côté Edge Function
- **Recharts** : graphs (déjà compatible Tailwind)
- **shadcn/ui** : composants (Button, Card, Dialog, Toast)

### 6.4 Conventions UI

- Reprendre la charte `BRAND_GUIDE.md` existante (cohérence avec `geoperf.com`)
- Mode dark optionnel
- Mobile responsive obligatoire (les CMO consultent en mobile)

---

## 7. Flow Stripe

### 7.1 Setup Stripe

**Produits à créer dans dashboard Stripe** :
- `geoperf_solo` — 149€/mois EUR
- `geoperf_pro` — 349€/mois EUR
- `geoperf_agency` — 899€/mois EUR

Tous en **Subscription**, mode **EUR**, **Tax behavior=exclusive**, activer **Stripe Tax** (TVA UE auto).

### 7.2 Flow checkout

1. User free clique "Upgrade vers Solo" sur `/app/billing`
2. Frontend appelle Edge Function `saas_create_checkout_session` qui retourne une `checkout_url`
3. Redirect user vers Stripe Checkout
4. Après paiement, Stripe redirige vers `/app/billing?session_id=...&success=true`
5. Webhook Stripe (`saas_stripe_webhook`) reçoit `checkout.session.completed` → upsert `saas_subscriptions` avec `tier=solo`, `status=active`
6. User refresh → tier mis à jour

### 7.3 Customer Portal

Pour cancel/upgrade/downgrade/factures : utiliser **Stripe Customer Portal** (zéro code à écrire).

Edge Function `saas_create_portal_session` retourne URL portail → frontend redirect.

### 7.4 Secrets requis

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_SOLO=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_AGENCY=price_...
```

À ajouter dans Supabase Secrets (`supabase secrets set`).

---

## 8. Prompts de monitoring (catalogue)

Localisation : `saas/prompts/brand_monitoring/`

**Stratégie** : 30 prompts par marque, catégorisés. Templates avec variables `{brand}`, `{category}`, `{competitors}`.

**Catégories** (10 prompts × 3 catégories) :
1. **Recherche directe** — "Quelles sont les meilleures plateformes de {category} en France ?", "Top 10 {category} 2026", etc.
2. **Recherche use-case** — "Je cherche un {category} pour [use-case spécifique]", "Comment choisir un {category} ?"
3. **Recherche concurrentielle** — "Alternatives à {competitor1}", "Comparaison {competitor1} vs {competitor2}"

Les templates concrets sont à dériver des prompts existants `prompts/phase1/` (un template par LLM, à généraliser).

---

## 9. Plan de phases (sprints)

### Sprint S1 — Foundation (1 semaine)
- [ ] Migration `20260429_saas_phase1_schema.sql` (toutes les tables saas_*)
- [ ] RLS policies
- [ ] Vues SQL `v_saas_brand_evolution`, `v_saas_brand_latest`
- [ ] Setup Stripe (produits + webhook endpoint)
- [ ] Edge Function `saas_stripe_webhook` + tests sandbox

### Sprint S2 — Pipeline data (1 semaine)
- [ ] Edge Function `saas_run_brand_snapshot` (port logique n8n Phase 1 vers Deno)
- [ ] Templates 30 prompts dans `saas/prompts/brand_monitoring/`
- [ ] Edge Function `saas_generate_recommendations`
- [ ] Edge Function `saas_detect_alerts`
- [ ] Cron `saas_run_all_scheduled`
- [ ] Tests E2E sur 1 marque pilote (Axa par exemple)

### Sprint S3 — Frontend user (1.5 semaine)
- [ ] Routes `/signup`, `/login`, `/app/*` avec middleware Supabase Auth
- [ ] `/app/dashboard` (overview multi-marques)
- [ ] `/app/brands` + form ajout marque
- [ ] `/app/brands/[id]` (graphs, snapshots, recos)
- [ ] `/app/billing` + intégration Stripe Customer Portal
- [ ] Composants partagés (`BrandEvolutionChart`, etc.)

### Sprint S4 — Alertes + emails (3 jours)
- [ ] Templates HTML emails (Resend)
- [ ] Edge Function `saas_send_alert_email`
- [ ] Page `/app/alerts` (historique)

### Sprint S5 — Admin + observability (3 jours)
- [ ] Étendre `/admin` avec section SaaS (MRR, ARPU, churn, signups)
- [ ] Dashboards Supabase pour monitoring coûts LLM
- [ ] Logs centralisés Edge Functions

### Sprint S6 — Polish + launch (1 semaine)
- [ ] Landing `/saas` (marketing)
- [ ] Onboarding 1ère marque (wizard 3 étapes)
- [ ] Email welcome + tutorial
- [ ] Tests charge (50 marques en parallèle)
- [ ] Doc utilisateur

**Total estimé** : ~5-6 semaines pour MVP launch.

---

## 10. Conventions techniques héritées

> Reprendre intégralement les conventions de `CLAUDE.md` racine et `docs/CLAUDE-backend.md`. Rappels critiques :

1. **Migrations SQL** : toutes sauvées dans `supabase/migrations/` avant `apply_migration`. Format : `YYYYMMDD_description.sql`.
2. **Pas de credentials hardcoded** : tous secrets via `supabase secrets` ou `.env.local` (jamais commit).
3. **Fichiers >150 lignes** : utiliser bash heredoc (Write tool tronque sur mount Windows).
4. **Pas de push GitHub** sans `npm run build` validé localement.
5. **SQL params Edge Functions** : préférer `jsonb` plutôt qu'array (issue n8n connue, mais bonne hygiène globale).
6. **Coût/run loggé** : chaque Edge Function qui appelle un LLM doit logger `cost_usd` dans `saas_usage_log` ET dans la row du snapshot.
7. **Test mode** : flag global `SAAS_TEST_MODE=true` qui mock les appels LLM (retourne fixtures) — pour éviter de cramer le budget en dev.

---

## 11. Quick-start CC CLI

**Pour démarrer le dev**, dans cet ordre :

1. `cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\saas`
2. Lire ce fichier (`SPEC.md`) **en entier**
3. Lire `../CLAUDE.md` et `../docs/CLAUDE-backend.md` pour les conventions
4. Lire 2-3 migrations existantes dans `../supabase/migrations/` pour le style SQL
5. Lire 1 prompt existant dans `../prompts/phase1/` pour le format
6. Démarrer Sprint S1 :
   - Créer `../supabase/migrations/20260429_saas_phase1_schema.sql` (toutes les tables ci-dessus)
   - Vérifier syntaxe : `supabase db diff` ou équivalent
   - Appliquer en local d'abord, puis `apply_migration` Supabase distant
7. Avant chaque commit : `npm run build` côté `landing/`

**Décisions verrouillées (2026-04-29)** :

- **Modèles OpenRouter** (alignés sur le n8n existant pour comparabilité des datasets) :
  - `openai/gpt-4o`
  - `anthropic/claude-sonnet-4-6`
  - `google/gemini-2.5-pro`
  - `perplexity/sonar-pro`
- **Stripe** : compte Jourdechance SAS existant. Mode **test** d'abord, switch **live** au launch (Sprint S6). Secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` à récupérer depuis le dashboard Stripe et stocker dans Supabase Secrets.
- **Resend / domaines email** :
  - `alerts@geoperf.com` → alertes monitoring (rank_drop, competitor_overtake, etc.)
  - `hello@geoperf.com` → transactionnel (welcome, billing, factures)
  - DNS de geoperf.com déjà setup (cf. `docs/DNS_EMAIL_SETUP.md`), juste à ajouter Resend comme sender + DKIM/SPF.
- **Auth** : email + password en principal, magic link en option. Les deux supportés nativement par Supabase Auth, zéro code custom.

---

## 12. Risques connus / décisions à trancher plus tard

- **Coût LLM imprévu** : si OpenRouter pricing bouge, marges varient. Mitigation : `SAAS_TEST_MODE` + budget cap par user dans `saas_usage_log` (alerte si > X€/mois).
- **RGPD** : les `response_text` peuvent contenir des données indirectement personnelles (citations de personnes). Audit RGPD avant launch payant.
- **Concurrence** : SE Ranking, Surfer SEO, Profound, OtterlyAI font déjà du LLM monitoring. Différentiation = qualité reco + ancrage sectoriel français + lien avec audit consulting.
- **Multi-langues** : prompts FR seulement v1. EN à ajouter Sprint 7+.
- **Marque détection ambiguë** : "BNP" peut citer BNP Paribas mais aussi BNP Real Estate. Ajouter un champ `aliases` dans `saas_tracked_brands` plus tard si nécessaire.

---

## Fin de spec
