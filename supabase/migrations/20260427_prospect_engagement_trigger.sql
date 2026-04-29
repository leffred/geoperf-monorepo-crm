-- Phase 2.2 : auto-transition prospects sur events critiques.
-- Test-mode safe : aucun appel sortant Apollo/email. Activable plus tard en décommentant net.http_post.

CREATE OR REPLACE FUNCTION public.handle_prospect_engagement()
RETURNS TRIGGER AS $$
DECLARE p_status TEXT;
BEGIN
  IF NEW.event_type = 'download_completed' THEN
    SELECT status INTO p_status FROM public.prospects WHERE id = NEW.prospect_id;
    IF p_status IN ('new','queued','sequence_a') THEN
      UPDATE public.prospects
      SET status = 'engaged',
          download_at = COALESCE(download_at, NOW()),
          last_engagement_at = NOW()
      WHERE id = NEW.prospect_id;
      INSERT INTO public.prospect_events (prospect_id, event_type, channel, direction, metadata)
      VALUES (NEW.prospect_id, 'status_changed', 'system', 'system',
              jsonb_build_object('from', p_status, 'to', 'engaged', 'reason', 'download_completed', 'auto_trigger', true));
    END IF;
    -- TODO post-test : décommenter pour déclencher Sequence B Apollo
    -- PERFORM net.http_post(url := '...', body := jsonb_build_object('prospect_id', NEW.prospect_id::text));

  ELSIF NEW.event_type = 'calendly_booked' THEN
    UPDATE public.prospects
    SET status = 'converted',
        call_booked_at = COALESCE(call_booked_at, NOW()),
        conversion_at = COALESCE(conversion_at, NOW()),
        last_engagement_at = NOW()
    WHERE id = NEW.prospect_id AND status NOT IN ('converted','opted_out');

  ELSIF NEW.event_type IN ('opt_out','email_unsubscribed') THEN
    UPDATE public.prospects
    SET status = 'opted_out',
        opt_out_at = COALESCE(opt_out_at, NOW()),
        opt_out_reason = COALESCE(opt_out_reason, 'auto: ' || NEW.event_type)
    WHERE id = NEW.prospect_id;

  ELSIF NEW.event_type = 'email_bounced' THEN
    UPDATE public.prospects SET status = 'bounced'
    WHERE id = NEW.prospect_id AND status != 'opted_out';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prospect_events_engagement_trigger ON public.prospect_events;
CREATE TRIGGER prospect_events_engagement_trigger
AFTER INSERT ON public.prospect_events
FOR EACH ROW EXECUTE FUNCTION public.handle_prospect_engagement();

CREATE OR REPLACE VIEW public.v_sequence_b_queue AS
SELECT p.id, p.full_name, p.email, p.title, c.nom AS company,
  p.lead_score, p.download_at, p.status,
  EXTRACT(EPOCH FROM (NOW() - p.download_at)) / 3600 AS hours_since_download,
  (SELECT COUNT(*) FROM public.prospect_events pe WHERE pe.prospect_id = p.id AND pe.event_type LIKE 'email_%') AS email_events_count
FROM public.prospects p
JOIN public.companies c ON c.id = p.company_id
WHERE p.status = 'engaged' AND p.conversion_at IS NULL AND p.opt_out_at IS NULL
ORDER BY p.download_at DESC;
