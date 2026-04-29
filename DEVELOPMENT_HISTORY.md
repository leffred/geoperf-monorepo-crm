# GEOPERF — Journal de développement

> Format : chaque entrée = 1 session ou 1 décision majeure.
> Les entrées les plus récentes en haut.

---

## 2026-04-29 (session 9) — Nuit en autonomie : admin tooling + Phase 2.2 + audit projet

**Contexte :** Fred au coucher, m'a donné 8h de carte blanche pour avancer. Aucun envoi email réel autorisé.

### Livrables ajoutés

**Admin tooling** :
- `/admin/profiles` — index des 57 pages SEO avec score IA + lien direct (Fred peut preview chaque /profile/[domain] facilement).
- `/admin/prospects/[id]` — page détail par lead : info complète, status, lead score, historique events, copy email button (client component), liens portal + landing perso + profil SEO + LinkedIn, métadonnées brutes en `<details>`. 170 lignes.
- Header `/admin` : nav link "Profils SEO" ajouté à côté du compteur prospects + Logout.
- Chaque ligne du tableau prospects de `/admin` est maintenant cliquable vers le détail.

**n8n Phase 2.2 sequence_load workflow** (`b6cwag080lQ2Kq4B`, créé + publié) :
- Webhook `POST /webhook/geoperf-sequence-load` body `{ report_id, sequence_id, lead_score_min, max }`
- Pull eligible prospects (status='new' + email verified + lead_score >= min)
- Loop : pour chaque, `POST /api/v1/contacts` Apollo (avec person_id + label_names) → save contact_id dans metadata
- onDone : aggregate contact_ids → `POST /api/v1/emailer_campaigns/{seq_id}/add_contact_ids` → update prospects.status='sequence_a' + log events `sequence_a_enrolled`
- Pattern fan-out splitInBatches comme Phase 2 (pour pas casser le loop si Apollo échoue sur un)
- Doc complète dans `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` (363 lignes) avec test pas-à-pas et SDK code source
- **Test mode safety** : tant que la sequence Apollo est paused, aucun email ne part même après enrollment
- `/api/admin/trigger` étendu pour accepter l'action `sequence_load`

**STATE_OF_PROJECT.md** (266 lignes) : audit complet du système, snapshot DB, coûts, dettes techniques, roadmap 4 sprints suivants. À actualiser après chaque session importante.

**Mémoire** :
- `feedback_windows_mount_truncation.md` ajouté pour rappel du contournement bash heredoc.
- MEMORY.md mis à jour.

### Bug rencontré

- L'API n8n MCP `update_workflow` a renvoyé `500` à 2 reprises sur le full Phase 2.2 → marche au 3e essai. Workflow stub créé d'abord pour tester. Note pour ne pas perdre temps si ça arrive : retry avec délai.
- Le mot `placeholder` est reservé dans le SDK n8n — utiliser `stub` ou `myPlaceholder`.

### À faire de Fred au réveil
1. Push GitHub : `cd landing && powershell -ExecutionPolicy Bypass -File .\push_update.ps1`
2. Tester `/admin/profiles` et `/admin/prospects/[id]` post-deploy
3. Lier le credential `Apollo Api Key` aux 2 nouveaux HTTP nodes du workflow `b6cwag080lQ2Kq4B`
4. Créer une sequence Apollo paused et noter son `sequence_id`
5. Test Phase 2.2 avec max=3 (suivre `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md`)

---

## 2026-04-28 (session 8) — Apollo enrichment fix + Refacto auth admin + SEO /profile

**Contexte :** Fred relance le sourcing Apollo qui retournait 0 résultats. Discussion approfondie sur la limite Apollo Free vs payant. Lui montre via curl direct que l'API renvoie 760 résultats sur `apollo.io` → l'API marche, le bug est dans le workflow n8n.

### Apollo sourcing — 2 patches workflow Phase 2

**Patch 1 — Fix endpoint `mixed_people/api_search`** (workflow `c85c3pPFq85Iy6O2`)
- Bug 1 : nom du paramètre. `q_organization_domains` (ancien) → `q_organization_domains_list[]` (nouveau api_search).
- Bug 2 : params en JSON body → doivent être en **query string**. POST avec body vide.
- Bug 3 : loop fan-out splitInBatches casse quand Score & filter retourne 0 items. Fix : `nextBatch` en branche parallèle de la chaîne score+upsert.
- Résultat : sur le report Asset Management 14 companies → **26 prospects** sur 12 companies (vs 7 avant).

**Patch 2 — Apollo bulk_match enrichment** (1 crédit/lead)
- `api_search` retourne `last_name_obfuscated` + `has_email: true` mais **pas l'email ni le nom**.
- Ajout des nodes : `Aggregate for bulk_match` → `Apollo bulk_match (enrich)` → `Spread enriched results`.
- Body : `{ reveal_personal_emails: false, reveal_phone_number: false, details: [{id}, ...] }`.
- Update SQL ON CONFLICT : merge metadata + COALESCE pour ne pas écraser des données existantes.
- Credential `Apollo Api Key` à relier manuellement après update SDK (n8n MCP ne lie pas auto les nouveaux nodes HTTP).
- Résultat : **25 emails verified Apollo + 25 noms complets + 24 LinkedIn** sur les 26 prospects (Ram Subramaniam ram.subramaniam@blackrock.com, Larry Drury larry_drury@vanguard.com, etc.).

### Refacto auth admin — token URL → Supabase Auth

**Avant :** `/admin?t=<TOKEN>` URL-based, `Authorization: Bearer <TOKEN>` pour `/api/admin/trigger`. Token traîne dans l'URL → mauvais pour la sécurité + UX.

**Après :** Supabase Auth email/password.
- Activation email auth dans le projet Supabase (côté dashboard).
- User Fred créé manuellement dans Supabase Auth.
- Pages `/admin/login` (form) + `/admin/logout` (POST signOut).
- `middleware.ts` qui gate `/admin/*` et redirect vers login si pas de session.
- `lib/supabase-server-auth.ts` : helpers `getSupabaseServerClient` + `getAdminUser` via `@supabase/ssr@^0.5.2` (nouveau dep).
- `/api/admin/trigger` accepte session **OU** Bearer token (token gardé pour cron jobs / GitHub Actions externes).
- Header admin affiche email user + bouton Logout.

### SEO — Page `/profile/[domain]`

Page publique générative pour chaque société qui apparaît dans un report ready :
- URL `/profile/blackrock.com` (canonical, indexable)
- Score visibilité IA 0-4 + rang dans étude vs rang marché estimé + gap saturation
- 4 mini-cards par LLM (ChatGPT/Gemini/Claude/Perplexity) avec ✓/× cite la marque
- Diagnostic prose si gap > 10% sous-représentation
- Historique études précédentes
- CTA navy "Tu travailles chez {company} ? Demander un audit"
- Sitemap dynamique : enumère toutes les companies du DB et émet `/profile/{domain}` automatiquement.

**Build local validé** : 23 routes Next.js, middleware 88kB.

### Reste à faire (Fred après pause)
1. `cd landing && powershell -ExecutionPolicy Bypass -File .\push_update.ps1` pour pusher les 3 livrables (refacto auth + /profile + sitemap).
2. Tester `/admin` post-deploy → doit rediriger vers `/admin/login`.
3. Optionnel : générer un nouveau report sur autre sous-catégorie pour valider /profile sur un set frais.

### Status post-session
- ✅ Pipeline outreach end-to-end : LB → sourcing Apollo + enrichment → 26 prospects ICP avec emails verified
- ✅ Auth admin propre Supabase Auth (login/mdp) + multi-user possible
- ✅ Page SEO `/profile/[domain]` indexable, sitemap dynamique
- ⏸️ Test mode toujours actif — aucun envoi réel, ne pas lever sans validation explicite Fred sur la sequence FR

---

## 2026-04-27 (session 6) — Sprint 1.1 en autonomie (Fred 1h absent)

**Contexte :** Fred parti 1h, m'a demandé d'avancer en autonomie sur Sprint 1.1.

**Pivot stratégique :** Initialement prévu Vercel Function pour génération PDF. Découverte : MCP Supabase expose `deploy_edge_function`. **Edge Functions Supabase = solution intégrée, gratuite, pas de Vercel nécessaire pour l'instant.** PDF reste manuel via le script bash existant pour le pilote (génération HTML auto suffit).

**Architecture finale Sprint 1.1 :**
```
Workflow Phase 1 (existant)
  → ... (extraction + consolidation + DB)
  → [NEW] HTTP node POST /webhook/geoperf-synthesis
       │
       └──> Workflow Phase 1.1 Synthesis (NEW)
              → Get consolidated payload (Postgres SQL)
              → Build prompt (Code JS)
              → Synthesis LLM (Haiku 4.5 par défaut, Sonnet/Opus en option)
              → Parse JSON sections (Code JS)
              → POST → Edge Function render_white_paper
                   │
                   └──> Edge Function Supabase (Deno)
                         → Fetch companies depuis DB
                         → Compute charts (geo, pyramid, llm bars)
                         → Render HTML inline (template editorial complet)
                         → Upload Storage white-papers/{report_id}.html
                         → Create signed URL (7 jours)
                         → UPDATE reports.html_url
                         → Return {ok, html_url}
              → Webhook response avec html_url
```

**Livrables produits :**

| Item | Statut | Path |
|---|---|---|
| Bucket Supabase Storage `white-papers` | ✅ Créé | (Supabase Dashboard) |
| Colonne `reports.html_url` | ✅ Migration appliquée | DB |
| Code Edge Function `render_white_paper` | ✅ 28 KB, 372 lignes TS | `supabase/functions/render_white_paper/index.ts` |
| Stub Edge Function déployé | ✅ ID `43e1504d-c829-4a96-a265-b44158459ebd` | Supabase |
| Procédure deploy CLI Edge Function | ✅ Doc complète | `supabase/functions/render_white_paper/DEPLOY.md` |
| Workflow n8n synthesis JSON | ✅ Complet | `n8n/workflows/geoperf_phase1_synthesis.json` |
| Patch chaînage Phase 1 → synthesis | ✅ Doc step-by-step | `n8n/workflows/PHASE1_CHAIN_PATCH.md` |

**Reste à faire côté Fred (15-20 min total) :**
1. **Deploy Edge Function complet** : `supabase functions deploy render_white_paper --no-verify-jwt` (1 commande)
2. **Setup variable d'env n8n** `SUPABASE_SERVICE_ROLE_KEY` (récupérer depuis Supabase Dashboard)
3. **Importer workflow synthesis** dans n8n cloud (`geoperf_phase1_synthesis.json`)
4. **Configurer credentials** sur le workflow synthesis : Postgres GEOPERF + OpenRouter GEOPERF (déjà créées)
5. **Activer** le workflow synthesis
6. **Patcher workflow Phase 1** : ajouter le node HTTP qui appelle synthesis (instructions dans PHASE1_CHAIN_PATCH.md)

**Limites du Sprint 1.1 livré :**
- HTML uniquement (pas PDF auto). PDF reste manuel via `pdf-generator/generate_pdf.js` jusqu'au Sprint 1.2.
- Le HTML Storage est `private` avec signed URL 7 jours. Pour pages publiques (landing prospects), Sprint 2 les servira via Next.js sur sous-domaine.
- Edge Function rend le HTML "complet" (cover + 8 sections + glossaire + FAQ + about). Si Fred veut PDF auto, deux options Sprint 1.2 :
  - Vercel Function avec puppeteer (gratuit)
  - PDFShift API (250 PDF/mois gratuit)

**Bug identifié à fixer :**
- Workflow n8n a 2 doublons "Goldman Sachs Asset Management" (matching par nom_normalisé seulement, pas domaine). Fix : améliorer le matching dans le node Consolidate (JS) pour merger si même nom_normalisé même si domaines différents.
- Gemini 2.5 Pro retourne souvent `companies: []` — peut-être le `max_tokens: 4000` est trop court pour son output verbeux. À tester en montant à 8000.

**Coût total cumulé Phase 1 + 1.1 (3 livres blancs générés aujourd'hui) :**
- LLM extraction : ~$0.40
- LLM synthesis : ~$0.045 (Haiku 4.5)
- Supabase : 0$ (free tier)
- **Total : <$0.50** sur la journée

---

## 2026-04-27 (session 5) — Tracking architecture + schéma Phase 2 + workflow n8n

**Inputs Fred :**
- Choix Option B (build workflow n8n d'abord)
- Demande tracking complet des actions sur chaque prospect (date, levier, réponse, statut) → besoin analytique : taux de transfo par sous-catégorie pour piloter "où insister vs où arrêter"
- Mention de l'usage d'Attio comme CRM existant

**Décisions d'architecture prises :**
- **Source de vérité = Supabase**, **miroir commercial = Attio** (Attio MCP suggéré pour connexion)
- Pourquoi : performance (pas de rate limit API), coût (Supabase free vs Attio par record), indépendance (si on change de CRM, la donnée reste)
- Sync n8n push immédiat sur events clés, batch hourly pour le reste
- Notes manuelles Attio pull-able vers Supabase via job nocturne (V2)

**Actions Claude :**
1. `docs/TRACKING_ARCHITECTURE.md` — décision archi documentée
2. Migration `geoperf_phase2_prospects_events_tracking` appliquée :
   - Tables : `prospects` (avec jalons funnel denormalized + tracking_token auto), `sequences`, `prospect_events`
   - 13 indexes
   - Trigger `update_prospect_milestones` qui maintient automatiquement `first_contact_at`, `download_at`, `call_booked_at`, `call_held_at`, `opt_out_at` sur `prospects` à chaque insert d'event
   - Trigger `set_updated_at` sur prospects
   - RLS activé
3. Migration `geoperf_phase2_analytics_views` appliquée — 4 vues SQL :
   - `funnel_by_subcategory` : entonnoir complet par sous-cat avec taux de chaque étape (DL, booking, show, close, overall)
   - `lever_performance` : performance par étape de séquence (M1, M2, M3, X1, X2, X3) × sous-cat
   - `prospect_timeline` : chronologie complète d'un prospect (pour préparation calls)
   - `daily_metrics` : métriques quotidiennes (new prospects, contacts, downloads, bookings, opt_outs)
4. Workflow n8n `GEOPERF Phase 1 — Extraction & Consolidation` créé en JSON et sauvegardé dans `n8n/workflows/geoperf_phase1_extraction.json` :
   - Trigger : Webhook POST `/geoperf-extract`
   - Get category from slug → Insert report (running) → Prepare context
   - 4 LLM en parallèle via OpenRouter chains : Perplexity Sonar Pro, GPT-4o-search, Gemini 2.5 Pro, Claude Sonnet 4.6
   - Merge → Code node consolidation (port JS de consolidate.py, ~80 lignes)
   - Insert raw_responses (4 rows) → Upsert companies + report_companies → Mark report ready → Webhook response
5. `n8n/workflows/README.md` : procédure d'import dans n8n cloud + config des 2 credentials (Supabase Postgres + OpenRouter) + commande de test curl
6. Vérification du workflow existant `Moteur GEO SaaS - OpenRouter Edition` (actif) — patterns réutilisés (chainLlm + lmChatOpenRouter), aucune modif sur ce workflow

**Limite v1 du workflow n8n :**
- S'arrête à la consolidation + écriture DB (pas la synthèse Opus + PDF)
- La synthèse + PDF seront ajoutées en Sprint 1.1 dans un workflow chaîné, après déploiement d'une Vercel Function `/api/render-pdf` (puppeteer ne tourne pas dans n8n cloud directement)

**Tentative d'import auto via MCP n8n :** échouée — le MCP n8n attend du code SDK JavaScript, pas du JSON brut. Le JSON est néanmoins importable directement via UI n8n (Workflows → "+" → Import from File). Documenté dans le README.

**Reste à faire côté Fred :**
1. Connecter le MCP **Attio** (carte proposée en chat)
2. Importer le workflow JSON dans n8n cloud
3. Créer les 2 credentials n8n (Supabase Postgres GEOPERF + OpenRouter GEOPERF)
4. Lancer un test `top_n=10` sur Asset Management pour valider end-to-end
5. (Sécurité) Rotater le mot de passe DB Supabase qui a transité en clair

**Reste à faire côté Claude (Sprint 1.1) :**
1. Workflow n8n chaîné `geoperf_phase1_synthesis_pdf` (déclenché à la fin de l'extraction)
2. Vercel Function `/api/render-pdf` (héberge render.py + generate_pdf.js)
3. Upload Supabase Storage du PDF + update `reports.pdf_url`

**Fichiers créés cette session :**
- `docs/TRACKING_ARCHITECTURE.md`
- `supabase/migrations/20260427_phase2_prospects_events_tracking.sql`
- `supabase/migrations/20260427_phase2_analytics_views.sql`
- `n8n/workflows/geoperf_phase1_extraction.json`
- `n8n/workflows/README.md`

---

## 2026-04-27 (session 4) — Décisions Sprint 1 + production artefacts Phase 1

**Décisions tranchées par Fred :**

| ID | Choix | Conséquence |
|---|---|---|
| D-014 | **A** — Monorepo Next.js avec middleware wildcard | 1 seul projet Vercel, hostname-routing dans `middleware.ts`, contenu chargé depuis Supabase |
| D-015 | **A** — Supabase Storage pour les PDF | Bucket `white-papers/`, accès via signed URL, RLS pour limiter l'accès aux LB ready |
| D-016 | **A** — Tracking download au clic | 1 event `download_completed` dès que le bouton est cliqué (avant le download effectif). Plus simple, moins fragile que le Service Worker callback. |
| D-017 | **Reportée** | Clé OpenRouter conservée pour le moment. À rotater plus tard. |

**Actions exécutées par Claude (session en cours) :**
- Rédaction des 4 prompts d'extraction Phase 1 dans `prompts/phase1/`
- Script Python de consolidation cross-LLM
- Prompt de synthèse rédactionnelle pour Claude Opus 4.7
- Template HTML/CSS du PDF brandé Editorial
- Allègement de DECISIONS.md

---

## 2026-04-27 (session 3) — Sprint 0 partiel exécuté

**Participants :** Fred + Claude

**Inputs reçus de Fred :**
- ✅ Logo direction choisie : **Editorial / Authority** (Direction 2)
- ✅ Projet Supabase créé : nom `GEOPERF`, mot de passe DB transmis (à stocker dans Vault à la prochaine session)
- ✅ OpenRouter API key transmise → stockée immédiatement dans Vault (`vault.create_secret name=openrouter_api_key`)
- ✅ Adresse Jourdechance : `31 rue Diaz, 92100 Boulogne-Billancourt`, SIREN `838 114 619`, RCS Nanterre
- ✅ MCPs Vercel et n8n connectés (vu dans la liste des outils disponibles : Vercel mcp__9e0bccb6 + n8n mcp__05c6df5e — note : le MCP n8n connecté est complet avec création/édition de workflows, pas seulement l'officiel limité)

**Actions exécutées par Claude :**

| # | Action | Détail |
|---|---|---|
| 1 | Identification projet Supabase | `qfdvdcvqknoqfxetttch`, region `eu-central-1`, URL `https://qfdvdcvqknoqfxetttch.supabase.co` |
| 2 | Récupération clés publiques Supabase | `anon` (legacy JWT) + `default` publishable (`sb_publishable_XPOl0kTSiGqQxUSz0NgzvA_xTvbOHmD`) |
| 3 | Stockage OpenRouter key dans Vault | `secret_id = 7a18091b-444d-48b8-a4be-b9bcf02a2e2e`, vérifié relisible via `vault.decrypted_secrets` |
| 4 | Migration `geoperf_phase1_schema` appliquée | 5 tables : categories, reports, raw_responses, companies, report_companies + 11 indexes + RLS activé |
| 5 | Migration `geoperf_phase1_seed_categories` appliquée | 6 catégories parent + 28 sous-catégories B2B |
| 6 | Sauvegarde des migrations dans le repo | `supabase/migrations/20260427_*.sql` |
| 7 | Test OpenRouter sur 4 LLM cibles | Réussi — 4 modèles répondent. Coûts par mini-test : $0.003-0.010. Estimation par LB complet : $0.50-1.00 (cible révisée à <$5) |
| 8 | Script de test réutilisable | `prompts/phase1/_test_openrouter.sh` |
| 9 | Mise à jour modèles dans PROJECT_PLAN | Sonnet **4.6** (au lieu de 4.5), GPT-4o **search-preview** (au lieu de standard, pour avoir le web), synthèse **Claude Opus 4.7** (au lieu de Sonnet — qualité éditoriale) |
| 10 | Logo Editorial finalisé en 6 variantes | `logo_primary.svg`, `logo_primary_white.svg`, `logo_mark.svg`, `logo_mark_outline.svg`, `favicon.svg`, `linkedin_avatar.svg`, `linkedin_cover.svg` |
| 11 | Charte graphique formalisée | `docs/BRAND_GUIDE.md` — palette, typo (Source Serif Pro + Inter + IBM Plex Mono), signature mail HTML, mentions légales, règles éditoriales |

**Apprentissages tests LLM (à exploiter dans les prompts Phase 1) :**
- **Perplexity Sonar Pro** : seul à donner du frais (sources sept-2025 visibles). Indispensable en Prompt #1 (extraction).
- **GPT-4o standard** : refuse de "prédire 2026" sans données — **utiliser `gpt-4o-search-preview`** pour Prompt #2.
- **Gemini 2.5 Pro** : produit du JSON propre directement, cutoff fin 2024 → préciser dans le prompt.
- **Claude Sonnet 4.6** : honnête sur sa cutoff, donne ses chiffres 2024 → bonne baseline pour la validation croisée.

**Décisions tranchées additionnelles (ex-DECISIONS.md) :**
- D-006-bis → Logo : **Direction 2 Editorial** retenue
- D-008 → MCPs : Vercel ✅ connecté, n8n ✅ connecté, GitHub à activer plus tard via `/mcp`
- D-013 → Mentions légales : adresse + SIREN intégrés dans `BRAND_GUIDE.md`

**Reste à clarifier (cf. DECISIONS.md) :**
- D-014 (architecture monorepo Next.js avec middleware vs un projet par sous-cat)
- D-015 (hébergement PDF — Supabase Storage vs Vercel Blob)
- D-016 (granularité tracking download)
- D-017 NEW : faut-il rotater la clé OpenRouter qui a transité en clair ?

**⚠️ Sécurité — recommandation forte :**
La clé OpenRouter `sk-or-v1-6dff...86efd79` a été transmise en clair dans le chat. Recommandation : la **régénérer sur openrouter.ai** dès cette session terminée, puis remplacer dans Vault via `vault.update_secret`. Pas urgent (la clé a un quota de $50 plafonné), mais bonne hygiène.

**Prochaines étapes côté Fred :**
1. (Sécurité) Rotater la clé OpenRouter
2. Suivre `docs/DNS_EMAIL_SETUP.md` pour activer la boîte mail OVH
3. Trancher D-014, D-015, D-016 dans `DECISIONS.md`
4. Convertir SVG logos en PNG quand on attaquera le déploiement (je peux le faire via bash)
5. Créer la page LinkedIn `linkedin.com/company/geoperf` avec les assets `linkedin_avatar.svg` et `linkedin_cover.svg` (à exporter en PNG d'abord)

**Prochaines étapes côté Claude (à la prochaine session) :**
1. Rédiger les 4 templates de prompts Phase 1 dans `prompts/phase1/` (extraction Perplexity, validation GPT-4o-search, validation Gemini, validation Claude Sonnet 4.6)
2. Rédiger le prompt de synthèse rédactionnelle pour Claude Opus 4.7 (génération du livre blanc à partir du JSON consolidé)
3. Créer le template HTML/CSS de PDF brandé (puppeteer-ready) en utilisant la charte du `BRAND_GUIDE.md`
4. Une fois Fred a tranché D-014 → scaffold du projet Next.js avec wildcard middleware
5. Bonus : créer la fonction PostgreSQL de normalisation de noms (`nom_normalise`) pour le dédoublonnage cross-LLM

**Coût engagé à ce jour :**
- OpenRouter : ~$0.04 (tests)
- Supabase : 0$ (free tier)
- Total : **<$0.05**

---

## 2026-04-27 (session 2) — Arbitrages Sprint 0 + setup MCPs

**Participants :** Fred + Claude

**Décisions tranchées (ex-DECISIONS.md) :**

| ID | Sujet | Décision |
|---|---|---|
| D-001 | Domaine GEOPERF | **`geoperf.com`** confirmé, enregistré chez OVH |
| D-002 | Architecture URL landings | **Sous-domaine par sous-catégorie** : `[sous-categorie].geoperf.com/lb/[token]` (ex: `asset-management.geoperf.com/lb/abc123`). Nécessite wildcard DNS + Next.js avec middleware routing par hostname |
| D-003 | Mail expéditeur | **`flefebvre@geoperf.com`** (réception via OVH MX, envoi via Apollo SMTP). Aucun MX/SPF/DKIM/DMARC config à date → procédure dans `docs/DNS_EMAIL_SETUP.md` |
| D-004 | Sous-catégorie pilote | **Asset Management**, hébergé sur `asset-management.geoperf.com` |
| D-005 | Stratégie LinkedIn | **Option C** : skip LinkedIn pour le pilote, démarrage email seul. Décision de réintégrer LinkedIn (PhantomBuster) si DL rate ≥ 8% sur le pilote |
| D-006 | Logo & charte | **Aucun logo existant**. Claude propose 3 directions (Geometric/Tech, Editorial/Authority, Data viz/Insight). Choix Fred attendu pour finaliser. Page LinkedIn `linkedin.com/company/geoperf/` à créer après choix logo |
| D-007 | Volume pilote | **B (200 prospects)** |
| D-010 | Bibliothèque PDF | **puppeteer** (HTML→PDF) |
| D-011 | Lock LLM versions | **Lock initial** : Perplexity Sonar Pro / GPT-4o / Gemini 2.5 Pro / Claude Sonnet 4.5. Re-test trimestriel |
| D-012 | Fréquence LB | **Semestriel** par sous-catégorie, avec date de génération en couverture |

**Choix infra additionnels :**
- Stockage des secrets : **Supabase Vault** (option B). Procédure documentée dans `docs/SECRETS_VAULT.md`
- MCPs additionnels validés : **GitHub** (déjà installé, à authentifier), **Vercel** (à connecter), **n8n** (à connecter, mais limité : seulement search/get/execute workflows, pas de création/édition via MCP)

**Comptes confirmés par Fred :**
- n8n Cloud : `https://fredericlefebvre.app.n8n.cloud/projects/6BdImo8lbZ2EZJSe/workflows`
- Vercel : `https://vercel.com/leffreds-projects`
- OpenRouter : compte créé + 50$ chargés (clé pas encore fournie)

**Livrables produits :**
- `docs/SECRETS_VAULT.md` — procédure Supabase Vault complète
- `docs/DNS_EMAIL_SETUP.md` — setup MX/SPF/DKIM/DMARC chez OVH + intégration Apollo
- `assets/logo_v1_geometric.svg`, `logo_v2_editorial.svg`, `logo_v3_dataviz.svg` — 3 directions logo
- `PROJECT_PLAN.md` mis à jour : architecture sous-domaine + mail expéditeur
- `DECISIONS.md` allégé : 13 décisions tranchées retirées, ne reste que ce qui bloque encore

**Reste à clarifier (cf. DECISIONS.md) :**
- D-006-bis : Quelle direction logo Fred préfère sur les 3 propositions
- D-008 : MCPs à connecter — Fred valide les 3 (Vercel, n8n, GitHub) ?
- D-013 : Adresse postale de Jourdechance pour mentions légales du LB et footer mail RGPD

**Prochaines étapes côté Fred :**
1. Choisir 1 direction logo (cf. message ci-dessus avec les 3 propositions)
2. Cliquer les boutons "Connect" pour Vercel, n8n, GitHub MCPs
3. Suivre `docs/DNS_EMAIL_SETUP.md` pour activer la boîte mail OVH (étapes 1-2 dans le manager OVH)
4. Créer le projet Supabase `geoperf` (si pas déjà fait), me donner le project ref
5. Fournir l'OpenRouter API key (je la stockerai immédiatement dans Vault)

**Prochaines étapes côté Claude (à la prochaine session) :**
1. Une fois MCP Supabase + project ref → créer schéma Phase 1 (categories, reports, raw_responses, companies, report_companies)
2. Une fois OpenRouter key → tester un appel chaque LLM en bash, valider OpenRouter ID des modèles
3. Rédiger les 4 templates de prompt Phase 1 dans `prompts/phase1/`
4. Une fois le logo choisi → décliner en versions PNG/SVG/favicon, brief charte

**Coût engagé à ce jour :** 0€.

---

## 2026-04-27 (session 1) — Initialisation du projet

**Participants :** Fred Lefebvre + Claude (Cowork)

**Contexte :** Premier brief complet du projet GEOPERF. Fred souhaite construire un produit qui mesure et améliore la visibilité des entreprises B2B dans les LLM, via la production de livres blancs sectoriels comme lead magnet, suivis d'une prospection automatisée.

**Décisions prises pendant la session :**

| Décision | Choix | Justification |
|---|---|---|
| Outil d'orchestration | **n8n Cloud** (~20€/mois) | Préféré à Make malgré l'absence de MCP natif. Fred valorise le no-limit op + ouverture self-host future. |
| Gateway LLM | **OpenRouter** | Une seule API key pour Perplexity + GPT-4o + Gemini + Claude. Billing unifié. |
| Stockage | **Supabase** | Compte déjà existant. Tables + Storage + Auth + Edge Functions tout-en-un. |
| Infra prospection | **Apollo Sequences** | Compte déjà existant. MCP connecté. Tracking inclus. |
| Format livre blanc | **PDF + landing Next.js sur Vercel** | PDF brandé "institutionnel" + landings dynamiques /lb/[token] pour personnalisation et tracking. |
| Branding | **Sous Jourdechance pour le pilote** | GEOPERF est un produit de Jourdechance SAS (6 ans). Structure dédiée à créer si traction validée. |

**Décisions reportées (cf. DECISIONS.md) :**
- Domaine exact GEOPERF (`.com`/`.fr`/sous-domaine)
- Adresse mail expéditeur
- Première sous-catégorie pilote
- LinkedIn manuel vs PhantomBuster
- Logo GEOPERF
- Plan d'envoi : commencer par 200 ou 500 prospects ?

**Livrables produits :**
- `PROJECT_PLAN.md` — plan maître complet (vision, architecture, schéma SQL, séquences, KPIs, roadmap 4 sprints, risques)
- `REQUIREMENTS.md` — check-list exhaustive accès/comptes/MCPs/skills + ce qui manque pour démarrer
- `DECISIONS.md` — backlog des arbitrages encore à faire
- `DEVELOPMENT_HISTORY.md` — ce journal
- Arborescence de dossiers : `docs/`, `n8n/workflows/`, `supabase/migrations/`, `landing/`, `pdf-generator/`, `prompts/`, `assets/`

**Prochaines étapes côté Fred :**
1. Compléter la check-list Sprint 0 du REQUIREMENTS.md
2. Trancher les questions du DECISIONS.md
3. Me revenir avec : domaine, OpenRouter key, n8n login, sous-catégorie pilote, logo

**Prochaines étapes côté Claude (à la prochaine session) :**
1. Créer le projet Supabase dédié `geoperf` (si pas déjà fait)
2. Écrire la 1ère migration SQL (tables `categories`, `reports`, `raw_responses`, `companies`, `report_companies`)
3. Rédiger les 4 templates de prompts (un par LLM) dans `/prompts/phase1/`
4. Si n8n login fourni : esquisser le workflow `geoperf_phase1_white_paper`

**Coût engagé à ce jour :** 0€ (pure planification).

**Estimation budget Sprint 0 + 1 :** ~80-120€ (n8n 20€ + OpenRouter 50$ crédit + domaine si à acheter ~12€/an).

---

## Convention pour les futures entrées

Format suggéré :

```
## YYYY-MM-DD — [Titre court de la session ou décision]

**Participants :** [qui]
**Contexte :** [pourquoi cette session]
**Ce qui a été fait :** [actions concrètes]
**Décisions :** [arbitrages]
**Blocages :** [si applicable]
**Suite :** [prochaines actions]
```
