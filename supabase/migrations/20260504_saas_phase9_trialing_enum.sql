-- ============================================
-- PHASE 9 — Add 'trialing' to saas_subscription_status enum
-- ============================================
-- Bug discovered S16.2 (2026-05-04) :
-- Le sprint S16 §4.4 a modifié saas_stripe_webhook.mapStripeStatus()
-- pour préserver le status 'trialing' au lieu de le collapser à 'active',
-- mais la valeur 'trialing' n'était PAS dans l'enum saas_subscription_status.
-- Conséquence : UPSERT plantait avec "invalid input value for enum" dès
-- qu'un user faisait un trial Pro 14j → webhook 500, sub bloquée à incomplete.
--
-- Fix : ajouter 'trialing' à l'enum.
-- Note : ALTER TYPE ADD VALUE doit être en migration séparée et committée
-- avant de pouvoir être utilisée dans des queries (limitation Postgres).

ALTER TYPE saas_subscription_status ADD VALUE IF NOT EXISTS 'trialing';
