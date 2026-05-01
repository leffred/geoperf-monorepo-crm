-- GEOPERF SaaS Phase 1 — Welcome email post-signup
-- Spec : saas/SPEC.md section 9 (Sprint S6)

-- Colonne pour idempotence (n'envoie qu'une fois par profile)
ALTER TABLE public.saas_profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.saas_profiles.welcome_email_sent_at IS
  'Timestamp d''envoi du welcome email transactionnel. NULL = pas encore envoyé.';

-- Trigger AFTER INSERT ON saas_profiles → fire saas_send_welcome_email via pg_net
CREATE OR REPLACE FUNCTION public.handle_saas_welcome_email_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
BEGIN
  -- Idempotence : skip si déjà envoyé
  IF NEW.welcome_email_sent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[saas welcome email dispatch] saas_service_role_key not found in Vault, skipping for user %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := base_url || '/saas_send_welcome_email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object('user_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_saas_welcome_email_dispatch() IS
  'Dispatch welcome email post-INSERT profile via pg_net → saas_send_welcome_email.';

CREATE TRIGGER saas_welcome_email_dispatch
  AFTER INSERT ON public.saas_profiles
  FOR EACH ROW
  WHEN (NEW.welcome_email_sent_at IS NULL)
  EXECUTE FUNCTION public.handle_saas_welcome_email_dispatch();
