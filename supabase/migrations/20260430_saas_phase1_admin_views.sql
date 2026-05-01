-- GEOPERF SaaS Phase 1 — Vues admin (KPI overview, top users, snapshots récents)
-- Spec : saas/SPEC.md section 9 (Sprint S5)

-- KPI overview : 4 cards principales
CREATE OR REPLACE VIEW public.v_saas_admin_overview AS
SELECT
  (SELECT COUNT(*) FROM saas_profiles WHERE created_at > NOW() - INTERVAL '30 days') AS signups_30d,
  (SELECT COUNT(*) FROM saas_profiles) AS signups_total,
  (SELECT COUNT(*) FROM saas_subscriptions WHERE status = 'active' AND tier <> 'free') AS active_paid_subs,
  (SELECT COUNT(*) FROM saas_subscriptions WHERE status = 'active' AND tier = 'free') AS active_free_subs,
  (SELECT COALESCE(SUM(CASE tier
      WHEN 'solo'   THEN 149
      WHEN 'pro'    THEN 349
      WHEN 'agency' THEN 899
      ELSE 0
    END), 0)
   FROM saas_subscriptions WHERE status = 'active') AS mrr_eur,
  (SELECT COALESCE(SUM(cost_usd), 0) FROM saas_usage_log WHERE created_at > NOW() - INTERVAL '30 days') AS llm_cost_30d_usd,
  (SELECT COUNT(*) FROM saas_brand_snapshots WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed') AS snapshots_30d,
  (SELECT COUNT(*) FROM saas_alerts WHERE email_sent_at IS NOT NULL AND created_at > NOW() - INTERVAL '30 days') AS emails_sent_30d;

COMMENT ON VIEW public.v_saas_admin_overview IS 'KPI snapshot pour /admin/saas (cards). Single-row.';

-- Top users par cost cumulé (30 derniers jours)
CREATE OR REPLACE VIEW public.v_saas_admin_top_users_cost AS
SELECT
  p.id AS user_id,
  p.email,
  p.company,
  s.tier,
  COUNT(DISTINCT b.id) AS brands_count,
  COALESCE(SUM(u.cost_usd), 0) AS cost_30d_usd,
  COUNT(DISTINCT bs.id) FILTER (WHERE bs.status = 'completed') AS snapshots_30d
FROM saas_profiles p
LEFT JOIN saas_subscriptions s ON s.user_id = p.id AND s.status = 'active'
LEFT JOIN saas_tracked_brands b ON b.user_id = p.id
LEFT JOIN saas_usage_log u ON u.user_id = p.id AND u.created_at > NOW() - INTERVAL '30 days'
LEFT JOIN saas_brand_snapshots bs ON bs.user_id = p.id AND bs.created_at > NOW() - INTERVAL '30 days'
GROUP BY p.id, p.email, p.company, s.tier
ORDER BY cost_30d_usd DESC, snapshots_30d DESC;

COMMENT ON VIEW public.v_saas_admin_top_users_cost IS 'Liste users triée par coût LLM 30j décroissant. Pour /admin/saas et /admin/saas/users.';

-- Distribution tier (donut)
CREATE OR REPLACE VIEW public.v_saas_admin_tier_distribution AS
SELECT tier, COUNT(*) AS n
FROM saas_subscriptions
WHERE status = 'active'
GROUP BY tier;

COMMENT ON VIEW public.v_saas_admin_tier_distribution IS 'Counts par tier pour le donut chart admin.';

-- Snapshots récents avec join brand + user (pour la liste /admin/saas)
CREATE OR REPLACE VIEW public.v_saas_admin_recent_snapshots AS
SELECT
  bs.id,
  bs.status,
  bs.brand_id,
  b.name AS brand_name,
  b.domain AS brand_domain,
  bs.user_id,
  p.email AS user_email,
  bs.visibility_score,
  bs.citation_rate,
  bs.total_cost_usd,
  bs.created_at,
  bs.completed_at,
  bs.error_message,
  EXTRACT(EPOCH FROM (bs.completed_at - bs.created_at)) AS duration_seconds
FROM saas_brand_snapshots bs
JOIN saas_tracked_brands b ON b.id = bs.brand_id
LEFT JOIN saas_profiles p ON p.id = bs.user_id
ORDER BY bs.created_at DESC;

COMMENT ON VIEW public.v_saas_admin_recent_snapshots IS 'Snapshots récents avec brand+user joinés. À limiter par LIMIT côté query.';

-- Évolution signups quotidiens (30 derniers jours)
CREATE OR REPLACE VIEW public.v_saas_admin_signups_daily AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  COUNT(*) AS signups
FROM saas_profiles
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;

COMMENT ON VIEW public.v_saas_admin_signups_daily IS 'Time-series signups daily 30j. Pour le chart évolution admin.';
