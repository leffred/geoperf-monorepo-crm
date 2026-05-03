# Sprint S14 — Recap général

**Date** : 2026-05-02
**Branche** : main
**Status build** : OK vert (`npm run build` — 31 pages, /app/brands/[id] = 272 B)
**Scope brief** : Dashboard Overview refonte type GetMint — visibility ranking + Top 10 widgets (SoV, domaines, URLs)

---

## TL;DR

Sprint nuit ciblé, **tous les objectifs livrés** :

| # | Objectif | Status | Path |
|---|---|---|---|
| 4.1 | Migration DB phase 6 + 2 vues + 2 RPC + backfill | OK | `supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql` |
| 4.2.a | Parser rangs concurrents (`findRankInLines` helper, DRY avec brand_rank) | OK | `supabase/functions/saas_run_brand_snapshot/index.ts` |
| 4.2.b | Insert `competitors_with_rank` JSONB | OK | idem |
| 4.2.c | Compteurs `brand_mention_count` / `total_mention_count` dans aggregate + UPDATE | OK | idem |
| 4.3 | Refonte page Overview `/app/brands/[id]` (5 rows) | OK | `landing/app/app/brands/[id]/page.tsx` |
| 4.3 | `CompetitorRankingBars` (visibility + fallback SoV) | OK | `landing/components/saas/CompetitorRankingBars.tsx` |
| 4.3 | `Top10ShareOfVoice` | OK | `landing/components/saas/Top10ShareOfVoice.tsx` |
| 4.3 | `Top10CitedDomains` | OK | `landing/components/saas/Top10CitedDomains.tsx` |
| 4.3 | `Top10CitedUrls` | OK | `landing/components/saas/Top10CitedUrls.tsx` |

**Aucun push, aucun deploy Edge Function, aucune opération git destructive.** 1 migration DB appliquée via apply_migration MCP (autorisée par brief §4.1, fichier SQL sauvé avant).

---

## Section 1 — Migration DB (phase 6)

**Fichier** : `supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql` (204 lignes)

### Schema additif

```sql
-- saas_brand_snapshots (additif)
brand_mention_count INT NOT NULL DEFAULT 0
total_mention_count INT NOT NULL DEFAULT 0

-- saas_snapshot_responses (additif)
competitors_with_rank JSONB  -- format [{"name":"X","rank":1|null}]
+ index GIN partiel WHERE competitors_with_rank IS NOT NULL
```

### 2 nouvelles vues

| Vue | Source | Output |
|---|---|---|
| `v_saas_competitor_share_of_voice` | `competitors_mentioned[]` + brand_mentioned | (snapshot_id, entity_name, is_self, mention_count, share_pct, rank) — fallback historique |
| `v_saas_competitor_visibility` | `competitors_with_rank` JSONB + brand_rank | (snapshot_id, entity_name, is_self, visibility_score, mention_count, avg_rank, rank) — primaire |

La vue `v_saas_competitor_visibility` reproduit la formule `aggregate.visibility_score` : 100 si rank=1, -10 par rang, plancher 10, fallback 50 si cité sans rank, 0 si pas mentionné.

### 2 RPCs (SECURITY DEFINER, GRANT authenticated + service_role)

- `saas_top_cited_domains(p_snapshot_id UUID, p_limit INT) → (domain, citation_count, share_pct)`
- `saas_top_cited_urls(p_snapshot_id UUID, p_limit INT) → (url, domain, citation_count, share_pct)`

Note RLS : SECURITY DEFINER bypass RLS sur l'unnest JSONB. Le filtrage côté client passe par snapshot_id, lui-même protégé par RLS sur saas_brand_snapshots quand utilisé via `getSupabaseServerClient()` avec session user.

### Backfill compteurs (one-shot dans la migration)

```sql
UPDATE saas_brand_snapshots SET brand_mention_count, total_mention_count
FROM (SELECT snapshot_id, SUM(CASE WHEN brand_mentioned THEN 1 ELSE 0 END), ...
      FROM saas_snapshot_responses GROUP BY snapshot_id) sub
WHERE id = sub.snapshot_id AND status = 'completed';
```

Vérification post-apply : 6 snapshots completed, max brand_mention_count=120, max total=240. OK

### Pas de backfill `competitors_with_rank`

Choix volontaire (cf brief §6 reportés) : trop coûteux (re-parse N×M réponses). Les snapshots historiques restent NULL et le frontend bascule sur le fallback SoV avec hint visible. Le 1er snapshot post-deploy aura les rangs concurrents.

---

## Section 2 — Edge Function `saas_run_brand_snapshot`

**Fichier** : `supabase/functions/saas_run_brand_snapshot/index.ts` (4 modifs ciblées, ~30 lignes nettes)

### 2.1 Helper `findRankInLines()` (DRY)

Extraction du regex de détection de rang dans une fonction réutilisable. Signature : `findRankInLines(lines: string[], regexes: RegExp[]) → number | null`. Pattern élargi : `/^\s*(\d+)[.)\-]\s+(.+)$/` (au lieu de `[.)]`) pour matcher aussi les listes en tirets « 1- foo ». Le calcul `brand_rank` réutilise désormais ce helper, plus aucun code dupliqué.

### 2.2 `parseResponse()` enrichi

Pour chaque concurrent matché par word-boundary, on tente `findRankInLines(lines, [competitorRegex])`. Output supplémentaire : `competitors_with_rank: { name, rank | null }[]`. Préservation de `competitors_mentioned` (string[]) pour rétro-compat des vues + sous-pages (by-prompt, by-model, citations-flow, sentiment).

### 2.3 Insert `saas_snapshot_responses`

Une seule ligne ajoutée : `competitors_with_rank: parsed.competitors_with_rank` dans le batch insert (~ligne 406).

### 2.4 `aggregate()` étendu

Retour étendu de 5 → 7 champs : ajout de `brand_mention_count` et `total_mention_count` (déjà calculés en interne, juste exposés). Le `UPDATE saas_brand_snapshots` à la complétion inclut désormais ces 2 colonnes.

### 2.5 Pas de modif workflow n8n

Confirmé : zero touch n8n. La fonction Edge couvre tout le SaaS.

---

## Section 3 — Frontend refonte page Overview

**Fichier principal** : `landing/app/app/brands/[id]/page.tsx` (411 lignes, server component)

**4 nouveaux composants serveur** (tous Tech crisp, tous Free+, tous server-side — 0 chunk client supplémentaire) :
- `landing/components/saas/CompetitorRankingBars.tsx` (134 lignes)
- `landing/components/saas/Top10ShareOfVoice.tsx` (55 lignes)
- `landing/components/saas/Top10CitedDomains.tsx` (51 lignes)
- `landing/components/saas/Top10CitedUrls.tsx` (72 lignes)

### Nouvelle structure (5 rows, du haut vers le bas)

```
Header (brand + topic selector + bouton refresh)
AlertBanner (si alertes unread, déplacé en haut)
ROW 1 (5 cols → 3/2)
├─ Visibility Score panel (col-span 3)
│  ├─ Big number 5xl/6xl brand-500
│  ├─ Sub "Basé sur N réponses · M prompts × K LLMs"
│  ├─ Performance quand cité (relativeVisibility) en hint
│  ├─ MiniStat × 3 (Rang moy, Citation, Share of Voice)
│  └─ CompetitorRankingBars (entries=visibilityEntries, fallback=sovEntries, limit=7)
└─ BrandEvolutionChart (col-span 2)
ROW 2 (3 cols égales sur lg, 2 sur md)
├─ Top10ShareOfVoice (rows=topSov)
├─ Top10CitedDomains (rows=topDomains)
└─ Top10CitedUrls (rows=topUrls)
ROW 3 — drill-down links (Sources, Par LLM, Par prompt, Citations flow, Sentiment, Topics)
ROW 4 — CompetitorMatrix [existant, Pro+ lock]
ROW 5 — Recommandations + Alertes [existants, 2 colonnes]
HISTORIQUE — table inchangée + concurrents suivis
```

### `CompetitorRankingBars` — logique fallback

```ts
hasVisibility = entries?.some(e => !e.is_self)
if (hasVisibility) → mode "visibility" (bars coloriées par score 0-100)
else if (fallback?.length) → mode "share_of_voice" + hint dégradé
else → empty state propre
```

Self toujours forcé dans le top (si exclu, on remplace la dernière entrée). `bg-brand-500` (#2563EB) pour self, `bg-ink/30` pour les autres.

### Conventions Tech crisp respectées

- Card `bg-white rounded-lg border border-ink/[0.08] p-6`
- Eyebrow JetBrains Mono uppercase tracking-eyebrow text-brand-500
- Headers Inter font-medium tracking-tight
- Bars `bg-brand-500` (self/primary) / `bg-ink/30` (autres)
- Padding card `p-6`, gap entre cards `gap-6`

### Données fetchées en parallèle (after latestSnapshot resolved)

`Promise.all([recos, matrixResponses, visibilityEntries (LIMIT 20), sovEntries (LIMIT 20), topDomains RPC, topUrls RPC])` — 6 queries parallélisées. La query principale snapshots inclut désormais aussi `brand_mention_count` et `total_mention_count` (réservés pour usage futur, pas encore affichés).

### Sous-pages drill-down inchangées

`/sources`, `/by-model`, `/by-prompt`, `/citations-flow`, `/sentiment`, `/topics` — pas modifiées. Les liens drill-down sont accessibles via Row 3.

---

## Section 4 — Tests effectués pendant la session

| # | Test | Status |
|---|---|---|
| 1 | Migration apply via MCP | OK `{success: true}` |
| 2 | Backfill compteurs (max brand_mention_count = 120) | OK |
| 3 | Vue v_saas_competitor_share_of_voice (snapshot historique) | OK `Bnp r1 50%, AXA r2 50%` |
| 3b | Vue v_saas_competitor_visibility (snapshot historique sans cwr) | OK self-only `[AXA, score 80]` |
| 4 | RPC saas_top_cited_domains | OK `[example.com 120 50%, test.fr 120 50%]` |
| 5 | RPC saas_top_cited_urls | OK (équivalent, output URLs) |
| - | `npm run build` (landing/) | OK 31 pages, /app/brands/[id] 272 B server-only |

### Tests qui requièrent un nouveau snapshot (à valider par Fred)

| # | Test | Comment |
|---|---|---|
| 6 | Page Overview avec snapshot completed récent | Login `/app/brands/[id]` après deploy |
| 6b | Parser rangs concurrents ≥50% des responses non-null | Lancer un snapshot, puis : `SELECT prompt_text, brand_rank, competitors_with_rank FROM saas_snapshot_responses WHERE snapshot_id = '<new_uuid>' AND brand_mentioned = true LIMIT 5;` Vérifier que ≥50% des responses ont au moins 1 concurrent avec rank non-null. Si <50% : ajuster regex (déjà élargi à `[.)\-]`, peut nécessiter parens « (1) » ou lettres « a) ») |
| 7 | Empty state (marque sans snapshot) | Crée une nouvelle marque, page doit montrer le block "Aucun snapshot encore généré" |
| 8 | Snapshot historique fallback dégradé | Sélectionner un snapshot pré-S14 → CompetitorRankingBars affiche le hint "Données rangs concurrents disponibles à partir du prochain snapshot" |
| 9 | Pro lock conservé | CompetitorMatrix reste lock Pro+ (vérifié inline : `locked={!matrixUnlocked}`) |

---

## Section 5 — Captures de fin attendues (à fournir par Fred)

Après deploy de l'Edge Function et 1 snapshot frais sur ta marque AXA :

1. **Capture Overview top** : Visibility Score 80, ranking concurrents en barres bleues/grises (Brevo-style), evolution chart à droite
2. **Capture Row 2** : 3 cards Top 10 (Share of Voice, Cited Domains, Cited URLs)
3. **Capture mode dégradé** : ouvrir un snapshot pré-S14, ranking en mode SoV avec hint visible
4. **SQL test parser** : output de la query 6b avec ≥50% des responses ayant un competitor rank

---

## Section 6 — Reste à faire pour Fred (deploy)

### 6.1 Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1
```

Vercel auto-redeploy en 1-2 min. Pas de nouvelle env var. Pas de nouvelle dépendance npm. Bundle change négligeable (server components only).

### 6.2 Deploy Edge Function

```bash
npx supabase functions deploy saas_run_brand_snapshot
```

**Critique** : sans ce deploy, les nouveaux snapshots n'auront pas les colonnes `competitors_with_rank` / `brand_mention_count` / `total_mention_count` peuplées. Le frontend tombera systématiquement sur le fallback SoV.

### 6.3 Migration DB

Déjà appliquée pendant la session via `apply_migration` MCP (autorisé par brief §4.1). Fichier SQL sauvé dans `supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql`. Aucune action manuelle requise.

### 6.4 Test E2E

1. Push frontend + deploy Edge Function
2. Login `/app/brands/<axa-uuid>` → cliquer "Lancer un snapshot"
3. Attendre 30-60s (4 LLM × 50 prompts ≈ 200 calls)
4. Refresh page → vérifier que CompetitorRankingBars s'affiche en mode visibility (barres avec scores 0-100, pas % SoV)
5. Run query SQL test 6b ci-dessus pour valider que parser extrait les rangs

Si test 6b retourne <50% de responses avec competitor rank non-null, ouvrir un ticket S15 pour élargir la regex (parens « (1) », lettres « a) », bullets « • »).

---

## Section 7 — Sujets reportés explicitement (cf brief §8)

À traquer dans `FEATURES_VS_GETMINT.md` :

| Sujet | Sprint cible |
|---|---|
| AI Overviews + Copilot LLMs | S15 |
| Cadence quotidienne Pro+ (×7 coûts) | S15 |
| System prompt "Sources :" structuré | S15 |
| Backfill rangs concurrents historiques | S15 (si nouveaux snapshots concluants) |
| Publisher Network EU lite (Common Crawl seed) | S16 |
| Doc API Swagger | S16 |

---

## Section 8 — `git status --short` final

### Côté `C:\Dev\GEOPERF\` (repo backend)

```
 M supabase/functions/saas_run_brand_snapshot/index.ts
?? saas/docs/SPRINT_S14_BRIEF.md
?? saas/docs/SPRINT_S14_RECAP.md
?? supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql
```

### Côté `C:\Dev\GEOPERF\landing\` (repo frontend séparé)

```
 M app/app/brands/[id]/page.tsx
?? components/saas/CompetitorRankingBars.tsx
?? components/saas/Top10CitedDomains.tsx
?? components/saas/Top10CitedUrls.tsx
?? components/saas/Top10ShareOfVoice.tsx
```

### Aucun fichier silencieusement ignoré

- OK Aucun fichier en `D` (deleted) inattendu
- OK Aucun lock file `.git/index.lock`
- OK Tree clean au démarrage du sprint (S13 commit propre)
- OK 0 nouvelle dépendance npm

---

## Stats finales S14

- **2 repos touchés** : root (backend + migration + Edge Function) + landing (frontend)
- **5 nouveaux fichiers** : 1 migration SQL, 4 composants saas
- **2 fichiers modifiés** : Edge Function (~30 lignes nettes), page Overview (refonte)
- **1 migration DB appliquée** (autorisée par brief §4.1)
- **0 deploy Edge Function** (à faire par Fred)
- **0 push** (à faire par Fred)
- **Build vert** OK

---

## Notes méthodologiques

### Palette respectée

`brand-500 = #2563EB` (bleu) confirmé par le brief §6 et le tailwind.config.ts. Toutes les barres self utilisent `bg-brand-500`. Aucune trace de vert dans les nouveaux composants.

### Anti-pattern §6 (Write tool tronque sur Windows mount)

Tentative initiale d'écrire `page.tsx` (411 lignes) via bash heredoc → échec parser bash sur les apostrophes du JSX FR. Bascule sur `Write` tool puis vérification de la fin du fichier (lignes 390-411 lues, MiniStat helper bien présent, fonction fermée). Build vert confirme l'intégrité du fichier. Idem pour ce recap (markdown FR avec apostrophes).

### DRY parser

Le helper `findRankInLines()` factorise la logique de matching de listes ordonnées. Le pattern regex est élargi de `[.)]` à `[.)\-]` pour catch également les listes en tirets, sans casser le parsing brand_rank existant (test couvert : la fixture mockResponse utilise « 1. … » qui matche tous les patterns).

### RLS et sécurité RPC

Les 2 RPCs sont en `SECURITY DEFINER` parce que `jsonb_array_elements` ne joue pas bien avec RLS sur les sous-queries. Mitigation côté Next.js : tous les appels passent par `getServiceClient()` (server-only) avec un `snapshot_id` qui a déjà été validé par RLS sur le SELECT initial de `saas_brand_snapshots`. Le service_role permet de bypass mais l'authz est faite en amont par `loadSaasContext()` (`brand.user_id === user.id` check ligne 67).

### Compteurs non encore affichés

`brand_mention_count` et `total_mention_count` sont calculés et stockés mais pas encore exposés dans l'UI (ce sprint se concentre sur les widgets graphiques). À utiliser potentiellement S15 pour des métriques supplémentaires (ex : "X mentions sur Y opportunités").

---

## Documents livrés ce sprint

1. **`saas/docs/SPRINT_S14_RECAP.md`** (ce fichier)
2. **`supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql`** — migration appliquée
3. **`landing/components/saas/CompetitorRankingBars.tsx`** — Row 1 widget visibility/fallback
4. **`landing/components/saas/Top10ShareOfVoice.tsx`** — Row 2 widget 1
5. **`landing/components/saas/Top10CitedDomains.tsx`** — Row 2 widget 2
6. **`landing/components/saas/Top10CitedUrls.tsx`** — Row 2 widget 3

---

Bon push Fred !
