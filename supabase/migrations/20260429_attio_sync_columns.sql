-- Migration : ajout colonnes Attio sync
-- À exécuter dans Supabase SQL editor OU via mcp_apply_migration depuis Cowork
-- Idempotent : utilise IF NOT EXISTS

-- Sur prospects : attio_record_id existe déjà, on ajoute juste les métadonnées de sync
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS attio_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS attio_sync_error text;

-- Sur companies : on ajoute attio_record_id + sync metadata
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS attio_record_id text,
  ADD COLUMN IF NOT EXISTS attio_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS attio_sync_error text;

-- Index pour le delta sync (queries du type WHERE attio_synced_at IS NULL OR updated_at > attio_synced_at)
CREATE INDEX IF NOT EXISTS idx_prospects_attio_sync_pending
  ON public.prospects (updated_at)
  WHERE attio_synced_at IS NULL OR updated_at > attio_synced_at;

CREATE INDEX IF NOT EXISTS idx_companies_attio_sync_pending
  ON public.companies (updated_at)
  WHERE attio_synced_at IS NULL OR updated_at > attio_synced_at;

-- Vue helper pour le workflow : prospects à sync (avec join companies + reports pour les données dérivées)
CREATE OR REPLACE VIEW public.v_attio_prospects_sync_queue AS
SELECT 
  p.id AS prospect_id,
  p.email,
  p.first_name,
  p.last_name,
  p.full_name,
  p.title,
  p.phone,
  p.linkedin_url,
  p.lead_score,
  p.status,
  p.tracking_token,
  p.download_at,
  p.call_booked_at,
  p.conversion_at,
  p.attio_record_id AS prospect_attio_record_id,
  p.attio_synced_at AS prospect_attio_synced_at,
  c.id AS company_id,
  c.nom AS company_name,
  c.domain AS company_domain,
  c.country AS company_country,
  c.attio_record_id AS company_attio_record_id,
  r.sous_categorie,
  LOWER(REPLACE(r.sous_categorie, ' ', '-')) AS subcategory_slug,
  rc.rank AS ai_rank,
  rc.visibility_score,
  rc.market_rank_estimate,
  rc.ai_saturation_gap,
  CASE 
    WHEN p.attio_synced_at IS NULL THEN 'new'
    WHEN p.updated_at > p.attio_synced_at THEN 'updated'
    ELSE 'synced'
  END AS sync_state
FROM public.prospects p
JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.reports r ON r.id = p.report_id
LEFT JOIN public.report_companies rc ON rc.report_id = p.report_id AND rc.company_id = p.company_id
WHERE p.email IS NOT NULL;

COMMENT ON VIEW public.v_attio_prospects_sync_queue IS
  'Vue pour Phase 4 Attio sync : tous prospects avec email + données dérivées companies/reports + sync_state.';
