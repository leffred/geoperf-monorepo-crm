-- GEOPERF SaaS Phase 1 — Préférences notifications
-- Spec : saas/SPEC.md section 5.5 + 6.4
-- Projet : qfdvdcvqknoqfxetttch
--
-- Ajoute le toggle email_notifs_enabled sur saas_profiles. Default TRUE pour ne pas
-- créer de surprise sur les comptes existants. Le toggle est exposé dans /app/settings.

ALTER TABLE public.saas_profiles
  ADD COLUMN IF NOT EXISTS email_notifs_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.saas_profiles.email_notifs_enabled IS
  'Si false, saas_send_alert_email ne tente même pas l''envoi pour ce user (opt-out). Default true.';

-- Backfill explicite (au cas où la default ne s'appliquerait pas sur les rows existantes — ALTER ADD COLUMN avec NOT NULL DEFAULT le fait, mais idempotent)
UPDATE public.saas_profiles SET email_notifs_enabled = TRUE WHERE email_notifs_enabled IS NULL;
