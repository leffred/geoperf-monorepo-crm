-- S18 §4.2 : Quick wins perf identifies via Supabase get_advisors(performance)
-- 1. 5 indexes manquants sur foreign keys
-- 2. Drop d'un index duplique
-- 3. 18 policies RLS optimisees (auth.uid() wrappe en SELECT pour InitPlan caching)
-- pg_stat_statements deja active sur le projet, pas de re-installation.

BEGIN;

-- ============================================================
-- 1. Indexes FK manquants (impact JOIN / cascade DELETE / FK lookup)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_saas_alerts_brand_id
  ON public.saas_alerts(brand_id);

CREATE INDEX IF NOT EXISTS idx_saas_api_calls_user_id
  ON public.saas_api_calls(user_id);

CREATE INDEX IF NOT EXISTS idx_saas_content_drafts_source_snapshot_id
  ON public.saas_content_drafts(source_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_saas_content_drafts_topic_id
  ON public.saas_content_drafts(topic_id);

CREATE INDEX IF NOT EXISTS idx_saas_recommendations_snapshot_id
  ON public.saas_recommendations(snapshot_id);

-- ============================================================
-- 2. Drop index duplique (signal Supabase Advisor)
-- ============================================================
DROP INDEX IF EXISTS public.idx_reports_slug_public_nounique;
-- idx_reports_slug reste actif (UNIQUE prefere).

-- ============================================================
-- 3. RLS policies : wrap auth.uid() pour InitPlan caching
--    Evite la re-evaluation par-row sur les SELECT massifs.
--    Pattern Supabase official : (SELECT auth.uid()) au lieu de auth.uid()
-- ============================================================

-- saas_profiles
ALTER POLICY "users own profile" ON public.saas_profiles
  USING ((SELECT auth.uid()) = id);

-- saas_tracked_brands
ALTER POLICY "users own brands" ON public.saas_tracked_brands
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_brand_snapshots
ALTER POLICY "users read own snapshots" ON public.saas_brand_snapshots
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_alerts
ALTER POLICY "users own alerts" ON public.saas_alerts
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_subscriptions
ALTER POLICY "users read own subscription" ON public.saas_subscriptions
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_usage_log
ALTER POLICY "users read own usage" ON public.saas_usage_log
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_snapshot_responses (EXISTS subquery — optimise auth.uid() interne)
ALTER POLICY "users read own responses" ON public.saas_snapshot_responses
  USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_snapshot_responses.snapshot_id
        AND s.user_id = (SELECT public.saas_account_owner_of(auth.uid()))
    )
  );

-- saas_recommendations
ALTER POLICY "users read own recos" ON public.saas_recommendations
  USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_recommendations.snapshot_id
        AND s.user_id = (SELECT public.saas_account_owner_of(auth.uid()))
    )
  );

-- saas_topics — read
ALTER POLICY "members read account topics" ON public.saas_topics
  USING (
    EXISTS (
      SELECT 1 FROM public.saas_tracked_brands b
      WHERE b.id = saas_topics.brand_id
        AND b.user_id = (SELECT public.saas_account_owner_of(auth.uid()))
    )
  );

-- saas_topics — write
ALTER POLICY "owners write account topics" ON public.saas_topics
  USING (
    EXISTS (
      SELECT 1 FROM public.saas_tracked_brands b
      WHERE b.id = saas_topics.brand_id
        AND b.user_id = (SELECT auth.uid())
    )
  );

-- saas_account_members
ALTER POLICY "members read team" ON public.saas_account_members
  USING (
    account_owner_id = (SELECT public.saas_account_owner_of(auth.uid()))
    OR member_user_id = (SELECT auth.uid())
  );

ALTER POLICY "owners manage team" ON public.saas_account_members
  USING (account_owner_id = (SELECT auth.uid()));

-- saas_account_invitations
ALTER POLICY "owners manage invitations" ON public.saas_account_invitations
  USING (account_owner_id = (SELECT auth.uid()));

-- saas_content_drafts — read
ALTER POLICY "members read account drafts" ON public.saas_content_drafts
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_content_drafts — write
ALTER POLICY "owners write drafts" ON public.saas_content_drafts
  USING (user_id = (SELECT auth.uid()));

-- saas_integrations — write
ALTER POLICY "owners manage integrations" ON public.saas_integrations
  USING (user_id = (SELECT auth.uid()));

-- saas_integrations — read
ALTER POLICY "members read account integrations" ON public.saas_integrations
  USING (user_id = (SELECT public.saas_account_owner_of(auth.uid())));

-- saas_api_keys
ALTER POLICY "owners manage api keys" ON public.saas_api_keys
  USING (user_id = (SELECT auth.uid()));

COMMIT;

-- Note : 24 alertes 'multiple_permissive_policies' restent (refonte design RLS,
-- non prioritaire S18). 34 unused_index conserves (tables jeunes, donnees encore
-- en montee — drop premature risque).
