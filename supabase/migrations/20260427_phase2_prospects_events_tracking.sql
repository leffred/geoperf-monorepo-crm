-- GEOPERF Phase 2 — Tracking prospects + events
-- Appliqué le 2026-04-27 sur projet qfdvdcvqknoqfxetttch

-- Voir la version exacte exécutée dans Supabase Dashboard.
-- Ce fichier est la source de vérité versionnée.

-- ============== PROSPECTS ==============
CREATE TABLE public.prospects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id),
  report_id UUID REFERENCES public.reports(id),

  apollo_person_id TEXT UNIQUE,
  attio_record_id TEXT UNIQUE,

  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  phone TEXT,
  linkedin_url TEXT,
  title TEXT,
  seniority TEXT,
  job_function TEXT,

  tracking_token TEXT UNIQUE NOT NULL DEFAULT (encode(gen_random_bytes(12), 'hex')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','queued','sequence_a','sequence_b','engaged','converted','opted_out','bounced','disqualified')),
  lead_score INT NOT NULL DEFAULT 0,

  first_contact_at TIMESTAMPTZ,
  last_engagement_at TIMESTAMPTZ,
  download_at TIMESTAMPTZ,
  call_booked_at TIMESTAMPTZ,
  call_held_at TIMESTAMPTZ,
  conversion_at TIMESTAMPTZ,
  conversion_value_eur NUMERIC(12,2),
  opt_out_at TIMESTAMPTZ,
  opt_out_reason TEXT,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== SEQUENCES ==============
CREATE TABLE public.sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  sequence_type TEXT NOT NULL CHECK (sequence_type IN ('A','B')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','stopped')),
  current_step_label TEXT,
  apollo_sequence_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stop_reason TEXT
);

-- ============== EVENTS ==============
CREATE TABLE public.prospect_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id UUID NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'prospect_created','prospect_enriched','status_changed',
    'linkedin_message_sent','linkedin_message_replied',
    'email_sent','email_delivered','email_opened','email_clicked','email_replied','email_bounced','email_unsubscribed',
    'landing_visited','download_started','download_completed',
    'calendly_booked','calendly_attended','calendly_no_show','calendly_cancelled',
    'opt_out','manual_note','call_logged','task_created','task_completed'
  )),
  channel TEXT CHECK (channel IN ('linkedin','email','phone','web','calendar','manual','system')),
  direction TEXT CHECK (direction IN ('outbound','inbound','system')),
  step_label TEXT,
  subject TEXT,
  body_summary TEXT,
  response_text TEXT,
  response_sentiment TEXT CHECK (response_sentiment IN ('positive','neutral','negative','opt_out','question')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== INDEXES ==============
CREATE INDEX idx_prospects_company ON public.prospects(company_id);
CREATE INDEX idx_prospects_category ON public.prospects(category_id);
CREATE INDEX idx_prospects_report ON public.prospects(report_id);
CREATE INDEX idx_prospects_status ON public.prospects(status);
CREATE INDEX idx_prospects_email ON public.prospects(email);
CREATE INDEX idx_prospects_token ON public.prospects(tracking_token);
CREATE INDEX idx_prospects_apollo ON public.prospects(apollo_person_id);
CREATE INDEX idx_sequences_prospect ON public.sequences(prospect_id);
CREATE INDEX idx_sequences_status ON public.sequences(status);
CREATE INDEX idx_sequences_next_action ON public.sequences(next_action_at) WHERE status = 'running';
CREATE INDEX idx_events_prospect ON public.prospect_events(prospect_id);
CREATE INDEX idx_events_type ON public.prospect_events(event_type);
CREATE INDEX idx_events_created ON public.prospect_events(created_at DESC);
CREATE INDEX idx_events_sequence ON public.prospect_events(sequence_id);
CREATE INDEX idx_events_step ON public.prospect_events(step_label);

-- ============== TRIGGERS ==============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger qui maintient les jalons funnel sur prospects depuis les events
CREATE OR REPLACE FUNCTION public.update_prospect_milestones() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'outbound' AND NEW.event_type IN ('linkedin_message_sent','email_sent') THEN
    UPDATE public.prospects
    SET first_contact_at = COALESCE(first_contact_at, NEW.created_at),
        last_engagement_at = NEW.created_at
    WHERE id = NEW.prospect_id;
  END IF;
  IF NEW.direction IN ('outbound','inbound') THEN
    UPDATE public.prospects
    SET last_engagement_at = NEW.created_at
    WHERE id = NEW.prospect_id AND (last_engagement_at IS NULL OR last_engagement_at < NEW.created_at);
  END IF;
  IF NEW.event_type = 'download_completed' THEN
    UPDATE public.prospects
    SET download_at = COALESCE(download_at, NEW.created_at),
        status = CASE WHEN status IN ('new','queued','sequence_a') THEN 'engaged' ELSE status END
    WHERE id = NEW.prospect_id;
  END IF;
  IF NEW.event_type = 'calendly_booked' THEN
    UPDATE public.prospects SET call_booked_at = COALESCE(call_booked_at, NEW.created_at) WHERE id = NEW.prospect_id;
  END IF;
  IF NEW.event_type = 'calendly_attended' THEN
    UPDATE public.prospects SET call_held_at = COALESCE(call_held_at, NEW.created_at) WHERE id = NEW.prospect_id;
  END IF;
  IF NEW.event_type IN ('opt_out','email_unsubscribed') THEN
    UPDATE public.prospects
    SET status = 'opted_out',
        opt_out_at = NEW.created_at,
        opt_out_reason = COALESCE(NEW.response_text, NEW.metadata->>'reason')
    WHERE id = NEW.prospect_id;
  END IF;
  IF NEW.event_type = 'email_bounced' THEN
    UPDATE public.prospects SET status = 'bounced' WHERE id = NEW.prospect_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_events_update_milestones
  AFTER INSERT ON public.prospect_events
  FOR EACH ROW EXECUTE FUNCTION public.update_prospect_milestones();

-- ============== RLS ==============
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_events ENABLE ROW LEVEL SECURITY;
