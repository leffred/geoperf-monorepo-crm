-- Sprint 1.2 : Auto-chain Phase 1 → synthesis via Postgres trigger
-- Appliqué le 2026-04-27 sur projet qfdvdcvqknoqfxetttch
-- Remplace le patch manuel n8n PHASE1_CHAIN_PATCH.md (plus simple, découplé)

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_synthesis_on_ready()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url TEXT := 'https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-synthesis';
  payload JSONB;
BEGIN
  -- Only fire if status flipped to 'ready' AND html_url is still null (avoid retriggers)
  IF NEW.status = 'ready' AND NEW.html_url IS NULL AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    payload := jsonb_build_object(
      'report_id', NEW.id::text,
      'top_n', 50,
      'model', 'anthropic/claude-haiku-4.5',
      'triggered_by', 'pg_trigger'
    );
    PERFORM net.http_post(
      url := webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := payload
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_synthesis_trigger ON public.reports;
CREATE TRIGGER reports_synthesis_trigger
AFTER UPDATE OF status ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.trigger_synthesis_on_ready();

COMMENT ON FUNCTION public.trigger_synthesis_on_ready IS
  'Auto-fires the n8n synthesis webhook (async via pg_net) when reports.status becomes ready. Skip if html_url already set to avoid loops.';
COMMENT ON TRIGGER reports_synthesis_trigger ON public.reports IS
  'Chains Phase 1 → Phase 1.1 synthesis automatically. Replaces the manual HTTP node patch in n8n Phase 1 workflow.';

-- To monitor pg_net calls :
-- SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;
