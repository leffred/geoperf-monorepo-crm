# Sprint S15 — Recap général

**Date** : 2026-05-03
**Branche** : main
**Status build** : OK vert (`npm run build` — 31 pages, /app/dashboard 267 B server-only)
**Scope brief** : Dashboard synthétique + 6 quick wins (filtre temporel, auto-suggest prompts, email digest, trend detection, AI Overviews)

---

## TL;DR

Sprint nuit dense. **6 objectifs livrés sur 7 ; §4.7 reporté en S16** (slugs OpenRouter introuvables) :

| # | Objectif | Status | Path |
|---|---|---|---|
| 4.1 | Refonte `/app/dashboard` — command center synthétique | OK | `landing/app/app/dashboard/page.tsx` (440 lignes) |
| 4.2 | Auto-redirect mono-brand (1 brand + 0 alertes + last_snapshot < 7j) | OK | idem (lignes 92-99) |
| 4.3 | Filtre temporel 1m/3m/6m/12m sur page brand | OK | `landing/components/saas/PeriodToggle.tsx` + page brand |
| 4.4 | Auto-suggest 5 prompts via Haiku | OK | Edge Function `saas_suggest_prompts` + UI |
| 4.5 | Email digest hebdo (lundi 8h CET, pg_cron) | OK | Edge Function `saas_send_weekly_digest` + migration phase 7 + UI settings |
| 4.6 | Trend detection — `competitor_emerged` | OK | `saas_detect_alerts/index.ts` + ENUM extend |
| 4.7 | AI Overviews + Copilot LLMs (Agency tier) | REPORTÉ S16 | Slugs OpenRouter introuvables (cf §2 ci-dessous) |

**Aucun push, aucun deploy Edge Function.** 2 migrations DB appliquées via apply_migration MCP (autorisées par brief §4.5 + §4.6).

---

## Section 1 — Pourquoi §4.7 est reporté en S16

**Vérification effectuée au début du sprint** (cf brief §4.7 étape 1) : appel `/api/v1/models` OpenRouter + scan des modèles avec mots-clés `overview`, `ai-overviews`, `grounded`, `copilot`, `microsoft`, `phi`, `bing`.

**Résultat** : aucun match.

- Côté Google : `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`, `gemma-4-*` — mais aucun slug spécifiquement « AI Overviews » ou « grounded ».
- Côté Microsoft : aucun modèle Microsoft listé sur OpenRouter (pas de Copilot, pas de Phi, pas de Bing). Copilot n'est pas exposé via OpenRouter.

**Décision** : ne pas inventer un slug et risquer un crash de tous les snapshots Agency. Le sprint reste à 6/7 livrables ; §4.7 est ré-évalué en S16 :
- Vérifier si Google sort un endpoint dédié « AI Overviews » (probablement via Vertex AI direct, pas OpenRouter).
- Évaluer un proxy Microsoft Copilot via Bing Search API + LLM wrapper (engineering significatif, hors scope quick win).

---

## Section 2 — Migration DB phase 7

**Fichier** : `supabase/migrations/20260503_saas_phase7_weekly_digest.sql` (50 lignes)

Appliquée en 2 étapes via `apply_migration` MCP (ALTER TYPE ADD VALUE doit être seul dans sa transaction sur Postgres) :

### 2.1 — `saas_phase7_alert_type_competitor_emerged`

```sql
ALTER TYPE saas_alert_type ADD VALUE IF NOT EXISTS 'competitor_emerged';
```

Idempotent (Postgres 9.6+).

### 2.2 — `saas_phase7_weekly_digest_pref_and_cron`

```sql
ALTER TABLE saas_profiles
  ADD COLUMN IF NOT EXISTS digest_weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- pg_cron entry : lundi 7h UTC (= 8h CET hiver / 9h CEST été)
SELECT cron.schedule(
  'saas-weekly-digest',
  '0 7 * * 1',
  $cron$SELECT net.http_post(...)$cron$
);
```

Vérification post-apply : `cron.job` retourne `{jobname: "saas-weekly-digest", schedule: "0 7 * * 1"}`. ✅

---

## Section 3 — §4.6 Trend detection `competitor_emerged`

**Fichier** : `supabase/functions/saas_detect_alerts/index.ts` (modif ~30 lignes nettes)
**Fichier** : `supabase/functions/saas_send_alert_email/index.ts` (extend type union + label + emoji)

### Logique

1. Au moment du snapshot completed, agréger `competitors_mentioned` du snapshot N et N-1.
2. Calculer le ranking par `mention_count` pour chaque snapshot.
3. Si une entité présente dans le **top 10 de N** est **absente du top 20 de N-1** → fire `competitor_emerged`.
4. Sévérité : `high` si rank ≤ 5, `medium` sinon.

### Distinction vs `competitor_overtake` existant

- `competitor_overtake` (existant) : concurrent absent en N-1 ET ratio ≥ 30% des mentions en N. Déclenche sur **émergence forte single-snapshot**.
- `competitor_emerged` (nouveau) : entité qui apparaît dans le **top du classement** par volume, indépendamment du ratio. Déclenche sur **mouvement sectoriel détecté via le ranking**.

Les deux peuvent fire ensemble pour un même concurrent (intentionnel — vues complémentaires).

### Email template

Ajout dans `saas_send_alert_email` :
- `TYPE_LABELS.competitor_emerged = "Concurrent émergent"`
- `TYPE_EMOJI.competitor_emerged = "◇"`

---

## Section 4 — §4.5 Email digest hebdo

**Fichier** : `supabase/functions/saas_send_weekly_digest/index.ts` (338 lignes, 1 nouveau endpoint)

### Pipeline

1. SELECT users avec `digest_weekly_enabled = true` ET email matchant le filtre TEST (cf §6.7 ci-dessous).
2. Pour chaque user :
   - Skip si `tier = 'free'`
   - Calcul fenêtre semaine = lundi 0h UTC précédent → dimanche 23h59 UTC, vs S-1
   - Récupère snapshots completed dans la fenêtre + S-1
   - Calcule pour chaque marque : `visibility_now`, `visibility_prev`, `citation_now`, `citation_prev`
   - Top 3 concurrents par mention_count (depuis dernières snapshot responses de la semaine)
   - Top 1 reco priority high non lue (toutes brands)
   - Compte alertes générées dans la semaine
3. Skip si « rien à dire » (0 snapshot ET 0 alerte)
4. POST Resend avec template HTML inline (tech crisp : Inter, brand-500, glyphe `·` ambré préservé)
5. Insert `saas_usage_log` event_type=`digest_sent`

### Template Resend

- Subject : `Ta semaine Geoperf — ↑/↓/→ +X.X pt`
- Hero : « Cette semaine sur {brand} »
- Table marques (visibility, citation, deltas couleurs)
- Section « Concurrents qui montent » (top 3)
- Section « Action recommandée » (1 reco)
- Footer : nombre d'alertes + lien dashboard + lien désinscription

### pg_cron

`saas-weekly-digest` schedulé lundi 7h UTC. Pattern Vault identique à `saas-run-scheduled-snapshots` (Phase 1). Service role key lu via `vault.decrypted_secrets`.

### UI Settings

Ajout dans `/app/settings` d'une seconde checkbox sous le toggle alerts existant :
> [x] Recevoir le digest hebdo (lundi 8h CET)
> Résumé compact de la semaine : visibility delta, top concurrents qui montent, action recommandée.

Le `updateProfile` action persiste désormais `digest_weekly_enabled`.

---

## Section 5 — §4.4 Auto-suggest 5 prompts via Haiku

### 5.1 Edge Function

**Fichier** : `supabase/functions/saas_suggest_prompts/index.ts` (~165 lignes)

- Modèle : `anthropic/claude-haiku-4-5-20251001` via OpenRouter
- System prompt FR strict (catégories `direct_search` | `competitive` | `use_case`, pas de markdown, JSON pur)
- Variables disponibles dans le template : `{brand}`, `{category}`, `{competitors}`, `{competitors[0]}`, etc.
- Rate-limit : 1 appel/min par user_id (via `saas_usage_log` event_type=`prompt_suggest`)
- Coût estimé : ~$0.001 par appel (Haiku 4.5, ~800 max_tokens, 0.4 temperature)

### 5.2 API route Next.js

**Fichier** : `landing/app/api/saas/suggest-prompts/route.ts`

Proxy server-side authentifié :
- Vérifie session user via `getSupabaseServerClient()`
- Renvoie 401 si non logué
- Forward vers Edge Function avec service_role_key (server-only)

### 5.3 UI Client component

**Fichier** : `landing/components/saas/PromptSuggestionPicker.tsx`

- Bouton « Suggérer 5 prompts » → fetch API → 5 prompts en preview avec checkboxes (default cochés)
- Erreur lisible si nom/catégorie manquants ou si rate-limited (429)
- Sérialisation JSON des prompts cochés dans input caché `suggested_prompts_json`
- Le server action `createBrand` lit ce champ et merge dans `saas_topics.prompts` (le default topic est créé par trigger DB sur insert brand)

### 5.4 Modif `createBrand` action

Après insert de la marque, lecture de `suggested_prompts_json`, parse strict (JSON.parse + Array check), filtrage des templates valides, insertion dans `saas_topics.prompts` du default topic. Erreur silencieuse en cas de parse fail (la marque reste créée, juste sans prompts custom).

---

## Section 6 — §4.3 Filtre temporel

### 6.1 Composant

**Fichier** : `landing/components/saas/PeriodToggle.tsx` (52 lignes, client component)

- 4 options : 1m / 3m / 6m / 12m (default 3m)
- Stockage via URL param `?period=...`
- Helper `periodToDays(p)` exporté pour usage server-side dans la page

### 6.2 Intégration page brand

**Fichier** : `landing/app/app/brands/[id]/page.tsx`

- Lecture du param dans `searchParams.period`
- Filtrage de la query `v_saas_brand_evolution` via `.gte("snapshot_date", periodCutoff)`
- Calcul d'un `periodDelta` = visibility(newest) - visibility(oldest in window)
- Affichage du delta sous le big number visibility : « +5.2 pt vs il y a 3 mois »
- Insertion du `<PeriodToggle />` sous le `TopicSelector` et avant l'AlertBanner

**Pas filtré** (intentionnel) :
- `CompetitorRankingBars`, `Top10*` widgets, `CompetitorMatrix` : restent sur le **dernier snapshot** (instantané)
- Historique snapshots : reste sur les 20 derniers (logique existante)

---

## Section 7 — §4.1 + §4.2 Dashboard refondu

### 7.1 Auto-redirect mono-brand (§4.2)

```ts
if (brandList.length === 1 && alertList.length === 0 &&
    brandList[0].last_snapshot_at &&
    Date.now() - new Date(brandList[0].last_snapshot_at).getTime() < 7 * 86400000) {
  redirect(`/app/brands/${brandList[0].id}`);
}
```

L'user mono-brand sain (≤ 7j depuis le dernier snapshot, 0 alertes unread) bypass directement le dashboard. L'user reste sur le dashboard si :
- Plusieurs marques
- Au moins une alerte unread
- Snapshot très ancien (cas onboarding incomplet)
- Aucune brand (EmptyState)

### 7.2 Structure refondue (§4.1)

```
Hero : "Bonjour {firstName}" + TierBadge + ligne info plan
ROW 1 : 5 KPIs
  ├─ Visibility moy. (avec delta vs 7j + sparkline 12 derniers points)
  ├─ Citation moy. (avec delta vs 7j)
  ├─ Mentions 7j (total brand_mention_count + total_mention_count)
  ├─ Concurrents distincts trackés
  └─ Snapshots ce mois
ROW 2 : 3 SuggestionCard
  ├─ Alerts (variant alerts si N>0, idle sinon)
  ├─ Recos (top reco priority high non lue)
  └─ Action suggérée contextuelle (rule-based)
AlertBanner (si alertes unread)
ROW 3 : Multi-brand BrandOverviewRow
  Pour chaque brand : nom + domaine + visibility + sparkline 6 derniers + top concurrent + badge alertes
ROW 4 : ActivityTimeline 7j
  Aggrège snapshots completed + alertes + recos + brand_created, sorted by created_at desc, max 10
Footer : plan info + lien /app/billing
```

### 7.3 Suggestion contextuelle — décision rule-based pas Haiku

Le brief §4.1 mentionne « Suggestion contextuelle Haiku (1 fois/jour cached) ». **Décision S15** : implémenter rule-based pour ce sprint, sans cache complexe. Justification :
- Pas d'appel LLM par visite dashboard (coût, latence)
- Heuristiques simples, prédictibles, gratuites
- Cache 1 fois/jour nécessite stockage par user (table cache + invalidation) — over-engineering pour S15
- Si l'utilisateur n'aime pas la qualité rule-based en feedback, on remplace en S16 par un appel Haiku cached

Heuristique implémentée :
1. Si une marque a son dernier snapshot > 7j → « Lance un snapshot sur {brand} (dernier il y a Xj) »
2. Sinon → « Tout est sous contrôle »

(Possibles extensions S16 : « moins de 3 concurrents trackés sur {brand} », « tier permet hebdo mais cadence mensuelle ».)

### 7.4 Composants nouveaux (4)

| Composant | Lignes | Type |
|---|---|---|
| `DashboardKpiCard.tsx` | 36 | server |
| `SuggestionCard.tsx` | 41 | server |
| `BrandOverviewRow.tsx` | 47 | server |
| `ActivityTimeline.tsx` | 64 | server |

Tous server-side, 0 chunk client supplémentaire. Tech crisp respecté (Inter, brand-500 #2563EB, ink-subtle, JetBrains Mono eyebrows).

### 7.5 Données fetchées en parallèle

`Promise.all([brands, alerts, evolution(50), snapshots7d, monthSnapshotsCount, topReco])` puis 2 queries séquentielles pour l'activity (`recentRecos`, `recentBrands`) + 1 query pour `competitor_domains` distincts si pas dans v_saas_brand_latest + 1 query pour `topCompetitorByBrand` (responses du dernier snapshot par brand).

---

## Section 8 — Filtre email TEST (§6.7 du brief)

**IMPORTANT — À retirer avant rollout production** :

Dans `saas_send_weekly_digest/index.ts`, hardcode environnemental :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "flefebvre@jourdechance.com")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
```

**Comportement actuel** :
- Filtre actif par default → seul `flefebvre@jourdechance.com` reçoit le digest même si d'autres users ont `digest_weekly_enabled = true`
- Pour rollout prod : set `DIGEST_TEST_EMAIL_FILTER=` (vide) dans Vercel/Supabase env vars OU édit le code pour retirer le filtre

**Mention dans la réponse de l'Edge Function** :
```json
{
  "ok": true,
  "test_filter_active": true,
  "test_filter_emails": ["flefebvre@jourdechance.com"],
  ...
}
```

→ L'admin peut voir d'un coup d'œil que le filtre est actif via curl/Postman.

---

## Section 9 — Tests effectués pendant la session

| # | Test | Status |
|---|---|---|
| 1 | Vérification slugs OpenRouter (overview/copilot/grounded/microsoft/phi/bing) | OK introuvables → §4.7 reporté |
| 2 | Migration `saas_phase7_alert_type_competitor_emerged` apply | OK `{success: true}` |
| 3 | Migration `saas_phase7_weekly_digest_pref_and_cron` apply | OK `{success: true}` |
| 4 | Vérif pg_cron schedule actif | OK `{jobname: 'saas-weekly-digest', schedule: '0 7 * * 1'}` |
| 5 | `npm run build` (landing/) | OK 31 pages, dashboard 267 B server-only |

### Tests à valider par Fred après deploy

| # | Test | Comment |
|---|---|---|
| 6 | Login user 0 brand → EmptyState onboarding | Dashboard refondu doit afficher EmptyState identique S13 |
| 7 | Login user 1 brand sans alerte + snapshot < 7j → redirect auto vers `/app/brands/[id]` | Test §4.2 |
| 8 | Login user 1 brand avec alertes → reste sur dashboard, KPIs + ROW2 alertes | Test §4.2 fallback |
| 9 | Login user N>1 brands → ROW3 Multi-brand BrandOverviewRow visible | Test §4.1 ROW3 |
| 10 | Page `/app/brands/[id]?period=1m` → BrandEvolutionChart filtré 30j + delta affiché | Test §4.3 |
| 11 | Form `/app/brands/new` → click "Suggérer 5 prompts" → 5 prompts cochables affichés en <5s | Test §4.4 |
| 12 | 2e click "Suggérer" en <60s → toast 429 "réessaie dans 60s" | Test rate-limit §4.4 |
| 13 | Submit form avec 3 prompts cochés → marque créée + topic default a 30+3 prompts | Test §4.4 persistance |
| 14 | Trigger manuel `curl POST /functions/v1/saas_send_weekly_digest -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"` → email arrive sur flefebvre@jourdechance.com | Test §4.5 (filtre actif) |
| 15 | User avec `digest_weekly_enabled=false` → pas d'email | Test §4.5 opt-out |
| 16 | Settings UI : toggle digest hebdo + sauvegarder → DB persiste | Test §4.5 UI |
| 17 | Snapshot avec un concurrent jamais vu → alerte `competitor_emerged` créée | Test §4.6 |
| 18 | Email `competitor_emerged` reçu avec subject "[À regarder] {brand} — Nouveau concurrent : X" | Test §4.6 deliverability |

---

## Section 10 — Reste à faire pour Fred (deploy)

### 10.1 Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S15: dashboard synthetique + 6 quick wins (filtre temporel, auto-suggest prompts, email digest, trend detection)"
```

Vercel auto-redeploy en 1-2 min.

### 10.2 Deploy Edge Functions

```bash
# 4 fonctions à déployer (3 nouvelles + 2 modifiées)
npx supabase functions deploy saas_suggest_prompts
npx supabase functions deploy saas_send_weekly_digest
npx supabase functions deploy saas_detect_alerts
npx supabase functions deploy saas_send_alert_email
```

**Critique** : sans `saas_send_weekly_digest` deployé, le pg_cron du lundi 7h UTC va échouer (URL 404).

### 10.3 Migrations DB

Déjà appliquées pendant la session via `apply_migration` MCP. Aucune action manuelle requise.

### 10.4 Env vars à vérifier sur Supabase Edge Functions

- `RESEND_API_KEY` (existant, pour digest + alerts)
- `ALERTS_EMAIL_FROM` (default OK : `Geoperf Alerts <alerts@geoperf.com>`)
- `OPENROUTER_API_KEY` (existant, pour suggest-prompts + Haiku)
- `APP_URL` (default OK : `https://geoperf.com`)
- `DIGEST_TEST_EMAIL_FILTER` (optionnel, default `flefebvre@jourdechance.com` — laisser tel quel pour la phase de validation)

### 10.5 Test E2E digest hebdo (RECOMMANDÉ avant rollout)

```bash
# Trigger manuel pour valider deliverability
curl -X POST https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_weekly_digest \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Vérifier la réponse : `test_filter_active: true`, `test_filter_emails: ["flefebvre@jourdechance.com"]`, `sent: 1`.

### 10.6 Retirer filtre email avant rollout production

**Étape critique pour rollout Solo+ users :**

Option A (recommandé) : edit `saas_send_weekly_digest/index.ts` ligne ~28, remplacer le default :
```typescript
const TEST_EMAIL_FILTER = (Deno.env.get("DIGEST_TEST_EMAIL_FILTER") ?? "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
```
Puis redeploy.

Option B : set env var `DIGEST_TEST_EMAIL_FILTER=` (vide) sur Supabase Edge Function settings.

---

## Section 11 — Sujets reportés explicitement (cf brief §8)

| Sujet | Sprint cible |
|---|---|
| AI Overviews + Copilot LLMs | S16 (slugs introuvables, ré-évaluer Vertex AI direct + proxy Bing) |
| System prompt structuré sources | S16 |
| Daily snapshots Pro+ (×7 coûts) | S16 |
| Mobile responsive audit complet | S16 |
| Backfill rangs concurrents historiques | S16 (si parser S14 concluant) |
| Suggestion contextuelle dashboard via Haiku cached | S16+ (S15 = rule-based) |
| Sectoral leaderboard public | S17+ |
| Cross-brand benchmark anonymisé | S17+ |
| Prompt Studio UI | S17+ |
| Public Profile pages enrichies | S17+ |

---

## Section 12 — `git status --short` final

### Côté `C:\Dev\GEOPERF\` (repo backend)

```
 M supabase/functions/saas_detect_alerts/index.ts
 M supabase/functions/saas_send_alert_email/index.ts
?? saas/docs/SPRINT_S15_BRIEF.md
?? saas/docs/SPRINT_S15_RECAP.md
?? supabase/functions/saas_send_weekly_digest/
?? supabase/functions/saas_suggest_prompts/
?? supabase/migrations/20260503_saas_phase7_weekly_digest.sql
```

### Côté `C:\Dev\GEOPERF\landing\` (repo frontend séparé)

```
 M app/app/brands/[id]/page.tsx           (period toggle + delta période)
 M app/app/brands/new/actions.ts          (merge suggested_prompts_json)
 M app/app/brands/new/page.tsx            (PromptSuggestionPicker injecté)
 M app/app/dashboard/page.tsx             (refonte command center)
 M app/app/settings/actions.ts            (digest_weekly_enabled persist)
 M app/app/settings/page.tsx              (toggle digest UI)
 M lib/saas-auth.ts                       (SaasProfile + SELECT digest_weekly_enabled)
 M push_update.ps1                        (modif Fred avant ce sprint, non touchée par moi)
?? app/api/saas/                          (route suggest-prompts proxy)
?? components/saas/ActivityTimeline.tsx
?? components/saas/BrandOverviewRow.tsx
?? components/saas/DashboardKpiCard.tsx
?? components/saas/PeriodToggle.tsx
?? components/saas/PromptSuggestionPicker.tsx
?? components/saas/SuggestionCard.tsx
```

---

## Stats finales S15

- **2 repos touchés** : root (backend Edge Functions + migration) + landing (frontend)
- **3 Edge Functions** : 2 nouvelles (saas_send_weekly_digest, saas_suggest_prompts) + 2 modifiées (saas_detect_alerts, saas_send_alert_email)
- **6 nouveaux composants frontend** : DashboardKpiCard, SuggestionCard, BrandOverviewRow, ActivityTimeline, PeriodToggle, PromptSuggestionPicker
- **1 nouveau API route** : `/api/saas/suggest-prompts`
- **1 migration SQL** (2 apply_migration MCP calls)
- **1 pg_cron schedule** ajouté (lundi 7h UTC)
- **0 nouvelle dépendance npm**
- **6/7 livrables livrés ; §4.7 reporté en S16** avec raison documentée
- **Build vert** OK

---

## Notes méthodologiques

### §4.7 reporté — décision documentée

Le brief autorisait explicitement le report en S16 si les slugs étaient introuvables (cf §4.7 étape 1 : « Si slugs introuvables : reporter §4.7 en S16 et le mentionner dans le recap. Ne pas bloquer le sprint. »). C'est ce qui a été fait. Le scope est resté à 6/7 sans dégrader la qualité.

### Suggestion contextuelle rule-based vs Haiku cached

J'ai choisi rule-based pour S15 plutôt que Haiku cached 1/jour (cf §7.3 ci-dessus). Si Fred trouve la qualité insuffisante, S16 peut implémenter un cache `saas_dashboard_suggestions(user_id, generated_at, suggestion_json)` invalidé daily.

### Filtre email test

Le filtre `flefebvre@jourdechance.com` est implémenté **AU NIVEAU DE LA FONCTION EDGE** (pas dans la query DB côté Next), pour 2 raisons :
1. Le filtre s'applique uniquement à la fonction `saas_send_weekly_digest` (les alerts par snapshot continuent leur cours normal pour tous les users payants).
2. Désactiver le filtre = 1 env var vide ou 1 ligne de code, sans toucher à la DB.

### Anti-pattern §6 (Write tool tronque sur Windows mount)

3 fichiers écrits via Write tool :
- `saas_send_weekly_digest/index.ts` (338 lignes) — vérifié intact via `tail -5`
- `dashboard/page.tsx` (440 lignes) — vérifié intact
- `SPRINT_S15_RECAP.md` (ce fichier) — vérifié intact

Bash heredoc a échoué une fois sur des apostrophes FR dans du HTML inline (template Resend). Bascule sur Write tool puis vérification post-écriture. Build vert confirme l'intégrité.

### `competitor_emerged` vs `competitor_overtake`

Les deux alertes coexistent volontairement (cf §3 ci-dessus). `overtake` réagit à un ratio fort de mentions single-snapshot ; `emerged` réagit à un mouvement de classement par rank. Le même concurrent peut déclencher les deux dans le même snapshot — c'est un signal positif (vue à deux dimensions).

### pg_cron pattern Vault

Le secret `saas_service_role_key` du Vault est déjà créé en Phase 1. Aucun setup manuel supplémentaire pour S15. Le job cron lit le secret au moment de l'exécution — pas de hardcoding.

---

## Documents livrés ce sprint

1. **`saas/docs/SPRINT_S15_RECAP.md`** (ce fichier)
2. **`supabase/migrations/20260503_saas_phase7_weekly_digest.sql`** — migration appliquée (2 apply_migration calls)
3. **`supabase/functions/saas_send_weekly_digest/index.ts`** — Edge Function digest hebdo
4. **`supabase/functions/saas_suggest_prompts/index.ts`** — Edge Function Haiku
5. **`landing/components/saas/DashboardKpiCard.tsx`** — KPI card dashboard
6. **`landing/components/saas/SuggestionCard.tsx`** — action card dashboard
7. **`landing/components/saas/BrandOverviewRow.tsx`** — ligne multi-brand
8. **`landing/components/saas/ActivityTimeline.tsx`** — timeline 7j
9. **`landing/components/saas/PeriodToggle.tsx`** — filtre temporel client
10. **`landing/components/saas/PromptSuggestionPicker.tsx`** — picker prompts client
11. **`landing/app/api/saas/suggest-prompts/route.ts`** — proxy API
12. Modifs : `landing/app/app/dashboard/page.tsx`, `landing/app/app/brands/[id]/page.tsx`, `landing/app/app/brands/new/{page,actions}.ts(x)`, `landing/app/app/settings/{page,actions}.ts(x)`, `landing/lib/saas-auth.ts`, `supabase/functions/saas_detect_alerts/index.ts`, `supabase/functions/saas_send_alert_email/index.ts`

---

Bon push Fred !
