-- GEOPERF SaaS Phase 1 — pg_cron orchestration
-- Spec : saas/SPEC.md section 5.6
-- Projet : qfdvdcvqknoqfxetttch (Frankfurt EU)
--
-- Pré-requis : pg_cron + pg_net + supabase_vault activés.
--
-- Setup manuel à faire UNE FOIS sur un nouveau projet Supabase :
--   1. Stocker la service_role key dans Vault (récupérable sur
--      https://supabase.com/dashboard/project/<ref>/settings/api) :
--        SELECT vault.create_secret(
--          '<SUPABASE_SERVICE_ROLE_KEY>',
--          'saas_service_role_key',
--          'Service role key utilisée par le cron saas_run_all_scheduled'
--        );
--   2. Vérifier que la clé est lisible :
--        SELECT length(decrypted_secret) FROM vault.decrypted_secrets
--          WHERE name = 'saas_service_role_key';
--
-- Note : on n'utilise PAS un GUC ALTER DATABASE ... SET app.service_role_key
-- car Supabase managed refuse cette commande au user postgres (permission denied).
-- Vault est la voie officielle Supabase pour ce cas d'usage.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ============== RPC : marques éligibles à un nouveau snapshot ==============
-- Utilisée par saas_run_all_scheduled. Fallback direct-query côté TS si la RPC plante.
CREATE OR REPLACE FUNCTION public.saas_eligible_brands_for_run()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  cadence TEXT,
  last_snapshot_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.user_id,
    b.name,
    b.cadence,
    (SELECT MAX(s.created_at) FROM public.saas_brand_snapshots s
       WHERE s.brand_id = b.id AND s.status = 'completed') AS last_snapshot_at
  FROM public.saas_tracked_brands b
  WHERE b.is_active = TRUE
    AND (
      (b.cadence = 'weekly'  AND COALESCE((SELECT MAX(s.created_at) FROM public.saas_brand_snapshots s
                                            WHERE s.brand_id = b.id AND s.status = 'completed'), 'epoch'::timestamptz)
                                < NOW() - INTERVAL '7 days')
      OR
      (b.cadence = 'monthly' AND COALESCE((SELECT MAX(s.created_at) FROM public.saas_brand_snapshots s
                                            WHERE s.brand_id = b.id AND s.status = 'completed'), 'epoch'::timestamptz)
                                < NOW() - INTERVAL '30 days')
    );
$$;

COMMENT ON FUNCTION public.saas_eligible_brands_for_run() IS
  'Retourne les marques actives dont le dernier snapshot completed dépasse leur cadence (7j weekly, 30j monthly).';

-- ============== CRON : run hourly orchestrator ==============
-- Exécution : toutes les heures à xx:15 (évite collision avec le cron Phase 3 qui tourne sur ':00')
-- Le BODY contient un JSON vide ; le service_role_key est lu depuis Vault.
SELECT cron.schedule(
  'saas-run-scheduled-snapshots',
  '15 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_run_all_scheduled',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'saas_service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb
    );
  $cron$
);

COMMENT ON EXTENSION pg_cron IS 'pg_cron — utilisé par saas-run-scheduled-snapshots et autres jobs récurrents.';

-- Pour debug / désactiver :
--   SELECT * FROM cron.job WHERE jobname = 'saas-run-scheduled-snapshots';
--   SELECT cron.unschedule('saas-run-scheduled-snapshots');
--   SELECT * FROM cron.job_run_details WHERE jobname = 'saas-run-scheduled-snapshots' ORDER BY start_time DESC LIMIT 10;