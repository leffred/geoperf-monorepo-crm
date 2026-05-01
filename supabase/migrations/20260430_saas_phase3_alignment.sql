-- GEOPERF SaaS Phase 3 — Brand Alignment
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S9.2
--
-- Compare la perception LLM (réponses) vs la description que le user a fourni.
-- "Les LLM disent X, ta marque dit Y, voici le gap."
-- Tier-gating : Pro+ uniquement.

ALTER TABLE public.saas_tracked_brands
  ADD COLUMN IF NOT EXISTS brand_description TEXT,
  ADD COLUMN IF NOT EXISTS brand_keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS brand_value_props TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.saas_tracked_brands.brand_description IS
  'Description courte de la marque par l''user. Ex: "Asset manager spécialisé ESG focus institutionnels". Utilisée par saas_compute_alignment.';
COMMENT ON COLUMN public.saas_tracked_brands.brand_keywords IS
  'Mots-clés que la marque veut associer à elle. Ex: ["ESG","institutionnels","durable","France"]. Max 20.';
COMMENT ON COLUMN public.saas_tracked_brands.brand_value_props IS
  'Propositions de valeur. Ex: ["Performance long-terme","Engagement actionnaires","Reporting transparent"]. Max 10.';

ALTER TABLE public.saas_brand_snapshots
  ADD COLUMN IF NOT EXISTS alignment_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS alignment_gaps JSONB,
  ADD COLUMN IF NOT EXISTS alignment_summary TEXT,
  ADD COLUMN IF NOT EXISTS alignment_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.saas_brand_snapshots.alignment_score IS
  '0-100 : pourcentage de keywords + value_props détectés dans les réponses LLM. Calculé par saas_compute_alignment.';
COMMENT ON COLUMN public.saas_brand_snapshots.alignment_gaps IS
  'JSONB : { matched_keywords: [...], missing_keywords: [...], matched_value_props: [...], missing_value_props: [...], unexpected_themes: [...] }';
