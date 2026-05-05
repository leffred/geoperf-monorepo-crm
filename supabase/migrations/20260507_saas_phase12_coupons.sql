-- S20 §4.1 : Coupon redemption — trial Starter 14j gratuit
-- Distribue par Frederic en 1-1 / Sequence A → l user signe Starter avec trial.

CREATE TABLE IF NOT EXISTS public.saas_coupons (
  code              TEXT PRIMARY KEY,
  tier_target       TEXT NOT NULL,
  trial_days        INTEGER NOT NULL DEFAULT 14,
  max_uses          INTEGER,
  used_count        INTEGER NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT saas_coupons_tier_check CHECK (tier_target IN ('starter','growth','pro','agency')),
  CONSTRAINT saas_coupons_trial_check CHECK (trial_days >= 0 AND trial_days <= 365),
  CONSTRAINT saas_coupons_used_check CHECK (used_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.saas_coupon_redemptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_code             TEXT NOT NULL REFERENCES public.saas_coupons(code) ON DELETE CASCADE,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email                   TEXT NOT NULL,
  stripe_subscription_id  TEXT,
  redeemed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_per_coupon UNIQUE (coupon_code, user_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_code
  ON public.saas_coupon_redemptions(coupon_code);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_email
  ON public.saas_coupon_redemptions(email);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_stripe_sub
  ON public.saas_coupon_redemptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- RLS : coupons + redemptions privees (admin uniquement via service_role)
ALTER TABLE public.saas_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- Vue admin pour lister coupons + status calcule
CREATE OR REPLACE VIEW public.v_admin_coupons AS
SELECT
  c.code,
  c.tier_target,
  c.trial_days,
  c.max_uses,
  c.used_count,
  c.expires_at,
  c.is_active,
  c.notes,
  c.created_at,
  c.created_by,
  CASE
    WHEN c.is_active = FALSE THEN 'disabled'
    WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 'expired'
    WHEN c.max_uses IS NOT NULL AND c.used_count >= c.max_uses THEN 'exhausted'
    ELSE 'active'
  END AS status,
  (SELECT COUNT(*) FROM public.saas_coupon_redemptions r WHERE r.coupon_code = c.code) AS redemption_count
FROM public.saas_coupons c;

COMMENT ON TABLE public.saas_coupons IS
  'S20: coupons offrant un trial Starter/Growth/Pro/Agency. Cree via /admin/saas/coupons.';
COMMENT ON TABLE public.saas_coupon_redemptions IS
  'S20: 1 ligne par couple (coupon, user). Inseree au checkout, mise a jour via webhook subscription.created.';
