-- S19 §4.1.f : Lead-magnet downloads tracking + anti-abus + CRM hook source
-- Table dediee : decouplee de prospects (qui peut etre absent en cas B "report pas dispo")

CREATE TABLE IF NOT EXISTS public.lead_magnet_downloads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT NOT NULL,
  ip                    TEXT,
  user_agent            TEXT,
  sous_categorie_slug   TEXT NOT NULL,
  report_id             UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  prospect_id           UUID REFERENCES public.prospects(id) ON DELETE SET NULL,
  pdf_url_at_request    TEXT,
  pending               BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at         TIMESTAMPTZ,
  resend_email_id       TEXT,
  source_path           TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  downloaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Anti-abus : lookup rapide par email + fenetre 30j
CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_email
  ON public.lead_magnet_downloads(email);
CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_email_recent
  ON public.lead_magnet_downloads(email, downloaded_at DESC);

-- Suivi par sous-cat (analytics)
CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_sous_cat
  ON public.lead_magnet_downloads(sous_categorie_slug, downloaded_at DESC);

-- Suivi pending (Phase 1 trigger queue analytics)
CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_pending
  ON public.lead_magnet_downloads(downloaded_at DESC)
  WHERE pending = TRUE;

-- RLS : table privee, accessible service_role uniquement
ALTER TABLE public.lead_magnet_downloads ENABLE ROW LEVEL SECURITY;

-- Pas de policy = service_role only par defaut (anon/authenticated bloques)

COMMENT ON TABLE public.lead_magnet_downloads IS
  'S19 lead-magnet flow : capture des telechargements PDF via /etude-sectorielle. Anti-abus 1 rapport/30j par email + tracking pending pour Phase 1 trigger.';
