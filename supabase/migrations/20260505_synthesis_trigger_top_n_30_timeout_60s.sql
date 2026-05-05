-- S20 fix : Phase 1.1 synthesis trigger — top_n 50 -> 30 + pg_net timeout 5s -> 60s
--
-- Contexte (cf. execution n8n 557, report cybersecurite e6830f45-...) :
--   1. Haiku 4.5 trunque a maxTokens=8000 quand top_n=50 (49 societes -> ~12K tokens output).
--      Workaround applique cote n8n : maxTokens 8000 -> 16000.
--      Defense-in-depth ici : reduire top_n a 30 reduit la pression de 40%.
--   2. pg_net default timeout = 5000ms. La synthesis Haiku + render PDF prend 30-60s.
--      pg_net timeout client-side n'annule pas n8n cote serveur, mais on n'a aucune
--      visibilite sur le succes. Bumper a 60000ms permet de capturer le status_code
--      reel dans net._http_response.

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
      'top_n', 30,                          -- S20 : 50 -> 30 pour rester sous le budget Haiku
      'model', 'anthropic/claude-haiku-4.5',
      'triggered_by', 'pg_trigger'
    );
    PERFORM net.http_post(
      url := webhook_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := payload,
      timeout_milliseconds := 60000        -- S20 : 5s default -> 60s pour capturer le status_code reel
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.trigger_synthesis_on_ready IS
  'Auto-fires the n8n synthesis webhook (async via pg_net) when reports.status becomes ready. Skip if html_url already set to avoid loops. S20: top_n=30 + timeout=60s.';
