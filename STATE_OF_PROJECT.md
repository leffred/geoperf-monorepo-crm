# GEOPERF — État du système (snapshot 2026-04-28 fin de journée)

> Document audit. Snapshot du système en fin de session du 28 avril 2026, après les patches Apollo + auth admin Supabase + page SEO `/profile/[domain]`. À actualiser après chaque session importante.

---

## TL;DR

Pipeline B2B lead-magnet **opérationnel end-to-end pour Asset Management** :

1. **Reporting engine** ✅ produit un livre blanc HTML+PDF brandé (~$0.20/run, ~2 min)
2. **Sourcing engine** ✅ trouve les CMOs ICP via Apollo, enrichit emails verified (1 crédit/lead)
3. **Frontend** ✅ landing perso + portal client + admin loggué + profils SEO publics
4. **Outreach** ⏸️ sequence rédigée (FR/EN, 3 touches), pas branchée — `test_mode` actif

**Données live** (snapshot DB) :
- 4 reports ready (Asset Management ×2, CRM, Aéronautique)
- 60 sociétés, 57 domaines uniques
- 27 prospects, dont 26 avec email + 24 verified + 24 avec LinkedIn
- 65 events tracés
- 28 sous-catégories seedées (mais seulement 4 ont un report)

---

## 1. `reporting-engine` — produit le livre blanc

### Composants
- **n8n Phase 1 extraction** (`p4mEEnt7XqeBaRZG`) — 4 LLM en parallèle (Perplexity, GPT-4o, Gemini 2.5 Pro, Claude Sonnet 4.6) → consolidation → insert companies + report_companies. 
- **n8n Phase 1.1 synthesis** (auto-chained via pg_net) — Haiku 4.5 par défaut, génère sections markdown.
- **Edge Function Supabase `render_white_paper`** (Deno) — fetch DB, génère HTML brandé Editorial, PDFShift → upload Storage `white-papers/{report_id}.pdf` → update `reports.html_url` et `pdf_url`.

### Flow
```
POST /webhook/geoperf-extract { category_slug, top_n, year }
  → Phase 1 extract (90s, 4 LLMs, ~$0.15)
  → Insert companies + scoring
  → Auto-chain Phase 1.1 synthesis (45s, Haiku, ~$0.05)
  → Edge Function render_white_paper (15s)
  → reports.status = 'ready', html_url + pdf_url remplis
```

### Status
- ✅ 4 reports produits sans intervention manuelle après le `geoperf-extract` initial
- ✅ PDFShift quota dispo (250 PDF/mois free, on en consomme 4 ce mois-ci)
- ⚠️ `total_cost_usd` n'est pas peuplé sur les reports historiques — bug à fix dans le workflow consolidate (calcul mais pas stocké)
- 🔮 Cron auto trimestriel : aucun trigger schedule. Fred lance manuellement via `/admin` bouton "Lancer extraction".

### Sous-catégories à activer (24 restantes)
Voir `categories` table. Asset Management ×2 et CRM et Aéronautique sont fait. 
Quick wins potentiels : Banking, Insurance, Wealth Management, Private Equity (réutilisent le même prompt que Asset Management).

---

## 2. `outreach-engine` — sourcing + sequences

### Composants
- **n8n Phase 2 sourcing** (`c85c3pPFq85Iy6O2`) — patché aujourd'hui, fully fonctionnel.
- **n8n Phase 2.2 sequence_load** — ❌ pas encore construit. Doit prendre les prospects status='new' lead_score >= 50 → créer contact Apollo (custom fields) → enroll dans sequence Apollo.
- **Triggers Postgres** :
  - `handle_prospect_engagement` — mise à jour automatique status (new → engaged → converted) sur événement.
  - `compute_ai_saturation_for_report` — calcul `ai_saturation_gap` à l'insertion d'un report.
- **Vues SQL outreach** :
  - `v_ai_saturation_opportunities` — prospects HOT (gap < -10%) priorisés.
  - `v_sequence_b_queue` — prospects qui ont download → éligibles seq B (call audit).
  - `v_prospect_landing_context` — pré-join pour la landing perso (`/[sous_cat]?t=...`).

### Apollo
- Plan **Basic 59€/mois** suffit (vérifié aujourd'hui). 2560 crédits/mois.
- Master API key OK.
- Endpoints utilisés :
  - `POST /api/v1/mixed_people/api_search` — search par domain + titles (0 crédit, params en query string).
  - `POST /api/v1/people/bulk_match` — enrichment batch (1 crédit/lead, body JSON).
- Credential n8n nommée `Apollo Api Key`.

### Sequence A — copies
- 3 touches J+0, J+3, J+7
- FR + EN dispo dans `docs/PHASE2_EMAIL_SEQUENCE.md` (248 lignes)
- Variables Apollo custom_fields à pousser au moment de l'enrollment :
  - `{{landing_url}}` = `https://geoperf.com/{sous_categorie}?t={tracking_token}`
  - `{{ranking_position}}` = `report_companies.rank`
  - `{{visibility_score}}` = `report_companies.visibility_score` (`/4`)
  - `{{competitor_top1}}` = top 1 du LB qui n'est pas la company

### Status
- ✅ Sourcing live, 26 prospects Asset Management avec emails verified
- ⏸️ **Aucun email envoyé** — `test_mode` actif jusqu'à validation explicite Fred sur les copies FR
- ❌ Phase 2.2 sequence_load workflow pas encore branché à Apollo Sequences API

### Bloqueur avant lever test_mode
- [ ] Validation copies FR (Fred re-lit les 3 touches)
- [ ] Création de la sequence dans Apollo UI (par Fred — son compte)
- [ ] Branchement workflow Phase 2.2 → API Apollo Sequences endpoint `/api/v1/emailer_campaigns/{id}/add_contact_ids`

---

## 3. `frontend` — Next.js sur Vercel

### Routes (25 total)

| Path | Type | Visibilité | Statut |
|---|---|---|---|
| `/` | static | publique indexée | ✅ |
| `/sample` | static | publique indexée | ✅ |
| `/about` | static | publique indexée | ✅ |
| `/contact` | static | publique indexée | ✅ |
| `/privacy`, `/terms` | static | publique indexée | ✅ |
| `/[sous_cat]?t=token` | dynamic | landing perso (noindex) | ✅ |
| `/portal?t=token` | dynamic | dashboard client (noindex) | ✅ |
| `/merci?p=...` | dynamic | post-download (noindex) | ✅ |
| `/profile/[domain]` | dynamic | **NEW** publique indexée SEO | ✅ |
| `/admin` | dynamic | session Supabase Auth | ✅ |
| `/admin/login`, `/admin/logout` | dynamic | auth | ✅ |
| `/admin/profiles` | dynamic | **NEW** index profils SEO | ✅ |
| `/admin/prospects/[id]` | dynamic | **NEW** détail prospect | ✅ |
| `/api/admin/trigger` | route | session OU Bearer token | ✅ |
| `/api/calendly-webhook` | route | HMAC-SHA256 | ✅ |
| `/api/click`, `/api/download`, `/api/track`, `/api/pixel/[token]`, `/api/og` | route | publiques | ✅ |
| `/sitemap.xml` | auto | inclut /profile dynamique | ✅ |
| `/robots.txt` | auto | bloque /admin /portal /[sous_cat] /merci | ✅ |

### Composants UI
- `Button`, `Section`, `Header`, `Footer`, `Card`, `Stat` dans `components/ui/`
- Branding **Editorial** : Source Serif Pro + Inter + IBM Plex Mono, navy/amber/cream

### Auth admin
- Session Supabase httpOnly cookie via `@supabase/ssr@^0.5.2`
- Middleware `middleware.ts` gate `/admin/*` → redirect login si pas loggué
- `lib/supabase-server-auth.ts` exporte `getSupabaseServerClient()` et `getAdminUser()`
- Admin token Bearer reste valide pour appels externes futurs (cron, GitHub Actions)

### Build
- Next.js 15.5.15 + React 19, Tailwind 3.4
- Dernière build local validée : 25 routes, middleware 88.7 kB
- Push via `landing/push_update.ps1` → Vercel auto-deploy en 1-2 min

---

## 4. `infrastructure` — Supabase, Vercel, DNS

### Supabase
- Project `qfdvdcvqknoqfxetttch` (Frankfurt EU)
- Tables principales : `categories` (34), `companies` (60), `reports` (4 ready), `report_companies` (67 links), `prospects` (27), `prospect_events` (65), `raw_responses` (toutes les réponses LLM)
- Edge Function : `render_white_paper` (Deno)
- Storage bucket : `white-papers` (PDF privés, signed URL 7j)
- Auth : email/password activé, user Fred créé
- Vault : OpenRouter key, PDFShift key

### Vercel
- Projet déployé sur `geoperf.com`, branche `main` auto-deploy
- Plan Hobby (100 GB bandwidth/mois)
- Env vars en place : Supabase URL/anon/service_role, GEOPERF_ADMIN_TOKEN (rotation 2026-04-28), Calendly URL, Site URL
- À ajouter quand pratique : `CALENDLY_WEBHOOK_SECRET` (manque encore)

### DNS
- OVH → Vercel ✅
- MX/SMTP : non utilisé pour le moment (sequences via Apollo SMTP)

### n8n
- Cloud Starter ($20/mois)
- Workflows actifs : Phase 1 extract, Phase 1.1 synthesis, Phase 2 sourcing
- À créer : Phase 2.2 sequence_load, Phase 3 cron schedule

---

## 5. Coûts mensuels

| Service | Plan | Coût | Note |
|---|---|---|---|
| OpenRouter | Pay-as-you-go | ~$0.20/run | 4 reports/mois actuellement = ~$1 |
| PDFShift | Free | $0 | 250 PDF/mois, on en utilise 4 |
| Supabase | Free | $0 | DB + Auth + Storage + Edge Functions OK |
| Vercel | Hobby | $0 | 100 GB bandwidth |
| Apollo | Basic | 59€ | 2560 crédits/mois, ~26 utilisés |
| n8n | Starter | $20 | 10k execs/mois |
| Calendly | Free | $0 | Pro nécessaire pour webhooks (non confirmé) |
| **Total actuel** | | **~$80/mois** | |

**Cible prod** (full pipeline 4 sous-catégories actives, 100 emails/semaine, ~150 prospects/trim) : ~$120-150/mois.

---

## 6. Trous, dettes techniques, à surveiller

### Bloqueurs avant launch externe
- [ ] **Validation FR sequence A copies** par Fred (avant lever test_mode)
- [ ] **Workflow Phase 2.2 sequence_load** non branché (bloque l'envoi auto)
- [ ] **Calendly webhook secret** non set côté Vercel env (CALENDLY_WEBHOOK_SECRET) — webhook côté Calendly UI à brancher

### Petites dettes
- `reports.total_cost_usd` jamais peuplé — fix dans le workflow Phase 1 consolidate node
- `landing/apollo_test.json` à supprimer côté local (PII Apollo, ajouté à `.gitignore`)
- `body` parameter d'Apollo people search v4 — le HTTP node renvoie un warning vide quand sendBody=false, à monitorer

### Sécurité / privacy
- Service role key utilisée côté server uniquement ✅
- RLS activé sur toutes les tables ✅
- Token admin gardé en backup pour calls externes ✅
- Cookies session Supabase httpOnly ✅
- PII Apollo (last_name, email) chiffrée at rest dans Supabase ✅

### Améliorations UX optionnelles
- /admin/prospects/[id] : ajouter actions "Mark as opted_out", "Force re-enrich" (UI pas fait, juste view)
- /profile/[domain] : ajouter graphique de saturation IA (similaire à celui du PDF)
- /admin : filtre par report_id en plus du status (utile quand plusieurs reports actifs)

---

## 7. Roadmap prochains sprints

### Sprint 9 — Sequence load Apollo
**Objectif** : enroll prospects en sequence Apollo automatiquement, lever test_mode après validation manuelle de chaque batch.
- [ ] Workflow n8n Phase 2.2 sequence_load (créer contact Apollo + add to sequence)
- [ ] UI `/admin/sequences` pour preview + dry-run + enroll
- [ ] Hook download → trigger sequence B (call audit) auto

### Sprint 10 — Cron trimestriel
**Objectif** : relancer un report par sous-catégorie tous les 3 mois automatiquement.
- [ ] n8n Schedule Trigger (cron 1er du mois 8h UTC)
- [ ] Workflow boucle sur les 4 (puis 28) sous-catégories actives
- [ ] Email digest à Fred avec deltas vs trimestre N-1

### Sprint 11 — Attio CRM mirror
**Objectif** : push prospects + events vers Attio pour Fred avoir une vue commerciale full-fledged.
- [ ] Workflow n8n trigger sur `prospect_events.event_type = 'calendly_booked'`
- [ ] Mapping Supabase prospects → Attio Person + Company

### Sprint 12 — A/B testing
**Objectif** : tester 2 variantes de la landing perso pour optimiser le download rate.
- [ ] Colonne `prospects.variant` (A/B/control)
- [ ] Variant assignment au hash du tracking_token
- [ ] Tracking event `landing_visited` avec variant
- [ ] Vue SQL `v_variant_funnel` pour comparer

---

## 8. Documentation existante

- `CLAUDE.md` racine — TL;DR projet, stack, conventions
- `landing/CLAUDE.md` — frontend conventions, routes, auth pattern
- `PROJECT_PLAN.md` — vision et roadmap
- `PROJECT_STRUCTURE.md` — découpage 4 sous-projets
- `COLLABORATION_BEST_PRACTICES.md` — comment me briefer
- `DECISIONS.md` — décisions tracées (D-024 et D-025 ajoutées aujourd'hui)
- `DEVELOPMENT_HISTORY.md` — log chronologique sessions (session 8 ajoutée)
- `REQUIREMENTS.md` — accès et comptes
- `docs/PHASE2_EMAIL_SEQUENCE.md` — copies FR/EN sequence A
- `docs/PHASE2_ICP_APOLLO.md` — ICP Asset Management + filtres
- `docs/BRAND_GUIDE.md` — branding Editorial
- `docs/SECRETS_VAULT.md` — Supabase Vault procédures
- `docs/DNS_EMAIL_SETUP.md` — MX/SMTP geoperf.com
- `docs/TRACKING_ARCHITECTURE.md` — Supabase primary + Attio mirror

---

## 9. Comment me briefer pour la suite

Format optimal :
```
[Sub-projet] : reporting-engine | outreach-engine | frontend | infrastructure
[Objectif] : ce que tu veux accomplir
[Périmètre] : touche à X et Y, pas Z
[Contraintes] : test_mode actif, pas plus de N min, etc.
```

Détail dans `COLLABORATION_BEST_PRACTICES.md`.

