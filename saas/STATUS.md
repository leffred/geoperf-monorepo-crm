# SaaS — STATUS snapshot

> Snapshot début nuit 2026-04-29 21:05 UTC. Mis à jour à mesure que la session avance.

## DB (qfdvdcvqknoqfxetttch)

### Tables saas_* présentes
- saas_profiles · saas_subscriptions · saas_tracked_brands · saas_brand_snapshots
- saas_snapshot_responses · saas_recommendations · saas_alerts · saas_usage_log

### Vues admin (5/5 attendues)
- v_saas_brand_evolution · v_saas_brand_latest
- v_saas_admin_overview · v_saas_admin_signups_daily · v_saas_admin_tier_distribution
- v_saas_admin_top_users_cost · v_saas_admin_recent_snapshots

### Triggers actifs
- on_auth_user_created_saas (auth.users → profile + free sub auto)
- saas_snapshot_completion_cascade (brand_snapshots completed → fire generate_reco + detect_alerts via pg_net)
- saas_alert_email_dispatch (saas_alerts INSERT → fire saas_send_alert_email via pg_net)

### Triggers manquants pour S6.1
- saas_welcome_email_dispatch (à appliquer ce soir via 20260430_saas_phase1_welcome_email.sql)

### Vault secrets
- saas_service_role_key ✅ présent (utilisé par les triggers DB → Edge Functions)

### Colonnes profile
- email_notifs_enabled ✅
- welcome_email_sent_at ❌ (à ajouter)

### Enum saas_alert_type
- 6 valeurs : rank_drop, rank_gain, competitor_overtake, new_source, citation_loss, citation_gain

## Edge Functions (9 deployed ACTIVE)

| Function | Version | verify_jwt | Status |
|---|---|---|---|
| saas_run_brand_snapshot | v10 | true | ACTIVE |
| saas_generate_recommendations | v6 | true | ACTIVE |
| saas_detect_alerts | v9 | true | ACTIVE |
| saas_run_all_scheduled | v5 | true | ACTIVE |
| saas_send_alert_email | v3 | true | ACTIVE |
| saas_create_checkout_session | v9 | true | ACTIVE |
| saas_create_portal_session | v9 | true | ACTIVE |
| saas_stripe_webhook | v9 | false | ACTIVE |
| render_white_paper | v14 | false | ACTIVE (legacy reporting) |

### Edge Functions manquantes
- saas_send_welcome_email (S6.1 — code à écrire ce soir, deploy = Fred)

## Frontend `landing/`

### Routes /app/* (S3 + S4 livrées)
- /signup, /login, /auth/callback (auth pages)
- /app/dashboard, /app/brands, /app/brands/new, /app/brands/[id]
- /app/billing, /app/settings, /app/alerts
- /app/page.tsx → redirect /app/dashboard

### Routes /admin/* (existantes pré-S5)
- /admin (KPIs prospects + actions reporting)
- /admin/login, /admin/logout, /admin/profiles, /admin/prospects/[id]
- **À créer ce soir** : /admin/saas, /admin/saas/users/[id], /admin/saas/snapshots, /admin/saas/cron

### Composants saas/
- TierBadge, BrandEvolutionChart, AlertBanner, RecommendationList
- **À créer ce soir** : CompetitorMatrix

### Lib
- lib/saas-auth.ts (loadSaasContext, TIER_LIMITS, requireSaasUser…)

## Pattern cascade DB → Edge Functions (état stable confirmé Fred)

Architecture v3 (post-debug WaitUntil) :
- Cascade `snapshot completed` → recos + alerts via **trigger AFTER UPDATE** + `pg_net.http_post` + Vault `saas_service_role_key`
- Dispatch email post-INSERT alerte via **trigger AFTER INSERT** + pg_net + même secret Vault
- Pas de fire-and-forget HTTP côté Edge Function (runtime tué avant l'envoi)

## Env vars / secrets côté Supabase à confirmer Fred

| Secret | Statut probable | Usage |
|---|---|---|
| OPENROUTER_API_KEY | ✅ (cost_usd parsed sur runs précédents) | LLM calls |
| RESEND_API_KEY | ❓ inconnu | saas_send_alert_email + saas_send_welcome_email |
| STRIPE_SECRET_KEY | ❓ | checkout/portal/webhook |
| STRIPE_WEBHOOK_SECRET | ❓ | webhook |
| STRIPE_PRICE_SOLO/PRO/AGENCY | ❓ | checkout |
| APP_URL | ❓ default = geoperf.com | redirect post-checkout |
| ALERTS_EMAIL_FROM | optionnel default = alerts@geoperf.com | sender |
| HELLO_EMAIL_FROM | à ajouter | sender welcome |

## Sprints

- ✅ S1 (DB foundation), S2 (pipeline), S3 (frontend user), S4 (alertes/emails)
- 🌙 **Cette nuit** : S5 (admin/observability) + S6 (welcome + landing /saas) + Q.1-3 si temps

---

> Ce fichier est read-only une fois posé. Tracking sprint = NIGHT_RECAP.md au matin.
