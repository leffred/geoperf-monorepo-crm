-- S18 §4.1 : Pivot ICP vers PME/ETI FR 50-500 emp
-- Ajout colonne is_active sur categories (masquage UI possible) + insertion 10 nouvelles
-- sous-categories ciblees PME FR. Les anciennes sous-cat restent intactes.

-- 1. Colonne is_active (NULL-safe : retro-compat queries existantes)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Insertion 10 nouvelles sous-cat PME FR
INSERT INTO public.categories (slug, nom, parent_id, ordre, is_active) VALUES
  -- Marketing
  ('agences-digitales-fr',     'Agences digitales FR',          'fa673c9d-cb85-4d05-b321-7df5519ac2c3', 11, TRUE),
  ('edition-medias-b2b-fr',    'Edition / Medias B2B FR',       'fa673c9d-cb85-4d05-b321-7df5519ac2c3', 21, TRUE),
  -- SaaS / Tech
  ('esn-fr-mid-market',        'ESN / SSII FR mid-market',      'df339150-4218-4515-bd75-237e5d3c340a', 60, TRUE),
  ('scaleups-saas-b2b-fr',     'Scale-ups SaaS B2B FR',         'df339150-4218-4515-bd75-237e5d3c340a', 70, TRUE),
  ('edtech-fr',                'Edtech FR',                      'df339150-4218-4515-bd75-237e5d3c340a', 80, TRUE),
  ('healthtech-fr',            'Healthtech FR',                  'df339150-4218-4515-bd75-237e5d3c340a', 90, TRUE),
  -- Finance
  ('fintech-b2b-fr',           'Fintech B2B FR',                'fd89663e-1d36-47a9-a3a4-c57de81e894b', 31, TRUE),
  -- Conseil
  ('conseil-rh-fr',            'Conseil RH FR',                  'fcb4f39d-894f-4014-972d-0b06acdb3911', 31, TRUE),
  ('cabinets-avocats-fr',      'Cabinets d''avocats d''affaires FR', 'fcb4f39d-894f-4014-972d-0b06acdb3911', 60, TRUE),
  -- Industrie
  ('food-d2c-fr',              'Marques food D2C FR',            '72e296f3-f166-4066-8776-63e2e4ae162c', 60, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 3. Index trivial (utile si queries WHERE is_active = TRUE deviennent frequentes)
CREATE INDEX IF NOT EXISTS idx_categories_active
  ON public.categories(is_active)
  WHERE is_active = TRUE;

COMMENT ON COLUMN public.categories.is_active IS
  'S18: permet de masquer une sous-cat sans la supprimer (preserve historique reports/prospects).';
