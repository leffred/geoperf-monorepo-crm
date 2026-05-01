-- GEOPERF SaaS Phase 3 — Cascade trigger extension (sentiment + alignment)
-- Spec : SPRINTS_S8_S9_S10_PLAN.md S9.1, S9.2
--
-- Étend handle_saas_snapshot_completed() pour fire saas_analyze_sentiment +
-- saas_compute_alignment en plus de generate_recommendations + detect_alerts.
-- Le tier-gating se fait côté Edge Function (qui skip si tier insuffisant).

CREATE OR REPLACE FUNCTION public.handle_saas_snapshot_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
BEGIN
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[saas snapshot cascade] saas_service_role_key not found in Vault, skipping cascade for snapshot %', NEW.id;
    RETURN NEW;
  END IF;

  -- 1. Recommandations (Haiku)
  PERFORM net.http_post(
    url := base_url || '/saas_generate_recommendations',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_role_key),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  -- 2. Alertes (compare avec snapshot N-1)
  PERFORM net.http_post(
    url := base_url || '/saas_detect_alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_role_key),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  -- 3. Sentiment analysis (S9 — Growth+ tier-gated côté Edge Function)
  PERFORM net.http_post(
    url := base_url || '/saas_analyze_sentiment',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_role_key),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  -- 4. Brand Alignment (S9 — Pro+ tier-gated côté Edge Function)
  PERFORM net.http_post(
    url := base_url || '/saas_compute_alignment',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_role_key),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_saas_snapshot_completed() IS
  'Cascade auto post-snapshot v3 (S9) : déclenche generate_reco + detect_alerts + analyze_sentiment + compute_alignment via pg_net. Tier-gating côté Edge Functions.';
