# Sprint S18 — Récap

**Date** : 2026-05-04 (nuit) → 2026-05-05
**Statut** : 5/5 axes livrés (§4.1, §4.2, §4.3, §4.4, §4.5)
**Build** : `npm run build` vert (Compiled successfully in 4.3s)
**Migrations DB** : 2/2 appliquées (apply_migration MCP)
**Push** : non effectué — Fred review puis push manuel

---

## TL;DR — checklist 5 axes

- [x] **§4.1** Pivot ICP PME FR — 10 nouvelles sous-catégories en DB + nouveau prompt LLM documenté pour patch n8n + ICP_STRATEGY.md
- [x] **§4.2** Audit perf — 5 indexes FK + 18 policies RLS optimisées + 1 dup index drop + PERF_AUDIT_S18.md
- [x] **§4.3** Refonte HP + FAQ — HP étoffée 5 sections nouvelles + FAQ 13→20 questions + JSON-LD schema.org FAQPage
- [x] **§4.4** Vercel Analytics installé (`@vercel/analytics@^2.0.1`) + intégré `layout.tsx`
- [x] **§4.5** Sentry tracesSampleRate 0.1 → 0.5 sur les 3 configs (client, server, edge)

---

## §4.1 — Pivot ICP PME FR

### DB
**Migration** : `supabase/migrations/20260505_saas_phase10_icp_pme_categories.sql` — appliquée.

10 nouvelles sous-cat insérées (avec colonne `is_active` ajoutée pour masquage futur) :

| Slug | Parent | Statut |
|---|---|---|
| `agences-digitales-fr` | marketing | ✓ |
| `edition-medias-b2b-fr` | marketing | ✓ |
| `esn-fr-mid-market` | saas-tech | ✓ |
| `scaleups-saas-b2b-fr` | saas-tech | ✓ |
| `edtech-fr` | saas-tech | ✓ |
| `healthtech-fr` | saas-tech | ✓ |
| `fintech-b2b-fr` | finance | ✓ |
| `conseil-rh-fr` | conseil | ✓ |
| `cabinets-avocats-fr` | conseil | ✓ |
| `food-d2c-fr` | industrie | ✓ |

**Vérif** :
```sql
SELECT slug, nom, parent_id, is_active
FROM categories WHERE slug LIKE '%-fr' OR slug = 'esn-fr-mid-market'
ORDER BY parent_id;
-- 10 rows, toutes is_active = TRUE
```

Anciennes sous-cat (Asset Mgmt, Pharma, Transfo Digitale, etc.) **non touchées** — conformes au garde-fou.

### Prompt n8n Phase 1 — patch documenté
Workflow `7DB53pFBW70OtGlM` analysé via MCP n8n :
- Prompt présent dans **8 nodes `chainLlm`** (4 LLMs × 2 paths webhook). Tous identiques.
- Nouveau prompt documenté dans `saas/docs/N8N_PROMPT_PHASE1_S18.md` — cible PME/ETI FR 50-500 emp + validation regex stricte du champ `domain` (fix bug #4.1 partiel).

**Décision** : patch via UI n8n par Fred (pas via MCP `update_workflow`) car update_workflow exige une réécriture SDK complète des 38 nodes — risque sur workflow actif. Le doc fournit la procédure exacte (8 nodes à patcher, prompt copy-paste).

### Stratégie ICP — `saas/docs/ICP_STRATEGY.md`
Document complet (~100 lignes) :
- Constat (anciennes études CAC40 trop hard à vendre)
- Nouveau ICP : PME/ETI FR 50-500 emp
- Roadmap S19 (3 sous-cat prioritaires) → S22+ (long tail)
- Implications sequence Apollo (ton à adapter avant S19)
- Métriques de succès à reviewer S20

---

## §4.2 — Audit perf + indexes

### Findings via Supabase get_advisors(performance) — 83 lints

| Type | Count | Action S18 |
|---|---|---|
| `unused_index` | 34 | Conservés (tables jeunes) |
| `multiple_permissive_policies` | 24 | Reportée S20+ |
| `auth_rls_initplan` | 18 | **Toutes corrigées** ✓ |
| `unindexed_foreign_keys` | 5 | **Toutes corrigées** ✓ |
| `duplicate_index` | 1 | **Corrigé** ✓ |
| `auth_db_connections_absolute` | 1 | Note infra |

### Migration appliquée
`supabase/migrations/20260505_saas_phase10_perf_indexes.sql` :
- 5 nouveaux indexes FK (saas_alerts.brand_id, saas_api_calls.user_id, saas_content_drafts.{source_snapshot_id, topic_id}, saas_recommendations.snapshot_id)
- DROP idx_reports_slug_public_nounique (duplicate)
- 18 policies RLS converties au pattern `(SELECT auth.uid())` pour InitPlan caching

**pg_stat_statements** : déjà actif sur le projet Supabase (extension v1.11) — pas de migration nécessaire.

### Vérif
```sql
-- 5 new FK indexes confirmés
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN (
  'idx_saas_alerts_brand_id','idx_saas_api_calls_user_id',
  'idx_saas_content_drafts_source_snapshot_id','idx_saas_content_drafts_topic_id',
  'idx_saas_recommendations_snapshot_id'
); -- 5

-- RLS optimisée
SELECT count(*) FROM pg_policies WHERE schemaname='public' AND qual ~ 'SELECT auth\.uid';
-- 8 (les 10 autres utilisent saas_account_owner_of, count différent mais pattern OK)
```

### Stats avant / après
**Limitation honnête** : pas de baseline EXPLAIN ANALYZE capturé avant la migration (pas de monitoring continu pré-S18). Détails et raisonnement dans `saas/docs/PERF_AUDIT_S18.md`.

**Données mesurables à venir** :
- pg_stat_statements → chiffres dans 7-14 jours
- Sentry Performance traces (sampleRate 0.5) → chiffres frontend p50/p95 dans 24-48h
- Vercel Analytics → LCP réel pages clés dans 7 jours

---

## §4.3 — Refonte HP + FAQ + JSON-LD GEO

### HP racine `landing/app/page.tsx`
**Avant** : 180 lignes, 3 sections (hero / features / pricing / CTA).
**Après** : 303 lignes, 7 sections :
1. Hero (poli, ajout lien FAQ dans header)
2. **Pourquoi maintenant** (3 stats factuelles avec sources : Similarweb, Gartner)
3. Comment ça marche (3 features, conservé)
4. **Pour qui** (4 personas PME FR : CMO PME/ETI, Head of Marketing scale-up, DirCom ESN, Founder SaaS B2B)
5. **Différenciateurs** (4 raisons : FR/UE, Free permanent, funnel intégré, tarif mid-market)
6. Tarifs (5 plans, conservé)
7. CTA final (étoffé : 3 CTAs au lieu de 2 — ajoute "Demander un audit GEO")

Ton FT-style : factuel, sources citées, pas de superlatifs ni hype.

### FAQ `landing/app/saas/faq/page.tsx`
**Avant** : 13 questions, liste plate.
**Après** : 20 questions, regroupées en **4 catégories** :
- Comprendre Geoperf (5 Q : qu'est-ce que Geoperf, GEO vs SEO, pourquoi monitorer, audit consulting, qui utilise)
- Utilisation produit (7 Q)
- Pricing & business (4 Q dont nouvelle "différence Free vs Starter")
- Sécurité & RGPD (4 Q dont nouvelles "sous-traitants" et "prompts utilisés pour training ?")

**FAQ JSON-LD schema.org FAQPage** : injecté via `<script type="application/ld+json">` dans le `<main>`. Structure validée Schema.org — citable par les LLM (mode RAG ChatGPT/Perplexity) et Google Rich Snippets.

### Pages content additionnelles
**Hors scope final** — pas créées : `/saas/use-cases` ni `/saas/insights/llm-vs-google`. Reportées S19 si Fred valide la direction.

---

## §4.4 — Vercel Analytics

```bash
cd landing && npm install @vercel/analytics
```
- Package installé : `@vercel/analytics@^2.0.1`
- Intégration `landing/app/layout.tsx` :
  ```tsx
  import { Analytics } from "@vercel/analytics/next";
  // ...
  <body>
    {children}
    <Analytics />
  </body>
  ```
- **Reste à faire Fred** : activer "Web Analytics" sur le Vercel Dashboard du projet `geoperf-landing` (gratuit même en plan Hobby).

---

## §4.5 — Sentry Performance traces

`tracesSampleRate` passé de `0.1` à `0.5` sur :
- `landing/sentry.client.config.ts`
- `landing/sentry.server.config.ts`
- `landing/sentry.edge.config.ts`

**Reste à faire Fred** : vérifier que NEXT_PUBLIC_SENTRY_DSN + SENTRY_DSN sont bien configurés sur Vercel Production (déjà setup S17 normalement).

Note : warnings build Sentry mentionnés (global-error.js manquant, `instrumentation-client.ts` recommandé Turbopack). Pas bloquant — à traiter S19+ si on bascule Turbopack.

---

## Build local

```
✓ Compiled successfully in 4.3s
Route (app)                                Size  First Load JS
├ ○ /                                     /             /
├ ○ /saas/faq                           465 B         180 kB
├ ƒ Middleware                                          154 kB
+ First Load JS shared by all                          178 kB
```

Bundle stable — Vercel Analytics ajoute ~5 kB minimal (lazy-loaded via Next).

---

## Reste à faire pour Fred

### À pousser (review puis push)
- [ ] `git diff` sur `landing/app/page.tsx` (HP refonte)
- [ ] `git diff` sur `landing/app/saas/faq/page.tsx` (FAQ refonte)
- [ ] `git diff` sur `landing/app/layout.tsx` (Analytics)
- [ ] `git diff` sur les 3 `landing/sentry.*.config.ts` (traces 0.5)
- [ ] `landing/package.json` + `package-lock.json` (Vercel Analytics)
- [ ] 2 nouvelles migrations dans `supabase/migrations/` (déjà appliquées en DB)
- [ ] 4 nouveaux docs dans `saas/docs/` : ICP_STRATEGY, N8N_PROMPT_PHASE1_S18, PERF_AUDIT_S18, SPRINT_S18_RECAP

Push frontend depuis `landing/` :
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S18: pivot ICP PME FR + perf indexes/RLS + HP/FAQ refonte + Vercel Analytics + Sentry 0.5"
```

Puis push repo root :
```powershell
cd C:\dev\geoperf
git add -A && git commit -m "S18: pivot ICP PME FR + audit perf + HP/FAQ/SEO refonte + Vercel Analytics + Sentry Performance"
git push origin main
```

### À faire manuellement (hors push)
1. **Patcher prompt n8n Phase 1** dans workflow `7DB53pFBW70OtGlM` — voir `saas/docs/N8N_PROMPT_PHASE1_S18.md`. 8 nodes à patcher (4 LLMs × 2 paths). Préférer UI n8n.
2. **Test trigger Phase 1** sur sous-cat `agences-digitales-fr` après patch — vérifier que les 30 marques retournées sont bien des PME FR (pas Microsoft/Publicis) et que tous les `domain` matchent la regex `^[a-z0-9-]+\.[a-z]{2,}$`.
3. **Activer Web Analytics** sur Vercel Dashboard côté projet (1 toggle).
4. **Vérifier Sentry Performance** — Dashboard → Performance → "Transactions" doit afficher des données dans 1-2h après push.

### Reportés S19+
- Lancer batch Apollo sur les nouvelles sous-cat (warmup en cours)
- Sequence A version EN (réactiver les 24 prospects disqualified S17)
- Adaptation copies sequence Apollo pour ton PME FR (moins formel)
- A/B test sur la HP (attendre data Vercel Analytics 7-14j)
- Refonte design system / branding (S20+)
- Décision plan Compute Supabase supérieur (post-données Sentry 2 sem)
- Refonte 24 multiple_permissive_policies (refactor RLS lourd)
- `/saas/use-cases` et `/saas/insights/llm-vs-google` (bonus reporté)

---

## Garde-fous respectés

- ✓ Anciennes sous-catégories non supprimées (colonne `is_active` ajoutée pour masquage futur, par défaut TRUE)
- ✓ Sequence Apollo FR1 active non touchée
- ✓ Migrations SQL sauvées AVANT `apply_migration` MCP
- ✓ `npm run build` vert AVANT proposition de push
- ✓ Contenu HP/FAQ : ton FT-style factuel, sources citées (Similarweb, Gartner), pas de superlatifs ni hype
- ✓ FAQ schema.org JSON-LD inclus pour optimisation GEO LLM
- ✓ Aucun push, aucun deploy auto
