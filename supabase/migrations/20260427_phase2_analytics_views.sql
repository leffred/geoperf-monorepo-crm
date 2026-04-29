-- GEOPERF Phase 2 — Vues analytiques pour piloter le business
-- Appliqué le 2026-04-27 sur projet qfdvdcvqknoqfxetttch

-- VUE funnel_by_subcategory : "où ça convertit, où ça stagne"
CREATE OR REPLACE VIEW public.funnel_by_subcategory AS
SELECT
  c.id           AS category_id,
  c.nom          AS sous_categorie,
  parent.nom     AS categorie_parent,
  COUNT(DISTINCT p.id)                                                          AS prospects_total,
  COUNT(DISTINCT p.id) FILTER (WHERE p.first_contact_at IS NOT NULL)            AS contacted,
  COUNT(DISTINCT p.id) FILTER (WHERE p.last_engagement_at IS NOT NULL
                                 AND p.last_engagement_at > p.first_contact_at) AS engaged,
  COUNT(DISTINCT p.id) FILTER (WHERE p.download_at IS NOT NULL)                 AS downloaded,
  COUNT(DISTINCT p.id) FILTER (WHERE p.call_booked_at IS NOT NULL)              AS call_booked,
  COUNT(DISTINCT p.id) FILTER (WHERE p.call_held_at IS NOT NULL)                AS call_held,
  COUNT(DISTINCT p.id) FILTER (WHERE p.conversion_value_eur IS NOT NULL
                                 AND p.conversion_value_eur > 0)                AS converted,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'opted_out')                    AS opted_out,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'bounced')                      AS bounced,
  ROUND(100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.download_at IS NOT NULL)
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.first_contact_at IS NOT NULL), 0), 2) AS dl_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.call_booked_at IS NOT NULL)
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.download_at IS NOT NULL), 0), 2)      AS booking_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.call_held_at IS NOT NULL)
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.call_booked_at IS NOT NULL), 0), 2)   AS show_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.conversion_value_eur > 0)
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.call_held_at IS NOT NULL), 0), 2)     AS close_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT p.id) FILTER (WHERE p.conversion_value_eur > 0)
        / NULLIF(COUNT(DISTINCT p.id) FILTER (WHERE p.first_contact_at IS NOT NULL), 0), 2) AS overall_conversion_pct,
  COALESCE(SUM(p.conversion_value_eur), 0) AS total_revenue_eur,
  ROUND(COALESCE(AVG(p.conversion_value_eur) FILTER (WHERE p.conversion_value_eur > 0), 0), 0) AS avg_deal_size_eur
FROM public.categories c
LEFT JOIN public.categories parent ON c.parent_id = parent.id
LEFT JOIN public.prospects p ON p.category_id = c.id
WHERE c.parent_id IS NOT NULL
GROUP BY c.id, c.nom, parent.nom;

-- VUE lever_performance : "M3 vs M2, X1 vs X2..."
CREATE OR REPLACE VIEW public.lever_performance AS
SELECT
  c.nom AS sous_categorie,
  e.step_label AS levier,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type IN ('email_sent','linkedin_message_sent')) AS prospects_touched,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'email_opened')      AS opens,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'email_clicked')     AS clicks,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'email_replied')     AS replies,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'download_completed') AS downloads_after_step,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'calendly_booked')   AS bookings_after_step,
  ROUND(100.0 * COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'email_opened')
        / NULLIF(COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type IN ('email_sent','linkedin_message_sent')), 0), 2) AS open_rate_pct,
  ROUND(100.0 * COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'email_replied')
        / NULLIF(COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type IN ('email_sent','linkedin_message_sent')), 0), 2) AS reply_rate_pct
FROM public.prospect_events e
LEFT JOIN public.prospects p ON e.prospect_id = p.id
LEFT JOIN public.categories c ON p.category_id = c.id
WHERE e.step_label IS NOT NULL
GROUP BY c.nom, e.step_label
ORDER BY c.nom, e.step_label;

-- VUE prospect_timeline : raconte tout ce qui s est passé sur un prospect
CREATE OR REPLACE VIEW public.prospect_timeline AS
SELECT
  p.id AS prospect_id, p.full_name, p.email, p.title, p.status AS prospect_status,
  comp.nom AS company_name, c.nom AS sous_categorie,
  e.created_at AS event_at, e.event_type, e.channel, e.direction, e.step_label,
  e.subject, e.body_summary, e.response_text, e.response_sentiment
FROM public.prospects p
LEFT JOIN public.companies comp ON p.company_id = comp.id
LEFT JOIN public.categories c ON p.category_id = c.id
LEFT JOIN public.prospect_events e ON e.prospect_id = p.id
ORDER BY p.id, e.created_at;

-- VUE daily_metrics : évolution dans le temps
CREATE OR REPLACE VIEW public.daily_metrics AS
SELECT
  DATE(e.created_at) AS day,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'prospect_created')   AS new_prospects,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type IN ('email_sent','linkedin_message_sent')) AS contacts_made,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'download_completed') AS downloads,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'calendly_booked')    AS bookings,
  COUNT(DISTINCT e.prospect_id) FILTER (WHERE e.event_type = 'opt_out')            AS opt_outs
FROM public.prospect_events e
GROUP BY DATE(e.created_at)
ORDER BY day DESC;
