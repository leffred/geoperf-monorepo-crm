-- GEOPERF SaaS Phase 1 — Vue admin pour cron monitoring
-- Spec : NIGHT_BRIEF_S5_S6.md Q.2
--
-- Le schéma cron n'est pas exposé via PostgREST par défaut. On wrap dans une vue
-- public qui joine cron.job + cron.job_run_details, lisible par service_role.

CREATE OR REPLACE VIEW public.v_saas_admin_cron_runs AS
SELECT
  d.runid,
  d.jobid,
  j.jobname,
  j.schedule,
  d.status,
  d.return_message,
  d.start_time,
  d.end_time,
  EXTRACT(EPOCH FROM (d.end_time - d.start_time)) AS duration_seconds,
  d.command
FROM cron.job_run_details d
JOIN cron.job j USING (jobid)
ORDER BY d.start_time DESC;

COMMENT ON VIEW public.v_saas_admin_cron_runs IS
  'Vue admin : runs récents pg_cron joints à leur job. Utilisée par /admin/saas/cron.';

GRANT SELECT ON public.v_saas_admin_cron_runs TO service_role;
