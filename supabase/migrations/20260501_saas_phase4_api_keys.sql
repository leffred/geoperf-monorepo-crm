-- GEOPERF SaaS Phase 4 — API publique (Agency tier)
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S10.4
--
-- API REST v1 dispatchée par saas_api_v1_router. Auth via Bearer gp_live_xxx
-- (key_prefix visible + key_hash bcrypt en DB). Rate limit 60 req/min via
-- table saas_api_calls (count par fenêtre glissante 1 min).

DO $$ BEGIN
  CREATE TYPE saas_api_scope AS ENUM ('read', 'write');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.saas_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  key_prefix      TEXT NOT NULL UNIQUE,                       -- "gp_live_xxxxxxxx" (12 chars premiers)
  key_hash        TEXT NOT NULL,                              -- sha256 hex de la clé full
  name            TEXT NOT NULL,                              -- "Looker prod"
  scopes          saas_api_scope[] NOT NULL DEFAULT ARRAY['read']::saas_api_scope[],
  last_used_at    TIMESTAMPTZ,
  use_count       INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.saas_api_keys IS
  'Clés API utilisateur (Agency only). key_hash = sha256 hex de la clé full (générée 1 fois, jamais re-affichée). Format clé : gp_live_<24 hex>.';
COMMENT ON COLUMN public.saas_api_keys.key_prefix IS
  'Préfixe lisible affiché dans la liste (12 chars). La clé complète n''est jamais re-affichée après création.';

CREATE INDEX IF NOT EXISTS idx_saas_api_keys_user ON public.saas_api_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_api_keys_prefix_active
  ON public.saas_api_keys(key_prefix)
  WHERE revoked_at IS NULL;

ALTER TABLE public.saas_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners manage api keys" ON public.saas_api_keys
  FOR ALL USING (user_id = auth.uid());

-- ============== Rate limit log ==============
CREATE TABLE IF NOT EXISTS public.saas_api_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      UUID REFERENCES public.saas_api_keys(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,                              -- "GET /v1/brands/:id/snapshots"
  status_code     INT,
  duration_ms     INT,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_api_calls_key_window
  ON public.saas_api_calls(api_key_id, created_at DESC);

-- ============== Helper : count calls last minute (pour rate limit) ==============
CREATE OR REPLACE FUNCTION public.saas_api_calls_count_last_minute(p_api_key_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM public.saas_api_calls
  WHERE api_key_id = p_api_key_id
    AND created_at > NOW() - INTERVAL '1 minute';
$$;

COMMENT ON FUNCTION public.saas_api_calls_count_last_minute(UUID) IS
  'Count des appels API dans la dernière minute pour rate limit (60 req/min Agency).';

-- ============== Cleanup automatique des vieux logs (>7 jours) ==============
-- Pas de cron mis ici, mais on documente : peut être ajouté en pg_cron plus tard.
-- DELETE FROM saas_api_calls WHERE created_at < NOW() - INTERVAL '7 days';
