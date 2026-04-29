# CLAUDE-backend.md — GEOPERF

> Sub-CLAUDE pour bosser sur le backend (étapes 1-5 du pipeline). Lu en complément du `CLAUDE.md` racine quand l'utilisateur dit `[backend]` ou parle de LB / sourcing / sequences / CRM / cron.

---

## Étape 1 — Création des LB (reporting-engine)

**Workflows n8n** (cloud `fredericlefebvre.app.n8n.cloud`) :
- Phase 1 extraction `7DB53pFBW70OtGlM` · webhook `POST /webhook/geoperf-extract` · body `{category_slug, top_n, year}` · 4 LLM parallèle (Perplexity, GPT-4o, Gemini 2.5 Pro, Claude Sonnet 4.6)
- Phase 1.1 synthesis `MMJL9KniTe91QOIu` · auto-chained via pg_net trigger après Phase 1 · Haiku 4.5 par défaut
- Edge Function Supabase `render_white_paper` (Deno) · template HTML Editorial + PDFShift · upload bucket `white-papers` (signed URL 7j)

**Tables** :
- `categories` (34 lignes, dont 28 sous-catégories seed)
- `reports` (`status`, `pdf_url`, `html_url`, `slug_public`, `total_cost_usd`)
- `raw_responses` (1 ligne par appel LLM, full response_json + sources)
- `companies` (60 lignes, 57 unique domains, dédoublonnage par `nom_normalise`)
- `report_companies` (rang + cited_by jsonb + visibility_score 0-4 + market_rank_estimate + ai_saturation_gap)

**Trigger pg_net** : auto-chaîne synthesis après extract complete. Migration `20260427_pg_net_synthesis_trigger.sql`.

**Conventions SQL n8n** : tous les params en `jsonb` (pas array, n8n splitting issue connu) → `($1::jsonb)->>'field'` puis cast `::uuid` ou `::int`.

**Coût/run** : ~$0.20 (4 LLM extract + Haiku synthesis). PDFShift quota free 250/mois.

**Prompts** : `prompts/phase1/` (4 .md, un par LLM).

---

## Étape 2 — Récupération contacts (outreach-engine sourcing)

**Workflow** : Phase 2 sourcing `c85c3pPFq85Iy6O2` · `POST /webhook/geoperf-sourcing` · body `{report_id, max_per_company, min_lead_score, country_filter}`.

**Apollo** :
- Plan Basic 59€/mois (2560 crédits/mois)
- Master API key requise (settings → Integrations → API)
- Credential n8n nommée **`Apollo Api Key`** (HTTP Header Auth, header `x-api-key`)
- Endpoints utilisés :
  - `POST /api/v1/mixed_people/api_search` — search par domain + titles + locations (0 crédit, **params en query string**)
  - `POST /api/v1/people/bulk_match` — enrichment (1 crédit/lead, params en JSON body)

**Param critique** : `q_organization_domains_list[]` (avec `_list`, pas l'ancien `q_organization_domains`).

**Filtre pays** : `country_filter` au workflow → SQL `c.country ILIKE '%X%'` + Apollo `person_locations[]=X`.

**ICP Asset Management** : titles `CMO/Chief Marketing Officer/Directeur Marketing/Head of Brand/Head of Digital`, seniorities `c_suite/vp/director/head`. Détail dans `docs/PHASE2_ICP_APOLLO.md`.

**Tables** :
- `prospects` (status enum : new/queued/sequence_a/sequence_b/engaged/converted/opted_out/bounced/disqualified)
- `tracking_token` (24-hex auto-généré, UNIQUE) → URL `/[sous_cat]?t=...` et `/portal?t=...`
- `prospect_events` (event_type/channel/direction/metadata)

**Trigger Postgres** `handle_prospect_engagement` : transitions auto status sur événement (download → engaged, calendly_booked → converted, etc.). Migration `20260427_prospect_engagement_trigger.sql`. **Ne pas dupliquer en TS.**

**Vues SQL utiles** :
- `v_ai_saturation_opportunities` — prospects HOT (gap < -10%) priorisés
- `v_prospect_landing_context` — pré-join pour landing perso
- `v_portal_dashboard` / `v_portal_company_activity` / `v_portal_competitors` — pour `/portal`

**Loop fan-out splitInBatches** : Apollo node branche en parallèle vers (a) score chain ET (b) `nextBatch`. Sinon le loop casse quand une company a 0 lead.

---

## Étape 3 — Outreach sequences

**Workflow** : Phase 2.2 sequence_load `b6cwag080lQ2Kq4B` · `POST /webhook/geoperf-sequence-load` · body `{report_id, sequence_id, lead_score_min, max}` · **INACTIF par défaut**.

**Flow** : pull eligible prospects → POST `/api/v1/contacts` Apollo (avec `person_id` + label_names) → save `apollo_contact_id` dans `prospects.metadata` → bulk add_contact_ids à la sequence Apollo → update status `sequence_a`.

**Test mode safety** : tant que la sequence Apollo est **paused** (UI Apollo), aucun email ne part même après enrollment. C'est le contrat.

**Custom fields Apollo à créer** (Settings → Custom Fields) pour personnalisation emails :
- `landing_url`, `ranking_position`, `visibility_score`, `competitor_top1`, `subcategory`

**Sequence FR** (3 touches J+0/J+3/J+7) : `docs/PHASE2_EMAIL_SEQUENCE.md`. Copies validées 2026-04-29 après review sub-agent.

**Tracking** :
- `/api/pixel/[token].png` — open tracking
- `/api/click?t=&u=&l=` — click tracking (allowlist hosts)
- `/api/calendly-webhook` — HMAC-SHA256 verif → trigger `calendly_booked`

**Anti-pattern** : ne JAMAIS lever test_mode tant que Fred n'a pas validé explicitement les copies + créé la sequence Apollo paused.

---

## Étape 4 — CRM Attio mirror (à brancher)

Pas encore branché. Plan complet dans `HOUR_AUTONOMY_RECAP.md` annexe B (mapping Supabase ↔ Attio People/Companies/Activities, workflow `geoperf_phase4_attio_sync`, custom fields, pipeline stages).

**Pré-requis Fred** : confirmer plan Attio + créer API key.

**Architecture choisie** (cf `docs/TRACKING_ARCHITECTURE.md`) : sync UNI-directionnelle Supabase → Attio. Supabase = source of truth.

Colonnes prospects préparées : `attio_record_id` (NULL pour l'instant). Quand on branchera : ajouter `attio_synced_at` + `sync_error`.

---

## Étape 5 — Cron auto trimestriel

**Workflow** : Phase 3 `UxuPlDTLEM6MceHR` · INACTIF par défaut · cron `0 8 1 1,4,7,10 *` (1er Jan/Avr/Jul/Oct 8h UTC).

**Flow** : pour chaque sous-catégorie ayant ≥1 report ready, trigger `/webhook/geoperf-extract` avec sleep 60s entre. Anti rate-limit OpenRouter.

À activer quand Fred valide la cadence (peut être ajustée dans le node Schedule trigger).

---

## Anti-patterns backend critiques

1. **Pas d'envoi mail tant que test_mode actif** (sequence Apollo reste paused)
2. **n8n update_workflow** : peut renvoyer 500 transient → retry avec sleep. Mot `placeholder` est réservé SDK
3. **Credentials HTTP Apollo** : doivent être re-liées en UI après chaque update SDK (n8n MCP n'auto-attache pas)
4. **Migrations SQL** : TOUJOURS sauvegarder dans `supabase/migrations/` avant `apply_migration`
5. **Ne pas dupliquer la logique status transition** en TS — c'est dans le trigger Postgres `handle_prospect_engagement`
6. **Ne pas écrire >150 lignes via Write tool** sur le mount Windows (truncation) → bash heredoc

---

## Pointeurs

- Architecture détaillée : `PROJECT_STRUCTURE.md`
- Etat global du système : `STATE_OF_PROJECT.md`
- ICP Apollo Asset Management : `docs/PHASE2_ICP_APOLLO.md`
- Sequence FR : `docs/PHASE2_EMAIL_SEQUENCE.md`
- Tracking architecture : `docs/TRACKING_ARCHITECTURE.md`
- Phase 2.2 setup pas-à-pas : `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md`
- Plan Attio Phase 4 : `HOUR_AUTONOMY_RECAP.md` annexe B
