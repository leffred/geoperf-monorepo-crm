-- GEOPERF SaaS Phase 4 — Webhook integrations (Slack / Teams / Discord / custom)
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S10.3
--
-- 1 row = 1 webhook configuré par un user. Quand une alerte est insérée dans
-- saas_alerts, un trigger AFTER INSERT fire saas_dispatch_integration_webhooks
-- via pg_net qui POST sur les webhooks actifs du user matchant les events.

DO $$ BEGIN
  CREATE TYPE saas_integration_type AS ENUM ('slack', 'teams', 'discord', 'webhook_custom');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.saas_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  type            saas_integration_type NOT NULL,
  name            TEXT NOT NULL,                              -- ex: "#alerts-geoperf prod"
  webhook_url     TEXT NOT NULL,
  events          TEXT[] NOT NULL DEFAULT '{rank_drop_high,competitor_overtake_high,citation_loss_high}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_sent_at    TIMESTAMPTZ,
  last_error      TEXT,
  send_count      INT NOT NULL DEFAULT 0,
  fail_count      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.saas_integrations IS
  'Webhooks vers Slack/Teams/Discord/custom. events[] = pattern alert_type+severity (ex: "rank_drop_high"). Si events vide, tous events fire.';
COMMENT ON COLUMN public.saas_integrations.events IS
  'Liste de patterns "alert_type" ou "alert_type_severity" (ex: rank_drop, rank_drop_high, citation_loss_medium). [] = match all.';

CREATE INDEX IF NOT EXISTS idx_saas_integrations_user_active
  ON public.saas_integrations(user_id, is_active)
  WHERE is_active = TRUE;

CREATE TRIGGER trg_saas_integrations_updated_at
  BEFORE UPDATE ON public.saas_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saas_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners manage integrations" ON public.saas_integrations
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "members read account integrations" ON public.saas_integrations
  FOR SELECT USING (user_id = public.saas_account_owner_of(auth.uid()));

-- ============== Trigger DB : alerte → fire dispatch ==============
CREATE OR REPLACE FUNCTION public.handle_saas_alert_dispatch_integrations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
BEGIN
  -- Skip si l'alerte vient d'être insérée mais sans intégration possible
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[saas integration dispatch] saas_service_role_key not found in Vault, skipping for alert %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := base_url || '/saas_dispatch_integration_webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('alert_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_saas_alert_dispatch_integrations() IS
  'Dispatch webhook integrations post-INSERT alert via pg_net → saas_dispatch_integration_webhooks. Tier-gating géré côté Edge Function.';

DROP TRIGGER IF EXISTS saas_alert_dispatch_integrations ON public.saas_alerts;
CREATE TRIGGER saas_alert_dispatch_integrations
  AFTER INSERT ON public.saas_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_saas_alert_dispatch_integrations();
