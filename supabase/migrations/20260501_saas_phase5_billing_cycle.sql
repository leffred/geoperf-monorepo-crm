-- Sprint S13 — Annual pricing -20% (appliquée en prod via apply_migration MCP)
-- Ajoute une colonne billing_cycle à saas_subscriptions pour tracker monthly/annual.
-- Pas de breaking change : DEFAULT 'monthly' couvre les souscriptions existantes.

ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'annual'));

COMMENT ON COLUMN saas_subscriptions.billing_cycle IS
  'Cycle de facturation : monthly ou annual. Annual = -20% sur le prix mensuel × 12. Synchronisé via Stripe webhook checkout.session.completed.';

-- Index utile si on veut filtrer rapidement les annual subs
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_billing_cycle
  ON saas_subscriptions(billing_cycle)
  WHERE billing_cycle = 'annual';
