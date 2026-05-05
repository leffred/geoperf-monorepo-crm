# Sprint S19 — Récap

**Date** : 2026-05-05 (après-midi → soir)
**Statut** : 3/3 axes livrés (§4.1, §4.2, §4.3)
**Build** : `npm run build` vert (Compiled successfully in 8.3s)
**Migrations DB** : 1/1 appliquée (`saas_phase11_lead_magnet`)
**Edge Functions** : 2 créées localement (deploy manuel par Fred)
**Push** : non effectué — Fred review puis push manuel

---

## TL;DR — checklist 3 axes

- [x] **§4.1** Lead-magnet flow complet — page `/etude-sectorielle` + 3 pages confirm + server action + 2 Edge Functions + migration DB + CTAs HP/saas
- [x] **§4.2** Bug fix Phase 1 Consolidate stats — patch documenté (`N8N_PATCHES_S19.md`)
- [x] **§4.3** Bug fix Phase 2 race condition — diagram analysé, patch connections documenté (`N8N_PATCHES_S19.md`)

---

## §4.1 — Lead-magnet flow complet

### Architecture

```
HP / saas → CTA "Recevoir mon étude sectorielle gratuite"
              ↓
       /etude-sectorielle (form 3 champs)
              ↓ submit (server action requestStudy)
              ↓
       ┌──────┴──────┬─────────────────┐
       ↓             ↓                 ↓
   Cas A          Cas B            Limit reached
   (rapport       (rapport         (anti-abus 30j)
    dispo)        pas dispo)
       ↓             ↓                 ↓
   /etude-…      /etude-…         /etude-…
   /sent         /pending         /limit-reached
   + email       + Phase 1
   + CRM hook    triggered
                 + CRM hook
```

### Fichiers créés

**Migration DB** :
- `supabase/migrations/20260506_saas_phase11_lead_magnet.sql` (43 lignes) — appliquée ✓
  - Table `lead_magnet_downloads` (id, email, ip, user_agent, sous_categorie_slug, report_id, prospect_id, pdf_url_at_request, pending, email_sent_at, resend_email_id, source_path, metadata, downloaded_at, created_at)
  - 4 indexes (email, email+date DESC, sous_cat+date DESC, partial pending)
  - RLS enabled (service_role only — pas de policy public)

**Edge Functions** (à deployer par Fred) :
- `supabase/functions/saas_send_lead_magnet_email/index.ts` (~190 lignes)
  - Resend send avec template inline Tech crisp + JetBrains Mono eyebrow + Inter
  - Subject : `Votre étude {sous_categorie} 2026 — Geoperf`
  - Section "Et après ?" : audit GEO / SaaS Free / autre étude (3 CTAs secondaires)
  - Footer RGPD : opt-out lien `/privacy#unsubscribe`, mention SIREN, hébergement Frankfurt
  - Tags Resend : `type=lead_magnet`, `sous_cat={slug}`
  - Idempotent : update `lead_magnet_downloads.email_sent_at` sur le download le plus récent matchant email+report_id
- `supabase/functions/saas_lead_magnet_crm_hook/index.ts` (~210 lignes)
  - Fallback simple (pas d'Apollo enrichment via MCP — trop lourd côté Edge Function)
  - Free email providers ignorés pour le matching company (gmail, yahoo, hotmail, free.fr, etc.)
  - Upsert company sur (nom_normalise, domain) si pro email
  - Upsert prospect sur email — merge metadata.downloaded_reports si déjà connu
  - Insert prospect_event `event_type=lead_magnet_download`
  - Update lead_magnet_downloads.prospect_id (lookup recent)

**Frontend** :
- `landing/app/etude-sectorielle/page.tsx` (server component, force-dynamic) — preload categories + reports availability map
- `landing/app/etude-sectorielle/StudyForm.tsx` (client component) — dropdown cascading parent → sous-cat avec label "rapport disponible" / "à venir"
- `landing/app/etude-sectorielle/actions.ts` (server action `requestStudy`)
- `landing/app/etude-sectorielle/sent/page.tsx` — confirmation email envoyé
- `landing/app/etude-sectorielle/pending/page.tsx` — Phase 1 triggered, notif email à venir 24-48h
- `landing/app/etude-sectorielle/limit-reached/page.tsx` — anti-abus → upsell SaaS Free

**Updates HP + /saas** :
- `landing/app/page.tsx` : 2 CTAs `/signup?source=etude` → `/etude-sectorielle`
- `landing/app/saas/page.tsx` : ajout CTA hero "Recevoir une étude sectorielle"

### Server action — pipeline détaillé

1. **Validation** : email regex + sous_categorie_slug présent
2. **Anti-abus** : `lead_magnet_downloads.email = X AND downloaded_at > NOW() - 30d`
   - Re-télécharger LE MÊME rapport : autorisé (re-envoi email)
   - Télécharger un AUTRE rapport sous 30j : `→ /limit-reached`
3. **Lookup report** : `slug_public = sous_categorie_slug AND status='ready' AND pdf_url IS NOT NULL`, ordre `created_at DESC`
4. **Cas A — report dispo** :
   - Insert tracking `lead_magnet_downloads` (pending=false)
   - Fire & forget : `saas_send_lead_magnet_email` (avec service_role auth)
   - Fire & forget : `saas_lead_magnet_crm_hook`
   - `→ /sent?email=…&sous_cat=…`
5. **Cas B — report pas dispo** :
   - Insert tracking pending=true
   - Fire & forget : `saas_lead_magnet_crm_hook` (capture intent)
   - Fire & forget : trigger Phase 1 webhook n8n `https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract`
   - `→ /pending?email=…&sous_cat=…`

### CRM hook — décision de simplification

Le brief autorise un fallback minimal si Apollo enrichment est trop complexe côté Edge Function. **Choix retenu** : pas d'appel Apollo MCP — l'Edge Function fait juste extract domain + upsert company/prospect/event. L'enrichissement Apollo se fait déjà séparément :
- Phase 4 Attio Sync (workflow `U6Sli3HkLNcSC4fd`) peut consommer ces nouveaux prospects
- Apollo MCP via Edge Function ajouterait un round-trip + dépendance MCP en prod (pas robuste)

Si Fred veut enrichment automatique → soit (a) appel Apollo people API direct via fetch (clé API en env), soit (b) workflow n8n dédié déclenché en async par le hook.

### Form — cascading dropdown

- **Côté server** : preload de tous les `categories` (parents + enfants) + map `slug_public` des reports `status=ready` avec `pdf_url`. Une seule requête combinée, pas de N+1.
- **Côté client** : `StudyForm.tsx` (use client) avec 2 useState (parentId, sousCatSlug). Changement parent → reset sous-cat. Filter sous-cats par `parent_id` au render.
- **UX** : le dropdown sous-cat affiche le label du report (ex: "Agences digitales FR — rapport disponible"). Une note dynamique sous le dropdown indique si le PDF est immédiat (Cas A) ou si on déclenche une génération 24-48h (Cas B).

---

## §4.2 — Bug fix Phase 1 Consolidate stats

### Bug confirmé

Workflow `7DB53pFBW70OtGlM` node `Consolidate (JS)` (id `b88af458-...`), ligne 130 :
```javascript
const stats = { total_unique_companies: ..., cited_by_4_llms: 0, cited_by_3_llms: 0, cited_by_2_llms: 0, cited_by_1_llm: 0 };
//                                                                                              ↑ singulier (typo)
for (const c of consolidated) stats['cited_by_' + c.visibility_score + '_llms'] = ...
//                                                                       ↑ pluriel (correct)
```

**Conséquence** : la boucle crée `cited_by_1_llms` (pluriel) à la volée, mais `cited_by_1_llm` (singulier) reste à 0 dans l'output → key orphan + downstream qui lit la clé singulière voit toujours 0.

### Patch documenté

`saas/docs/N8N_PATCHES_S19.md` — fix : ajouter un `s` à la ligne 130 pour passer `cited_by_1_llm: 0` → `cited_by_1_llms: 0`. Idem dans le node dupliqué `Consolidate (JS)1` du path 2.

**Décision** : pas de patch via MCP `update_workflow` — réécriture SDK des 38 nodes risque d'introduire des regressions sur ce workflow actif. Patch UI = 30 secondes, faible risque.

---

## §4.3 — Bug fix Phase 2 race condition

### Diagram analysé via MCP

Workflow `c85c3pPFq85Iy6O2`. Connection problématique identifiée :

```
"Apollo people search":{"main":[[
  {"node":"Score & filter (top N per company)","type":"main","index":0},
  {"node":"Split per company","type":"main","index":0}        ← LOOP-BACK IMMÉDIAT (bug)
]]}
```

### Cause racine

`Apollo people search` fait un **fan-out** vers (a) la chaîne d'enrichissement (Score → Aggregate → bulk_match → Spread → Upsert → Log) et (b) le retour direct vers Split per company pour la prochaine itération.

Le loop redémarre AVANT que la chaîne d'upsert ne soit terminée. Quand Split finit toutes les iterations, son output 0 (done) déclenche Build summary — mais les derniers Upsert + Log de la dernière itération sont encore en flight.

→ `SELECT COUNT(*) FROM prospects WHERE report_id = ...` retourne `total = 0` (ou un partiel inexact).

### Patch documenté

Refacto des connections (Option B raffinée du brief, détaillée dans `N8N_PATCHES_S19.md`) :

1. **Retirer** la flèche `Apollo people search → Split per company`
2. **Ajouter** la flèche `Log prospect_created event → Split per company`

Schéma cible :
```
Split per company (loop)
  → Apollo people search → Score & filter → Aggregate → bulk_match → Spread → Upsert → Log
  → Split per company (loop-back PROPRE — next batch après commit)
```

Quand toutes iterations terminées → Split output 0 fires → Build summary trouve toutes les rows commitées → `total` correct.

### Méthode

UI n8n : supprimer 1 flèche, en tirer 1 nouvelle. ~1 minute. Rollback en 30 secondes.

### Risques surveillés

- **Faible** : 2 modifications de connections, aucune logique métier touchée.
- **À monitorer** : si Apollo retourne 0 résultats sur une itération, la chaîne `Score → … → Log` s'exécute quand même (mode "no-op"). Vérifier qu'aucun node ne plante sur `items` vide. Si oui, ajouter un IF en garde-fou.

---

## Build local

```
✓ Compiled successfully in 8.3s
Route (app)                                Size  First Load JS
├ ƒ /etude-sectorielle                   1.94 kB         181 kB
├ ○ /etude-sectorielle/limit-reached       473 B         180 kB
├ ƒ /etude-sectorielle/pending             473 B         180 kB
├ ƒ /etude-sectorielle/sent                473 B         180 kB
+ First Load JS shared by all             178 kB
```

---

## Tests E2E lead-magnet — plan attendu

À valider par Fred après deploy + patch n8n :

1. **Cas A — rapport dispo** : Marketing → Agences digitales FR → email pro → submit
   - Redirect `/etude-sectorielle/sent`
   - Email reçu < 30s avec lien PDF (TTL 7j)
   - Row `lead_magnet_downloads` (pending=false, email_sent_at non-null après hook)
   - Row `prospects` (source='lead_magnet' dans metadata, source non sur la column)
   - Row `prospect_events` (event_type=lead_magnet_download)
2. **Cas B — rapport pas dispo** : Marketing → Édition / Médias B2B FR (pas encore généré) → email → submit
   - Redirect `/etude-sectorielle/pending`
   - Phase 1 webhook trigger envoyé (vérifier dans n8n executions)
   - Row `lead_magnet_downloads` (pending=true)
3. **Anti-abus** : même email + une autre sous-cat ayant un rapport, < 30j
   - Redirect `/etude-sectorielle/limit-reached`
4. **Re-download même rapport** : même email + même sous-cat → autorisé (re-envoi email)
5. **Email invalide** : `notanemail` → redirect avec `?error=email_invalid` → message rouge dans le form
6. **Free email provider** : `john@gmail.com` → row prospect créée mais sans `company_id` (skip company match)

### Capture du form (description textuelle — pas de screenshot pris automatiquement)

```
┌─ /etude-sectorielle ─────────────────────────────────────────┐
│  ÉTUDE SECTORIELLE GRATUITE                                  │
│                                                               │
│  Téléchargez gratuitement nos études sectorielles 2026.      │
│  Visibilité de votre secteur dans ChatGPT, Claude, Gemini    │
│  et Perplexity.                                               │
│                                                               │
│  · 30 marques benchmarkées sur 4 LLM                          │
│  · Score de consensus inter-LLM, sources, biais               │
│  · 5 recommandations actionnables                             │
│  · PDF 12 pages — lien valide 7 jours                         │
│                                                               │
│  ┌─ Form ────────────────────────────────────────────────┐    │
│  │ CATÉGORIE                                              │    │
│  │ [▼ Sélectionnez une catégorie…              ]          │    │
│  │                                                        │    │
│  │ SOUS-CATÉGORIE                                         │    │
│  │ [▼ Choisissez d'abord une catégorie         ]          │    │
│  │                                                        │    │
│  │ EMAIL PROFESSIONNEL                                    │    │
│  │ [vous@entreprise.com                        ]          │    │
│  │                                                        │    │
│  │ [Recevoir le rapport]                                  │    │
│  │                                                        │    │
│  │ Vos données sont stockées sur Supabase Frankfurt (UE). │    │
│  │ Aucun envoi commercial sans consentement explicite.    │    │
│  │ Limite anti-abus : 1 rapport différent / 30j par email.│    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

(Pas de screenshot pris — le form est server-rendered + client-component, aucun navigateur démarré dans cette session pour capturer un PNG. Si Fred veut une capture pixel, lancer `npm run dev` puis screencap manuel.)

---

## Reste à faire pour Fred

### À pousser (review puis push)

- [ ] `git diff` sur `landing/app/page.tsx` (CTAs HP)
- [ ] `git diff` sur `landing/app/saas/page.tsx` (CTA hero)
- [ ] Nouveaux fichiers `landing/app/etude-sectorielle/{page,actions,StudyForm}.tsx`
- [ ] Nouveaux fichiers `landing/app/etude-sectorielle/{sent,pending,limit-reached}/page.tsx`
- [ ] Nouvelle migration `supabase/migrations/20260506_saas_phase11_lead_magnet.sql` (déjà appliquée DB)
- [ ] Nouveaux fichiers `supabase/functions/saas_send_lead_magnet_email/index.ts` + `saas_lead_magnet_crm_hook/index.ts`
- [ ] Nouveaux docs `saas/docs/N8N_PATCHES_S19.md` + `saas/docs/SPRINT_S19_RECAP.md`

Push frontend depuis `landing/` :
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S19: lead-magnet flow complet (page dediee form 3 champs + email gate + anti-abus + CRM hook + dispatch PDF/Phase 1) + Phase 1/2 bugs documentes"
```

Puis push repo root :
```powershell
cd C:\dev\geoperf
git add -A && git commit -m "S19: lead-magnet flow + Phase 1/2 bugs fix doc + Edge Functions saas_send_lead_magnet_email + saas_lead_magnet_crm_hook + migration phase 11"
git push origin main
```

### À faire manuellement (hors push)

1. **Deploy Edge Functions** :
   ```bash
   npx supabase functions deploy saas_send_lead_magnet_email
   npx supabase functions deploy saas_lead_magnet_crm_hook
   ```
2. **Vérifier env vars Supabase Edge** : `RESEND_API_KEY`, `HELLO_EMAIL_FROM` (default OK), `APP_URL` (default `https://geoperf.com`)
3. **Vérifier env var Vercel landing** : `N8N_PHASE1_WEBHOOK_URL` (default OK si l'instance n8n n'a pas changé d'URL)
4. **Patcher Phase 1 stats** via UI n8n — voir `saas/docs/N8N_PATCHES_S19.md` §4.2 (1 caractère)
5. **Patcher Phase 2 connections** via UI n8n — voir `saas/docs/N8N_PATCHES_S19.md` §4.3 (2 flèches à modifier)
6. **Tests E2E** — voir liste plus haut (Cas A/B/anti-abus)
7. **Vérifier Vercel deploy** : tester `/etude-sectorielle` en prod, soumettre un email test, vérifier inbox.

### Reportés S20+

- Cacher coûts snapshots côté user (S20)
- Page `/admin/saas/reports` + création catégories UI (S20)
- Compte démo SaaS public avec 6 mois historique (S20)
- A/B test sur la page lead-magnet (post-data Vercel Analytics)
- Ajout du dropdown au footer global (post-S20)
- Sequence A FR1 EN version (post-warmup mailbox)
- Apollo enrichment async dans le CRM hook (si conversion lead-magnet → demo justifie)

---

## Garde-fous respectés

- ✓ Migration SQL sauvée AVANT `apply_migration` MCP
- ✓ Pas de modification du `render_white_paper` Edge Function — réutilisé le `pdf_url` existant
- ✓ Pas de modification des templates emails existants — nouveau template inline dans `saas_send_lead_magnet_email`
- ✓ Sequence A FR1 paused, pas de modification du workflow d'outreach
- ✓ Email lead-magnet : Resend, sender `hello@geoperf.com`, mention RGPD opt-out + lien `/privacy#unsubscribe` + mention SIREN/hébergement
- ✓ Phase 2 diagram analysé via MCP AVANT proposition de patch (Option B raffinée + risque de no-op géré)
- ✓ `npm run build` vert AVANT proposition de push (8.3s)
- ✓ Aucun push, aucun deploy auto
