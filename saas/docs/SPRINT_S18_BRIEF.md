# Sprint S18 — Brief : Pivot ICP PME + Perf + HP/FAQ

**Date brief** : 2026-05-04 (soir, post-S17)
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-04)
**Effort estimé** : 1 nuit Claude Code dense (8-10h focus dev)
**Pré-requis** : S17 mergé et déployé (acquisition launch + UI pricing). Warmup Apollo en cours.

---

## 1. Pourquoi ce sprint

3 douleurs identifiées par Fred après les tests E2E S17 :

1. **Catalogue mal aligné avec l'ICP commercial** : les études actuelles (Asset Management, Transformation Digitale, Pharma) génèrent des prospects type CMO Microsoft/BlackRock/Accenture. Impossible à vendre rapidement à ces giants. **Décision Fred** : pivot vers **option B** — changer les sous-catégories pour cibler des marques PME-friendly (agences digitales FR, ESN, scale-ups SaaS B2B FR, etc.).
2. **Perçu lag sur l'app** : login, lancement snapshot, navigation dashboard/settings — tout semble lent. Pas de chiffres pour l'instant. Cause possible : DB micro Supabase ($10 add-on Compute) + queries non optimisées.
3. **HP pauvre en contenu** : un visiteur arrive sur `/` et `/saas` et n'a pas assez d'infos pour comprendre la valeur. Manque de FAQ, témoignages, sections de blabla orienté SEO + GEO LLM (être citable par ChatGPT/Claude).

**Ce sprint = 3 axes parallèles**. Si scope dépasse, prioriser §4.1 (ICP — c'est l'urgent commercial) > §4.3 (HP/FAQ) > §4.2 (perf).

---

## 2. Périmètre

### In scope

1. **§4.1** Pivot ICP : nouvelles sous-catégories PME FR + modif prompt Phase 1 LLM
2. **§4.2** Audit perf + fixes quick wins (indexes DB, queries parallèles, cache Next.js, bundle size)
3. **§4.3** Refonte HP + FAQ étoffée + sections SEO/GEO LLM (option B : CC écrit le contenu)
4. **§4.4** Vercel Analytics installé (`@vercel/analytics`)
5. **§4.5** Sentry Performance traces (config tracesSampleRate)

### Out of scope (S19+)

- ❌ Lancer effectivement le batch Apollo sur les nouvelles sous-cat (warmup mailbox encore en cours, 5-10j)
- ❌ Refonte complète du design system / branding
- ❌ Migration Supabase plan supérieur (décision business à prendre par Fred après les chiffres Sentry/Vercel Analytics)
- ❌ Bug Phase 1 LLM hallucine domains (#4.1 BUGS_AND_FEEDBACK) — fix au prompt seul, pas validation full-stack
- ❌ Backfill Asset Management / Transformation Digitale prospects — les anciennes études restent archivées, pas effacées
- ❌ A/B test sur la HP

---

## 3. État courant à connaître

### 3.1 Tables DB pertinentes
- `categories` : 34 sous-cat dont seules 5 ont un report ready (Asset Mgmt ×2, CRM, Aéro, Transfo Digitale)
- `reports` : 5 reports ready, 60+ companies
- `prospects` : 76+ rows total, dont ~24 disqualified S17 (anglophones)
- `saas_*` : pipeline SaaS S6-S17

### 3.2 Workflow n8n Phase 1 extraction
- Workflow `7DB53pFBW70OtGlM`, prompt LLM dans le node JS "Build prompt LLM"
- Génère un palmarès de 30 marques par sous-cat (top_n configurable)
- Bug connu (#4.1) : LLM hallucine parfois "description" au lieu de "domain"
- Pour les giants type Microsoft/Accenture : pas idéal pour vente PME

### 3.3 Stack frontend
- Next.js 15.5 + Tailwind 3.4 + Vercel
- Sentry SDK installé en S17 (pas encore Performance Traces actives)
- Pas de Vercel Analytics encore
- Page `/saas` : déjà bien structurée (S17), mais peut être étoffée
- Page `/` (HP racine) : `landing/app/page.tsx`, plus light

### 3.4 Stack DB / API
- Supabase Pro $25 + Compute Add-on Micro $10 ≈ $35/mois total
- pg_stat_statements probablement pas activé
- Pas de monitoring perf en place

---

## 4. Livrables

### 4.1 Pivot ICP — Nouvelles sous-catégories PME FR

#### 4.1.a Définir 8-12 nouvelles sous-catégories ICP-friendly

Cibles : entreprises FR de **50-500 employés** (PME/ETI), B2B principalement, qui :
- Ont un budget marketing actif (CMO ou Head of Marketing payé)
- Sont susceptibles de vouloir monitorer leur image dans les LLM (compétitivité commerciale)
- Sont dans des secteurs où Geoperf a du sens

**Liste candidate à valider/affiner par CC** :

| # | Sous-catégorie | Slug | Rationale ICP |
|---|---|---|---|
| 1 | Agences digitales FR | `agences-digitales-fr` | Marketing-natif, comprennent immédiatement le sujet GEO |
| 2 | ESN / SSII FR mid-market | `esn-fr-mid-market` | B2B tech, cycle achat court, CMO accessibles |
| 3 | Scale-ups SaaS B2B FR | `scaleups-saas-b2b-fr` | Tech-natifs, sensibles à l'autorité LLM, budget croissant |
| 4 | Cabinets conseil RH FR | `conseil-rh-fr` | Concurrence forte FR, marketing-driven |
| 5 | Edtech FR | `edtech-fr` | Marché FR PME, beaucoup de concurrents |
| 6 | Healthtech FR | `healthtech-fr` | B2B + B2B2C, marketing crucial |
| 7 | Fintech B2B FR | `fintech-b2b-fr` | Mid-market, segmentation CMO claire |
| 8 | Cabinet d'avocats d'affaires FR | `cabinets-avocats-fr` | Budget marketing (RP+SEO), notion de réputation forte |
| 9 | Marques food D2C FR | `food-d2c-fr` | E-commerce mid-market, marketing-driven |
| 10 | Édition / médias B2B FR | `edition-medias-b2b-fr` | Naturellement intéressés par les LLM |

CC peut affiner cette liste, ajouter/retirer en fonction de l'intuition produit.

#### 4.1.b Migration DB : insérer ces nouvelles catégories

```sql
-- À sauvegarder dans supabase/migrations/20260505_saas_phase10_icp_pme_categories.sql
INSERT INTO categories (slug, nom, parent_id, top_n, is_active) VALUES
  ('agences-digitales-fr', 'Agences digitales FR', <parent_marketing_id>, 30, true),
  ('esn-fr-mid-market', 'ESN/SSII FR mid-market', <parent_tech_id>, 30, true),
  ...
ON CONFLICT (slug) DO NOTHING;
```

CC doit identifier les `parent_id` des catégories parent existantes (probablement Marketing, Tech, Conseil) ou créer les parents si manquants.

#### 4.1.c Modifier le prompt Phase 1 pour cibler PME FR

Workflow `7DB53pFBW70OtGlM`, node "Build prompt LLM" (à vérifier le nom exact via MCP n8n) :

**Avant** (probablement) :
```
Tu es un analyste sectoriel. Liste les 30 marques leaders dans la sous-catégorie {category_name}.
```

**Après** :
```
Tu es un analyste sectoriel français. Liste 30 marques **ETI/PME françaises** (50-500 employés)
dans la sous-catégorie {category_name}. Critères :
- Société basée en France (siège FR)
- Effectif estimé entre 50 et 500 employés
- B2B principalement
- Visible dans le marché français (pas seulement présence locale d'un groupe étranger)
- Privilégier les acteurs en croissance / scale-ups français
- EXCLURE explicitement les CAC40, multinationales, GAFAM, Big4 conseil

Pour chaque marque, retourne EXACTEMENT ce JSON :
{ "rank": <int>, "nom": "<official name>", "domain": "<domain.fr or .com>",
  "country": "France", "description_courte": "<1 sentence>" }

CRITIQUE : le champ "domain" DOIT être un nom de domaine valide (regex: ^[a-z0-9-]+\.[a-z]{2,}$).
Pas de description, pas de slogan, pas de catégorie. Juste le domaine.
```

CC doit :
1. Localiser le node prompt dans le workflow Phase 1 via MCP n8n
2. Extraire le prompt actuel
3. Patcher avec la nouvelle version (renforcer aussi la validation domain — fix bug #4.1 partiel)
4. Save le workflow

#### 4.1.d Documenter la nouvelle stratégie ICP

Créer `saas/docs/ICP_STRATEGY.md` (~2 pages) :
- Constat : ancienne ICP CAC40 trop hard à vendre
- Nouveau ICP : PME/ETI FR 50-500 emp
- 10 sous-catégories cibles avec rationale
- Roadmap : Phase 1 sur 3 sous-cat prioritaires (Agences digitales, ESN, Scale-ups SaaS), suite plus tard
- Implications pour Sequence A : copies à valider/adapter pour ce ton PME (moins formel que pour les CAC40)

### 4.2 Audit perf + quick fixes

#### 4.2.a Activer pg_stat_statements

Migration `20260505_saas_phase10_pg_stat_statements.sql` :
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

#### 4.2.b Audit indexes manquants

Utiliser le MCP Supabase `get_advisors` pour lister les recommandations de Supabase Advisor (indexes manquants, RLS, perf).

Action attendue par CC :
1. Appeler get_advisors(project_id, type='performance')
2. Identifier les top 5 problèmes
3. Créer une migration `20260505_saas_phase10_perf_indexes.sql` qui ajoute les indexes recommandés
4. Mesurer EXPLAIN ANALYZE avant/après pour les 3 queries les plus utilisées

Cibles probables d'indexes :
- `saas_brand_snapshots(brand_id, status, created_at DESC)` — déjà ?
- `saas_snapshot_responses(snapshot_id)` — déjà ?
- `saas_subscriptions(user_id, status)` — partiel ?
- `prospects(report_id, status)` — déjà ?
- `prospect_events(prospect_id, created_at)` — déjà ?

CC vérifie quels existent et lesquels manquent.

#### 4.2.c Audit queries des pages clés

Pages à auditer (via lecture du code + EXPLAIN ANALYZE) :
- `/login` → `app/login/page.tsx` + post-login redirect
- `/app/dashboard` → 3 queries parallèles (latest brands, alerts, evolution)
- `/app/brands/[id]` → 6+ queries dans la page Overview S14
- `/app/billing` → subscription + tier limits

Pour chaque page :
1. Lister les queries (count + temps moyen)
2. Identifier les parallèles ratées (queries sequencées qui pourraient être en `Promise.all`)
3. Identifier les N+1 problems (loop sur des entités avec query par item)

Documenter dans `saas/docs/PERF_AUDIT_S18.md` avec recommandations.

#### 4.2.d Quick wins implémentés

Sur la base de l'audit, appliquer les fixes les plus rentables :
- Indexes manquants
- Promise.all pour les queries parallèles ratées
- `revalidate: N` sur les pages où la data change peu (ex: `/saas` page tarifs)
- `unstable_cache` sur les queries DB lentes lues souvent
- Code splitting si bundle JS trop gros

Cible : **améliorer Largest Contentful Paint (LCP) de 30%+** sur les 3 pages principales.

### 4.3 Refonte HP + FAQ + SEO/GEO LLM

#### 4.3.a Refonte HP racine `/`

Fichier : `landing/app/page.tsx`

Sections à étoffer (CC écrit le contenu — option B) :
1. **Hero** : déjà OK probablement, juste polir
2. **Section "Le problème"** : 3 stats marquantes sur l'invisibilité dans les LLM (ex: "Les LLM sont consultés par 60% des décideurs B2B avant un achat")
3. **Section "Comment ça marche"** : 3 étapes étoffées (étude → audit → SaaS)
4. **Section "Pour qui ?"** : 3-4 personas (CMO PME FR, Head of Marketing scale-up, Directeur Communication ESN, etc.)
5. **Section "Pourquoi Geoperf"** : 4-5 différenciateurs (FR/EU, prix accessibles, plan free permanent, funnel intégré)
6. **CTA finaux** : "Créer mon compte gratuit" + "Voir l'étude sample" + "Demander un audit"

#### 4.3.b FAQ étoffée

Page `/saas/faq` (existe déjà selon S13). Étendre de ~5-10 questions à **15-20 questions** :

Catégories suggérées :
- **Comprendre Geoperf** (5-6 questions) : qu'est-ce que GEO, quelle différence avec SEO classique, etc.
- **Utilisation produit** (5-6 questions) : combien de prompts, quels LLM, fréquence des snapshots, etc.
- **Pricing & business** (3-4 questions) : différence Free/Starter, possibilité d'annuler, factures, etc.
- **Sécurité & RGPD** (2-3 questions) : où sont stockées les data, sous-traitants, certifications, etc.

CC écrit le contenu. Ton : factuel, FT-style, pas de hype.

#### 4.3.c Optimisations GEO LLM (être cité par ChatGPT)

**FAQ schema.org** : ajouter du JSON-LD structuré sur la page `/saas/faq` pour que les LLM puissent extraire des Q/A propres :

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Qu'est-ce que Geoperf ?",
      "acceptedAnswer": { "@type": "Answer", "text": "Geoperf est un SaaS français..." }
    },
    ...
  ]
}
</script>
```

**Sections optimisées GEO** : utiliser des structures parsables par LLM :
- Listes numérotées au lieu de paragraphes denses
- Headings clairs (H2/H3 explicites)
- Phrases auto-suffisantes (le LLM peut citer une phrase sans contexte)

#### 4.3.d Pages content-marketing additionnelles (si scope permet)

- `/saas/use-cases` : 3-4 cas d'usage détaillés (1 page chacun, ou tous sur 1 page)
- `/saas/insights/llm-vs-google` : article SEO de ~1500 mots (ton expert, factuel)

Ces 2 pages sont **bonus** si CC a le temps. Pas critiques.

### 4.4 Vercel Analytics

```bash
cd landing
npm install @vercel/analytics
```

Modifier `landing/app/layout.tsx` :
```tsx
import { Analytics } from "@vercel/analytics/next";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

Note : Fred doit aussi activer "Web Analytics" sur Vercel Dashboard côté projet (gratuit même Hobby).

### 4.5 Sentry Performance traces

Modifier `landing/sentry.client.config.ts` (ou le file équivalent) pour avoir un `tracesSampleRate` raisonnable :

```typescript
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.5,  // 50% des transactions tracées en prod
  // production : éventuellement baisser à 0.2 si quota limit atteint
});
```

Vérifier aussi `sentry.server.config.ts`.

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Dev\GEOPERF\landing
npm install  # pour @vercel/analytics
npm run build
```
Doit passer vert. Bundle size attendu : +5-10kB pour Vercel Analytics (négligeable).

### 5.2 Tests fonctionnels par axe

**§4.1 Pivot ICP** :
1. Migration DB appliquée → vérifier `SELECT slug, nom FROM categories WHERE is_active = true ORDER BY created_at DESC LIMIT 15;` retourne les nouvelles sous-cat
2. Trigger Phase 1 sur `agences-digitales-fr` (sous-cat la plus claire) → vérifier que le report est ready dans 2-3 min et que les 30 marques retournées sont bien des PME FR (pas Microsoft/Accenture)
3. Vérifier que `domain` est valide pour les 30 rows (regex)

**§4.2 Perf** :
4. `pg_stat_statements` activé : `SELECT * FROM pg_stat_statements LIMIT 5;`
5. Indexes appliqués : `\di` + EXPLAIN ANALYZE des 3 queries lentes (avant/après)
6. Audit doc créé : `saas/docs/PERF_AUDIT_S18.md`

**§4.3 HP + FAQ** :
7. Visiter `/` et `/saas/faq` en incognito → contenu visible, structure cohérente
8. Vérifier le JSON-LD FAQ via View Source → bien présent
9. Test mobile responsive (DevTools)

**§4.4 Vercel Analytics** :
10. Après push, ouvrir une page → Vercel Dashboard Analytics affiche un page view dans 1-2 min

**§4.5 Sentry Performance** :
11. Sentry Dashboard → Performance → "Transactions" doit afficher des données dans 1-2h après push

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. Migrations SQL sauvées AVANT `apply_migration` MCP.
2. Fichiers >150 lignes : bash heredoc obligatoire.
3. `npm run build` vert AVANT proposition de push.
4. brand-500 = #2563EB.
5. **Ne PAS supprimer** les anciennes sous-catégories (Asset Mgmt, Pharma, Transfo Digitale, etc.) — juste mettre `is_active = false` si on veut les masquer du UI.
6. **Ne PAS toucher** à la sequence Apollo FR1 active (warmup en cours).
7. Documents content marketing (HP, FAQ, ICP) : ton FT-style, factuel, pas de superlatifs ni hype. CC écrit en autonomie mais Fred re-lira et corrigera.

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Dev\GEOPERF\landing
npm run build
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S18: pivot ICP PME FR (10 nouvelles sous-cat) + audit perf (indexes, queries) + refonte HP/FAQ/SEO/GEO + Vercel Analytics + Sentry Performance"
```

### 7.2 Migrations DB
- `20260505_saas_phase10_icp_pme_categories.sql`
- `20260505_saas_phase10_pg_stat_statements.sql`
- `20260505_saas_phase10_perf_indexes.sql`

Apply via `apply_migration` MCP.

### 7.3 Workflow n8n Phase 1
Patch via MCP n8n `update_workflow` ou via UI. Ne PAS désactiver le workflow.

### 7.4 Push repo root
```powershell
cd C:\Dev\GEOPERF
git add -A
git commit -m "S18: pivot ICP PME FR + audit perf + HP/FAQ/SEO refonte + Vercel Analytics + Sentry Performance"
git push origin main
```

---

## 8. Reporté S19+

| Sujet | Sprint cible | Pourquoi |
|---|---|---|
| Lancer batch Apollo sur les nouvelles sous-cat | S19 | Warmup mailbox encore en cours (5-10j) |
| Sequence A version EN | S19 | Réactiver les 24 prospects disqualified S17 |
| A/B test sur la HP | S19 | Attendre data Vercel Analytics 7-14j d'abord |
| Refonte design system / branding | S20+ | Coût élevé, pas urgent |
| Migration plan Supabase supérieur | Décision business Fred | Attendre data perf S18 d'abord |
| Backfill Asset Management report avec PME FR | S19+ | Reanimer les anciennes études si pertinent |

---

## 9. Livrable de fin de sprint

`saas/docs/SPRINT_S18_RECAP.md` au format S17 :
- TL;DR check-list 5 axes (§4.1 → §4.5)
- Sous-catégories ICP créées + résultats du test Phase 1 sur 1 sous-cat
- Stats perf avant/après (queries time, bundle size, LCP estimé)
- Captures HP / FAQ avant/après
- Reste à faire pour Fred (push, deploy migrations, activation Vercel/Sentry, validation contenu HP)

---

Bon sprint dense ! 🚀
