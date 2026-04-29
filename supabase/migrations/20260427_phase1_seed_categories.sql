-- GEOPERF Phase 1 — Seed taxonomie B2B
-- Appliqué le 2026-04-27. 6 catégories parent + 28 sous-catégories.

INSERT INTO public.categories (nom, slug, parent_id, ordre) VALUES
  ('Finance',          'finance',     NULL, 10),
  ('SaaS / Tech',      'saas-tech',   NULL, 20),
  ('Conseil',          'conseil',     NULL, 30),
  ('Industrie',        'industrie',   NULL, 40),
  ('Marketing',        'marketing',   NULL, 50),
  ('Logistique',       'logistique',  NULL, 60);

-- Finance
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('Asset Management',     'asset-management',     10),
  ('Banque privée',        'banque-privee',        20),
  ('Fintech B2B',          'fintech-b2b',          30),
  ('Assurance entreprise', 'assurance-entreprise', 40),
  ('Conseil M&A',          'conseil-ma',           50)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'finance';

-- SaaS / Tech
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('CRM',            'crm',            10),
  ('ERP',            'erp',            20),
  ('Cybersécurité',  'cybersecurite',  30),
  ('DevOps',         'devops',         40),
  ('Data analytics', 'data-analytics', 50)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'saas-tech';

-- Conseil
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('Stratégie',                'strategie',                 10),
  ('Transformation digitale',  'transformation-digitale',   20),
  ('Conseil RH',               'conseil-rh',                30),
  ('Audit',                    'audit',                     40),
  ('Juridique',                'juridique',                 50)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'conseil';

-- Industrie
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('Aéronautique',     'aeronautique',     10),
  ('Automotive',       'automotive',       20),
  ('Énergie',          'energie',          30),
  ('Pharma',           'pharma',           40),
  ('Agro-industrie',   'agro-industrie',   50)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'industrie';

-- Marketing
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('Agences digitales',  'agences-digitales',  10),
  ('Médias B2B',         'medias-b2b',         20),
  ('Influence B2B',      'influence-b2b',      30),
  ('MarTech',            'martech',            40)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'marketing';

-- Logistique
INSERT INTO public.categories (nom, slug, parent_id, ordre)
SELECT v.nom, v.slug, p.id, v.ordre
FROM (VALUES
  ('Supply chain SaaS',  'supply-chain-saas',  10),
  ('Transport',          'transport',          20),
  ('Entreposage',        'entreposage',        30),
  ('Last-mile',          'last-mile',          40)
) AS v(nom, slug, ordre)
CROSS JOIN public.categories p WHERE p.slug = 'logistique';
