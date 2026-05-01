# Sprint S10 — Différenciateurs (Recap)

**Date** : 2026-04-29
**Branche** : main
**Status build** : ✅ vert (`npm run build` OK, 4 nouvelles routes générées)

---

## TL;DR

Sprint S10 livre **4 différenciateurs majeurs** vs concurrents (Profound / Brand Intel / Athena) :

| # | Feature | Tier requis | Livré |
|---|---|---|---|
| S10.1 | Citations Flow Sankey | Pro+ | ✅ |
| S10.2 | AI Overviews + Copilot | Agency | ⚠️ TODO Sprint S11 (slugs OpenRouter à valider) |
| S10.3 | Webhooks Slack/Teams | Slack Growth+, Teams Pro+ | ✅ |
| S10.4 | API publique | Agency | ✅ |
| S10.5 | Publisher Network | — | 🔴 SKIPPED (Fred enquête côté agrégateurs) |

---

## S10.1 — Citations Flow Sankey (Pro+)

**Objectif** : visualiser le flux Prompts → LLM → Mention oui/non → Sources citées sur le dernier snapshot.

### Frontend
- **`landing/components/saas/CitationsSankey.tsx`** (NEW) — composant Recharts `<Sankey />` natif (pas besoin de @nivo/sankey, Recharts 3.8.1 expose Sankey).
  - 4 colonnes : prompt category → LLM → brand_mentioned (oui/non) → top 5 sources cited.
  - `buildSankeyData()` agrège les responses, détecte la catégorie de prompt par mots-clés (heuristique : "concurrents", "alternatives", "comparaison", "qui sont", etc).
  - Custom `<SankeyNode />` avec couleur par colonne (NODE_COLORS tableau).
  - Locked overlay si tier < Pro.

- **`landing/app/app/brands/[id]/citations-flow/page.tsx`** (NEW)
  - `ALLOWED = new Set(["pro", "agency"])`.
  - `<TopicSelector />` pour filtrer.
  - Charge dernier snapshot completed → responses → passe à CitationsSankey.

- **`landing/components/saas/AppSidebar.tsx`** (MOD) — section "Reports" ajoutée avec entrée Citations Flow (Pro+ gated, sinon lien grisé).

**Build** : route `/app/brands/[id]/citations-flow` = 7.02 kB / 199 kB First Load (Recharts Sankey lourd, mais code-split OK).

---

## S10.2 — AI Overviews + Copilot (Agency)

**Status** : ⚠️ **TODO Sprint S11**.

**Pourquoi** : pas d'accès internet pendant la session pour valider les slugs OpenRouter (`google/ai-overviews-*`, `microsoft/copilot-*`). Inscription au backlog Sprint S11 :

- Vérifier dispo via `https://openrouter.ai/api/v1/models` filter `q=ai-overviews` et `q=copilot`.
- Si dispo : ajouter à `LLMS_BY_TIER.agency` dans `supabase/functions/saas_run_brand_snapshot/index.ts`.
- Si pas dispo : maintenir 7 LLMs Agency (4 Pro + Mistral + Grok + Llama).

Le marketing en a déjà eu vent → Fred mentionne "7 LLMs" sur la pricing card Agency, ce qui reste valide même sans AI Overviews/Copilot (compte Mistral, Grok, Llama).

---

## S10.3 — Webhooks Slack / Teams (Slack Growth+, Teams Pro+)

### DB
**Migration appliquée** : `supabase/migrations/20260501_saas_phase4_integrations.sql`
- Table `saas_integrations` — type ENUM (slack/teams/discord/webhook_custom), webhook_url, events[], is_active, last_sent_at, send_count, last_error, fail_count.
- Trigger `AFTER INSERT ON saas_alerts` → `handle_saas_alert_dispatch_integrations()` → `pg_net.http_post` vers Edge Function `saas_dispatch_integration_webhooks`.
- RLS : owners manage, members read account integrations.

### Edge Function (code only, pas deployed)
**`supabase/functions/saas_dispatch_integration_webhooks/index.ts`** (299 lignes)
- Tier gates : `slack`/`discord` → Growth+, `teams`/`webhook_custom` → Pro+.
- Filtre événements : matche `alert_type`, `alert_type_severity` ou wildcard `*`.
- Formats payload :
  - **Slack** : block kit (header + section avec context fields).
  - **Teams** : MessageCard standard (themeColor + sections).
  - **Discord** : embed (color + fields).
  - **Custom** : JSON brut `{ alert, brand, account_id, sent_at }`.
- Update `last_sent_at`, `send_count`, `last_error`, `fail_count`.
- Log `saas_usage_log` event_type = `integration_webhook_sent`.

### UI
- **`landing/app/app/integrations/page.tsx`** (NEW) — formulaire création (type/name/webhook_url/events checkboxes), liste avec actions (Tester / Désactiver / Réactiver / Supprimer).
- **`landing/app/app/integrations/actions.ts`** (NEW) — `createIntegration` valide URL par type (Slack must be `hooks.slack.com`, Teams `webhook.office.com` etc), `testIntegration` envoie payload format-specific.
- Sidebar : "Intégrations" sous Settings, gated Growth+ avec fallback grisé.

**À déployer manuellement par Fred** (next CLI session) :
```bash
npx supabase functions deploy saas_dispatch_integration_webhooks --no-verify-jwt
```

---

## S10.4 — API publique REST (Agency)

### DB
**Migration appliquée** : `supabase/migrations/20260501_saas_phase4_api_keys.sql`
- Table `saas_api_keys` (key_prefix UNIQUE, key_hash sha256 hex, scopes saas_api_scope[] ENUM read/write, name, last_used_at, revoked_at).
- Table `saas_api_calls` (rate limit log : api_key_id, called_at, path, method, status_code, duration_ms).
- Helper SQL `saas_api_calls_count_last_minute(api_key_id uuid) → int`.

### Edge Function (code only)
**`supabase/functions/saas_api_v1_router/index.ts`** (241 lignes)
- Auth : `Authorization: Bearer gp_live_xxx` → SHA-256 (Deno `crypto.subtle.digest`) → match `key_hash` en DB.
- Tier gate : Agency uniquement → 403.
- Rate limit : 60 req/min via `saas_api_calls_count_last_minute()` → 429 + `Retry-After: 60`.
- Routeur regex `matchPath()` :
  - `GET /v1/brands` (scope=read)
  - `GET /v1/brands/:id` (scope=read, +latest_snapshot summary)
  - `GET /v1/brands/:id/snapshots?limit=N` (scope=read)
  - `GET /v1/brands/:id/snapshots/:sid` (scope=read, full responses)
  - `GET /v1/brands/:id/recommendations` (scope=read)
  - `GET /v1/brands/:id/alerts` (scope=read)
  - `POST /v1/brands/:id/snapshots` (scope=write, déclenche `saas_run_brand_snapshot`, retourne 202 + snapshot_id)
- Headers : `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Geoperf-Tier`, `X-Geoperf-Duration-Ms`.
- Logs every call dans `saas_api_calls` + update `last_used_at` du key.

### UI
- **`landing/app/app/api-keys/page.tsx`** (NEW) — Agency only, liste avec prefix/scopes/use_count/last_used/status. Affichage one-shot de la clé full via cookie httpOnly 5 min TTL après création (consumed sur next page load).
- **`landing/app/app/api-keys/actions.ts`** (NEW) — `createApiKey` (`gp_live_<24 hex>`, prefix = 12 first chars, hash sha256, max 10 active keys/user), `revokeApiKey` (set revoked_at).
- **`landing/app/saas/api-docs/page.tsx`** (NEW, **public**) — doc REST complète avec curl quickstart, format réponse `{ ok, data, error, hint }`, codes HTTP, endpoints détaillés avec exemples.

**À déployer manuellement par Fred** :
```bash
npx supabase functions deploy saas_api_v1_router --no-verify-jwt
```
Puis activer la route publique côté Vercel/DNS si besoin (ou laisser le BASE Supabase tel quel).

---

## S10.5 — Publisher Network — SKIPPED

Fred enquête côté agrégateurs (Common Crawl, BrightData, Apify) pour identifier un fournisseur de signaux d'autorité par domaine. Pas d'implémentation tant que le pipeline data n'est pas confirmé.

---

## Pricing UI mise à jour

### `landing/app/app/billing/page.tsx` (MOD)
- Growth bullets : ajout `🔌 Webhooks Slack / Discord`
- Pro bullets : ajout `📊 Citations Flow (Sankey diagram)` + `🔌 Webhooks Teams + custom`
- Agency bullets : ajout `🔑 API REST publique (60 req/min)`

### `landing/app/saas/page.tsx` (MOD, public landing)
- Growth : `Sentiment ✨`, `Webhooks Slack 🔌`
- Pro : `Alignment ✨`, `Content Studio ✨`, `Citations Flow 📊`, `Webhooks Teams 🔌`
- Agency : `Tout Pro`, `Content Studio ∞`, `API REST 🔑`, `White-label`

### `landing/components/saas/AppSidebar.tsx` (MOD)
- Icons : `flow`, `webhook`, `apikey`.
- Tier sets : `SLACK_ALLOWED = growth/pro/agency`, `AGENCY_ONLY = agency`.
- Section **Reports** : Citations Flow (Pro+).
- Section **Settings** : Intégrations (Growth+) + API Keys (Agency) avec liens grisés en fallback.

---

## Files livrés / à committer

### Modifiés (3)
- `landing/app/app/billing/page.tsx`
- `landing/app/saas/page.tsx`
- `landing/components/saas/AppSidebar.tsx`

### Nouveaux frontend (7)
- `landing/app/app/api-keys/actions.ts`
- `landing/app/app/api-keys/page.tsx`
- `landing/app/app/brands/[id]/citations-flow/page.tsx`
- `landing/app/app/integrations/actions.ts`
- `landing/app/app/integrations/page.tsx`
- `landing/app/saas/api-docs/page.tsx`
- `landing/components/saas/CitationsSankey.tsx`

### Nouveaux backend (4) — à `git add` côté monorepo (pas dans landing/)
- `supabase/migrations/20260501_saas_phase4_integrations.sql` (appliquée via MCP)
- `supabase/migrations/20260501_saas_phase4_api_keys.sql` (appliquée via MCP)
- `supabase/functions/saas_dispatch_integration_webhooks/index.ts` (code only, **non déployée**)
- `supabase/functions/saas_api_v1_router/index.ts` (code only, **non déployée**)

### Aucun fichier silencieusement ignoré
`git status --untracked-files=all` confirme tous les fichiers tracés. Pas besoin de `git add -f`.

---

## Actions résiduelles pour Fred

1. **Commit** côté `landing/` ET côté `supabase/` (deux dossiers du monorepo).
2. **Deploy 2 Edge Functions** (CLI Supabase, hors session Claude) :
   ```bash
   npx supabase functions deploy saas_dispatch_integration_webhooks --no-verify-jwt
   npx supabase functions deploy saas_api_v1_router --no-verify-jwt
   ```
3. **Test E2E** :
   - Citations Flow : login Pro → `/app/brands/<id>/citations-flow` → vérifie le Sankey rendu sur AXA.
   - Webhooks : `/app/integrations` → créer Slack avec un webhook test → bouton "Tester" → confirme le block kit dans Slack.
   - API : `/app/api-keys` → générer clé Agency → `curl -H "Authorization: Bearer gp_live_xxx" https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_api_v1_router/v1/brands` → check 200.
4. **Sprint S11 backlog** : valider slugs OpenRouter `ai-overviews` + `copilot` et ajouter à LLMS_BY_TIER si dispo.

---

## Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1
```

Vercel auto-redeploy en 1-2 min.

---

## Notes tech

- **Recharts Sankey natif** utilisé (pas de nouvelle dep, build size OK).
- **SHA-256 (Deno crypto.subtle)** pour hash API keys — pas de bcrypt nécessaire (clés non-passwords, entropy 96 bits).
- **Cookie one-shot** (`saas_api_key_just_created`, httpOnly, 5 min TTL) pour afficher la clé full après création — best practice secret rotation.
- **Tier-gating consistant** : DB (RLS owners) + Edge Function (TIER_GATE map) + UI (sidebar conditional + page redirect).
- **Trigger DB → pg_net.http_post → Edge Function** : pattern dispatch async qui scale (pas de blocage écriture alerte).
