-- GEOPERF Phase 1 — Schéma initial
-- Appliqué le 2026-04-27 sur projet qfdvdcvqknoqfxetttch

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============== CATEGORIES (taxonomie B2B) ==============
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  ordre INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.categories IS 'Taxonomie B2B 2 niveaux : parent_id NULL = catégorie racine, sinon = sous-catégorie';

-- ============== REPORTS (1 livre blanc = 1 report) ==============
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES public.categories(id),
  sous_categorie TEXT NOT NULL,
  top_n INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  pdf_url TEXT,
  slug_public TEXT UNIQUE,
  owner_email TEXT,
  total_cost_usd NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

COMMENT ON COLUMN public.reports.slug_public IS 'Sous-domaine public, ex: asset-management pour asset-management.geoperf.com';

-- ============== RAW LLM RESPONSES ==============
CREATE TABLE public.raw_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('perplexity','openai','google','anthropic')),
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response_json JSONB,
  sources_json JSONB,
  tokens_in INT,
  tokens_out INT,
  cost_usd NUMERIC(10,4),
  duration_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============== COMPANIES (master catalog cross-reports) ==============
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL,
  domain TEXT,
  country TEXT,
  employees_range TEXT,
  description TEXT,
  sector_tags TEXT[],
  apollo_organization_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_enriched_at TIMESTAMPTZ,
  UNIQUE(nom_normalise, domain)
);

COMMENT ON COLUMN public.companies.nom_normalise IS 'Lowercase, accents retirés, espaces collapsés. Pour dédoublonnage cross-LLM';

-- ============== REPORT_COMPANIES (visibilité IA par société) ==============
CREATE TABLE public.report_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  rank INT,
  cited_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility_score INT CHECK (visibility_score BETWEEN 0 AND 4),
  avg_position_in_lists NUMERIC(5,2),
  source_count INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_id, company_id)
);

COMMENT ON COLUMN public.report_companies.cited_by IS 'JSON: {"perplexity":true,"openai":false,"google":true,"anthropic":true}';
COMMENT ON COLUMN public.report_companies.visibility_score IS '0-4: nombre de LLM qui ont cité cette société dans ce report';

-- ============== INDEXES ==============
CREATE INDEX idx_categories_parent ON public.categories(parent_id);
CREATE INDEX idx_reports_category ON public.reports(category_id);
CREATE INDEX idx_reports_status ON public.reports(status);
CREATE INDEX idx_reports_slug ON public.reports(slug_public);
CREATE INDEX idx_raw_responses_report ON public.raw_responses(report_id);
CREATE INDEX idx_raw_responses_provider ON public.raw_responses(provider);
CREATE INDEX idx_companies_normalise ON public.companies(nom_normalise);
CREATE INDEX idx_companies_domain ON public.companies(domain);
CREATE INDEX idx_report_companies_report ON public.report_companies(report_id);
CREATE INDEX idx_report_companies_company ON public.report_companies(company_id);
CREATE INDEX idx_report_companies_rank ON public.report_companies(report_id, rank);

-- ============== ROW LEVEL SECURITY ==============
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_companies ENABLE ROW LEVEL SECURITY;
