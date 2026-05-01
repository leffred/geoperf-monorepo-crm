# Sprint S7 — Feature parité GetMint (refonte pricing + 4 features + UX HP)

> Décisions prises avec Fred (2026-04-30) : on aligne Geoperf sur GetMint en features et on devient un peu moins cher.
> Lis ce fichier en entier + saas/SPEC.md + saas/STATUS.md (s'il existe) avant de commencer.

## Décisions verrouillées

### Pricing nouvelle grille (remplace l'ancien Free/Solo/Pro/Agency)

| Tier | Prix HT/mois | Brands | Prompts/marque | LLMs | Topics | Seats |
|---|---|---|---|---|---|---|
| **Free** | 0€ | 1 | 30 | 1 (GPT-4o) | 1 | 1 |
| **Starter** | 79€ | 1 | 50 | 4 | 3 | 1 |
| **Growth** | 199€ | 1 | 200 | 4 | 9 | 5 |
| **Pro** | 399€ | 3 | 200 | 4 + Mistral + Grok | unlimited | unlimited |
| **Agency** | 799€ | 10 | 300 | tous | unlimited | unlimited |

Cadence pour tous les tiers payants : **hebdomadaire**. Free reste mensuel.

### Features cette semaine (Tier 1)

1. **Topics** — segmenter les prompts par sous-sujet d'une marque
2. **3 vues additionnelles** — Sources Explorer, Brand Visibility by Model, Prompt Visibility Ranking
3. **Multi-seats** — invitation membres dans un compte
4. **Refonte pricing** — 5 tiers + nouveaux Stripe products

Tier 2 (semaine prochaine) : Sentiment, Content Studio, plus de LLMs.

### UX HP (`landing/app/page.tsx`)

- **Suppression de tous les `mailto:`** sur la HP (header + CTA principal)
- **2 CTAs distincts** :
  - Primary : "Suivre ma marque dans les LLM" → `/signup`
  - Secondary : "Recevoir l'étude sectorielle gratuite" → `/signup?source=etude&category=` (pré-rempli)
- Le `mailto:contact@geoperf.com` du header → `<Link href="/contact">contact@geoperf.com</Link>` ou supprime

---

## Changements DB nécessaires

### 1. Refonte tier ENUM

Migration `20260430_saas_phase2_tier_refonte.sql` :

```sql
-- Étape 1 : ajouter les nouveaux tiers à l'ENUM
ALTER TYPE saas_tier ADD VALUE IF NOT EXISTS 'starter';
ALTER TYPE saas_tier ADD VALUE IF NOT EXISTS 'growth';
-- 'solo', 'pro', 'agency' restent (legacy, on migrera les users existants)

-- Étape 2 : migrer les users actuels (test seulement, à vérifier avant prod)
-- Personne en solo/pro/agency en prod actuellement à part Fred.
UPDATE saas_subscriptions SET tier = 'starter' WHERE tier = 'solo';
-- Pro et agency conservent leur nom car ils existent dans la nouvelle grille.
```

Note : on ne peut PAS retirer une value d'un ENUM Postgres (immuable). Les valeurs `solo`/`pro`/`agency` restent en DB mais ne sont plus utilisées en code.

### 2. Table topics

Migration `20260430_saas_phase2_topics.sql` :

```sql
CREATE TABLE public.saas_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  prompts         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- override si besoin custom
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(brand_id, slug)
);

ALTER TABLE public.saas_brand_snapshots
  ADD COLUMN topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

ALTER TABLE public.saas_alerts
  ADD COLUMN topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

ALTER TABLE public.saas_recommendations
  ADD COLUMN topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

CREATE INDEX idx_saas_topics_brand ON public.saas_topics(brand_id);
CREATE INDEX idx_saas_brand_snapshots_topic ON public.saas_brand_snapshots(topic_id, created_at DESC);
```

**Concept** : chaque snapshot run est associé à 1 topic (ou NULL = "Default Topic"). Le code de `saas_run_brand_snapshot` est étendu pour accepter `{ brand_id, topic_id?, mode }`. Si topic_id donné, utilise les prompts de ce topic ; sinon utilise les prompts par défaut.

Pour le tier-gating : nb de topics autorisés par tier (3 Starter, 9 Growth, unlimited Pro+).

### 3. Multi-seats

Migration `20260430_saas_phase2_seats.sql` :

```sql
-- L'owner du compte = saas_subscriptions.user_id
-- Les membres invités vivent dans saas_account_members
CREATE TYPE saas_member_role AS ENUM ('owner', 'admin', 'viewer');

CREATE TABLE public.saas_account_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  member_user_id  UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  role            saas_member_role NOT NULL DEFAULT 'viewer',
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE(account_owner_id, member_user_id)
);

CREATE INDEX idx_saas_account_members_owner ON public.saas_account_members(account_owner_id);
CREATE INDEX idx_saas_account_members_member ON public.saas_account_members(member_user_id);

-- Invitations en attente (avant que l'invité ait un compte)
CREATE TABLE public.saas_account_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  invitee_email   TEXT NOT NULL,
  role            saas_member_role NOT NULL DEFAULT 'viewer',
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE(account_owner_id, invitee_email)
);
```

**Logique** :
- L'owner (qui paye) crée des invitations (`/app/team/invite`)
- L'invité reçoit un email avec lien `geoperf.com/auth/accept?token=...`
- S'il a déjà un compte, on lie ; sinon il signup d'abord puis le accept route lie automatiquement
- Les helpers `loadSaasContext()` doivent être étendus pour résoudre l'`account_owner_id` (si user est membre, il consomme le tier de l'owner)

### 4. Lib : étendre saas-auth.ts

Le helper `loadSaasContext()` doit retourner :
- `user` (toujours)
- `account_owner_id` (= user.id si owner, sinon l'id du compte qu'il rejoint)
- `effective_tier` (tier du account_owner)
- `role` (owner|admin|viewer)
- `limits` (TIER_LIMITS du effective_tier)

`TIER_LIMITS` à mettre à jour avec les 5 tiers + nb seats max.

---

## Changements code TS

### saas_run_brand_snapshot

- Accepter `topic_id` dans le body (optionnel, défaut = Default Topic)
- Si topic donné, charger les prompts depuis `saas_topics.prompts` (sinon utiliser prompts.json)
- Insérer le snapshot avec `topic_id`
- Logique de gating LLMs par tier mise à jour (Pro = +Mistral+Grok, Agency = tous)

### Frontend : routes et pages à créer/modifier

| Route | Action | Note |
|---|---|---|
| `/app/brands/[id]/topics` | NEW | Liste topics + bouton "+ Topic" |
| `/app/brands/[id]/topics/new` | NEW | Form (name, prompts custom optionnels) |
| `/app/brands/[id]/topics/[topicId]` | NEW | Vue topic (snapshots, recos, alerts par topic) |
| `/app/brands/[id]` | MODIFY | Ajouter sélecteur de Topic en haut |
| `/app/brands/[id]/snapshots/[sid]` | MODIFY | Ajouter affichage du topic_id |
| `/app/brands/[id]/sources` | NEW | Sources Explorer (top 50 domains cited, par LLM, par topic) |
| `/app/brands/[id]/by-model` | NEW | Brand Visibility by Model (radar chart 4 LLMs ou bar chart) |
| `/app/brands/[id]/by-prompt` | NEW | Prompt Visibility Ranking (table prompts triés par citation rate) |
| `/app/team` | NEW | Liste seats + invitations en cours |
| `/app/team/invite` | NEW | Form pour inviter un membre |
| `/auth/accept` | NEW | Route handler qui consomme le token invitation |
| `/app/billing` | MODIFY | Refonte UI avec 5 tiers (Free/Starter/Growth/Pro/Agency) |
| `/saas` | MODIFY | Refonte pricing tableau avec 5 tiers |
| `/saas/faq` | MODIFY | Update si nécessaire (questions sur seats, topics) |
| `/app/dashboard` | MODIFY | Mention si user est membre vs owner |

### Composants nouveaux à créer

- `<TopicSelector />` — dropdown topic dans la page brand
- `<SourcesExplorer />` — table avec filtres par LLM, par period
- `<VisibilityByModelChart />` — radar / bar chart 4 LLMs
- `<PromptRankingTable />` — table triée par metric
- `<TeamMembersList />` — liste members + roles
- `<InviteMemberForm />` — form invitation avec rôle

### HP refonte (`landing/app/page.tsx`)

Structure suggérée :

```
HEADER (logo + nav simple : Tarifs, Connexion, [contact mail → Link contact page])

HERO
  Eyebrow : MONITORING LLM
  H1 : Surveillez votre visibilité dans ChatGPT, Claude, Gemini, Perplexity
  Sous-titre : court
  CTA primary : "Suivre ma marque" → /signup
  CTA secondary : "Recevoir l'étude sectorielle" → /signup?source=etude

SECTION "Comment ça marche" (3 colonnes)
  1. Suivez votre marque
  2. Comparez aux concurrents
  3. Améliorez votre référencement IA

SECTION Pricing (extrait — lien vers /saas pour le full)

SECTION testimonial (vide pour l'instant)

FOOTER (existant)
```

Aucun mailto. Le formulaire de demande d'étude n'existe plus — l'étude devient un bonus du onboarding free tier.

### /signup pré-rempli depuis /saas?source=etude

Si query param `source=etude` est présent, afficher un message d'accueil :

> "Crée ton compte gratuit. Une fois connecté, tu recevras automatiquement l'étude sectorielle correspondant à ton secteur."

Et stocker `source=etude` + `category` (si présent) dans `auth.users.raw_user_meta_data` au signup pour que le welcome email l'utilise (TODO : ajout du download étude au welcome).

---

## Stripe — Recréation des products

Les products actuels (`prod_UQOSNtHyqdkNkJ` solo, `prod_UQOSydTTcMJXBB` pro, `prod_UQORsYXtgheXQR` agency) sont à **archiver** (pas supprimer) puis recréer en 5 nouveaux products :

```
geoperf_starter  — 79€/mois EUR
geoperf_growth   — 199€/mois EUR
geoperf_pro      — 399€/mois EUR
geoperf_agency   — 799€/mois EUR
```

(geoperf_free n'a pas de product Stripe, juste un tier en DB.)

Côté code :
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY` à mettre dans Supabase Secrets
- `saas_create_checkout_session` : étendre `TIER_TO_PRICE` map avec les 4 tiers payants
- `saas_stripe_webhook` : `priceIdToTier()` map à jour

À faire par Fred (Stripe dashboard, ~10 min) :
1. Archive les 3 anciens products
2. Crée les 4 nouveaux avec les nouveaux prix
3. Note les 4 nouveaux `price_id`
4. Update les 3 secrets Stripe (rename + nouveaux IDs)

---

## Plan de phases (ordre suggéré)

### Phase A — Pricing + Topics + 3 vues (Tier 1, focus DB+UI)

Jour 1 :
- [ ] Migrations : tier ENUM, topics, topic_id sur snapshots/alerts/recos
- [ ] TIER_LIMITS update + helpers étendus
- [ ] Stripe products recréation (Fred manuel + code update)
- [ ] /app/billing refonte 5 tiers
- [ ] /saas refonte pricing

Jour 2 :
- [ ] saas_run_brand_snapshot accepte topic_id, charge prompts depuis saas_topics si fourni
- [ ] /app/brands/[id]/topics + new + detail
- [ ] TopicSelector dans /app/brands/[id]
- [ ] Adapter sendTestEmail pour topic optionnel

Jour 3 :
- [ ] Sources Explorer
- [ ] Brand Visibility by Model
- [ ] Prompt Visibility Ranking
- [ ] Tests E2E sur 1 brand

### Phase B — Multi-seats + UX HP

Jour 4 :
- [ ] Migration multi-seats + invitations
- [ ] /app/team + /app/team/invite
- [ ] /auth/accept route handler
- [ ] Email d'invitation (Edge Function `saas_send_invitation_email`)
- [ ] Helpers loadSaasContext + RLS adaptées (membre voit les brands de l'owner)

Jour 5 :
- [ ] HP refonte avec 2 CTAs
- [ ] /signup avec source=etude param + message d'accueil
- [ ] Suppression tous les mailto: (11 fichiers)
- [ ] Page /contact (déjà existe ? sinon créer)
- [ ] Tests E2E full

---

## Conventions héritées

- Bash heredoc pour fichiers >150 lignes (mount Windows truncation)
- Migrations sauvées dans supabase/migrations/ avant apply_migration
- Préfère composants existants components/ui sur shadcn
- SVG inline sur Recharts
- Trigger DB-side sur EdgeRuntime.waitUntil
- Pas de push GitHub sans validation Fred
- npm run build avant tout commit
- Cost loggé pour chaque appel LLM dans saas_usage_log

---

## Reporting au matin

Crée `saas/docs/SPRINT_S7_RECAP.md` avec :
- ✅ Features livrées (path → 1 ligne)
- ⚠️ Skippées (raison)
- 🐛 Bugs trouvés + fix appliqué
- 📊 Stats : fichiers créés/modifiés, migrations, lignes
- ▶️ Prochaines étapes Fred (deploy commands, tests E2E)
