-- S21 fix : Auto-dispatch lead-magnet email quand PDF d'un report devient dispo
--
-- Contexte : le flow lead-magnet S19 cas B (rapport pas dispo) crée une row
-- lead_magnet_downloads avec pending=TRUE et déclenche Phase 1. Une fois Phase 1
-- terminée + Phase 1.1 synthesis terminée, reports.pdf_url est set MAIS aucun
-- mécanisme ne dispatch l'email aux pending downloads. Trou trouvé en testant
-- le report cybersecurite (e6830f45-...).
--
-- Fix : trigger AFTER UPDATE OF pdf_url ON reports qui :
--   1. Match les lead_magnet_downloads pending sur (sous_categorie_slug = slug_public)
--   2. Update report_id + pdf_url_at_request + pending=FALSE
--   3. Fire saas_send_lead_magnet_email via pg_net (async)
--
-- Pattern aligné sur 20260429_saas_phase1_completion_cascade.sql (Vault + SECURITY DEFINER + pg_net).

-- ============== TRIGGER FUNCTION ==============
CREATE OR REPLACE FUNCTION public.dispatch_lead_magnet_on_pdf_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
  pending_record RECORD;
  dispatched_count INT := 0;
BEGIN
  -- Get service role key from Vault (same secret as SaaS cascade)
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE WARNING '[lead_magnet dispatch] saas_service_role_key not found in Vault, skipping for report %', NEW.id;
    RETURN NEW;
  END IF;

  -- For each pending lead-magnet matching this report's slug_public, attach + fire email
  FOR pending_record IN
    SELECT id, email
    FROM public.lead_magnet_downloads
    WHERE pending = TRUE
      AND sous_categorie_slug = NEW.slug_public
      AND email_sent_at IS NULL
  LOOP
    -- Attach report and clear pending (idempotent : guard pending=TRUE in WHERE)
    UPDATE public.lead_magnet_downloads
    SET report_id = NEW.id,
        pdf_url_at_request = NEW.pdf_url,
        pending = FALSE
    WHERE id = pending_record.id
      AND pending = TRUE;

    -- Fire-and-forget email dispatch (Edge Function gère idempotency via email_sent_at)
    PERFORM net.http_post(
      url := base_url || '/saas_send_lead_magnet_email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'email', pending_record.email,
        'report_id', NEW.id::text
      ),
      timeout_milliseconds := 60000
    );

    dispatched_count := dispatched_count + 1;
  END LOOP;

  IF dispatched_count > 0 THEN
    RAISE NOTICE '[lead_magnet dispatch] report % (slug=%) : % pending downloads dispatched', NEW.id, NEW.slug_public, dispatched_count;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.dispatch_lead_magnet_on_pdf_ready() IS
  'S21 : auto-dispatch lead-magnet emails quand un report passe de pdf_url=NULL à set. Match sur slug_public.';

-- ============== TRIGGER ==============
DROP TRIGGER IF EXISTS lead_magnet_dispatch_on_pdf_ready ON public.reports;
CREATE TRIGGER lead_magnet_dispatch_on_pdf_ready
  AFTER UPDATE OF pdf_url ON public.reports
  FOR EACH ROW
  WHEN (NEW.pdf_url IS NOT NULL AND OLD.pdf_url IS DISTINCT FROM NEW.pdf_url)
  EXECUTE FUNCTION public.dispatch_lead_magnet_on_pdf_ready();

COMMENT ON TRIGGER lead_magnet_dispatch_on_pdf_ready ON public.reports IS
  'Cascade auto vers saas_send_lead_magnet_email pour les pending downloads matching slug_public.';

-- ============== RATTRAPAGE — pending downloads existants avec PDF déjà dispo ==============
-- Couvre le cas du user lefebvre.frederic+11@gmail.com (cybersecurite) + tout autre
-- pending=TRUE dont le report a un PDF arrivé avant cette migration.
DO $$
DECLARE
  service_role_key TEXT;
  base_url TEXT := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1';
  rec RECORD;
  count_dispatched INT := 0;
BEGIN
  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'saas_service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE NOTICE '[rattrapage] saas_service_role_key absent, skipping rattrapage';
    RETURN;
  END IF;

  FOR rec IN
    SELECT lmd.id AS lmd_id, lmd.email, r.id AS report_id, r.pdf_url
    FROM public.lead_magnet_downloads lmd
    JOIN public.reports r ON r.slug_public = lmd.sous_categorie_slug
    WHERE lmd.pending = TRUE
      AND lmd.email_sent_at IS NULL
      AND r.status = 'ready'
      AND r.pdf_url IS NOT NULL
    ORDER BY lmd.created_at ASC
  LOOP
    UPDATE public.lead_magnet_downloads
    SET report_id = rec.report_id,
        pdf_url_at_request = rec.pdf_url,
        pending = FALSE
    WHERE id = rec.lmd_id
      AND pending = TRUE;

    PERFORM net.http_post(
      url := base_url || '/saas_send_lead_magnet_email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'email', rec.email,
        'report_id', rec.report_id::text
      ),
      timeout_milliseconds := 60000
    );

    count_dispatched := count_dispatched + 1;
  END LOOP;

  RAISE NOTICE '[rattrapage] dispatched % pending lead-magnet emails for already-ready reports', count_dispatched;
END;
$$;
