# Plan d'attaque Sprints S8 → S10

> Objectif : combler le gap perceptif vs GetMint sans courir après leur Publisher Network.
> Décisions stratégiques prises avec Fred (2026-04-30).
> Lis AGENTS_RULES.md à la racine du repo AVANT toute action.

## Contexte stratégique

Geoperf SaaS a livré son **MVP fonctionnel** (S1-S7). Le backend est compétitif, le frontend est en place, mais le produit paraît "léger" face à GetMint à cause de :
- UX/polish moins dense
- 0 features Tier 2 (Sentiment, Content Studio, etc.)
- Charts SVG inline non interactifs
- Pas de Citations Flow / AI Overviews / Slack integration

**On ne cherche pas la parité totale.** On cherche à :
1. Combler le gap perceptif (S8 — UX polish)
2. Ajouter les 2-3 features qui changent la perception (S9 — Sentiment + Content Studio)
3. Différencier sur ce qui compte pour le marché FR (S10 — intégrations + plus de LLMs)

Les différenciateurs Geoperf restent : sectoriel français, audit consulting bundlé, prix -20%, funnel lead-magnet.

---

## SPRINT S8 — Polish UX (1 semaine)

> Objectif : rendre le produit visuellement aussi dense et raffiné que GetMint. Aucune nouvelle data à collecter, on présente mieux la data existante.

### S8.1 — Migrate charts vers Recharts (jour 1)

**Problème** : nos charts sont en SVG inline (BrandEvolutionChart, AdminCharts). Pas de tooltip au hover, pas de zoom, pas d'animation. GetMint a des charts interactifs Recharts/D3.

**Action** :
- `npm install recharts` (ajouter à package.json)
- Refactorer `components/saas/BrandEvolutionChart.tsx` → `<LineChart>` Recharts avec :
  - Tooltip au hover (date + scores des 3 concurrents top)
  - Multi-line (la marque + 3 concurrents les plus visibles)
  - Smooth curves (`type="monotone"`)
  - Légende cliquable pour show/hide une marque
- Refactorer `components/saas/AdminCharts.tsx` (SignupsBarChart + TierDonut) avec Recharts
- Conserver les couleurs navy/amber/cream du design system

**Critères d'acceptation** :
- Tooltip apparaît au hover dans les 3 charts
- Légende interactive
- Build passe (sans warning de bundle size — Recharts est ~50kb gzipped, OK)

### S8.2 — Refonte dashboard density (jour 1-2)

**Problème** : `/app/dashboard` montre 1 chart + 1 grid de marques. GetMint affiche 4 KPI cards + chart évolution + 3 panels Top 10 (SoV / Domains / URLs) en haut + détails en bas.

**Action** :
- Nouveau layout `/app/dashboard` :
  - Row 1 : 4 KPI cards (Visibility moyenne, Citation rate moyen, Marques actives, Snapshots cette semaine)
  - Row 2 : 1 line chart évolution (toutes marques superposées)
  - Row 3 : 3 panels Top 10 SoV / Top 10 Domains / Top 10 URLs (agrégés sur toutes les marques de l'user)
  - Row 4 : Grid des marques (cartes avec mini-chart sparkline)
- Composant `<KPICard />` réutilisable (icon + label + value + delta% vs période précédente)
- Composant `<TopPanel />` réutilisable (titre + liste numérotée 1-10 + bar progress)

**Critères d'acceptation** :
- Dashboard remplit l'écran sans scroll vertical excessif
- KPI cards animent au mount (count-up de 0 à valeur)
- Panels Top 10 ont des barres de progression colorées

### S8.3 — Sidebar hiérarchique + Topics dans nav (jour 2)

**Problème** : nav top plate (Dashboard / Marques / Alertes / Abonnement). GetMint a sidebar gauche avec hiérarchie : Brand → Topic → vue.

**Action** :
- Nouveau component `<AppSidebar />` :
  - Section haut : sélecteur de brand (dropdown) avec score actuel
  - Section TOPICS : liste des topics de la brand sélectionnée
  - Section VIEWS : Visibility / Sources / By Model / By Prompt / Competition
  - Section BRAND HEALTH (S9) : Sentiment / Alignment (vide pour l'instant)
  - Section OPTIMIZATION (S9) : Content Studio (vide pour l'instant)
  - Section SETTINGS : Prompts / Brand Setup
  - Section bas : Other brands (mini-list) + bouton "+ Add Brand"
- Layout `/app/*` updated pour avoir sidebar gauche + main content droit (responsive : drawer en mobile)
- Remplacer la nav top simple par cette sidebar

**Critères d'acceptation** :
- Sidebar apparaît sur toutes les pages `/app/brands/[id]/*`
- Topic sélectionné est highlighted
- Mobile : burger menu qui ouvre la sidebar en drawer
- Performance OK (pas de re-fetch à chaque navigation)

### S8.4 — Empty states + loading skeletons (jour 3)

**Problème** : quand un user débarque sur une page sans data (pas encore de snapshot), il voit "Aucune donnée" en texte plat. GetMint a des illustrations + CTAs.

**Action** :
- Component `<EmptyState />` avec props (icon, title, body, ctaLabel, ctaHref)
- Component `<Skeleton />` pour les loading states (pulses gris)
- Cas à couvrir :
  - `/app/dashboard` sans marque → "Ajoute ta 1ère marque" + CTA
  - `/app/brands/[id]` sans snapshot → "Lance ton 1er snapshot" + CTA
  - `/app/brands/[id]/sources` sans data → skeleton 5 rows + texte "Snapshot en cours, sources disponibles dans 30s"
  - `/app/alerts` sans alerte → "Tout est calme" + lien vers brand detail

**Critères d'acceptation** :
- Aucune page n'affiche "Aucune donnée" en texte sec
- Loading skeletons sur toutes les vues qui font des queries lentes

### S8.5 — Color palette concurrents (jour 3)

**Problème** : on n'a pas de logique pour assigner des couleurs distinctes aux concurrents dans les charts. GetMint en a 7+.

**Action** :
- Helper `assignBrandColor(domain: string)` dans `lib/brand-colors.ts` :
  - Hash du domain → index 0-6 → palette de 7 couleurs (navy, amber, vert, rouge, violet, cyan, rose)
  - Garantit que la même brand a toujours la même couleur cross-page
- Update charts pour utiliser ces couleurs au lieu de couleurs hardcodées
- Component `<BrandPill />` qui affiche le nom + couleur attribuée

**Critères d'acceptation** :
- Cohérence visuelle entre la légende d'un chart et le tableau de competitors plus bas
- AXA est toujours navy, Amundi toujours amber (par exemple)

### S8.6 — Tests + recap (jour 4-5)

- Test E2E manuel sur AXA + Allianz + Qonto (3 brands de test déjà créées)
- Vérifier que tous les charts ont leurs tooltips
- Build vert
- Recap dans `saas/docs/SPRINT_S8_RECAP.md`

---

## SPRINT S9 — Features Tier 2 (1-2 semaines)

> Objectif : ajouter les 3 features qui ferment le gap perçu côté "intelligence" (Sentiment, Alignment, Content Studio). Ajouter Mistral + Grok comme LLMs additionnels.

### S9.1 — Sentiment analysis (jour 1-3)

**Concept** : pour chaque réponse LLM, classifier la perception de la marque comme `positive` / `neutral` / `negative`. Affiché dans un dashboard "Brand Health → Sentiment".

**DB** :

```sql
-- Migration 20260501_saas_phase3_sentiment.sql
ALTER TABLE saas_snapshot_responses
  ADD COLUMN sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed', 'not_mentioned')),
  ADD COLUMN sentiment_score NUMERIC(3,2), -- -1.0 à 1.0
  ADD COLUMN sentiment_summary TEXT;        -- 1-2 phrases résumées du sentiment

ALTER TABLE saas_brand_snapshots
  ADD COLUMN avg_sentiment_score NUMERIC(3,2),
  ADD COLUMN sentiment_distribution JSONB; -- { positive: 12, neutral: 8, negative: 3, mixed: 5, not_mentioned: 2 }
```

**Edge Function** :
- Nouveau `saas_analyze_sentiment` qui prend un `snapshot_id`, charge les `saas_snapshot_responses` où `brand_mentioned=true`, et appelle Haiku 4.5 en 1 batch :

```
Pour chaque réponse, classifie le sentiment envers {brand} :
- positive : la marque est mentionnée favorablement
- neutral : mention factuelle sans jugement
- negative : critique, faiblesses pointées
- mixed : aspects positifs et négatifs

Output JSON : [{response_id, sentiment, score: -1..1, summary}]
```

- Trigger DB : `AFTER UPDATE OF status ON saas_brand_snapshots WHEN NEW.status='completed'` → fire `saas_analyze_sentiment` (en parallèle de generate_recommendations)
- Coût : 1 appel Haiku par snapshot ≈ $0.001 (négligeable)

**Frontend** :
- Nouvelle page `/app/brands/[id]/sentiment` avec :
  - Donut chart distribution sentiment (positive/neutral/negative)
  - Score moyen sur 100 (calcul : avg_sentiment_score * 50 + 50)
  - Évolution sentiment dans le temps (line chart)
  - Top 5 réponses positives + top 5 négatives (avec excerpt)
- Ajout "Sentiment" dans la sidebar S8.3 (section Brand Health)
- KPI card sentiment dans dashboard

**Tier-gating** : Sentiment uniquement Growth+ (pas en Free/Starter).

### S9.2 — Brand Alignment (jour 4-6)

**Concept** : compare la perception LLM de la marque vs la description que le user fournit. "Les LLM disent X, ta marque dit Y, voici le gap."

**DB** :

```sql
ALTER TABLE saas_tracked_brands
  ADD COLUMN brand_description TEXT,         -- "Asset manager spécialisé ESG focus institutionnels"
  ADD COLUMN brand_keywords TEXT[],           -- ["ESG","institutionnels","durable","France"]
  ADD COLUMN brand_value_props TEXT[];        -- ["Performance long-terme","Engagement actionnaires","Reporting transparent"]

ALTER TABLE saas_brand_snapshots
  ADD COLUMN alignment_score NUMERIC(5,2),    -- 0-100, % de keywords trouvés dans les réponses LLM
  ADD COLUMN alignment_gaps JSONB,            -- {"missing_keywords": [...], "missing_value_props": [...], "unexpected_themes": [...]}
  ADD COLUMN alignment_summary TEXT;
```

**Edge Function** :
- Nouveau `saas_compute_alignment` qui :
  - Charge les responses du snapshot
  - Pour chaque keyword/value_prop, count combien de réponses le mentionnent
  - Détecte les "themes inattendus" (mots récurrents dans les réponses qui ne sont PAS dans la description) via Haiku
  - Output : alignment_score 0-100 + gaps + summary

**Frontend** :
- Edition du brand_description / keywords / value_props dans `/app/brands/[id]/setup`
- Page `/app/brands/[id]/alignment` :
  - Score 0-100 avec gauge
  - Liste keywords matched / missed (avec % couverture)
  - Themes inattendus (le LLM parle de quoi qui n'est pas dans ta description)
  - Recommandation "Pour aligner, mentionne X dans ton site/PR"

**Tier-gating** : Pro+ uniquement.

### S9.3 — Content Studio basic (jour 7-10)

**Concept** : génère des "drafts" de contenus optimisés pour gagner en ranking LLM. Pas une CMS, juste un générateur de pitches.

**DB** :

```sql
CREATE TABLE saas_content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES saas_tracked_brands(id) ON DELETE CASCADE,
  user_id UUID REFERENCES saas_profiles(id) ON DELETE CASCADE,
  draft_type TEXT CHECK (draft_type IN ('blog_post','press_release','linkedin_post','tweet')),
  title TEXT,
  body TEXT,
  target_keywords TEXT[],
  target_authority_sources TEXT[],
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','published','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON saas_content_drafts(brand_id);
CREATE INDEX ON saas_content_drafts(user_id);
```

**Edge Function** :
- Nouveau `saas_generate_content_draft` qui prend `{brand_id, draft_type, focus_topic_id?}` :
  - Charge brand info + dernier snapshot
  - Identifie les gaps (où la marque n'est pas citée)
  - Identifie les authority sources qu'elle devrait cibler
  - Appelle Haiku/Sonnet pour générer 3 drafts (par exemple : "blog post de 800 mots sur {topic} qui cible {authority_source}")
  - Insert dans saas_content_drafts

**Frontend** :
- Page `/app/brands/[id]/content` :
  - Bouton "Générer un draft" avec dropdown type (blog/PR/LinkedIn/tweet)
  - Liste drafts existants avec preview
  - Détail draft : title + body + suggested keywords + suggested sources cibles
  - Actions : Edit / Approve / Mark published / Archive
- Coût : 1 appel Sonnet 4.6 par draft ≈ $0.05

**Tier-gating** : Pro+ uniquement (limite 10 drafts/mois en Pro, illimité en Agency).

### S9.4 — Plus de LLMs (jour 11)

**Action** :
- Vérifier sur OpenRouter : `mistralai/mistral-large` et `xai/grok-2`
- Update `LLMS_BY_TIER` dans `saas_run_brand_snapshot/index.ts` :
  - Pro : ajouter `mistralai/mistral-large` + `xai/grok-2` (6 LLMs total)
  - Agency : ajouter aussi `microsoft/copilot-2025` si dispo + `meta/llama-3.3-70b` (8 LLMs)
- Re-test sur 1 brand pour vérifier les coûts réels
- Update les tier descriptions dans UI pricing

### S9.5 — Tests + recap (jour 12)

- Test E2E sentiment + alignment sur AXA
- Test génération de 1 draft Content Studio
- Recap dans `saas/docs/SPRINT_S9_RECAP.md`

---

## SPRINT S10 — Différenciateurs (1-2 semaines)

> Objectif : 4 features qui élargissent le marché adressable (intégrations, API, plus de LLMs, visualisation avancée).

### S10.1 — Citations Flow (Sankey) (jour 1-3)

**Concept** : visualisation type Sankey diagram qui montre comment les citations flow depuis les **prompts** → **LLMs** → **brand mentions** → **sources autorité**.

**Frontend** :
- Page `/app/brands/[id]/citations-flow`
- Component `<CitationsSankey />` utilisant `react-flow` ou `d3-sankey` + Recharts custom
- Data source : agrège `saas_snapshot_responses` du dernier snapshot par topic
- 3-4 colonnes : Prompts catégorie → LLM → brand_mentioned (yes/no) → sources_cited

**Tier-gating** : Pro+ (la visualisation devient complexe, payant tier seulement).

### S10.2 — AI Overviews + Copilot (jour 4-5)

**Concept** : ajouter Google AI Overviews (le mode IA de Google Search) et Microsoft Copilot comme LLMs trackés.

**Action** :
- Vérifier OpenRouter : `google/ai-overviews-2025` et `microsoft/copilot-2025`
- Si dispo via OpenRouter : ajouter dans LLMS_BY_TIER
- Si pas dispo : passer par leur API directe (Google Search API + Bing Copilot API). Plus de boulot, à voir.

### S10.3 — Webhooks Slack/Teams (jour 6-8)

**Concept** : quand une alerte est générée (rank_drop critique par exemple), poster automatiquement dans le channel Slack/Teams du user.

**DB** :

```sql
CREATE TABLE saas_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES saas_profiles(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('slack','teams','discord','webhook_custom')),
  webhook_url TEXT NOT NULL,
  events TEXT[] DEFAULT '{rank_drop_high,citation_loss_high,competitor_overtake_high}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Edge Function** :
- Trigger DB : AFTER INSERT ON saas_alerts, fire `saas_dispatch_integration_webhooks`
- Pour chaque integration active du user qui matche le type d'event, POST sur webhook_url avec body Slack-formatted

**Frontend** :
- Page `/app/integrations` avec form ajout webhook + test send
- Tier-gating : Growth+ pour Slack, Pro+ pour Teams.

### S10.4 — API publique (jour 9-12)

**Concept** : endpoint REST que les users Pro+ peuvent consommer pour intégrer Geoperf à leur stack interne (Looker, Tableau, scripts).

**DB** :

```sql
CREATE TABLE saas_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES saas_profiles(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,                    -- "gp_live_xxxxx" (8 first chars affichés)
  key_hash TEXT NOT NULL,                       -- bcrypt du full key
  name TEXT NOT NULL,                           -- "Looker prod"
  scopes TEXT[] DEFAULT '{read}',               -- 'read' | 'write'
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
```

**Edge Function** :
- Nouveau `saas_api_v1_router` qui dispatch :
  - `GET /v1/brands` → liste brands user
  - `GET /v1/brands/:id/snapshots` → historique snapshots
  - `GET /v1/brands/:id/snapshots/:sid` → détail snapshot
  - `GET /v1/brands/:id/recommendations` → recos
  - `GET /v1/brands/:id/alerts` → alerts
  - `POST /v1/brands/:id/snapshots` → trigger snapshot (write scope)
- Auth via header `Authorization: Bearer gp_live_xxx`
- Rate limit 60 req/min/key (via Redis ou table SQL)

**Frontend** :
- Page `/app/api-keys` : génération clé, révocation, doc
- Page `/saas/api-docs` (publique) : référence OpenAPI

**Tier-gating** : Agency uniquement (API = enterprise feature).

### S10.5 — Publisher Network (si Fred trouve un aggrégateur, jour 12-14)

**Concept** : Fred investigue Cision / Meltwater / Featured.com / autre aggrégateur API qui permet de pitcher des médias. Si trouvé :

**Architecture suggérée** :
- Edge Function `saas_pitch_authority_source` qui prend un draft (depuis Content Studio S9.3) + un domain cible
- Appelle l'API de l'aggrégateur pour soumettre le pitch
- Track le statut (sent/opened/replied/published) dans `saas_content_drafts.status`
- UI dans `/app/brands/[id]/content/[draftId]` : bouton "Pitch to {domain}" avec aperçu du pitch

**Tier-gating** : Agency uniquement (API d'aggrégateur coûte cher, à répercuter).

### S10.6 — Tests + recap (jour 14)

- Test API avec curl
- Test Slack webhook
- Test Sankey rendering sur AXA
- Recap dans `saas/docs/SPRINT_S10_RECAP.md`

---

## Conventions héritées (rappel)

- Bash heredoc pour fichiers >150 lignes (mount Windows truncation)
- Pas de push GitHub ni deploy Edge Functions sans validation Fred
- Migrations via apply_migration MCP, sauvées dans supabase/migrations/
- Cost loggé partout pour les appels LLM
- AGENTS_RULES.md à respecter strict
- Aucun agent ne fait git rm, reset, clean, checkout, push

## Ordre d'exécution recommandé

1. **S8 d'abord** (1 semaine) — c'est ce qui change le plus la perception du produit. Critère de succès : si tu mets Geoperf et GetMint côte à côte, on ne sent plus l'écart UX.
2. **S9 ensuite** (1-2 semaines) — Sentiment + Alignment + Content Studio = les 3 features marketing qui justifient le pricing.
3. **S10 si tu vises agences/enterprise** (1-2 semaines) — Sankey + API + Slack = signaux pro pour les agences. À skiper si tu cibles les marques en direct.

**Total : 3-5 semaines pour parité GetMint perceptive + différenciation FR/sectorielle.**

## Coûts estimés additionnels

| Sprint | Coût LLM additionnel par snapshot Pro | Justification |
|---|---|---|
| S9 Sentiment | +$0.001 (Haiku batch) | 1 call par snapshot |
| S9 Alignment | +$0.005 (Sonnet) | 1 call par snapshot |
| S9 Content Studio | +$0.05 par draft (à la demande) | 1 call par draft, pas par snapshot |
| S9 Mistral + Grok | +$0.4 par snapshot | 60 prompts × 2 LLMs additionnels |
| S10 AI Overviews + Copilot | +$0.4 si via OpenRouter | sinon coût API direct |

**Marge brute Pro** : 399€ - $5/mois snapshot ≈ 99% encore. OK.

## Risques

- **Recharts bundle size** (~50kb gzipped) — peut affecter perf mobile. Mitigation : dynamic import par page.
- **OpenRouter dispo Mistral/Grok** — vérifier les slugs exacts et leur disponibilité avant de prommettre.
- **Coût LLM si users abusent du Content Studio** — limiter à N drafts/mois par tier.
- **API rate limiting** — implémenter dès le début, sinon abus en Pro.

---

> Plan locked le 2026-04-30. Toute modif passe par Fred.
