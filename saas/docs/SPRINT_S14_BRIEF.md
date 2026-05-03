# Sprint S14 — Brief

**Date brief** : 2026-05-02
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-02)
**Effort estimé** : 1 nuit Claude Code (3-4h focus dev — incluant modif parser pour rangs concurrents)
**Pré-requis** : S13 mergé et déployé (PDF refresh + audit UX SaaS + page vs-getmint)

---

## 1. Pourquoi ce sprint

Le dashboard SaaS actuel `/app/brands/[id]` affiche la donnée nécessaire mais **éclatée sur 5 sous-pages** (`/sources`, `/by-model`, `/by-prompt`, `/citations-flow`). GetMint.ai met tout sur l'écran principal : Visibility Score + ranking concurrents en barres + Visibility Evolution + Top 10 Share of Voice + Top 10 Cited Domains + Top 10 Cited URLs.

Diagnostic préliminaire (cf. session Cowork du 2026-05-02) : **la donnée brute existe à 90% en DB**. Pas de modif workflow n8n requise (n8n c'est pour le lead-magnet, pas le SaaS). Tout passe par l'Edge Function `saas_run_brand_snapshot` + Postgres.

**Ce sprint = plomberie UI + 1 vue SQL + 2 colonnes compteurs + 1 colonne JSONB pour les rangs concurrents + modif parser. Une refonte ciblée, pas profonde.**

**Décision Fred 2026-05-02** : on inclut dès S14 l'extraction des rangs des concurrents (pas juste leurs noms). Raison : permettre un vrai `visibility_score` par concurrent pour matcher le widget ranking GetMint (Brevo 84% / HubSpot 55% / Mailchimp 41%) au lieu d'un proxy share_of_voice.

---

## 2. Périmètre

### In scope
- Migration DB additive (2 colonnes compteurs + 1 colonne JSONB rangs concurrents + 2 vues + 2 RPC)
- **Modif parser de réponse LLM** dans `saas_run_brand_snapshot` pour extraire les rangs des concurrents (en plus du nom)
- Modif fonction `aggregate()` pour peupler les 2 nouveaux compteurs
- Refonte page `landing/app/app/brands/[id]/page.tsx` pour matcher la densité GetMint
- 4 nouveaux widgets serveur-side : `CompetitorRankingBars` (visibility score par concurrent), `Top10ShareOfVoice`, `Top10CitedDomains`, `Top10CitedUrls`
- Adaptation des sous-pages existantes : garder pour drill-down détaillé, NE PAS supprimer

### Out of scope (explicitement)
- ❌ Toucher aux workflows n8n (lead-magnet, hors scope SaaS)
- ❌ Modifier le format `sources_cited` / `competitors_mentioned` existants (on AJOUTE une colonne `competitors_with_rank`, on ne casse pas l'existant)
- ❌ Backfill du parser sur les snapshots historiques (cher, on laisse `competitors_with_rank IS NULL` pour les anciens)
- ❌ Ajouter de nouveaux LLMs (AI Overviews / Copilot → reporté S15)
- ❌ Cadence quotidienne pour Pro+ (impact business model à discuter à part, reporté S15)
- ❌ Améliorer le system prompt pour exiger sources structurées (reporté S15, +15% coût tokens)
- ❌ Nouveau scoring d'autorité de domaine (Common Crawl seed → S16+)

---

## 3. État courant à connaître avant de coder

### 3.1 Schéma `saas_brand_snapshots` (15 colonnes)
```
id UUID PK · brand_id UUID FK · user_id UUID FK · status ENUM · llms_used TEXT[]
· prompts_count INT · visibility_score NUMERIC(5,2) · avg_rank NUMERIC(5,2)
· citation_rate NUMERIC(5,2) · share_of_voice NUMERIC(5,2) · total_cost_usd NUMERIC(8,4)
· raw_response_count INT · error_message TEXT · created_at · completed_at · topic_id UUID
```

### 3.2 Schéma `saas_snapshot_responses` (13 colonnes)
```
id · snapshot_id FK · llm TEXT · prompt_text TEXT · response_text · response_json JSONB
· brand_mentioned BOOL · brand_rank INT · competitors_mentioned TEXT[]
· sources_cited JSONB ([{url, domain}]) · cost_usd · latency_ms · created_at
```

Important : `competitors_mentioned` est un **TEXT[] de noms humanisés** (ex. `['Vanguard','BlackRock']`), pas de JSONB et pas de domaines.

### 3.3 Vues existantes
- `v_saas_brand_evolution` : timeline visibility/avg_rank/citation_rate/SoV par snapshot completed → utilisée par `BrandEvolutionChart`
- `v_saas_brand_latest` : résumé dashboard brands list

### 3.4 Edge Function `saas_run_brand_snapshot/index.ts`
- Lignes 133-139 : fonction `parseResponse()` boucle sur competitorHumans, regex word-boundary case-insensitive → output `competitors_mentioned: string[]` (juste les noms, pas les rangs)
- Lignes 216-259 : fonction `aggregate()` calcule les 5 scores agrégés
- Lignes 406-411 : appel `aggregate(succeeded)`
- Lignes 413-423 : `UPDATE saas_brand_snapshots SET ...`

**Modifications S14** :
- `parseResponse()` doit maintenant aussi détecter les rangs des concurrents dans les listes ordonnées (logique similaire à celle utilisée pour `brand_rank` lignes 117-130)
- `aggregate()` doit peupler 2 nouveaux compteurs (`brand_mention_count`, `total_mention_count`)
- L'INSERT dans `saas_snapshot_responses` (ligne ~384) doit inclure une nouvelle colonne `competitors_with_rank` JSONB

### 3.5 Page Overview actuelle (server component)
`landing/app/app/brands/[id]/page.tsx` — fetch parallèle :
- saas_tracked_brands, saas_topics, dernier snapshot + 20 historique, saas_alerts top 10, `v_saas_brand_evolution`
- Si snapshot completed : saas_recommendations + saas_snapshot_responses (pour CompetitorMatrix)
- Composants : `BrandEvolutionChart`, `AlertBanner`, `RecommendationList`, `CompetitorMatrix` (Pro+ lock), `TopicSelector`

---

## 4. Livrables

### 4.1 Migration DB — `supabase/migrations/20260502_saas_phase6_dashboard_aggregates.sql`

**Sauvegarder le fichier AVANT `apply_migration` MCP** (cf. anti-pattern §3 du `CLAUDE.md` racine).

```sql
-- ============================================
-- PHASE 6 — Dashboard aggregates pour Overview
-- ============================================

-- 1. Compteurs absolus de mentions sur saas_brand_snapshots
ALTER TABLE saas_brand_snapshots
  ADD COLUMN IF NOT EXISTS brand_mention_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mention_count INT NOT NULL DEFAULT 0;

-- 1b. Colonne JSONB pour les rangs des concurrents dans saas_snapshot_responses
-- Format : [{"name": "Vanguard", "rank": 1}, {"name": "BlackRock", "rank": 2}, {"name": "AXA IM", "rank": null}]
-- "rank": null si concurrent cité mais pas dans une liste ordonnée
-- ⚠️ NULL pour les snapshots historiques (pas de backfill, parsing trop coûteux)
ALTER TABLE saas_snapshot_responses
  ADD COLUMN IF NOT EXISTS competitors_with_rank JSONB;

CREATE INDEX IF NOT EXISTS idx_saas_responses_competitors_with_rank
  ON saas_snapshot_responses USING GIN (competitors_with_rank)
  WHERE competitors_with_rank IS NOT NULL;

-- 2. Vue : Share of Voice par concurrent par snapshot
-- Logique : unnest competitors_mentioned + ajouter la brand elle-même.
-- Sortie : 1 row par (snapshot_id, entity_name, mention_count, share_pct)
CREATE OR REPLACE VIEW v_saas_competitor_share_of_voice AS
WITH all_mentions AS (
  -- Mentions concurrents
  SELECT
    r.snapshot_id,
    unnest(r.competitors_mentioned) AS entity_name,
    FALSE AS is_self
  FROM saas_snapshot_responses r
  WHERE array_length(r.competitors_mentioned, 1) > 0
  UNION ALL
  -- Mentions de la brand elle-même
  SELECT
    r.snapshot_id,
    b.name AS entity_name,
    TRUE AS is_self
  FROM saas_snapshot_responses r
  JOIN saas_brand_snapshots s ON s.id = r.snapshot_id
  JOIN saas_tracked_brands b ON b.id = s.brand_id
  WHERE r.brand_mentioned = TRUE
),
counted AS (
  SELECT
    snapshot_id,
    entity_name,
    bool_or(is_self) AS is_self,
    COUNT(*)::INT AS mention_count
  FROM all_mentions
  GROUP BY snapshot_id, entity_name
)
SELECT
  c.snapshot_id,
  c.entity_name,
  c.is_self,
  c.mention_count,
  ROUND(100.0 * c.mention_count / NULLIF(SUM(c.mention_count) OVER (PARTITION BY c.snapshot_id), 0), 2) AS share_pct,
  ROW_NUMBER() OVER (PARTITION BY c.snapshot_id ORDER BY c.mention_count DESC) AS rank
FROM counted c;

-- 2b. Vue : Visibility Score par concurrent (et par soi-même) par snapshot
-- Logique : reproduit la formule visibility_score de la fonction aggregate() mais par entité.
-- - 100 si rank=1 ; 90 si rank=2 ; ... ; 10 si rank=10+ ; 50 si cité sans rank
-- - 0 si pas cité dans la réponse
-- Note : on a besoin de competitors_with_rank pour les concurrents.
-- Pour les snapshots historiques (competitors_with_rank IS NULL), la vue retourne juste self + entités sans rank (score 50).
CREATE OR REPLACE VIEW v_saas_competitor_visibility AS
WITH per_response AS (
  -- Self : la marque elle-même
  SELECT
    r.snapshot_id,
    b.name AS entity_name,
    TRUE AS is_self,
    r.brand_mentioned AS mentioned,
    r.brand_rank AS rank
  FROM saas_snapshot_responses r
  JOIN saas_brand_snapshots s ON s.id = r.snapshot_id
  JOIN saas_tracked_brands b ON b.id = s.brand_id
  UNION ALL
  -- Concurrents (depuis competitors_with_rank si dispo)
  SELECT
    r.snapshot_id,
    (cwr ->> 'name')::TEXT AS entity_name,
    FALSE AS is_self,
    TRUE AS mentioned,
    NULLIF(cwr ->> 'rank', '')::INT AS rank
  FROM saas_snapshot_responses r,
       jsonb_array_elements(COALESCE(r.competitors_with_rank, '[]'::jsonb)) cwr
  WHERE r.competitors_with_rank IS NOT NULL
),
scored AS (
  SELECT
    snapshot_id,
    entity_name,
    bool_or(is_self) AS is_self,
    AVG(
      CASE
        WHEN mentioned = FALSE THEN 0
        WHEN rank IS NULL THEN 50
        WHEN rank = 1 THEN 100
        WHEN rank = 2 THEN 90
        WHEN rank = 3 THEN 80
        WHEN rank = 4 THEN 70
        WHEN rank = 5 THEN 60
        WHEN rank = 6 THEN 50
        WHEN rank = 7 THEN 40
        WHEN rank = 8 THEN 30
        WHEN rank = 9 THEN 20
        ELSE 10
      END
    )::NUMERIC(5,2) AS visibility_score,
    COUNT(*) FILTER (WHERE mentioned)::INT AS mention_count,
    AVG(rank) FILTER (WHERE rank IS NOT NULL)::NUMERIC(5,2) AS avg_rank
  FROM per_response
  GROUP BY snapshot_id, entity_name
)
SELECT
  snapshot_id,
  entity_name,
  is_self,
  visibility_score,
  mention_count,
  avg_rank,
  ROW_NUMBER() OVER (PARTITION BY snapshot_id ORDER BY visibility_score DESC, mention_count DESC) AS rank
FROM scored;

-- 3. RPC : Top N domaines cités pour un snapshot
CREATE OR REPLACE FUNCTION saas_top_cited_domains(p_snapshot_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (domain TEXT, citation_count INT, share_pct NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH expanded AS (
    SELECT jsonb_array_elements(r.sources_cited) ->> 'domain' AS domain
    FROM saas_snapshot_responses r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.sources_cited IS NOT NULL
      AND jsonb_typeof(r.sources_cited) = 'array'
  ),
  counted AS (
    SELECT domain, COUNT(*)::INT AS citation_count
    FROM expanded
    WHERE domain IS NOT NULL AND domain <> ''
    GROUP BY domain
  )
  SELECT
    domain,
    citation_count,
    ROUND(100.0 * citation_count / NULLIF(SUM(citation_count) OVER (), 0), 2) AS share_pct
  FROM counted
  ORDER BY citation_count DESC
  LIMIT p_limit;
$$;

-- 4. RPC : Top N URLs citées pour un snapshot
CREATE OR REPLACE FUNCTION saas_top_cited_urls(p_snapshot_id UUID, p_limit INT DEFAULT 10)
RETURNS TABLE (url TEXT, domain TEXT, citation_count INT, share_pct NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH expanded AS (
    SELECT
      jsonb_array_elements(r.sources_cited) ->> 'url' AS url,
      jsonb_array_elements(r.sources_cited) ->> 'domain' AS domain
    FROM saas_snapshot_responses r
    WHERE r.snapshot_id = p_snapshot_id
      AND r.sources_cited IS NOT NULL
      AND jsonb_typeof(r.sources_cited) = 'array'
  ),
  counted AS (
    SELECT url, MIN(domain) AS domain, COUNT(*)::INT AS citation_count
    FROM expanded
    WHERE url IS NOT NULL AND url <> ''
    GROUP BY url
  )
  SELECT
    url,
    domain,
    citation_count,
    ROUND(100.0 * citation_count / NULLIF(SUM(citation_count) OVER (), 0), 2) AS share_pct
  FROM counted
  ORDER BY citation_count DESC
  LIMIT p_limit;
$$;

-- 5. Permissions RPC (RLS bypass via SECURITY DEFINER, mais on filtre côté client par auth)
REVOKE ALL ON FUNCTION saas_top_cited_domains(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION saas_top_cited_urls(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saas_top_cited_domains(UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION saas_top_cited_urls(UUID, INT) TO authenticated, service_role;
```

**À noter** :
- Pas de RLS sur la vue `v_saas_competitor_share_of_voice` directement → côté code Next.js, on filtre via `snapshot_id` qui est lui-même protégé par RLS sur `saas_brand_snapshots`. Vérifier que les requêtes passent par le client `getSupabaseServerClient()` avec session user.
- Les RPC sont en SECURITY DEFINER pour bypass RLS sur l'unnest JSONB (limitation Postgres). Bien protéger côté Next.js : ne jamais passer un `snapshot_id` non vérifié.

### 4.2 Edge Function `saas_run_brand_snapshot/index.ts`

#### 4.2.a Modif `parseResponse()` — extraction rangs concurrents

Aujourd'hui (lignes 133-139, à confirmer en lisant le fichier) :
```typescript
const competitorsMatched: string[] = [];
for (const competitorHuman of competitorHumans) {
  const re = new RegExp(`\\b${escapeRegex(competitorHuman)}\\b`, "i");
  if (re.test(response)) competitorsMatched.push(competitorHuman);
}
```

Nouvelle logique : pour chaque concurrent matché, tenter d'extraire son rang dans une liste ordonnée du LLM, EXACTEMENT la même approche que pour `brand_rank` (lignes ~117-130). Output supplémentaire : `competitors_with_rank: Array<{name: string, rank: number | null}>`.

```typescript
function extractRankForEntity(response: string, entityName: string): number | null {
  // Cherche "1. ... entityName ...", "2. ... entityName ...", etc.
  // Pattern utilisé pour brand_rank : reuse / extract en helper si pas déjà fait.
  const lines = response.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)\-]\s+(.+)$/);
    if (m) {
      const rankNum = parseInt(m[1], 10);
      const lineContent = m[2];
      const re = new RegExp(`\\b${escapeRegex(entityName)}\\b`, "i");
      if (re.test(lineContent)) return rankNum;
    }
  }
  return null;
}

// Dans parseResponse() :
const competitorsWithRank: Array<{ name: string; rank: number | null }> = [];
for (const competitorHuman of competitorHumans) {
  const re = new RegExp(`\\b${escapeRegex(competitorHuman)}\\b`, "i");
  if (re.test(response)) {
    competitorsWithRank.push({
      name: competitorHuman,
      rank: extractRankForEntity(response, competitorHuman),
    });
  }
}

// Conserver competitors_mentioned pour compatibilité descendante
const competitorsMentioned = competitorsWithRank.map(c => c.name);

return {
  brand_mentioned, brand_rank,
  competitors_mentioned: competitorsMentioned,
  competitors_with_rank: competitorsWithRank,
  sources_cited,
};
```

**Important** : si la helper `extractRankForEntity` est extraite, refacto aussi le calcul `brand_rank` existant pour utiliser la même fonction (DRY). Ne pas casser le format actuel.

#### 4.2.b Insert dans `saas_snapshot_responses`

Au moment du batch insert (~ligne 384), ajouter le champ :
```typescript
{
  ...,
  competitors_mentioned: parsed.competitors_mentioned,
  competitors_with_rank: parsed.competitors_with_rank,  // NEW (JSONB)
  sources_cited: parsed.sources_cited,
}
```

#### 4.2.c Modif `aggregate()` — compteurs absolus

```typescript
function aggregate(rows: AggregateInput[]): AggregateResult {
  // ... code existant ...
  
  // NEW : compteurs absolus
  let brandMentionCount = 0;
  let totalMentionCount = 0;
  
  for (const row of rows) {
    if (row.brand_mentioned) brandMentionCount += 1;
    totalMentionCount += (row.brand_mentioned ? 1 : 0) + (row.competitors_mentioned?.length ?? 0);
  }
  
  return {
    visibility_score: ...,
    avg_rank: ...,
    citation_rate: ...,
    share_of_voice: ...,
    total_cost_usd: ...,
    brand_mention_count: brandMentionCount,
    total_mention_count: totalMentionCount,
  };
}
```

Puis dans le `UPDATE saas_brand_snapshots` (lignes 413-423), ajouter `brand_mention_count: agg.brand_mention_count, total_mention_count: agg.total_mention_count`.

**Backfill recommandé pour les snapshots historiques** : SQL one-shot dans la migration (à la fin) :
```sql
UPDATE saas_brand_snapshots s
SET
  brand_mention_count = sub.brand_mentions,
  total_mention_count = sub.total_mentions
FROM (
  SELECT
    r.snapshot_id,
    SUM(CASE WHEN r.brand_mentioned THEN 1 ELSE 0 END)::INT AS brand_mentions,
    SUM(CASE WHEN r.brand_mentioned THEN 1 ELSE 0 END + COALESCE(array_length(r.competitors_mentioned, 1), 0))::INT AS total_mentions
  FROM saas_snapshot_responses r
  GROUP BY r.snapshot_id
) sub
WHERE s.id = sub.snapshot_id AND s.status = 'completed';
```

### 4.3 Frontend — Refonte page Overview

**Fichier principal** : `landing/app/app/brands/[id]/page.tsx`

**Nouvelle structure proposée (du haut vers le bas)** :

```
┌─ AlertBanner (si alertes unread)
├─ Header brand (nom + topic selector + bouton refresh) [existant]
│
├─ ── ROW 1 (2 colonnes 60/40) ───────────────────────
│  ├─ Visibility Score panel (gauche, 60%)
│  │  ├─ Big number visibility_score% (xl, brand-500)
│  │  ├─ Sub : "Based on N answers" (= raw_response_count)
│  │  └─ Ranking concurrents par visibility_score (barres horizontales) ← NEW
│  │     Source : v_saas_competitor_visibility WHERE snapshot_id = latest ORDER BY rank LIMIT 7
│  │     Self toujours visible (force inclusion). brand-500 pour self, autres couleurs pour concurrents
│  │     Si competitors_with_rank IS NULL sur tous les responses (snapshot ancien),
│  │     fallback sur v_saas_competitor_share_of_voice (mode dégradé) avec hint
│  │     "Données rangs concurrents disponibles à partir du prochain snapshot"
│  │
│  └─ BrandEvolutionChart (droite, 40%) [existant]
│     Reuse component, peut-être agrandir
│
├─ ── ROW 2 (3 colonnes égales) ──────────────────────
│  ├─ Top10ShareOfVoice ← NEW
│  │  Source : v_saas_competitor_share_of_voice (top 10 par mention_count)
│  │  Style : barres horizontales avec ranks 1/2/3 numérotés
│  │
│  ├─ Top10CitedDomains ← NEW
│  │  Source : RPC saas_top_cited_domains(snapshot_id, 10)
│  │  Style : favicon + domain + bar share_pct
│  │
│  └─ Top10CitedUrls ← NEW
│     Source : RPC saas_top_cited_urls(snapshot_id, 10)
│     Style : URL truncated + share_pct
│
├─ ── ROW 3 (drill-down links) ───────────────────────
│  Lignes "Voir détails →" vers /sources, /by-model, /by-prompt, /citations-flow
│
├─ ── ROW 4 ─────────────────────────────────────────
│  CompetitorMatrix [existant, Pro+ lock] (full width)
│
└─ ── ROW 5 ─────────────────────────────────────────
   RecommendationList + Historique snapshots [existant]
```

**Composants à créer** :
- `landing/components/saas/CompetitorRankingBars.tsx` (Row 1 widget concurrents)
- `landing/components/saas/Top10ShareOfVoice.tsx`
- `landing/components/saas/Top10CitedDomains.tsx`
- `landing/components/saas/Top10CitedUrls.tsx`

Tous **server components** (pas de "use client"), reçoivent les rows en props depuis la page parent.

**Conventions de style** (cf. `SPRINT_S13_AUDIT_UX.md` Tech crisp) :
- Card border `border border-ink/[0.08]`
- Eyebrow JetBrains Mono uppercase letter-spacing-0.12em color brand-500
- Headers Inter 500 letter-spacing-tight
- Bars : `bg-brand-500` pour self/top, `bg-ink-subtle` pour le reste
- Padding card `p-6`, gap entre cards `gap-6`

**Lock tier** : les 3 widgets Top10 sont **Free+** (donnée de base). Pas de paywall.

### 4.4 Sous-pages drill-down — pas de changement

Garder `/sources`, `/by-model`, `/by-prompt`, `/citations-flow` exactement comme aujourd'hui. Elles servent de drill-down détaillé. Ajouter juste un lien "← Retour au dashboard" en header si pas déjà là.

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
```
Doit passer vert. Pas de nouvelle dépendance npm. 0 régression bundle attendue (server components only, pas de chunk client supplémentaire).

### 5.2 Tests fonctionnels

1. **Migration apply** : `apply_migration` MCP avec le fichier SQL, vérifier qu'il n'y a pas d'erreur.
2. **Backfill** : vérifier que `SELECT brand_mention_count, total_mention_count FROM saas_brand_snapshots WHERE status='completed' LIMIT 5` retourne des valeurs > 0.
3. **Vue concurrents SoV** : `SELECT * FROM v_saas_competitor_share_of_voice WHERE snapshot_id = '<latest_uuid>' ORDER BY rank LIMIT 10` doit retourner les top concurrents avec self en première position si la marque est bien citée.
3b. **Vue concurrents Visibility** : `SELECT * FROM v_saas_competitor_visibility WHERE snapshot_id = '<latest_uuid_NEW>' ORDER BY rank LIMIT 10` doit retourner les top entités triées par visibility_score décroissant. Vérifier que les rangs des concurrents sont peuplés (sortir 1-2 exemples avec rank entre 1-10).
4. **RPC domains** : `SELECT * FROM saas_top_cited_domains('<snapshot_id>', 10)` retourne ≤10 rows triés par citation_count DESC.
5. **RPC URLs** : idem.
6. **Page Overview** : connexion sur `/app/brands/[id]` avec un snapshot completed récent (avec `competitors_with_rank` peuplé), vérifier visuellement que les 4 nouveaux widgets s'affichent. Le widget CompetitorRankingBars doit montrer un ranking ordonné par visibility_score.
6b. **Test parser rangs** : lancer un nouveau snapshot via `/app/brands/[id]` bouton "Refresh", attendre completion, puis :
    ```sql
    SELECT prompt_text, brand_rank, competitors_with_rank
    FROM saas_snapshot_responses WHERE snapshot_id = '<new_uuid>' AND brand_mentioned = true LIMIT 5;
    ```
    Vérifier qu'au moins 50% des responses ont au moins 1 concurrent avec un rank non-null. Si <50% : ajuster la regex `extractRankForEntity` pour matcher plus de patterns (ex: tirets, parenthèses, lettres "a)", "b)", etc).
7. **Empty state** : créer une nouvelle marque sans snapshot, vérifier que les widgets affichent un EmptyState propre (pas de crash, pas de "0%").
8. **Snapshot historique fallback** : sélectionner un snapshot pré-S14 (sans `competitors_with_rank`), vérifier que CompetitorRankingBars passe en mode dégradé (utilise share_of_voice) avec hint visible.
9. **Pro lock conservé** : CompetitorMatrix reste lock Pro+, les 4 nouveaux widgets sont Free+.

### 5.3 Test régression sous-pages
Vérifier que `/sources`, `/by-model`, `/by-prompt`, `/citations-flow` continuent de fonctionner exactement comme avant. Pas de modification attendue mais sanity check.

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. **Migration SQL sauvée AVANT `apply_migration`** dans `supabase/migrations/`.
2. **Pas de credentials hardcoded** — RLS et clés env vars uniquement.
3. **Fichiers >150 lignes : bash heredoc obligatoire** (Write tool tronque sur mount Windows).
4. **Pas de push GitHub sans `npm run build` validé**.
5. **Pas de toucher n8n** — les workflows lead-magnet sont indépendants du SaaS.
6. **Brand-500 = #2563EB bleu** (le brief S13 mentionnait vert mais c'est le bleu réel du repo).

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1
```
Vercel auto-redeploy en 1-2 min.

### 7.2 Edge Function
```bash
npx supabase functions deploy saas_run_brand_snapshot
```

### 7.3 Migration DB
Appliquée via `apply_migration` MCP pendant la session (autorisée par §3 anti-patterns du CLAUDE.md racine puisque le fichier SQL est sauvé).

---

## 8. Post-S14 — sujets reportés explicitement

À traquer dans `FEATURES_VS_GETMINT.md` :

| Sujet | Sprint cible | Pourquoi pas S14 |
|---|---|---|
| AI Overviews + Copilot LLMs | S15 | Vérifier slugs OpenRouter, pas trivial |
| Cadence quotidienne Pro+ | S15 | Impact business model à modéliser (×7 coûts LLM) |
| System prompt "Sources :" structuré | S15 | +15% coût tokens, à valider sur 1 snapshot test avant rollout |
| Backfill rangs concurrents historiques | S15 | Coût : re-parse ~N×M réponses anciennes, 1-2h compute. À faire si Fred trouve les nouveaux snapshots concluants. |
| Publisher Network EU lite (Common Crawl seed top 5k) | S16 | 50€/mois infra, 2-3 semaines effort |
| Doc API Swagger | S16 | Skipped S13, low priority |

---

## 9. Livrable de fin de sprint

À produire dans `saas/docs/SPRINT_S14_RECAP.md` (format S13 recap) :
- TL;DR check-list objectifs livrés
- Fichiers modifiés / créés (git status --short)
- Captures attendues par Fred : screenshot avant/après de la page Overview
- Reste à faire (deploy commands, env vars si applicable)
- Notes méthodologiques

---

Bon sprint ! 🚀
