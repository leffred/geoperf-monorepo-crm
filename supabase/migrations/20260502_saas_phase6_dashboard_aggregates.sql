-- ============================================
-- PHASE 6 — Dashboard aggregates pour Overview
-- Sprint S14 — 2026-05-02
-- ============================================

-- 1. Compteurs absolus de mentions sur saas_brand_snapshots
ALTER TABLE saas_brand_snapshots
  ADD COLUMN IF NOT EXISTS brand_mention_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mention_count INT NOT NULL DEFAULT 0;

-- 1b. Colonne JSONB pour les rangs des concurrents dans saas_snapshot_responses
-- Format : [{"name": "Vanguard", "rank": 1}, {"name": "BlackRock", "rank": 2}, {"name": "AXA IM", "rank": null}]
-- "rank": null si concurrent cité mais pas dans une liste ordonnée
-- NULL pour les snapshots historiques (pas de backfill, parsing trop coûteux)
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
-- Pour les snapshots historiques (competitors_with_rank IS NULL), la vue retourne juste self
-- + entités sans rank (score 50).
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

-- 5. Permissions RPC (RLS bypass via SECURITY DEFINER, on filtre côté client par auth)
REVOKE ALL ON FUNCTION saas_top_cited_domains(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION saas_top_cited_urls(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION saas_top_cited_domains(UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION saas_top_cited_urls(UUID, INT) TO authenticated, service_role;

-- 6. Backfill compteurs pour snapshots historiques completed
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
