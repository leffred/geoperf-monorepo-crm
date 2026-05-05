-- S20 §4.5 : Compte demo SaaS public
-- Seed user demo@geoperf.com + brand "Demo Corp" + 26 snapshots fictifs sur 6 mois.
-- Donnees anonymisees inspiree de la cat Asset Management (renommee Demo).
-- Login via Edge Function saas_demo_login (service_role mint JWT 24h). Mot de passe
-- bcrypt initial sert au signInWithPassword si jamais utilise (sinon ignore).

-- ============================================================
-- 1. Demo user (auth.users + auth.identities)
-- ============================================================

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES (
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'demo@geoperf.com',
  crypt('DemoGeoperf-2026-Public', gen_salt('bf')),
  NOW() - INTERVAL '6 months',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"is_demo": true, "full_name": "Demo Geoperf"}'::jsonb,
  NOW() - INTERVAL '6 months',
  NOW(),
  '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider, email,
  last_sign_in_at, created_at, updated_at
) VALUES (
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  jsonb_build_object(
    'sub', 'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
    'email', 'demo@geoperf.com',
    'email_verified', true
  ),
  'email',
  'demo@geoperf.com',
  NOW(),
  NOW() - INTERVAL '6 months',
  NOW()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- ============================================================
-- 2. Profile + subscription free
-- ============================================================
INSERT INTO public.saas_profiles (id, email, full_name, company, email_notifs_enabled, digest_weekly_enabled, created_at, updated_at)
VALUES (
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  'demo@geoperf.com',
  'Demo Geoperf',
  'Demo Corp',
  FALSE, -- pas d email envoye sur le compte demo
  FALSE,
  NOW() - INTERVAL '6 months',
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Subscription free active (le trigger handle_new_saas_user devrait l avoir cree —
-- on assure idempotence)
INSERT INTO public.saas_subscriptions (user_id, tier, status, billing_cycle, stripe_subscription_id, created_at, updated_at)
VALUES (
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  'free', 'active', 'monthly', NULL,
  NOW() - INTERVAL '6 months',
  NOW()
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Demo Corp brand
-- ============================================================
INSERT INTO public.saas_tracked_brands (
  id, user_id, name, domain, category_slug, competitor_domains,
  cadence, is_active, brand_description, brand_keywords, brand_value_props,
  created_at
) VALUES (
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30001',
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  'Demo Corp',
  'demo-corp.example',
  'asset-management',
  ARRAY['demo-asset-a.example', 'demo-asset-b.example', 'demo-asset-c.example'],
  'weekly',
  TRUE,
  'Asset manager europeen mid-market specialise dans les fonds ESG et alternatifs. Donnees fictives pour la demo Geoperf publique.',
  ARRAY['esg','alternatifs','mid-market','europe','asset management'],
  ARRAY['Specialiste ESG europeen','Mid-market 10-50Md AUM','Approche systematique multi-asset'],
  NOW() - INTERVAL '6 months'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. 26 snapshots hebdo sur 6 mois — visibility en croissance 40 → 70
-- ============================================================

-- Generation parametrique : 1 snapshot par semaine, ~26 occurrences.
INSERT INTO public.saas_brand_snapshots (
  id, brand_id, user_id, status, llms_used, prompts_count,
  visibility_score, avg_rank, citation_rate, share_of_voice,
  total_cost_usd, raw_response_count,
  brand_mention_count, total_mention_count,
  created_at, completed_at
)
SELECT
  gen_random_uuid(),
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30001',
  'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30000',
  'completed'::saas_snapshot_status,
  ARRAY['openai','anthropic','google','perplexity'],
  30,
  -- visibility_score : croissance lineaire 38 → 72 + bruit ±3
  ROUND( (38 + (week_idx::numeric * (72 - 38) / 25.0) + (random() * 6 - 3))::numeric, 1 ),
  -- avg_rank : decroissance 7.5 → 3.2
  ROUND( (7.5 - (week_idx::numeric * (7.5 - 3.2) / 25.0) + (random() * 0.6 - 0.3))::numeric, 2 ),
  -- citation_rate : 0.42 → 0.78
  ROUND( (0.42 + (week_idx::numeric * (0.78 - 0.42) / 25.0) + (random() * 0.05 - 0.025))::numeric, 3 ),
  -- share_of_voice : 0.18 → 0.34
  ROUND( (0.18 + (week_idx::numeric * (0.34 - 0.18) / 25.0) + (random() * 0.04 - 0.02))::numeric, 3 ),
  -- cost_usd ~5$ par snapshot (4 LLM x 30 prompts)
  ROUND((4.85 + random() * 0.4)::numeric, 4),
  120,
  -- mentions
  20 + (week_idx % 7),
  60 + (week_idx % 11),
  NOW() - ((26 - week_idx) || ' weeks')::INTERVAL,
  NOW() - ((26 - week_idx) || ' weeks')::INTERVAL + INTERVAL '45 seconds'
FROM generate_series(0, 25) AS week_idx
WHERE NOT EXISTS (
  SELECT 1 FROM public.saas_brand_snapshots
  WHERE brand_id = 'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30001'
);

-- ============================================================
-- 5. Quelques recommandations sur le snapshot le plus recent
-- ============================================================
DO $$
DECLARE
  latest_snapshot_id UUID;
BEGIN
  SELECT id INTO latest_snapshot_id
  FROM public.saas_brand_snapshots
  WHERE brand_id = 'd3403d3e-d3d3-d3d3-d3d3-d3d3d3d30001'
  ORDER BY created_at DESC
  LIMIT 1;

  IF latest_snapshot_id IS NOT NULL THEN
    -- Skip si recommandations deja presentes
    IF NOT EXISTS (SELECT 1 FROM public.saas_recommendations WHERE snapshot_id = latest_snapshot_id) THEN
      -- Note : on n insere pas en dur car la table peut avoir un schema strict.
      -- L equivalent realiste serait gere par saas_generate_recommendations Edge Function
      -- sur trigger snapshot.completed. Pour la demo, on laisse ce subset comme TODO admin.
      NULL;
    END IF;
  END IF;
END $$;

-- ============================================================
-- 6. Vue admin prospects (joins prospects + companies + categories)
-- ============================================================
CREATE OR REPLACE VIEW public.v_admin_prospects AS
SELECT
  p.id,
  p.email,
  p.first_name,
  p.last_name,
  p.full_name,
  p.title,
  p.seniority,
  p.email_verified,
  p.lead_score,
  p.status,
  p.tracking_token,
  p.metadata,
  p.first_contact_at,
  p.last_engagement_at,
  p.download_at,
  p.opt_out_at,
  p.created_at,
  p.updated_at,
  p.company_id,
  c.nom        AS company_nom,
  c.domain     AS company_domain,
  c.country    AS company_country,
  c.employees_range AS company_employees_range,
  p.report_id,
  r.sous_categorie AS report_sous_categorie,
  r.slug_public    AS report_slug,
  r.status         AS report_status,
  p.category_id,
  cat.slug         AS category_slug,
  cat.nom          AS category_nom,
  parent_cat.id    AS parent_category_id,
  parent_cat.slug  AS parent_category_slug,
  parent_cat.nom   AS parent_category_nom
FROM public.prospects p
LEFT JOIN public.companies   c          ON c.id = p.company_id
LEFT JOIN public.reports     r          ON r.id = p.report_id
LEFT JOIN public.categories  cat        ON cat.id = p.category_id
LEFT JOIN public.categories  parent_cat ON parent_cat.id = cat.parent_id;

COMMENT ON VIEW public.v_admin_prospects IS
  'S20 §4.2 : agregat prospects + company + category + parent_category pour /admin/prospects.';
