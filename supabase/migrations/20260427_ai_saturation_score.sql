-- Sprint 1.2 : Score saturation IA — quantifie l'écart entre rang LLM et rang marché.
-- Une société grosse mais peu citée = score saturation HAUT = OPPORTUNITÉ commerciale Geoperf.
-- Cf. vue v_ai_saturation_opportunities pour les leads HOT/WARM à prioriser dans Apollo Sequences.

ALTER TABLE public.report_companies
  ADD COLUMN IF NOT EXISTS market_rank_estimate INT,
  ADD COLUMN IF NOT EXISTS ai_saturation_gap NUMERIC(5,2);

COMMENT ON COLUMN public.report_companies.market_rank_estimate IS
  'Rang marché estimé via proxy (employee_range + size signals). 1 = plus gros. NULL = inconnu.';
COMMENT ON COLUMN public.report_companies.ai_saturation_gap IS
  'Écart normalisé entre rang LLM et rang marché. Positif = sous-représenté dans LLM (= opportunité). Négatif = sur-représenté.';

CREATE OR REPLACE FUNCTION public.estimate_market_rank_from_size(p_report_id UUID)
RETURNS TABLE(company_id UUID, market_rank INT) AS $$
BEGIN
  RETURN QUERY
  WITH sized AS (
    SELECT c.id,
      COALESCE(
        CASE
          WHEN c.employees_range ~ '10[ ]?000\s*\+' THEN 10000
          WHEN c.employees_range ~ '25[,]?000' THEN 25000
          WHEN c.employees_range ~ '5[ ]?000' THEN 5000
          WHEN c.employees_range ~ '8[ ]?000' THEN 8000
          WHEN c.employees_range ~ '3[ ]?000' THEN 3000
          WHEN c.employees_range ~ '2500' THEN 2500
          ELSE 0
        END, 0) AS approx_employees
    FROM public.companies c
    JOIN public.report_companies rc ON rc.company_id = c.id
    WHERE rc.report_id = p_report_id
  )
  SELECT sized.id, ROW_NUMBER() OVER (ORDER BY sized.approx_employees DESC NULLS LAST)::INT
  FROM sized;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.compute_ai_saturation_for_report(p_report_id UUID)
RETURNS VOID AS $$
DECLARE total_count INT;
BEGIN
  SELECT COUNT(*) INTO total_count FROM public.report_companies WHERE report_id = p_report_id;
  IF total_count = 0 THEN RETURN; END IF;
  WITH market AS (SELECT * FROM public.estimate_market_rank_from_size(p_report_id))
  UPDATE public.report_companies rc
  SET market_rank_estimate = m.market_rank,
      ai_saturation_gap = ROUND(((rc.rank::numeric - m.market_rank) / total_count * 100)::numeric, 2)
  FROM market m
  WHERE rc.company_id = m.company_id AND rc.report_id = p_report_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW public.v_ai_saturation_opportunities AS
SELECT r.id AS report_id, r.sous_categorie, c.nom AS company, c.country, c.domain,
  rc.rank AS ai_rank, rc.market_rank_estimate AS market_rank, rc.ai_saturation_gap, rc.visibility_score,
  CASE
    WHEN rc.ai_saturation_gap >= 30 THEN 'HOT_OPPORTUNITY'
    WHEN rc.ai_saturation_gap >= 15 THEN 'WARM_OPPORTUNITY'
    WHEN rc.ai_saturation_gap <= -15 THEN 'OVER_INDEXED'
    ELSE 'BALANCED'
  END AS saturation_label
FROM public.report_companies rc
JOIN public.companies c ON c.id = rc.company_id
JOIN public.reports r ON r.id = rc.report_id
WHERE rc.market_rank_estimate IS NOT NULL
ORDER BY rc.ai_saturation_gap DESC;

COMMENT ON VIEW public.v_ai_saturation_opportunities IS
  'Vue listant les sociétés par opportunité commerciale Geoperf : HOT = très sous-représentée dans LLM (= proie facile pour audit). À utiliser pour scorer les leads avant outreach Apollo.';
