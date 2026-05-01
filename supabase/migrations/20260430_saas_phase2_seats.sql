-- GEOPERF SaaS Phase 2 — Multi-seats (membres dans un compte)
-- Spec : SPRINT_S7_BRIEF.md "Multi-seats"
--
-- Concept : l'owner = saas_subscriptions.user_id (celui qui paye). Les members
-- consomment le tier de l'owner. Les invitations en attente vivent dans
-- saas_account_invitations jusqu'à acceptation via /auth/accept?token=...

DO $$ BEGIN
  CREATE TYPE saas_member_role AS ENUM ('owner', 'admin', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.saas_account_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id  UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  member_user_id    UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  role              saas_member_role NOT NULL DEFAULT 'viewer',
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  UNIQUE(account_owner_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_account_members_owner ON public.saas_account_members(account_owner_id);
CREATE INDEX IF NOT EXISTS idx_saas_account_members_member ON public.saas_account_members(member_user_id);

CREATE TABLE IF NOT EXISTS public.saas_account_invitations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id  UUID NOT NULL REFERENCES public.saas_profiles(id) ON DELETE CASCADE,
  invitee_email     TEXT NOT NULL,
  role              saas_member_role NOT NULL DEFAULT 'viewer',
  token             TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  UNIQUE(account_owner_id, invitee_email)
);

CREATE INDEX IF NOT EXISTS idx_saas_account_invitations_email ON public.saas_account_invitations(invitee_email);
CREATE INDEX IF NOT EXISTS idx_saas_account_invitations_owner ON public.saas_account_invitations(account_owner_id);

COMMENT ON TABLE public.saas_account_members IS
  'Members invités dans un compte. L''owner paye, les members consomment le tier de l''owner. Voir lib/saas-auth.ts loadSaasContext().';

COMMENT ON TABLE public.saas_account_invitations IS
  'Invitations en attente. Token unique encodé en URL /auth/accept?token=... Une fois acceptée, accepted_at est set et une row saas_account_members est créée.';

-- ============== Helper view : compte effectif d'un user ==============
-- Donne le account_owner_id pour un user (si membre) ou son propre id (si owner)
CREATE OR REPLACE VIEW public.v_saas_user_account AS
SELECT
  p.id AS user_id,
  COALESCE(m.account_owner_id, p.id) AS account_owner_id,
  COALESCE(m.role, 'owner'::saas_member_role) AS role,
  m.accepted_at AS joined_at
FROM public.saas_profiles p
LEFT JOIN public.saas_account_members m
  ON m.member_user_id = p.id AND m.accepted_at IS NOT NULL;

COMMENT ON VIEW public.v_saas_user_account IS
  'Pour chaque user : si membre accepté → renvoie account_owner_id + role ; sinon → l''user est owner de son propre compte.';

GRANT SELECT ON public.v_saas_user_account TO service_role;

-- ============== RLS adaptations ==============
-- Les members doivent voir les brands/snapshots/etc. de leur owner.
-- Update les policies existantes pour autoriser également les members.

-- Helper inline pour éviter de répéter le subquery
CREATE OR REPLACE FUNCTION public.saas_account_owner_of(uid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_owner_id FROM public.v_saas_user_account WHERE user_id = uid LIMIT 1;
$$;

-- Brand : l'user voit les brands de son account (owner OU members acceptés)
DROP POLICY IF EXISTS "users own brands" ON public.saas_tracked_brands;
CREATE POLICY "users own brands" ON public.saas_tracked_brands
  FOR ALL USING (
    user_id = public.saas_account_owner_of(auth.uid())
  );

-- Snapshots : SELECT pour members
DROP POLICY IF EXISTS "users read own snapshots" ON public.saas_brand_snapshots;
CREATE POLICY "users read own snapshots" ON public.saas_brand_snapshots
  FOR SELECT USING (
    user_id = public.saas_account_owner_of(auth.uid())
  );

-- Alerts : SELECT/UPDATE (mark read) pour members
DROP POLICY IF EXISTS "users own alerts" ON public.saas_alerts;
CREATE POLICY "users own alerts" ON public.saas_alerts
  FOR ALL USING (
    user_id = public.saas_account_owner_of(auth.uid())
  );

-- Subscription : SELECT pour members (visible mais non-modifiable)
DROP POLICY IF EXISTS "users read own subscription" ON public.saas_subscriptions;
CREATE POLICY "users read own subscription" ON public.saas_subscriptions
  FOR SELECT USING (
    user_id = public.saas_account_owner_of(auth.uid())
  );

-- Usage log : SELECT pour members
DROP POLICY IF EXISTS "users read own usage" ON public.saas_usage_log;
CREATE POLICY "users read own usage" ON public.saas_usage_log
  FOR SELECT USING (
    user_id = public.saas_account_owner_of(auth.uid())
  );

-- Profile : seul l'user voit/modifie son propre profile (pas étendu aux members)
-- Idem pour saas_recommendations et saas_snapshot_responses : héritage via saas_brand_snapshots
DROP POLICY IF EXISTS "users read own responses" ON public.saas_snapshot_responses;
CREATE POLICY "users read own responses" ON public.saas_snapshot_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_snapshot_responses.snapshot_id
        AND s.user_id = public.saas_account_owner_of(auth.uid())
    )
  );

DROP POLICY IF EXISTS "users read own recos" ON public.saas_recommendations;
CREATE POLICY "users read own recos" ON public.saas_recommendations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saas_brand_snapshots s
      WHERE s.id = saas_recommendations.snapshot_id
        AND s.user_id = public.saas_account_owner_of(auth.uid())
    )
  );

-- saas_topics et saas_account_members RLS
ALTER TABLE public.saas_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_account_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read account topics" ON public.saas_topics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saas_tracked_brands b
      WHERE b.id = saas_topics.brand_id
        AND b.user_id = public.saas_account_owner_of(auth.uid())
    )
  );
CREATE POLICY "owners write account topics" ON public.saas_topics
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.saas_tracked_brands b
      WHERE b.id = saas_topics.brand_id
        AND b.user_id = auth.uid()  -- only owners can edit topics
    )
  );

CREATE POLICY "members read team" ON public.saas_account_members
  FOR SELECT USING (
    account_owner_id = public.saas_account_owner_of(auth.uid())
    OR member_user_id = auth.uid()
  );
CREATE POLICY "owners manage team" ON public.saas_account_members
  FOR ALL USING (account_owner_id = auth.uid());

CREATE POLICY "owners manage invitations" ON public.saas_account_invitations
  FOR ALL USING (account_owner_id = auth.uid());
