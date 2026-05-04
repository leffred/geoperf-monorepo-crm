-- ============================================
-- PHASE 7 — Weekly digest + competitor_emerged
-- Sprint S15 - 2026-05-03
-- ============================================

-- 1. Étendre l'ENUM saas_alert_type pour competitor_emerged
-- ALTER TYPE ADD VALUE IF NOT EXISTS est idempotent et hors transaction (Postgres 9.6+).
ALTER TYPE saas_alert_type ADD VALUE IF NOT EXISTS 'competitor_emerged';

-- 2. Preference user pour le digest hebdo (default true)
ALTER TABLE saas_profiles
  ADD COLUMN IF NOT EXISTS digest_weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN saas_profiles.digest_weekly_enabled IS
  'Si true, l''user recoit le digest email chaque lundi 8h CET. Default: true.';

-- 3. pg_cron schedule pour le digest weekly (lundi 7h UTC = 8h CET hiver / 9h CEST ete)
-- Utilise le meme pattern Vault que saas-run-scheduled-snapshots.
-- Vault secret name : saas_service_role_key (deja cree en Phase 1).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'saas-weekly-digest') THEN
    PERFORM cron.unschedule('saas-weekly-digest');
  END IF;
END$$;

SELECT cron.schedule(
  'saas-weekly-digest',
  '0 7 * * 1',
  $cron$
    SELECT net.http_post(
      url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_weekly_digest',
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
