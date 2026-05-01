-- GEOPERF SaaS Phase 2 — Refonte tier (parité GetMint)
-- Spec : SPRINT_S7_BRIEF.md section "Pricing nouvelle grille"
--
-- Ajoute starter + growth à l'enum saas_tier, migre les subs solo→starter
-- (legacy data : aucun sub payant en prod hors test). 'pro' et 'agency' restent.
-- 'solo' reste dans l'enum (immuable Postgres) mais n'est plus utilisé en code.

-- ALTER TYPE ADD VALUE est idempotent via IF NOT EXISTS
ALTER TYPE saas_alert_type ADD VALUE IF NOT EXISTS 'citation_gain';  -- safety re-run, déjà appliqué

ALTER TYPE saas_tier ADD VALUE IF NOT EXISTS 'starter';
ALTER TYPE saas_tier ADD VALUE IF NOT EXISTS 'growth';

COMMENT ON TYPE saas_tier IS
  'Tiers SaaS Geoperf v2 : free (0€), starter (79€), growth (199€), pro (399€), agency (799€). Legacy : solo (=> starter post-migration). Voir TIER_LIMITS dans landing/lib/saas-auth.ts.';
