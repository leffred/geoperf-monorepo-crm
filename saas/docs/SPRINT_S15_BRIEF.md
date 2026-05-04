# Sprint S15 — Brief

**Date brief** : 2026-05-02
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-02 après S14 livré)
**Effort estimé** : 1 nuit Claude Code dense (5-7h focus dev)
**Pré-requis** : S14 mergé et déployé (parser rangs concurrents + 4 widgets Overview)

---

## 1. Pourquoi ce sprint

S14 a refondu `/app/brands/[id]` (la page d'une marque) au niveau de densité GetMint. Mais le **`/app/dashboard`** (la page d'accueil après login) est resté minimaliste : 4 stats tier + grid de cards brand + 1 chart de la marque "featured". L'user qui se logge ne voit pas l'essentiel.

**Décision Fred 2026-05-02** : refondre `/app/dashboard` en **page synthétique de commande** (5-7 KPIs + 3 actions suggérées), PAS un cockpit Boeing exhaustif. Le drill-down détaillé reste sur `/app/brands/[id]`.

**En parallèle** : packager dans le même sprint **5 quick wins** qui débloquent du engagement et du différentiel concurrentiel : filtre temporel, auto-suggest prompts, email digest hebdo, trend detection, AI Overviews + Copilot LLMs.

**Anti-pattern à éviter** : tout entasser. Si le scope dépasse, l'agent doit prioriser dans l'ordre §4.1 → §4.7 et reporter §4.8 (AI Overviews) en S16 si manque de temps.

---

## 2. Périmètre

### In scope (par ordre de priorité décroissante)

1. **Refonte `/app/dashboard`** en command center synthétique (mono + multi-brand)
2. **Auto-redirect mono-brand** : si l'user a 1 seule marque + 0 alerte unread → redirect direct vers `/app/brands/[id]`
3. **Filtre temporel** "vs 1m / 3m / 6m / 12m" sur la page brand Overview (réutilise donnée existante)
4. **Auto-suggest 5 prompts via Haiku** à la création d'une marque (`/app/brands/new` ou onboarding)
5. **Email digest hebdo** chaque lundi 8h CET (Edge Function + pg_cron)
6. **Trend detection** : nouveau concurrent dans le top 10 → alerte `competitor_emerged`
7. **AI Overviews + Copilot LLMs** : vérification slugs OpenRouter + ajout dans `LLMS_BY_TIER` Agency

### Out of scope (reporté explicitement)

- ❌ System prompt structuré sources (+15% coût LLM, à modéliser séparément en S16)
- ❌ Daily snapshots Pro+ (impact business model à modéliser, S16)
- ❌ Mobile responsive audit complet (exploratoire, S16+)
- ❌ Sectoral leaderboard public (gros sprint dédié, S17+)
- ❌ Cross-brand benchmark anonymisé (gros sprint, S17+)
- ❌ Prompt Studio dans l'UI (gros chantier, S17+)
- ❌ Backfill rangs concurrents historiques (cher, S16 si concluant)

---

## 3. État courant à connaître

### 3.1 Page `/app/dashboard` actuelle (170 lignes)
- Header greeting + CTA "Suivre une marque"
- AlertBanner si alertes unread
- 4 cards Stats tier (Marques / Cadence / LLMs / Plan)
- EmptyState si aucune marque (CTA onboarding)
- 1 BrandEvolutionChart de la marque "featured" (la plus historisée)
- Grid cards brands : nom/domain, visibility, avg_rank, citation_rate, SoV, date last snapshot, badges alerts/recos
- Données : `v_saas_brand_latest`, `saas_alerts` (5 unread), `v_saas_brand_evolution` (50 points)

### 3.2 Cron / scheduling
- **pg_cron natif** sur Postgres Supabase (cf `supabase/migrations/20260429_saas_phase1_cron.sql`)
- Trigger horaire à `:15` qui appelle `saas_run_all_scheduled` via `net.http_post` (pg_net) avec service_role_key du Vault
- **Pour S15** : ajouter une nouvelle entrée pg_cron pour `saas_send_weekly_digest` chaque **lundi 8h CET (= 7h UTC)**

### 3.3 Système d'alertes existant (`saas_detect_alerts`)
6 types d'alertes : `rank_drop`, `rank_gain`, `citation_loss`, `citation_gain`, `competitor_overtake`, `new_source`.
Sévérité : `high | medium | low`. Schéma : `saas_alerts (brand_id, user_id, snapshot_id, alert_type, severity, title, body, metadata JSONB, email_sent_at, created_at)`.
**Pour S15** : ajouter le type `competitor_emerged` (nouveau concurrent dans le top 10).

### 3.4 Email send (`saas_send_alert_email`)
Service **Resend**, env `ALERTS_EMAIL_FROM` (default `Geoperf Alerts <alerts@geoperf.com>`).
Template HTML inline via `renderEmail()`, réutilisable. Tags Resend `alert_type` + `severity`.
**Pour S15** : créer une nouvelle Edge Function `saas_send_weekly_digest` qui réutilise le même client Resend mais avec un template digest dédié.

### 3.5 LLMs par tier (`LLMS_BY_TIER` dans `saas_run_brand_snapshot/index.ts` lignes 29-37)
```
Free      : ['openai/gpt-4o']
Starter   : ['openai/gpt-4o', 'anthropic/claude-sonnet-4-6', 'google/gemini-2.5-pro', 'perplexity/sonar-pro']
Growth    : idem Starter (4)
Pro       : Starter + ['mistralai/mistral-large', 'x-ai/grok-2'] (6)
Agency    : Pro + ['meta-llama/llama-3.3-70b-instruct'] (7)
```
**Pour S15** : ajouter AI Overviews + Copilot uniquement sur Agency (vérifier slugs OpenRouter au démarrage).

---

## 4. Livrables (ordonnés par priorité)

### 4.1 Refonte `/app/dashboard` — command center synthétique

**Fichier** : `landing/app/app/dashboard/page.tsx`

**Nouvelle structure (mono-brand + multi-brand unifiée)** :

```
┌─ Hero greeting "Bonjour {firstName}" + chip "Plan {tier}"
│
├─ ── ROW 1 : 5 KPIs principaux (cards alignées) ──────────
│  KPI 1 : Visibility moyenne (toutes brands) avec delta vs 7j
│  KPI 2 : Citation rate moyen avec delta vs 7j
│  KPI 3 : Mentions totales (semaine en cours) absolu
│  KPI 4 : Concurrents trackés (count distinct)
│  KPI 5 : Snapshots restants ce mois (quota tier - usage)
│
├─ ── ROW 2 : 3 actions suggérées (cards interactives) ────
│  Action card 1 : "X alertes nouvelles" → /app/alerts (filtré unread)
│                  ou si 0 alertes : "Tout est sous contrôle"
│  Action card 2 : "Y recommandations" → /app/brands/[topBrand]/recommendations
│                  ou si 0 : "Aucune action urgente"
│  Action card 3 : Suggestion contextuelle Haiku (1 fois/jour cached) :
│                  ex "Lance un snapshot sur {brand} (dernier il y a 8j)"
│                  ex "Ajoute un concurrent à {brand} (seulement 2 trackés)"
│                  ex "Augmente ta cadence à hebdo (Starter+)"
│
├─ ── ROW 3 : Multi-brand overview (si N>1) ──────────────
│  Pour chaque brand : row compacte
│    [LogoMark] [name] [visibility%] [sparkline 6 sem] [Top concurrent] [→]
│  Si N=1 : auto-redirect vers /app/brands/[id] (cf §4.2)
│
├─ ── ROW 4 : Last activity (timeline 7 derniers jours) ──
│  Timeline compacte des events : snapshot completed, alerte fired,
│  reco générée, brand créée. Max 10 items.
│
└─ Footer : "Plan {tier} - {brands_used}/{brands_limit} brands - Upgrade"
```

**Composants à créer dans `landing/components/saas/`** :
- `DashboardKpiCard.tsx` : KPI avec valeur grosse + delta + sparkline mini
- `SuggestionCard.tsx` : action card cliquable (3 variantes : alerts / recos / haiku)
- `BrandOverviewRow.tsx` : ligne compacte multi-brand (réutilise sparkline existant)
- `ActivityTimeline.tsx` : timeline compacte server-side

**Données nouvelles à fetcher** :
- KPIs agrégés multi-brand (calcul côté JS depuis `v_saas_brand_latest`)
- Quota usage : `SELECT COUNT(*) FROM saas_brand_snapshots WHERE user_id = ? AND created_at > date_trunc('month', NOW())`
- Activité 7j : UNION des events depuis `saas_brand_snapshots`, `saas_alerts`, `saas_recommendations`

**Style** : Tech crisp (Inter, brand-500 #2563EB, surface #F7F8FA, glyphe `·` ambré préservé). Cards `border border-ink/[0.08] p-6 rounded-lg`. Eyebrow JetBrains Mono uppercase.

### 4.2 Auto-redirect mono-brand

**Fichier** : `landing/app/app/dashboard/page.tsx` (en haut de la fonction)

```typescript
// Si user a exactement 1 brand + 0 alerte unread + dernier snapshot < 7 jours,
// redirect direct vers la page brand. Sinon, on affiche le dashboard.
if (
  brandList.length === 1 &&
  alertList.length === 0 &&
  brandList[0].last_snapshot_at &&
  Date.now() - new Date(brandList[0].last_snapshot_at).getTime() < 7 * 86400000
) {
  redirect(`/app/brands/${brandList[0].id}`);
}
```

**Important** : NE PAS rediriger si alertes unread (l'user doit voir le dashboard pour les traiter) ou si snapshot très ancien (cas onboarding incomplet, l'user doit voir l'EmptyState ou les CTAs).

### 4.3 Filtre temporel sur page brand

**Fichier** : `landing/app/app/brands/[id]/page.tsx`

Ajouter un toggle horizontal en haut de la page (sous le header brand, avant Row 1) :

```
[ 1 mois | 3 mois | 6 mois | 12 mois ]   (default = 3 mois)
URL param : ?period=3m
```

**Impact sur les widgets** :
- BrandEvolutionChart : filtre `snapshot_date >= NOW() - INTERVAL '{period}'`
- KPIs visibility/citation_rate : montrer le delta sur la période sélectionnée (ex: "+5pts vs il y a 3 mois")
- CompetitorRankingBars / Top10 : reste sur le **dernier snapshot** (instantané), n'est pas filtré
- Activity timeline (si présent) : filtré

**Composant à créer** : `landing/components/saas/PeriodToggle.tsx` (client component cette fois, géré via URL param avec `useSearchParams`).

**Donnée déjà en DB** : aucun changement nécessaire, juste filtrer les requêtes existantes.

### 4.4 Auto-suggest 5 prompts via Haiku

**Fichiers** :
- `landing/app/app/brands/new/page.tsx` (form de création de marque) — ou `/app/onboarding/page.tsx`
- Nouvelle Edge Function : `supabase/functions/saas_suggest_prompts/index.ts`

**Flow** :
1. Dans le form de création, après que l'user a saisi `name`, `domain`, `category`, `competitor_domains` → bouton "Suggérer des prompts" (loading)
2. Server action appelle l'Edge Function `saas_suggest_prompts` avec `{name, domain, category, competitors}`
3. Edge Function : appelle Haiku via OpenRouter avec un prompt système :
   ```
   Tu es un expert SEO/GEO B2B. Génère exactement 5 prompts en français
   qui seraient typiquement posés par un acheteur B2B cherchant des solutions
   dans la catégorie "{category}". Format JSON :
   [{"category": "direct_search|competitive|use_case", "template": "..."}]
   Pas de markdown, pas de commentaire, juste le JSON array.
   ```
4. Edge Function retourne le JSON, le frontend l'affiche en preview avec checkboxes
5. L'user coche ceux qu'il veut conserver (par défaut tous cochés)
6. Au submit du form, les prompts cochés sont mergés dans `saas_topics.prompts` (override) en plus du jeu par défaut

**Coût** : 1 appel Haiku par création de marque, ~$0.001 (négligeable).

**Cap** : maximum 1 appel par minute par user (rate-limit côté Edge Function).

### 4.5 Email digest hebdo

**Fichiers** :
- Nouvelle Edge Function : `supabase/functions/saas_send_weekly_digest/index.ts`
- Migration : `supabase/migrations/20260503_saas_phase7_weekly_digest.sql` (ajout pg_cron entry + colonne preference)

**Flow** :
1. pg_cron tous les **lundi 7h UTC** → `saas_send_weekly_digest`
2. La fonction :
   - SELECT tous les users avec `digest_weekly_enabled = true` (default true)
   - Pour chaque user, calculer pour la semaine écoulée (lundi 0h → dimanche 23h59) :
     - Visibility delta vs semaine précédente
     - Top 3 concurrents qui ont gagné le plus de mentions
     - Top 1 reco actionable (priority high non lue)
     - Nb d'alertes générées dans la semaine
   - Si rien à dire (aucun snapshot dans la semaine + 0 alerte) → skip envoi
   - Sinon → envoyer via Resend avec template digest

**Template Resend** (à créer dans la fonction, inline) :
```
Subject : "📊 Ta semaine Geoperf — visibility {delta_emoji} {delta}"
Body :
  - Hero : "Cette semaine sur {brand_name}"
  - 3 KPI cards : visibility, citation, SoV (avec delta vs S-1)
  - Section "Concurrents qui montent" : top 3 avec leurs deltas
  - Section "Action recommandée" : 1 reco actionable
  - Footer : "{X} alertes non lues - Voir tout sur app.geoperf.com"
```

**Migration SQL additive** :
```sql
ALTER TABLE saas_profiles
  ADD COLUMN IF NOT EXISTS digest_weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- pg_cron entry (lundi 7h UTC)
SELECT cron.schedule(
  'saas-weekly-digest',
  '0 7 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_weekly_digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**UI settings** : ajouter un toggle "Recevoir le digest hebdo (lundi 8h)" dans `/app/settings`.

### 4.6 Trend detection — `competitor_emerged`

**Fichier** : `supabase/functions/saas_detect_alerts/index.ts`

**Logique** :
1. Au moment du snapshot completed, comparer le top 10 concurrents (par mention_count via `v_saas_competitor_share_of_voice`) :
   - Snapshot N (current)
   - Snapshot N-1 (le précédent completed pour la même brand)
2. Si une entité présente dans le top 10 de N est absente du top 20 de N-1 → fire alerte `competitor_emerged`
3. Sévérité : `high` si l'entité est dans top 5, sinon `medium`

**Format alerte** :
```typescript
{
  alert_type: 'competitor_emerged',
  severity: 'high' | 'medium',
  title: `Nouveau concurrent : ${name}`,
  body: `${name} apparaît pour la première fois dans le top 10 (rang ${rank}, ${mention_count} mentions). C'est peut-être un signe de mouvement sectoriel.`,
  metadata: { entity_name, mention_count, rank, snapshot_id }
}
```

**Test** : créer manuellement un snapshot où un concurrent n'est pas dans l'historique précédent, vérifier que l'alerte est créée.

### 4.7 AI Overviews + Copilot LLMs (Agency tier)

**Fichier** : `supabase/functions/saas_run_brand_snapshot/index.ts` (lignes 29-37)

**ÉTAPE 1 — Vérification slugs OpenRouter** (à faire AU DÉBUT, peut bloquer le sprint) :

L'agent doit appeler OpenRouter `/api/v1/models` (ou consulter https://openrouter.ai/models) pour confirmer les slugs disponibles. Candidats probables :
- `google/ai-overviews` ou `google/gemini-2.5-flash-grounded`
- `microsoft/copilot` ou `microsoft/phi-3.5` (Copilot n'est pas directement OpenRouter, peut nécessiter un proxy)

**Si slugs introuvables** : reporter §4.7 en S16 et le mentionner dans le recap. Ne pas bloquer le sprint.

**ÉTAPE 2 — Si slugs OK** :
```typescript
const LLMS_BY_TIER = {
  free: ['openai/gpt-4o'],
  starter: [...],
  growth: [...],
  pro: [...],
  agency: [
    ...LLMS_BY_TIER.pro,
    'meta-llama/llama-3.3-70b-instruct',
    'google/ai-overviews',     // NEW
    'microsoft/copilot',        // NEW (à confirmer)
  ],
};
```

**Test** : lancer un snapshot Agency, vérifier que les 9 LLMs sont appelés et que les coûts restent raisonnables.

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
```
Doit passer vert. 0 nouvelle dépendance npm attendue.

### 5.2 Tests fonctionnels

**Dashboard refondu (§4.1, §4.2)** :
1. Login user 0 brand → EmptyState onboarding (existant)
2. Login user 1 brand sans alerte unread + snapshot récent → redirect auto vers `/app/brands/[id]`
3. Login user 1 brand avec alertes → reste sur dashboard, KPIs + ROW2 alertes visibles
4. Login user 3 brands → dashboard complet avec ROW3 multi-brand

**Filtre temporel (§4.3)** :
5. Page brand avec ?period=1m → BrandEvolutionChart filtré, delta KPI calculé sur 30j
6. Page brand avec ?period=12m → Chart sur 12 mois, delta sur 365j
7. Default (pas de param) → 3m

**Auto-suggest prompts (§4.4)** :
8. Form `/app/brands/new` rempli (name, domain, category) → click "Suggérer" → 5 prompts proposés en <5s
9. Cocher 3 prompts, submit → la marque est créée avec ces 3 prompts en plus des 30 par défaut
10. Rate-limit : 2 clicks "Suggérer" en <60s → second renvoie 429

**Email digest (§4.5)** :
11. Trigger manuel : `curl -X POST .../saas_send_weekly_digest -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"` → vérifier qu'un email arrive sur le compte test
12. User avec `digest_weekly_enabled = false` → pas d'email
13. User sans snapshot dans la semaine → skip (logs visibles dans Supabase function logs)

**Trend detection (§4.6)** :
14. Snapshot brand X avec un concurrent jamais vu auparavant → alerte `competitor_emerged` créée + email envoyé
15. Snapshot suivant avec le même concurrent → pas de nouvelle alerte (uniquement à l'apparition)

**AI Overviews + Copilot (§4.7) — conditionnel** :
16. Si slugs validés : snapshot Agency → 9 LLMs callés, parsing OK, coût total <$0.50
17. Si slugs introuvables : §4.7 reporté en S16 dans le recap

### 5.3 Test régression
Vérifier que `/app/brands/[id]` (page S14) continue de fonctionner avec les 4 widgets, et que l'AlertBanner+sources/by-model/by-prompt/citations-flow ne sont pas cassés.

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. Migrations SQL sauvées AVANT `apply_migration` MCP.
2. Fichiers >150 lignes : bash heredoc obligatoire.
3. `npm run build` vert AVANT toute proposition de push.
4. Pas de toucher aux workflows n8n (lead-magnet, hors scope SaaS).
5. brand-500 = #2563EB (bleu).
6. Préserver le glyphe `·` ambré dans les emails et UI.
7. **Aucun envoi mail réel hors test compte Fred** : pour le digest hebdo, hardcoder un filtre `WHERE email IN ('flefebvre@jourdechance.com')` pendant la phase de validation. Mentionner clairement dans le recap qu'il faut retirer ce filtre avant rollout production.

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S15: dashboard synthetique + 6 quick wins (filtre temporel, auto-suggest prompts, email digest, trend detection, AI Overviews)"
```

### 7.2 Edge Functions à déployer
```bash
npx supabase functions deploy saas_suggest_prompts
npx supabase functions deploy saas_send_weekly_digest
npx supabase functions deploy saas_detect_alerts        # modifié pour competitor_emerged
npx supabase functions deploy saas_run_brand_snapshot   # si §4.7 livré
```

### 7.3 Migration DB
Appliquée via `apply_migration` MCP. Inclure le nouvel pg_cron schedule.

### 7.4 Env vars à vérifier
- `RESEND_API_KEY` (existant, vérifier non-expiré)
- `ALERTS_EMAIL_FROM` (default OK)
- `OPENROUTER_API_KEY` (existant)
- `service_role_key` dans Vault Postgres (pour pg_cron)

---

## 8. Reporté S16+

| Sujet | Sprint cible | Pourquoi pas S15 |
|---|---|---|
| System prompt structuré sources | S16 | +15% coût LLM, à benchmarker sur 1 marque test avant rollout |
| Daily snapshots Pro+ | S16 | Impact business model à modéliser (×7 coûts LLM) |
| Mobile responsive audit complet | S16 | Travail exploratoire, peut prendre 1-2 jours |
| Backfill rangs concurrents historiques | S16 | Coût compute, à faire si parser S14 concluant |
| Sectoral leaderboard public | S17+ | Gros sprint dédié, page SEO + acquisition |
| Cross-brand benchmark anonymisé | S17+ | Vue Postgres + UI Pro+ |
| Prompt Studio UI | S17+ | Feature majeure, sortir des prompts JSON bundlés |
| Public Profile pages enrichies | S17+ | Graphique visibility historique sur /profile/[domain] |

---

## 9. Livrable de fin de sprint

À produire dans `saas/docs/SPRINT_S15_RECAP.md` (format S13/S14 recap) :
- TL;DR check-list 7 objectifs (§4.1 à §4.7)
- Fichiers modifiés / créés (`git status --short`)
- Si §4.7 reporté : raison explicite (slugs introuvables ou autre)
- Reste à faire pour Fred : push, deploys, env vars, retrait filtre email test
- Tests effectués (lesquels validés, lesquels demandent intervention manuelle)
- Notes méthodologiques (palette, lock tier, etc.)

---

Bon sprint ! 🚀
