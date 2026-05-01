-- GEOPERF SaaS Phase 2 — Topics (segmentation prompts par sous-sujet)
-- Spec : SPRINT_S7_BRIEF.md "Table topics"
--
-- Concept : 1 topic = 1 sous-sujet d'une marque (ex: "ESG" / "Innovation digitale" /
-- "Performance financière"). Chaque snapshot run est attaché à 1 topic (ou NULL =
-- "Default Topic"). Les recos et alerts héritent du topic_id du snapshot.
-- Tier-gating : 1 topic Free, 3 Starter, 9 Growth, unlimited Pro/Agency.

CREATE TABLE IF NOT EXISTS public.saas_topics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  description     TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  prompts         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(brand_id, slug)
);

COMMENT ON TABLE public.saas_topics IS
  '1 topic = sous-sujet pour segmenter les prompts. is_default=true pour le topic généraliste créé auto. prompts JSONB = override des prompts standards (vide = utilise prompts.json par défaut).';

COMMENT ON COLUMN public.saas_topics.prompts IS
  'JSONB array d''objets {id, category, template} pour override les prompts standards. Vide [] = utilise prompts.json bundlé dans saas_run_brand_snapshot.';

CREATE INDEX IF NOT EXISTS idx_saas_topics_brand ON public.saas_topics(brand_id);

-- 1 seul topic par brand peut être is_default=true (UNIQUE INDEX partiel)
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_topics_one_default_per_brand
  ON public.saas_topics(brand_id)
  WHERE is_default = TRUE;

-- ============== topic_id sur snapshots/alerts/recos ==============
ALTER TABLE public.saas_brand_snapshots
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

ALTER TABLE public.saas_alerts
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

ALTER TABLE public.saas_recommendations
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saas_brand_snapshots_topic ON public.saas_brand_snapshots(topic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_recommendations_topic ON public.saas_recommendations(topic_id);
CREATE INDEX IF NOT EXISTS idx_saas_alerts_topic ON public.saas_alerts(topic_id);

-- ============== Default topic auto-provisioning ==============
-- À chaque nouvelle brand, créer un topic par défaut "Général" pour cohérence UX
CREATE OR REPLACE FUNCTION public.handle_saas_brand_default_topic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.saas_topics (brand_id, name, slug, description, is_default, prompts)
  VALUES (NEW.id, 'Général', 'general', 'Topic par défaut. Utilise les 30 prompts standards.', TRUE, '[]'::jsonb)
  ON CONFLICT (brand_id, slug) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS saas_brand_default_topic ON public.saas_tracked_brands;
CREATE TRIGGER saas_brand_default_topic
  AFTER INSERT ON public.saas_tracked_brands
  FOR EACH ROW EXECUTE FUNCTION public.handle_saas_brand_default_topic();

-- Backfill : créer le default topic pour les brands existantes
INSERT INTO public.saas_topics (brand_id, name, slug, description, is_default, prompts)
SELECT b.id, 'Général', 'general', 'Topic par défaut. Utilise les 30 prompts standards.', TRUE, '[]'::jsonb
FROM public.saas_tracked_brands b
WHERE NOT EXISTS (
  SELECT 1 FROM public.saas_topics t WHERE t.brand_id = b.id AND t.is_default = TRUE
)
ON CONFLICT (brand_id, slug) DO NOTHING;
