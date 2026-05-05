# Audit perf S18 — Geoperf SaaS

**Date** : 2026-05-04
**Source** : Supabase MCP `get_advisors(performance)` + lecture du code Next.js
**Scope** : DB Postgres (RLS, indexes) — pas de profilage frontend dans cet audit (Sentry Performance + Vercel Analytics installés en parallèle pour S19+)

---

## TL;DR

- **5 indexes FK** ajoutés sur tables SaaS chaudes — réduit le coût des JOINs et des CASCADE DELETE.
- **18 policies RLS optimisées** — `auth.uid()` wrappée en `(SELECT auth.uid())` pour InitPlan caching Postgres. Gain attendu **5-30 %** sur les SELECT massifs (snapshots, alerts, recommendations).
- **1 index dupliqué** (`idx_reports_slug_public_nounique`) supprimé.
- `pg_stat_statements` était déjà actif (extension Supabase de base).
- **Reste** : 24 alertes `multiple_permissive_policies` (refonte design RLS, hors scope) + 34 `unused_index` conservés (tables jeunes, montée en data attendue).

---

## 1. Audit Supabase Advisor — état initial

83 lints (43 WARN + 40 INFO). Décomposition :

| Catégorie | Count | Action S18 |
|---|---|---|
| `unused_index` | 34 | Conservés (tables en montée) |
| `multiple_permissive_policies` | 24 | Reportée S20+ (refonte RLS) |
| `auth_rls_initplan` | 18 | **Toutes corrigées** ✓ |
| `unindexed_foreign_keys` | 5 | **Toutes corrigées** ✓ |
| `duplicate_index` | 1 | **Corrigé** ✓ |
| `auth_db_connections_absolute` | 1 | Note infra (pas DB) |

---

## 2. Indexes FK ajoutés

| Index | Table | Colonne | Justification |
|---|---|---|---|
| `idx_saas_alerts_brand_id` | saas_alerts | `brand_id` | Lookups par marque (alertes du dashboard) |
| `idx_saas_api_calls_user_id` | saas_api_calls | `user_id` | Métriques d'usage / quota |
| `idx_saas_content_drafts_source_snapshot_id` | saas_content_drafts | `source_snapshot_id` | JOIN dashboards drafts |
| `idx_saas_content_drafts_topic_id` | saas_content_drafts | `topic_id` | Filtre par topic |
| `idx_saas_recommendations_snapshot_id` | saas_recommendations | `snapshot_id` | JOIN recos par snapshot (dashboard `/app/brands/[id]`) |

**Gain attendu** : sur les pages `/app/dashboard` et `/app/brands/[id]`, les requêtes qui joignaient ces tables sans index passent de scan séquentiel à index lookup. Bénéfice marginal aujourd'hui (peu de data) mais critique à mesure que les snapshots s'accumulent (1 snapshot/semaine × N users × 4 LLM × 30 prompts).

Migration : `20260505_saas_phase10_perf_indexes.sql` — appliquée 2026-05-04.

---

## 3. Optimisation RLS InitPlan (18 policies)

### Pattern Supabase recommandé

```sql
-- AVANT (re-évalue auth.uid() à chaque ligne)
USING (user_id = auth.uid())

-- APRES (Postgres planner cache la valeur — InitPlan)
USING (user_id = (SELECT auth.uid()))
```

Source : https://supabase.com/docs/guides/database/postgres/row-level-security#use-security-definer-functions

### Tables / policies optimisées

| Table | Policy | Pattern appliqué |
|---|---|---|
| `saas_profiles` | users own profile | `(SELECT auth.uid())` |
| `saas_tracked_brands` | users own brands | `(SELECT public.saas_account_owner_of(auth.uid()))` |
| `saas_brand_snapshots` | users read own snapshots | idem |
| `saas_alerts` | users own alerts | idem |
| `saas_subscriptions` | users read own subscription | idem |
| `saas_usage_log` | users read own usage | idem |
| `saas_snapshot_responses` | users read own responses | EXISTS + (SELECT…) |
| `saas_recommendations` | users read own recos | EXISTS + (SELECT…) |
| `saas_topics` | members read account topics | EXISTS + (SELECT…) |
| `saas_topics` | owners write account topics | EXISTS + (SELECT…) |
| `saas_account_members` | members read team | (SELECT…) ×2 |
| `saas_account_members` | owners manage team | (SELECT auth.uid()) |
| `saas_account_invitations` | owners manage invitations | (SELECT auth.uid()) |
| `saas_content_drafts` | members read account drafts | (SELECT…) |
| `saas_content_drafts` | owners write drafts | (SELECT auth.uid()) |
| `saas_integrations` | owners manage integrations | (SELECT auth.uid()) |
| `saas_integrations` | members read account integrations | (SELECT…) |
| `saas_api_keys` | owners manage api keys | (SELECT auth.uid()) |

**Vérification post-migration** :
```sql
SELECT COUNT(*) FROM pg_policies
WHERE schemaname='public' AND qual ~ 'SELECT auth\.uid';
-- 8 (les autres utilisent saas_account_owner_of, count différent)
```
Toutes les 18 policies sont passées au pattern `( SELECT … )`.

---

## 4. Index dupliqué supprimé

`idx_reports_slug` et `idx_reports_slug_public_nounique` étaient strictement identiques. Drop de la version `_nounique` (l'autre porte la contrainte UNIQUE déjà active).

---

## 5. Pages frontend — audit queries (lecture du code)

> **Méthodo** : pas de profilage live (Sentry Performance vient d'être activé ce soir, données dans 24h). Audit basé sur la lecture du code des pages chaudes.

### `/app/dashboard` (`landing/app/app/dashboard/page.tsx`)
- 3 queries Supabase : latest brands (`saas_tracked_brands`), récentes alertes (`saas_alerts`), évolution score (`saas_brand_snapshots`).
- ✓ Déjà parallèles (`Promise.all` ou équivalent).
- ✓ Bénéficient des nouveaux indexes FK + RLS optimisée.

### `/app/brands/[id]` (`landing/app/app/brands/[id]/page.tsx`)
- 6+ queries (Overview S14) : snapshots, responses, recommendations, alerts, topics, competitors.
- À vérifier S19 : sont-elles toutes en `Promise.all` ? Possible gain si certaines sont sequencées.
- Le JOIN snapshots → recommendations bénéficie maintenant de `idx_saas_recommendations_snapshot_id`.

### `/login` post-redirect (`landing/middleware.ts` + Supabase Auth)
- Latence dominée par le round-trip Supabase Auth API (cold-start sur compute Micro $10).
- Pas de fix DB possible côté Geoperf — investigation Compute Add-on plan supérieur (décision business Fred après 2 semaines de chiffres Sentry).

### `/app/billing` (`landing/app/app/billing/page.tsx`)
- 1 query subscription + 1 query usage_log. Both bénéficient maintenant de RLS optimisée.

---

## 6. Sujets reportés S20+

### Multiple permissive policies (24 alertes)
4 tables (`saas_account_members`, `saas_content_drafts`, `saas_integrations`, `saas_topics`) ont 2 policies SELECT actives en parallèle (membre + owner). Postgres exécute les deux et combine OR — chaque ligne paye le coût des 2.

**Fix possible** : fusionner en 1 policy unique avec `(condition_owner OR condition_member)`. Refonte design RLS qui demande tests d'isolation utilisateurs — non prioritaire S18.

### Unused indexes (34)
La plupart sont sur des tables peu peuplées (`sequences`, `prospect_events`, `reports`). À ne pas drop tant que les volumes restent faibles : ces indexes deviendront utiles à mesure que les outreach scale.

À **ré-examiner S22+** quand les volumes auront 6 mois de recul.

### Auth DB connections absolute (config, hors DDL)
Alerte Supabase sur le pool de connexions auth. À regarder si on voit des erreurs `connection refused` dans Sentry. Pas urgent.

---

## 7. Stats avant / après — limites

**Limite assumée** : pas de baseline `EXPLAIN ANALYZE` capturé avant la migration (pas de monitoring continu pré-S18, et les changements RLS sont difficiles à benchmarker à froid sur un projet single-tenant).

**Après S18** :
- pg_stat_statements actif → on aura des chiffres dans 7-14 jours.
- Sentry Performance traces actives (sampleRate 0.5) → on aura des chiffres frontend p50/p95 dans 24-48h.
- Vercel Analytics → on aura LCP réel sur les 3 pages clés dans 7 jours.

**Décision plan supérieur Compute** : à réviser fin de mois quand les chiffres Sentry auront 2 semaines de recul. Si le p95 login reste > 2s, considérer l'upgrade $10 → $25 Small.
