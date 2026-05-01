-- GEOPERF SaaS Phase 1 — Schema multi-tenant (monitoring LLM ranking)
-- Spec : saas/SPEC.md v1.0 (2026-04-29) section 4
-- Projet : qfdvdcvqknoqfxetttch (Frankfurt EU)
--
-- Toutes les tables sont préfixées saas_ pour ne pas polluer le schéma
-- reporting-engine existant (reports/companies/prospects).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============== ENUMS ==============
CREATE TYPE saas_tier AS ENUM ('free', 'solo', 'pro', 'agency');
CREATE TYPE saas_subscription_status AS ENUM ('active', 'past_due', 'canceled', 'incomplete');
CREATE TYPE saas_snapshot_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE saas_reco_priority AS ENUM ('high', 'medium', 'low');
CREATE TYPE saas_alert_type AS ENUM ('rank_drop', 'rank_gain', 'competitor_overtake', 'new_source', 'citation_loss');

-- ============== PROFILES (1:1 avec auth.users) ==============
CREATE TABLE public.saas_profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL UNIQUE,
  full_name          TEXT,
  company            TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_profiles IS 'Profils utilisateurs SaaS (1:1 avec auth.users). Lien Stripe via stripe_customer_id.';

-- ============== SUBSCRIPTIONS (synced via stripe webhook) ==============
CREATE TABLE public.saas_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  tier                   saas_tier NOT NULL DEFAULT 'free',
  status                 saas_subscription_status NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id        TEXT,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_subscriptions IS 'Abonnements Stripe miroir. Source of truth = Stripe, mais cache local pour enforcement quotas.';

-- ============== TRACKED BRANDS (marques suivies par user) ==============
CREATE TABLE public.saas_tracked_brands (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  domain             TEXT NOT NULL,
  category_slug      TEXT NOT NULL,
  competitor_domains TEXT[] NOT NULL DEFAULT '{}',
  cadence            TEXT NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','monthly')),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, domain)
);

COMMENT ON COLUMN public.saas_tracked_brands.category_slug IS 'Aligné sur public.categories.slug quand possible (ex: asset-management). Pas de FK pour permettre catégories custom.';
COMMENT ON COLUMN public.saas_tracked_brands.competitor_domains IS 'Domains concurrents pour focus prompts ; ex: [''bnpparibas.fr'',''axa.fr''].';

-- ============== BRAND SNAPSHOTS (1 run extraction par marque) ==============
CREATE TABLE public.saas_brand_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  status             saas_snapshot_status NOT NULL DEFAULT 'queued',
  llms_used          TEXT[] NOT NULL,
  prompts_count      INT NOT NULL,
  visibility_score   NUMERIC(5,2),
  avg_rank           NUMERIC(5,2),
  citation_rate      NUMERIC(5,2),
  share_of_voice     NUMERIC(5,2),
  total_cost_usd     NUMERIC(8,4),
  raw_response_count INT NOT NULL DEFAULT 0,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

COMMENT ON COLUMN public.saas_brand_snapshots.visibility_score IS '0-100, agrégat multi-LLM ; calcul dans saas_run_brand_snapshot.';
COMMENT ON COLUMN public.saas_brand_snapshots.avg_rank IS 'Rang moyen quand cité (NULL si jamais cité).';
COMMENT ON COLUMN public.saas_brand_snapshots.citation_rate IS 'Pourcentage de prompts où la marque est mentionnée.';
COMMENT ON COLUMN public.saas_brand_snapshots.share_of_voice IS 'Pourcentage de mentions vs total mentions concurrents.';

-- ============== SNAPSHOT RESPONSES (1 ligne par appel LLM) ==============
CREATE TABLE public.saas_snapshot_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           UUID NOT NULL REFERENCES public.saas_brand_snapshots(id) ON DELETE CASCADE,
  llm                   TEXT NOT NULL,
  prompt_text           TEXT NOT NULL,
  response_text         TEXT,
  response_json         JSONB,
  brand_mentioned       BOOLEAN NOT NULL DEFAULT FALSE,
  brand_rank            INT,
  competitors_mentioned TEXT[] NOT NULL DEFAULT '{}',
  sources_cited         JSONB,
  cost_usd              NUMERIC(8,6),
  latency_ms            INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.saas_snapshot_responses.brand_rank IS '1=premier listé, NULL=non cité.';
COMMENT ON COLUMN public.saas_snapshot_responses.sources_cited IS 'JSONB: [{"url":"...","domain":"...","title":"..."}].';

-- ============== RECOMMENDATIONS (Haiku-generated) ==============
CREATE TABLE public.saas_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id       UUID NOT NULL REFERENCES public.saas_brand_snapshots(id) ON DELETE CASCADE,
  brand_id          UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  priority          saas_reco_priority NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('authority_source','content_gap','competitor_threat','positioning')),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  authority_sources JSONB,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_recommendations IS 'Recos générées par saas_generate_recommendations (Haiku 4.5).';

-- ============== ALERTS ==============
CREATE TABLE public.saas_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      UUID NOT NULL REFERENCES public.saas_tracked_brands(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  snapshot_id   UUID NOT NULL REFERENCES public.saas_brand_snapshots(id) ON DELETE CASCADE,
  alert_type    saas_alert_type NOT NULL,
  severity      saas_reco_priority NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  metadata      JSONB,
  email_sent_at TIMESTAMPTZ,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_alerts IS 'Évènements notables détectés snapshot par snapshot (saas_detect_alerts).';

-- ============== USAGE LOG (pour enforcement tier + budget cap) ==============
CREATE TABLE public.saas_usage_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata   JSONB,
  cost_usd   NUMERIC(8,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.saas_usage_log.event_type IS 'snapshot_run | export | reco_generated | alert_sent.';

-- ============== INDEXES ==============
CREATE INDEX idx_saas_subscriptions_user           ON public.saas_subscriptions(user_id);
-- Garantit qu'un user n'a qu'UNE subscription active à la fois (canceled/past_due autorisés en archive)
CREATE UNIQUE INDEX uq_saas_subscriptions_one_active_per_user
  ON public.saas_subscriptions(user_id)
  WHERE status = 'active';
CREATE INDEX idx_saas_tracked_brands_user          ON public.saas_tracked_brands(user_id);
CREATE INDEX idx_saas_tracked_brands_active        ON public.saas_tracked_brands(is_active, cadence);
CREATE INDEX idx_saas_brand_snapshots_brand_date   ON public.saas_brand_snapshots(brand_id, created_at DESC);
CREATE INDEX idx_saas_brand_snapshots_user         ON public.saas_brand_snapshots(user_id);
CREATE INDEX idx_saas_brand_snapshots_status       ON public.saas_brand_snapshots(status);
CREATE INDEX idx_saas_snapshot_responses_snapshot  ON public.saas_snapshot_responses(snapshot_id);
CREATE INDEX idx_saas_recommendations_brand_date   ON public.saas_recommendations(brand_id, created_at DESC);
CREATE INDEX idx_saas_alerts_user_unread           ON public.saas_alerts(user_id, is_read);
CREATE INDEX idx_saas_usage_log_user_date          ON public.saas_usage_log(user_id, created_at DESC);

-- ============== TRIGGERS (updated_at) ==============
-- Réutilise public.set_updated_at() défini dans 20260427_phase2_prospects_events_tracking.sql
CREATE TRIGGER trg_saas_profiles_updated_at
  BEFORE UPDATE ON public.saas_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_saas_subscriptions_updated_at
  BEFORE UPDATE ON public.saas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============== AUTO-PROVISIONING (signup → profile + free subscription) ==============
-- À l'inscription via Supabase Auth, on crée auto :
--   1. la row saas_profiles (id miroir auth.users.id)
--   2. la row saas_subscriptions tier='free' status='active'
-- Sans ce trigger, le frontend crash après signup (pas de profile, pas de tier).
CREATE OR REPLACE FUNCTION public.handle_new_saas_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.saas_profiles (id, email, full_name, company)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'company'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.saas_subscriptions (user_id, tier, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_saas_user() IS 'Auto-provisioning au signup : crée profile + free subscription. SECURITY DEFINER pour bypass RLS.';

CREATE TRIGGER on_auth_user_created_saas
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_saas_user();

-- ============== ROW LEVEL SECURITY ==============
ALTER TABLE public.saas_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_tracked_brands     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_brand_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_snapshot_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_recommendations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_usage_log          ENABLE ROW LEVEL SECURITY;

-- Note : les writes sur snapshots/responses/recommendations passent par service_role
-- (Edge Functions) qui bypass RLS automatiquement. On expose seulement le SELECT au user.

CREATE POLICY "users own profile" ON public.saas_profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "users read own subscription" ON public.saas_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users own brands" ON public.saas_tracked_brands
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users read own snapshots" ON public.saas_brand_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users read own responses" ON public.saas_snapshot_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_snapshot_responses.snapshot_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "users read own recos" ON public.saas_recommendations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_recommendations.snapshot_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "users own alerts" ON public.saas_alerts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users read own usage" ON public.saas_usage_log
  FOR SELECT USING (auth.uid() = user_id);

-- ============== VUES (dashboard frontend) ==============

-- Évolution visibility score d'une marque (graph dashboard)
CREATE VIEW public.v_saas_brand_evolution AS
SELECT
  b.id            AS brand_id,
  b.user_id,
  b.name,
  s.created_at::date AS snapshot_date,
  s.visibility_score,
  s.avg_rank,
  s.citation_rate,
  s.share_of_voice
FROM public.saas_tracked_brands b
JOIN public.saas_brand_snapshots s ON s.brand_id = b.id
WHERE s.status = 'completed';
-- Note : pas d'ORDER BY dans la vue (ignoré quand requêté avec WHERE/ORDER BY consommateur). Le frontend trie.

COMMENT ON VIEW public.v_saas_brand_evolution IS 'Source pour <BrandEvolutionChart /> (Recharts line chart).';

-- Résumé dashboard : latest snapshot par marque + compteurs alerts/recos non lus
CREATE VIEW public.v_saas_brand_latest AS
SELECT DISTINCT ON (b.id)
  b.id,
  b.user_id,
  b.name,
  b.domain,
  b.category_slug,
  b.competitor_domains,
  b.cadence,
  b.is_active,
  b.created_at,
  s.id              AS latest_snapshot_id,
  s.visibility_score,
  s.avg_rank,
  s.citation_rate,
  s.share_of_voice,
  s.created_at      AS last_snapshot_at,
  (SELECT COUNT(*) FROM public.saas_alerts a
     WHERE a.brand_id = b.id AND a.user_id = b.user_id AND NOT a.is_read) AS unread_alerts,
  (SELECT COUNT(*) FROM public.saas_recommendations r
     JOIN public.saas_brand_snapshots ss ON ss.id = r.snapshot_id
     WHERE ss.brand_id = b.id AND ss.user_id = b.user_id AND NOT r.is_read) AS unread_recos
FROM public.saas_tracked_brands b
LEFT JOIN public.saas_brand_snapshots s
  ON s.brand_id = b.id AND s.status = 'completed'
ORDER BY b.id, s.created_at DESC NULLS LAST;

COMMENT ON VIEW public.v_saas_brand_latest IS 'Source pour le dashboard /app/dashboard. NULLS LAST garantit qu''une marque sans snapshots ne masque pas une marque avec scores.';