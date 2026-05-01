-- GEOPERF SaaS Phase 1 — Ajout du type d'alerte citation_gain
-- Spec : saas/SPEC.md section 5.3 (extension produit, alerte symétrique de citation_loss)
--
-- Pourquoi : la spec initiale ne définissait que citation_loss (drop > 20pts).
-- Sans citation_gain, un utilisateur qui voit son taux de citation passer de 30% à 60%
-- (signal commercial fort) n'a aucune notification. On ajoute le pendant positif.
--
-- Note Postgres : ALTER TYPE ... ADD VALUE doit s'exécuter hors d'une transaction où
-- le type est utilisé. La syntaxe IF NOT EXISTS rend la migration idempotente.

ALTER TYPE saas_alert_type ADD VALUE IF NOT EXISTS 'citation_gain';

COMMENT ON TYPE saas_alert_type IS
  'Types d''alertes monitoring : rank_drop/gain, competitor_overtake, new_source, citation_loss/gain.';
