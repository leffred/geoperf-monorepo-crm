-- GEOPERF SaaS Phase 3 — Content Studio
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S9.3
--
-- Drafts de contenus optimisés pour gagner en ranking LLM. Pas un CMS — juste
-- un générateur de pitches (blog post / press release / linkedin post / tweet).
-- Tier-gating : Pro+ uniquement (limite 10 drafts/mois en Pro, illimité Agency).

DO $$ BEGIN
  CREATE TYPE saas_draft_type AS ENUM ('blog_post', 'press_release', 'linkedin_post', 'tweet');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE saas_draft_status AS ENUM ('draft', 'approved', 'published', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.saas_content_drafts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                 UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  topic_id                 UUID REFERENCES public.saas_topics(id) ON DELETE SET NULL,
  draft_type               saas_draft_type NOT NULL,
  title                    TEXT NOT NULL,
  body                     TEXT NOT NULL,
  target_keywords          TEXT[] NOT NULL DEFAULT '{}',
  target_authority_sources TEXT[] NOT NULL DEFAULT '{}',
  status                   saas_draft_status NOT NULL DEFAULT 'draft',
  cost_usd                 NUMERIC(8,6),
  llm_used                 TEXT,
  source_snapshot_id       UUID REFERENCES public.saas_brand_snapshots(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_content_drafts IS
  'Drafts générés par saas_generate_content_draft. 1 row = 1 draft généré. Edit/approve/publish/archive via /app/brands/[id]/content.';

CREATE INDEX IF NOT EXISTS idx_saas_content_drafts_brand ON public.saas_content_drafts(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_content_drafts_user ON public.saas_content_drafts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_content_drafts_status ON public.saas_content_drafts(status);

CREATE TRIGGER trg_saas_content_drafts_updated_at
  BEFORE UPDATE ON public.saas_content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saas_content_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read account drafts" ON public.saas_content_drafts
  FOR SELECT USING (user_id = public.saas_account_owner_of(auth.uid()));

CREATE POLICY "owners write drafts" ON public.saas_content_drafts
  FOR ALL USING (user_id = auth.uid());

-- Helper function : nb drafts générés ce mois pour quota Pro (10/mois)
CREATE OR REPLACE FUNCTION public.saas_drafts_count_this_month(p_user_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.saas_content_drafts
  WHERE user_id = p_user_id
    AND created_at >= DATE_TRUNC('month', NOW())
    AND status <> 'archived';
$$;

COMMENT ON FUNCTION public.saas_drafts_count_this_month(UUID) IS
  'Compte les drafts créés ce mois (hors archived) pour enforcer quota Pro = 10/mois.';
