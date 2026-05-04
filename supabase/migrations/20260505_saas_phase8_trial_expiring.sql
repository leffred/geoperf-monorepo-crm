-- ============================================
-- PHASE 8 — Trial expiring email J-2
-- Sprint S17 - 2026-05-04
-- ============================================

-- 1. Colonne trial_expiring_email_sent_at pour idempotence
ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS trial_expiring_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN saas_subscriptions.trial_expiring_email_sent_at IS
  'Timestamp d''envoi de l''email rappel J-2 fin de trial. Idempotent : si set, l''Edge Function skip.';

-- 2. pg_cron schedule quotidien 8h UTC pour scan trial expiring
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'saas-trial-expiring-check') THEN
    PERFORM cron.unschedule('saas-trial-expiring-check');
  END IF;
END$$;

SELECT cron.schedule(
  'saas-trial-expiring-check',
  '0 8 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_trial_expiring_email',
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
