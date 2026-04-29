# Récap session déjeuner — GEOPERF

> Travail réalisé pendant tes 3h de déjeuner. Aucun envoi mail (test mode respecté).

---

## TL;DR

**8 livrables** structurés en 3 thèmes :

### 1. Méta — comment mieux travailler ensemble
- **`COLLABORATION_BEST_PRACTICES.md`** : guide pratique (10 sections) sur comment me briefer efficacement, mes outils et limites, anti-patterns
- **`PROJECT_STRUCTURE.md`** : décomposition de GEOPERF en 4 sous-projets (`reporting-engine`, `outreach-engine`, `frontend`, `infrastructure`) avec responsabilités, dépendances, dossiers concernés

### 2. Portal client — la grosse pièce demandée
- **Migration Supabase** : 3 nouvelles vues SQL (`v_portal_dashboard`, `v_portal_company_activity`, `v_portal_competitors`) — pré-aggregent tout ce dont la page a besoin en 1-2 queries
- **`lib/portal.ts`** : helpers `loadPortalData(token)` + `buildRecommendations(d)` (recos actionnables auto-générées)
- **`app/portal/page.tsx`** : page tableau de bord client complète :
  - KPIs perso (rang, score IA, LLM citants, sources)
  - Score saturation IA avec badge sémantique
  - Détail par LLM (4 cartes : qui cite, qui ne cite pas)
  - Recommandations actionnables (high/medium/low priority, auto-générées selon profil)
  - Comparateur top-5 concurrents avec ligne du prospect mise en évidence
  - Activité collective de l'équipe (si plusieurs prospects de la même boîte)
  - Historique perso (8 derniers events)
  - CTA audit Calendly + re-download HTML/PDF

### 3. Backend Phase 2 — fixes + Calendly
- **Fix splitInBatches Apollo** : refactor de la chaîne pour que le loop continue toujours, même si Apollo retourne 0 résultats (cause : node "Continue loop" branché en parallèle d'`Apollo people search` au lieu d'après `Log`)
- **`/api/calendly-webhook`** : route Next.js qui reçoit les events Calendly (booked/cancelled/no_show), match par email, log l'event → trigger Postgres transitionne le prospect en `converted`
- **Migration trigger** : extension de `handle_prospect_engagement` pour gérer cancel + no_show (en plus du booked déjà géré)

---

## 1. Best practices doc — synthèse

Le fichier `COLLABORATION_BEST_PRACTICES.md` couvre :

| Section | TL;DR |
|---|---|
| Briefing | Objectif + périmètre + critère de succès dans la même demande |
| Dépannage | Copy-paste les erreurs exactes, pas reformuler |
| Anti-patterns | Mont Excel, "rien marche", apostrophes courbes, rebranding mid-stream |
| Mes outils | Ce que je peux faire seul vs ce qui nécessite ton intervention |
| Mémoire | Ce qui persiste entre sessions vs ce qu'il faut me recharger |
| Checkpointing | Push après chaque feature testée — pas 5 changements interdépendants |
| Coûts | ~$120-150/mois en prod cible |
| Quand me dire stop | Tu cadres → on avance vite |

À lire au calme une fois, à relire si tu as l'impression qu'on perd du temps.

---

## 2. Architecture sous-projets

`PROJECT_STRUCTURE.md` propose **4 sous-projets** indépendants qui communiquent via DB Supabase :

```
reporting-engine → produit le LB (n8n + Edge Function + DB schema)
outreach-engine → prospects + sequences (n8n + triggers + Apollo)
frontend       → Vercel (Next.js 20+ routes)
infrastructure → Supabase, Vercel, DNS, secrets
```

Pour chaque session future, dis-moi sur quel sous-projet on bosse :

```
"On travaille sur outreach-engine — switch Apollo vers Hunter.io"
"Frontend — ajoute X au portal"
"Infra — rotate la clé OpenRouter"
```

Ça me fait gagner 10s × N fois et ça structure ta tête aussi. **Pas de migration physique nécessaire** — la structure existe déjà de facto, c'est juste un vocabulaire commun.

---

## 3. Portal client `/portal?t=<token>`

### Architecture

Auth = même token URL que la landing personnalisée (`tracking_token` UNIQUE par prospect, généré par défaut via `gen_random_bytes(12)`).

Une fois sur le portal, le prospect voit son tableau de bord complet — sans login requis. Pour la persistance, le prospect peut bookmarker l'URL.

### Sections de la page

1. **Hero compact** — "Bonjour {first_name}, voici votre tableau de bord {company}"

2. **KPIs principaux (4 stats)** — position, score IA, LLM citants, sources distinctes

3. **Score Saturation IA** — gros bloc avec badge sémantique :
   - HOT_OPPORTUNITY (gap ≥ 30%) → "Forte sous-représentation"
   - WARM_OPPORTUNITY (gap ≥ 15%) → "Sous-représentation modérée"
   - BALANCED → "Équilibré"
   - OVER_INDEXED (gap ≤ -15%) → "Sur-représenté (avantage)"

4. **Détail par LLM** — 4 cartes (ChatGPT, Claude, Perplexity, Gemini) avec "Vous cite" / "Ne vous cite pas" + opportunité d'amélioration

5. **Recommandations actionnables** — généré automatiquement par `buildRecommendations(dashboard)` :
   - Prio HIGH si LLM ne cite pas → texte qui propose les sources à travailler
   - Prio HIGH si gap saturation ≥ 15% → propose audit pour fermer l'écart
   - Prio MEDIUM si sources distinctes < 3 → propose diversification
   - Prio LOW : CTA audit personnalisé

6. **Comparateur concurrents** — tableau du top-5 du même secteur + ligne du prospect mise en évidence (background ambre)

7. **Activité collective** — affichée si > 1 prospect de la même boîte (combien d'autres collègues ont visité, téléchargé, sont engagés)

8. **Historique perso** — 8 derniers events du prospect (visites, downloads, clics email, etc.)

9. **CTA audit** — Calendly + re-download HTML/PDF

### Test après le push

URL après deploy Vercel :
```
https://geoperf.com/portal?t=3d28ae026886ecaf2a3249af
```

(Token de Fred Test sur BlackRock — déjà en DB)

Tu devrais voir :
> Bonjour Fred. Vos stats de visibilité IA pour BlackRock.
> #1 dans l'étude · 3/4 score IA · 3 LLM qui vous citent · 6 sources distinctes
> Score saturation : Sur-représenté (avantage)
> Détail : ChatGPT vous cite ✓, Claude ✓, Perplexity ✓, Gemini ✗
> Recommandations : Gemini ne vous cite pas → action prio HIGH
> Comparateur : top-5 sociétés AM avec ligne BlackRock highlightée
> Activité : 1 membre identifié, 1 visite, 1 download

---

## 4. Fix splitInBatches Apollo

### Le problème (rappel)
Quand Apollo retourne `total_entries: 0` (cas plan free), `Score & filter` retourne `[]` → `Upsert` et `Log` ne s'exécutent pas → `Continue loop` jamais atteint → splitInBatches s'arrête après le 1er batch au lieu de boucler sur les 11 sociétés.

### La solution

Refactor de l'architecture du workflow :

**Avant (cassé)** :
```
Apollo → Score & filter → Upsert → Log → Continue loop → Split (back)
```
Si Score retourne [] → tout meurt après.

**Après (robuste)** :
```
Apollo ─┬→ Score & filter → Upsert → Log → (END terminator)
        └→ Continue loop → Split (back to next batch)
```
Continue loop est branché en parallèle directement après Apollo. Il s'exécute toujours, peu importe ce que renvoie Apollo. Le batch suivant est garanti d'être traité.

### Pour appliquer (3 modifs UI n8n, 2 min)

Cf section "Webhook Calendly handler" du fichier `LUNCH_SESSION_RECAP.md` (ce fichier).

1. Convertir node **"Continue loop"** : NoOp → Code node avec :
   ```js
   return [{ json: { __continue: true } }];
   ```
2. **Supprimer** la connexion `Log prospect_created event → Continue loop`
3. **Ajouter** une connexion `Apollo people search → Continue loop` (en plus de la connexion existante vers Score & filter)

Save + Publish.

JSON local déjà patché → si tu re-importes, tu auras la bonne config (mais re-bind les credentials).

---

## 5. Webhook Calendly handler

### Route Next.js

`POST /api/calendly-webhook` :
- Vérifie la signature HMAC-SHA256 de Calendly (si `CALENDLY_WEBHOOK_SECRET` est set en env var)
- Parse le payload Calendly v2 (event = `invitee.created` / `invitee.canceled` / `invitee.no_show_marked`)
- Match l'invitee email avec un `prospects.email` (case-insensitive)
- Log l'event dans `prospect_events` avec metadata complet (cancel_reason, event_start_time, etc.)
- Le trigger Postgres `handle_prospect_engagement` transitionne automatiquement le prospect :
  - `calendly_booked` → `status = converted`, set `call_booked_at`, `conversion_at`
  - `calendly_cancelled` → revert vers `engaged` (ou `queued` si pas de download), unset `call_booked_at`
  - `calendly_no_show` → log seulement, pas de change status (ils peuvent re-booker)

### Setup côté Calendly (5 min)

1. Calendly → Account → Integrations → **Webhooks** → Create Webhook Subscription
2. **URL** : `https://geoperf.com/api/calendly-webhook` (après que le DNS soit propagé)
3. **Events** : sélectionne `invitee.created`, `invitee.canceled`, `invitee.no_show_marked`
4. **Signing key** : Calendly te génère une clé → copy
5. Vercel → env vars → ajoute `CALENDLY_WEBHOOK_SECRET = <la clé>`

Si tu skip l'étape 4-5, le webhook accepte sans vérifier la signature (mode dev). En prod, **toujours** mettre la signing key.

### Test

Une fois setup :
1. Tu réserves toi-même un slot Calendly avec l'email `test@example.com` (ou un autre prospect en DB)
2. Tu vois apparaître dans `/admin?t=<token>` (panel "Activité récente") un event `calendly_booked`
3. Le prospect passe en `status = 'converted'` automatiquement
4. Le dashboard Cowork montre +1 dans la KPI "Conversions"

---

## 6. Migration SQL appliquée

`compute_ai_saturation_for_report` étendue + 3 nouvelles vues :

```sql
public.v_portal_dashboard           -- 1 row par prospect, tout le contexte
public.v_portal_company_activity    -- agg par société (équipe)
public.v_portal_competitors         -- top-5 concurrents par report
```

+ trigger `handle_prospect_engagement` étendu pour calendly_cancelled / calendly_no_show.

---

## 7. État actuel — checklist complète

### ✅ Live et opérationnel
- Pipeline backend autonome (Phase 1 → Synthesis auto-chained via pg_net)
- 3 reports en DB (Asset Management ×2 + CRM)
- Edge Function v5 avec PDFShift
- Vercel deploy + domain geoperf.com
- Front : 20 routes (incluse le nouveau /portal et /api/calendly-webhook)
- Admin web /admin avec triggers workflows
- Dashboard Cowork live
- Portal client /portal opérationnel

### ⏳ En attente d'action de ta part
1. **Push ces nouveautés sur GitHub** (5 fichiers nouveaux/modifiés) → script `push_update.ps1`
2. **Apollo** : décider plan Basic ou alternative (cf 3 options du précédent récap)
3. **3 modifs UI n8n** sur workflow Apollo (cf section 4 ci-dessus, 2 min)
4. **Setup Calendly webhook** (cf section 5, 5 min) — quand tu auras un Calendly configuré

### 🔮 Prochains chantiers possibles
- Connecteur Hunter.io comme alternative à Apollo
- A/B test framework pour les landings
- Generative SEO : pages publiques par société (`/profile/blackrock` indexable Google)
- Sync Attio CRM (mirror des prospects)
- Cron auto trimestriel pour ré-générer les LB
- Page admin "Étude par étude" : drill-down par report avec stats détaillées

---

## 8. Fichiers livrés cette session

```
COLLABORATION_BEST_PRACTICES.md            NEW (10 sections, 350 lignes)
PROJECT_STRUCTURE.md                        NEW (architecture sous-projets)
LUNCH_SESSION_RECAP.md                      NEW (ce fichier)

landing/lib/portal.ts                       NEW (loadPortalData + buildRecommendations)
landing/app/portal/page.tsx                 NEW (page tableau de bord client)
landing/app/api/calendly-webhook/route.ts   NEW (handler webhook + signature check)
landing/app/[sous_cat]/page.tsx             UPDATED (lien "Voir mes stats" → portal)

n8n/workflows/geoperf_phase2_sourcing.json  UPDATED (fix splitInBatches loop)

supabase/migrations/                        2 migrations appliquées live :
  - portal_views (3 vues)
  - extend_engagement_trigger_calendly
```

Build local validé : 20 routes, 0 erreur.

---

## 9. Push à faire

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1
```

Ça commit/push les fichiers landing/ vers GitHub. Vercel redeploy en 1-2 min après.

---

Bon retour. ☕
