# GEOPERF — Architecture en sous-projets

> Décomposition pour clarifier les zones de responsabilité et permettre à Claude (moi) de raisonner sur un sous-projet à la fois sans devoir charger tout en mémoire.

---

## Vue d'ensemble

GEOPERF se décompose en **4 sous-projets** indépendants qui communiquent via DB Supabase :

```
                    ┌─────────────────────┐
                    │  reporting-engine   │  → produit le LB (extraction LLM + render)
                    └──────────┬──────────┘
                               │ écrit dans reports, companies, report_companies
                               ▼
                       ┌────────────┐
                       │  Supabase  │  ← source de vérité unique
                       └─────┬──────┘
                             │
            ┌────────────────┼────────────────────┐
            ▼                ▼                    ▼
     ┌────────────┐    ┌──────────┐      ┌────────────────┐
     │  outreach  │    │ frontend │      │ infrastructure │
     │  (Apollo,  │    │ (Next.js │      │ (Supabase,     │
     │  sequences)│    │  landing │      │  Vercel, DNS,  │
     │            │    │  + admin │      │  monitoring)   │
     └────────────┘    └──────────┘      └────────────────┘
```

---

## Sous-projet 1 : `reporting-engine`

**Responsabilité** : transformer une catégorie B2B en livre blanc HTML+PDF brandé.

**Composants** :
- 2 workflows n8n :
  - `GEOPERF Phase 1 — Extraction & Consolidation` (id: 7DB53pFBW70OtGlM)
  - `GEOPERF Phase 1.1 — Synthesis & HTML Render` (id: MMJL9KniTe91QOIu)
- 1 Edge Function Supabase : `render_white_paper`
- 5 prompts (`prompts/phase1/01..05`)
- Trigger Postgres `reports_synthesis_trigger` (auto-chain)
- Tables : `categories`, `reports`, `raw_responses`, `companies`, `report_companies`

**Inputs** : `{category_slug, top_n, year}` via webhook `/geoperf-extract`
**Outputs** : nouveau row dans `reports` avec `html_url`, `pdf_url`, `status='ready'`

**Ce qui change rarement** : prompts, schema DB
**Ce qui peut changer** : modèles LLM (Haiku → Opus), template HTML, format PDF

**Coût par run** : ~$0.20 (extract $0.18 + synthesis $0.02)
**Durée par run** : ~2 min (extract 80s + synthesis 45s)

**Dossiers concernés** :
```
prompts/phase1/                  → templates LLM
n8n/workflows/geoperf_phase1_*   → workflow JSON
supabase/functions/render_white_paper/  → Edge Function
supabase/migrations/2026*phase1*.sql    → schema
```

**Doc d'entrée** : `prompts/phase1/README.md` (à créer si pas déjà)

---

## Sous-projet 2 : `outreach-engine`

**Responsabilité** : transformer une liste de sociétés du LB en pipeline de prospects qualifiés et activer les séquences mailing.

**Composants** :
- 1 workflow n8n : `GEOPERF Phase 2 — Apollo Sourcing & Prospect DB` (id: c85c3pPFq85Iy6O2)
- À venir : Phase 2.2 sequence trigger, Calendly webhook
- 2 triggers Postgres :
  - `prospect_events_engagement_trigger` (auto-status)
  - `compute_ai_saturation_for_report` (computed scoring)
- Tables : `prospects`, `sequences`, `prospect_events`
- Vues : `v_ai_saturation_opportunities`, `v_sequence_b_queue`, `v_prospect_landing_context`

**Inputs** : `{report_id, max_per_company, min_lead_score}` via webhook `/geoperf-sourcing`
**Outputs** : prospects en DB avec scoring 0-100

**Dépendances externes** : Apollo API (plan Basic+ requis), Calendly webhook (à brancher)

**Status** : workflow techniquement OK, BLOQUÉ sur quota Apollo Free

**Dossiers concernés** :
```
n8n/workflows/geoperf_phase2_*           → workflow JSON
docs/PHASE2_ICP_APOLLO.md                → ICP & filtres
docs/PHASE2_EMAIL_SEQUENCE.md            → templates emails
supabase/migrations/*phase2*.sql         → schema
supabase/migrations/*saturation*.sql     → scoring
supabase/migrations/*engagement*.sql     → triggers
```

**Doc d'entrée** : `docs/PHASE2_ICP_APOLLO.md`

---

## Sous-projet 3 : `frontend`

**Responsabilité** : tous les points de contact web — landings personnalisées, page sample publique, admin Fred, portal client.

**Repo séparé** : `leffred/geoperf-landing` (déployé sur Vercel @ geoperf.com)

**Composants** :
- App Next.js 15 (App Router) → `landing/`
- 16 routes : home, /sample, /about, /contact, /privacy, /terms, /[sous_cat], /merci, /admin, /portal (à construire), 6 routes API
- Lib `lib/tracking.ts` (résolution token + log events)
- Composants UI réutilisables (`components/ui/`)

**Inputs** : `tracking_token` (URL param), événements client (clics, downloads)
**Outputs** : `prospect_events` en DB

**Ce qui change souvent** : copy, styles, ajouts de pages
**Ce qui change rarement** : auth pattern, schéma URL

**Dossiers concernés** :
```
landing/   → tout le repo Next.js (séparé du repo parent GEOPERF/)
```

**Doc d'entrée** : `landing/README.md`

---

## Sous-projet 4 : `infrastructure`

**Responsabilité** : tout ce qui n'est pas du code applicatif — DNS, secrets, monitoring, conformité, déploiements.

**Composants** :
- Supabase project `qfdvdcvqknoqfxetttch` (Frankfurt)
- Vercel project `geoperf-landing`
- DNS OVH (geoperf.com → Vercel)
- Secrets : OpenRouter key, Apollo key, Supabase service role, PDFShift key, Admin token
- Monitoring : à mettre en place (uptime, error tracking)

**Docs** :
- `docs/SECRETS_VAULT.md` — gestion secrets via Supabase Vault
- `docs/DNS_EMAIL_SETUP.md` — config OVH (MX, SPF, DKIM, DMARC)
- `docs/TRACKING_ARCHITECTURE.md` — pipeline events Supabase + mirror Attio (à construire)

**Ce qui change rarement** : architecture, hébergeurs
**Ce qui change parfois** : secrets (rotation), DNS records

---

## Comment me dire sur quel sous-projet on bosse

Au début d'une session ou d'une demande :

```
"On travaille sur reporting-engine — fix le bug Gemini maxTokens"
"Sub-projet outreach — switch Apollo vers Hunter.io"
"Frontend — ajoute une section dans la landing"
"Infra — rotate la clé OpenRouter"
```

Si tu ne précises pas, je te demanderai (ou je devinerai mal). Le préfixe me fait gagner 10s × N fois par session.

---

## Quand splitter vraiment en repos séparés ?

**Pas maintenant**. Tant que c'est un solo project, monorepo = simple.

**Quand splitter** :
- Si tu veux donner accès à un dev externe à `frontend` sans qu'il voie le reste (perms GitHub)
- Si CI devient lente et qu'on veut isoler les tests
- Si l'un des sous-projets passe en prod B2B SaaS multi-clients (ex: l'admin devient un produit séparé)

**Pour l'instant**, garder tout sous `Projects/GEOPERF/` avec sous-dossiers est le bon trade-off.

---

## Migration vers cette structure (action requise — 0 min)

C'est déjà ainsi de facto. Les dossiers existent. Cette doc sert juste à **expliciter** les frontières et donner un vocabulaire commun ("on bosse sur reporting-engine").

Si plus tard tu veux **forcer** la séparation (ex: bloquer les imports cross-subprojects), on peut ajouter des `.eslintrc` ou des `tsconfig.json` paths restrictions. Pas urgent.

---

## TL;DR

| Sous-projet | Owner code | Stack | Coût/mois |
|---|---|---|---|
| `reporting-engine` | n8n + Supabase Edge | TypeScript + SQL + Python prompts | ~$50 (LLMs) |
| `outreach-engine` | n8n + Postgres triggers | SQL + JS code nodes | ~$50 (Apollo) |
| `frontend` | Next.js Vercel | TypeScript + Tailwind | $0 (Hobby plan) |
| `infrastructure` | Supabase + Vercel + OVH | DNS + secrets + DB | ~$25 (Supabase Pro à terme) |

Total cible prod : **~$125/mois** + Apollo upgrade.
