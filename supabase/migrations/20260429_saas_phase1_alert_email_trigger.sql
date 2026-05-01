-- GEOPERF SaaS Phase 1 — Trigger DB pour dispatch email après insert d'alerte
-- Spec : saas/SPEC.md sections 5.3, 5.5
--
-- Pourquoi : on a abandonné EdgeRuntime.waitUntil dans saas_detect_alerts (cascade
-- silencieusement perdue par cleanup runtime — même bug que la cascade snapshot→recos
-- corrigée par 20260429_saas_phase1_completion_cascade.sql).
--
-- Pattern : trigger Postgres AFTER INSERT ON saas_alerts qui pose un job pg_net.http_post
-- vers saas_send_alert_email. La fonction send_alert_email gère déjà tier=free / opt-out /
-- déjà envoyé / pas de RESEND_API_KEY → on peut tirer aveuglément, elle skip proprement.

CREATE OR REPLACE FUNCTION public.handle_saas_alert_email_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
BEGIN
  -- Sanity : ne tire que si email pas encore envoyé (idempotence si re-INSERT après upsert)
  IF NEW.email_sent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[saas alert email dispatch] saas_service_role_key not found in Vault, skipping email for alert %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := base_url || '/saas_send_alert_email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('alert_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_saas_alert_email_dispatch() IS
  'Dispatch email post-INSERT alerte via pg_net → saas_send_alert_email (qui gère tier/opt-out/skip).';

CREATE TRIGGER saas_alert_email_dispatch
  AFTER INSERT ON public.saas_alerts
  FOR EACH ROW
  WHEN (NEW.email_sent_at IS NULL)
  EXECUTE FUNCTION public.handle_saas_alert_email_dispatch();
