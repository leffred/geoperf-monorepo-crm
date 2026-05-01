-- GEOPERF SaaS Phase 3 — Sentiment analysis
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S9.1
--
-- Pour chaque réponse LLM où la marque est mentionnée, on classifie le sentiment
-- (positive / neutral / negative / mixed / not_mentioned). Cible : visualiser
-- "Brand Health → Sentiment" dans /app/brands/[id]/sentiment.
-- Tier-gating : Growth+ uniquement (skip côté Edge Function pour Free/Starter).

DO $$ BEGIN
  CREATE TYPE saas_sentiment AS ENUM ('positive', 'neutral', 'negative', 'mixed', 'not_mentioned');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.saas_snapshot_responses
  ADD COLUMN IF NOT EXISTS sentiment saas_sentiment,
  ADD COLUMN IF NOT EXISTS sentiment_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS sentiment_summary TEXT;

COMMENT ON COLUMN public.saas_snapshot_responses.sentiment IS
  'Classification sentiment de la mention de la marque dans la réponse. NULL si pas encore analysé. not_mentioned si brand_mentioned=false.';
COMMENT ON COLUMN public.saas_snapshot_responses.sentiment_score IS
  'Score continu -1.0 (très négatif) à 1.0 (très positif). NULL si pas analysé.';

ALTER TABLE public.saas_brand_snapshots
  ADD COLUMN IF NOT EXISTS avg_sentiment_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS sentiment_distribution JSONB,
  ADD COLUMN IF NOT EXISTS sentiment_analyzed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.saas_brand_snapshots.sentiment_distribution IS
  'JSONB : { positive: 12, neutral: 8, negative: 3, mixed: 5, not_mentioned: 2 }. Calculé par saas_analyze_sentiment.';

CREATE INDEX IF NOT EXISTS idx_saas_snapshot_responses_sentiment
  ON public.saas_snapshot_responses(snapshot_id, sentiment)
  WHERE sentiment IS NOT NULL;
