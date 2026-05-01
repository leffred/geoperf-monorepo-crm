-- GEOPERF SaaS Phase 1 — Cascade trigger post-completion + dédup alertes
-- Spec : saas/SPEC.md sections 5.1, 5.2, 5.3 (cascade auto run → recos → alerts)
--
-- Pourquoi : la cascade côté Edge Function (EdgeRuntime.waitUntil dans saas_run_brand_snapshot)
-- est tuée par le runtime Supabase quand le parent return — résultat : recos+alerts pas
-- générées en cascade auto. Le pattern fiable est un trigger Postgres AFTER UPDATE qui
-- pose 2 jobs pg_net.http_post (asynchrones, non-bloquants) à la transition status→completed.
--
-- Ce pattern est déjà utilisé côté reporting-engine (cf. 20260427_pg_net_synthesis_trigger.sql).
--
-- Bonus : ajout d'un UNIQUE INDEX (snapshot_id, alert_type) pour empêcher les doublons
-- d'alertes quand detect_alerts est appelé plusieurs fois (manuel + cascade).

-- ============== TRIGGER : saas_brand_snapshots → completed ==============
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
  -- Récupère la service_role_key depuis Vault (même secret que le cron)
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[saas snapshot cascade] saas_service_role_key not found in Vault, skipping cascade for snapshot %', NEW.id;
    RETURN NEW;
  END IF;

  -- 1. Génère les recommandations (Haiku)
  PERFORM net.http_post(
    url := base_url || '/saas_generate_recommendations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  -- 2. Détecte les alertes (compare avec snapshot N-1)
  PERFORM net.http_post(
    url := base_url || '/saas_detect_alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('snapshot_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_saas_snapshot_completed() IS
  'Cascade auto post-snapshot : déclenche generate_recommendations + detect_alerts via pg_net.';

-- WHEN clause filter : ne tire QUE sur la transition status → completed (idempotent si re-update)
CREATE TRIGGER saas_snapshot_completion_cascade
  AFTER UPDATE OF status ON public.saas_brand_snapshots
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed'))
  EXECUTE FUNCTION public.handle_saas_snapshot_completed();

-- ============== UNIQUE INDEX anti-doublons sur alertes ==============
-- Empêche detect_alerts de créer 2 alertes identiques (snapshot_id + alert_type)
-- quand il est appelé plusieurs fois sur le même snapshot (manuel + cascade).
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_alerts_snapshot_type
  ON public.saas_alerts(snapshot_id, alert_type);

COMMENT ON INDEX public.uq_saas_alerts_snapshot_type IS
  'Anti-doublons : 1 seule alerte par (snapshot, type). detect_alerts doit upsert ou ignorer en cas de conflit.';
