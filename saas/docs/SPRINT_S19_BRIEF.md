# Sprint S19 — Brief : Lead-magnet onboarding + 2 bugs cosmétiques

**Date brief** : 2026-05-05 (après-midi, post-S18)
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-05)
**Effort estimé** : 1 nuit Claude Code (6-8h focus dev)
**Pré-requis** : S18 mergé et déployé (ICP PME FR + perf + HP/FAQ + Vercel Analytics + Sentry Performance).

---

## 1. Pourquoi ce sprint

Après le pivot ICP PME FR (S18) et le test Phase 2 Apollo (5 vrais leads PME éligibles sur Agences digitales FR), Fred veut **industrialiser le lead-magnet** comme moteur d'acquisition organique :

> Idée : un visiteur arrive sur HP ou `/saas` → click "Recevoir mon étude sectorielle gratuite" → atterrit sur une **page dédiée** avec un form (catégorie + sous-cat + email) → reçoit le PDF par email. Anti-abus 1 rapport/mois. Si rapport non encore généré, message "en cours" + trigger workflow Phase 1.

En parallèle, 2 bugs cosmétiques découverts en S18 :
1. **Phase 1 Consolidate** : initialise `cited_by_1_llm` (singulier) mais agrège sur `cited_by_1_llms` (pluriel) → stats incohérentes
2. **Phase 2 Build summary** : retourne `total=0` même quand 6 prospects sont insérés → probable race condition entre Upsert et SELECT final

---

## 2. Périmètre

### In scope (3 axes)

1. **§4.1** Lead-magnet flow complet : nouvelle page `/etude-sectorielle` + form 3 champs + email gate + anti-abus + CRM hook + dispatch PDF (ou trigger Phase 1 si manquant)
2. **§4.2** Bug fix Phase 1 Consolidate (cited_by_X_llms cohérent)
3. **§4.3** Bug fix Phase 2 Build summary (await tous les Upsert avant SELECT, ou refacto pour comptage post-loop)

### Out of scope (S20+)

- ❌ Cacher les coûts snapshots côté user (S20)
- ❌ Page `/admin/saas/reports` + création catégories UI (S20)
- ❌ Compte démo SaaS avec 6 mois historique (S20)
- ❌ A/B test sur la page lead-magnet (post-S19, après data Vercel Analytics)
- ❌ Ajout du dropdown au footer global (post-S19, à voir si conversion HP/saas suffit)
- ❌ Modification du PDF rendering ou du workflow Phase 1 lui-même (sauf le bug stats)

---

## 3. État courant à connaître

### 3.1 Pages existantes
- `/` HP racine : refondue S18 (7 sections incl. CTAs). Bouton "Créer mon compte gratuit" + "Voir l'étude sample" en hero. Le 2e CTA pointe probablement vers `/sample`.
- `/saas` : page produit SaaS (refonte S13+S15+S17). Bouton "Créer un compte gratuit" + "Voir les plans".
- `/sample` : page teaser PDF actuelle (à vérifier — peut-être statique avec lien direct PDF, ou form simple).

**Décision Fred (Q1)** : ne PAS mettre le dropdown directement sur HP/saas. Garder un CTA simple "Recevoir mon étude sectorielle gratuite" sur HP + `/saas` qui **redirige vers une nouvelle page** dédiée `/etude-sectorielle` (ou nom équivalent à choisir par CC).

### 3.2 Stockage PDF existant
- Edge Function `render_white_paper` génère le PDF, l'upload dans Supabase Storage `white-papers`, retourne signed URL valide 7j (ref STATE_OF_PROJECT.md)
- Table `reports` a `pdf_url` (signed URL) et `html_url`
- Bucket Storage `white-papers` : privé, signed URLs

### 3.3 Catégories DB
- Table `categories` : 34 sous-cat dont 10 nouvelles ICP-friendly ajoutées en S18 (`agences-digitales-fr`, `esn-fr-mid-market`, etc.)
- Hierarchy `parent_id` self-référence
- 5+ reports `status=ready` selon les sous-cat lancées

### 3.4 Email send
- Resend configuré + DKIM/SPF verified (mail-tester 10/10)
- Sender `hello@geoperf.com` (Workspace) ou `alerts@geoperf.com` (transactionnel)
- Env var `RESEND_API_KEY` côté Supabase + Vercel
- Templates inline dans Edge Functions (pas de système templating dédié)

### 3.5 CRM existant
- Table `prospects` (76+ rows) avec `source` field (apollo_sourcing_workflow, lead_magnet à créer)
- Workflow n8n Phase 4 Attio CRM Sync (`U6Sli3HkLNcSC4fd`) existe pour push vers Attio
- Pour le lead-magnet : on insère dans `prospects` + Attio sync hérite si configuré

---

## 4. Livrables

### 4.1 Lead-magnet flow complet

#### 4.1.a Nouvelle page `/etude-sectorielle`

**Fichier** : `landing/app/etude-sectorielle/page.tsx`

**Layout** :
- Hero court : "Téléchargez gratuitement nos études sectorielles 2026"
- Sous-titre : "Visibilité de votre secteur dans ChatGPT, Claude, Gemini et Perplexity. Étude indépendante Jourdechance."
- **Form 3 champs** (server component avec server action) :
  1. **Catégorie** (dropdown) : liste des `categories` parent (où `parent_id IS NULL`)
  2. **Sous-catégorie** (dropdown cascading) : filtré par la catégorie parent sélectionnée. Affiche le nombre de rapports disponibles pour aider l'user (ex: "Asset Management (rapport disponible)" vs "ESN FR (à venir)")
  3. **Email** (input type=email, validation HTML5 + server-side regex)
- Bouton submit : "Recevoir le rapport"
- Petite mention RGPD sous le form : "Vos données sont stockées sur Supabase Frankfurt (EU). Aucun envoi commercial sans votre consentement explicite. [Privacy](/privacy)"

**Style** : Tech crisp cohérent avec /saas (Card, Eyebrow, Button, Section).

**Cascading dropdown** : implémenter via client component pour le 2e dropdown qui dépend du 1er. Possibilité simple : pré-loader toutes les sous-cat côté server, filtrer client-side au change.

#### 4.1.b Server action `requestStudy`

**Fichier** : `landing/app/etude-sectorielle/actions.ts`

```typescript
"use server";

export async function requestStudy(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const categorySlug = String(formData.get("category_slug") || "");
  const sousCategorySlug = String(formData.get("sous_categorie_slug") || "");
  
  // 1. Validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect("/etude-sectorielle?error=email_invalid");
  }
  if (!sousCategorySlug) {
    redirect("/etude-sectorielle?error=missing_sous_cat");
  }
  
  // 2. Anti-abus : check si déjà download dans le mois
  const sb = getServiceClient();
  const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  
  const { data: recentDownloads } = await sb
    .from("lead_magnet_downloads")
    .select("id, sous_categorie_slug, downloaded_at")
    .eq("email", email)
    .gte("downloaded_at", oneMonthAgo);
  
  // Re-télécharger LE MÊME rapport est OK
  const sameRapport = recentDownloads?.find(d => d.sous_categorie_slug === sousCategorySlug);
  
  if (recentDownloads && recentDownloads.length > 0 && !sameRapport) {
    // L'user a déjà téléchargé un AUTRE rapport ce mois-ci → upsell SaaS
    redirect("/etude-sectorielle/limit-reached");
  }
  
  // 3. Lookup le report selon sous_categorie_slug
  const { data: report } = await sb
    .from("reports")
    .select("id, sous_categorie, status, pdf_url")
    .eq("status", "ready")
    .ilike("slug_public", sousCategorySlug)  // ou autre col
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  // 4. Cas A : report disponible → email + insert downloaded
  if (report?.pdf_url) {
    // Insert tracking
    await sb.from("lead_magnet_downloads").insert({
      email,
      ip: headers().get("x-forwarded-for") ?? null,
      user_agent: headers().get("user-agent") ?? null,
      sous_categorie_slug: sousCategorySlug,
      report_id: report.id,
      pdf_url_at_request: report.pdf_url,
    });
    
    // Send email via Edge Function dédiée
    fetch(`${SUPABASE_URL}/functions/v1/saas_send_lead_magnet_email`, {
      method: "POST",
      headers: { ... },
      body: JSON.stringify({ email, report_id: report.id, sous_categorie: report.sous_categorie }),
    }).catch(e => console.warn("[lead_magnet] email dispatch:", e));
    
    // CRM hook : insert ou update prospect (avec source='lead_magnet')
    fetch(`${SUPABASE_URL}/functions/v1/saas_lead_magnet_crm_hook`, { ... });
    
    redirect(`/etude-sectorielle/sent?email=${encodeURIComponent(email)}`);
  }
  
  // 5. Cas B : report pas dispo → message "en cours" + trigger Phase 1
  // Insert tracking quand même (intent capturé)
  await sb.from("lead_magnet_downloads").insert({
    email,
    ip: headers().get("x-forwarded-for") ?? null,
    user_agent: headers().get("user-agent") ?? null,
    sous_categorie_slug: sousCategorySlug,
    report_id: null,
    pending: true,
  });
  
  // Trigger Phase 1 via webhook n8n (fire & forget)
  fetch("https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_slug: sousCategorySlug, top_n: 30, year: 2026, owner_email: email }),
  }).catch(e => console.warn("[lead_magnet] Phase 1 trigger:", e));
  
  redirect(`/etude-sectorielle/pending?sous_cat=${sousCategorySlug}&email=${encodeURIComponent(email)}`);
}
```

#### 4.1.c Pages de confirmation

**`/etude-sectorielle/sent`** : message "Le rapport vous a été envoyé à {email}. Si vous ne le voyez pas dans 5 min, vérifiez vos spams."

**`/etude-sectorielle/pending`** : message "Cette étude n'est pas encore disponible. Vous serez notifié·e par email à {email} dès qu'elle sera prête (généralement sous 24-48h)."

**`/etude-sectorielle/limit-reached`** : "Vous avez déjà téléchargé un rapport ce mois-ci. Pour accéder à toutes nos études sans limite, créez un compte Geoperf SaaS gratuit." + CTA "Créer mon compte gratuit" → `/signup`

#### 4.1.d Edge Function `saas_send_lead_magnet_email`

**Fichier** : `supabase/functions/saas_send_lead_magnet_email/index.ts`

Pattern identique à `saas_send_welcome_email` (S16) :
- Resend SMTP via API
- Template inline Tech crisp brandé Geoperf
- Subject : `📊 Votre étude {sous_categorie} 2026 — Geoperf`
- Body :
  - Hero : "Voici votre étude sectorielle"
  - Texte : "Vous trouverez ci-dessous votre rapport Geoperf 2026 sur {sous_categorie}. Bonne lecture."
  - Bouton "Télécharger le PDF" → signed URL Storage (refresh 7j)
  - Section "Et après ?" : 3 propositions
    1. Audit GEO consulting (lien `/contact`)
    2. SaaS Geoperf gratuit (lien `/signup`)
    3. Autre étude sectorielle (lien `/etude-sectorielle`)
  - Footer : Ge·perf wordmark + RGPD opt-out + lien `/privacy`

#### 4.1.e Edge Function `saas_lead_magnet_crm_hook`

**Fichier** : `supabase/functions/saas_lead_magnet_crm_hook/index.ts`

Logique :
1. Reçoit `{ email, sous_categorie_slug, report_id }`
2. Extract domain de l'email (ex: `john@acme.com` → `acme.com`)
3. Enrich via Apollo MCP `apollo_organizations_enrich(domain)` (si compte Apollo a le scope) ou via stripe `stripe_api_search` au pire
4. Crée ou update une row `prospects` avec :
   - `email`, `first_name` (parse from email avant @ si pas trouvé), `company_id` (FK vers companies — créer si manquante)
   - `source` = `'lead_magnet'`
   - `metadata` = `{ "downloaded_reports": [report_id], "first_seen_at": NOW(), "ip": ..., "user_agent": ... }`
5. Insert un `prospect_event` `event_type=lead_magnet_download`
6. Si Attio sync workflow configuré : trigger Attio push (optionnel)

**Effort réduit** : si l'enrichment Apollo est trop complexe, fallback sur juste extract domain + créer un prospect minimal. CC peut adapter.

#### 4.1.f Migration DB

**Fichier** : `supabase/migrations/20260506_saas_phase11_lead_magnet.sql`

```sql
-- Table tracking des téléchargements (anti-abus + CRM)
CREATE TABLE IF NOT EXISTS public.lead_magnet_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  sous_categorie_slug TEXT NOT NULL,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  pdf_url_at_request TEXT,
  pending BOOLEAN NOT NULL DEFAULT FALSE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_email ON public.lead_magnet_downloads(email);
CREATE INDEX IF NOT EXISTS idx_lead_magnet_downloads_email_month ON public.lead_magnet_downloads(email, downloaded_at DESC);

-- Optionnel : ajouter 'lead_magnet' aux valeurs autorisées de prospects.source
-- Vérifier la check constraint actuelle
```

#### 4.1.g Updates HP + /saas (CTAs)

**HP racine** (`landing/app/page.tsx`) :
- Trouver le CTA actuel "Voir l'étude sample" (ou équivalent) et le remplacer par "Recevoir mon étude sectorielle gratuite" → `/etude-sectorielle`

**`/saas`** (`landing/app/saas/page.tsx`) :
- Ajouter un CTA secondaire dans le hero ou les sections : "Recevoir mon étude sectorielle gratuite" → `/etude-sectorielle`

### 4.2 Bug fix Phase 1 Consolidate stats

**Fichier** : workflow n8n `7DB53pFBW70OtGlM`, node "Consolidate (JS)"

Le code actuel (vu via MCP n8n) :
```javascript
const stats = { total_unique_companies: ..., cited_by_4_llms: 0, cited_by_3_llms: 0, cited_by_2_llms: 0, cited_by_1_llm: 0 };
//                                                                                              ↑ singulier
for (const c of consolidated) stats['cited_by_' + c.visibility_score + '_llms'] = ...
//                                                                       ↑ pluriel
```

**Fix** : aligner sur `_llms` (pluriel) partout. Modifier l'init pour utiliser `cited_by_1_llms`.

CC patche via UI n8n (1 caractère à changer).

### 4.3 Bug fix Phase 2 Build summary race condition

**Fichier** : workflow n8n `c85c3pPFq85Iy6O2`, node "Build summary"

Le bug : Build summary SELECT `prospects WHERE report_id = ...` mais s'exécute trop tôt (les Upsert ne sont pas tous commit en DB au moment du SELECT).

**Hypothèse de root cause** : le splitInBatches n'attend pas que toutes les iterations soient finies avant de pass au output 0 (done). Ou bien le SELECT s'exécute avant le commit du dernier Upsert.

**Fix possible** :
- Option A : Ajouter un node "Wait" de 2-3 secondes avant Build summary pour laisser les Upsert se commit
- Option B : Modifier la connection : "Upsert prospect in Supabase" → "Build summary" (séquentiel après le dernier Upsert) au lieu de Split per company branch 0
- Option C : Refactor le Build summary pour qu'il attende le retour de tous les Upsert via un compteur

**Recommandation** : **Option B** (le plus propre). Modifier les connections du workflow n8n pour que Build summary s'exécute après "Log prospect_created event" (le dernier node de la chaîne d'insertion) et plus depuis le branch 0 de Split per company.

CC patche via MCP n8n update_workflow ou via UI.

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Dev\GEOPERF\landing
npm run build
```

### 5.2 Tests fonctionnels

**§4.1 Lead-magnet** :
1. Visiter `/` → CTA "Recevoir mon étude sectorielle gratuite" visible et cliquable
2. Click → `/etude-sectorielle` ouvre avec form 3 champs
3. Sélectionner Catégorie "Marketing" → 2e dropdown affiche "Agences digitales FR (rapport disponible)" + autres
4. Sélectionner "Agences digitales FR" + email valide → submit
5. **Cas A** (rapport dispo) : redirect `/etude-sectorielle/sent` + email reçu avec lien PDF (vérifier inbox + spam)
6. **Cas B** (rapport pas dispo) : choisir une sous-cat sans report ready → submit → redirect `/etude-sectorielle/pending` + Phase 1 triggered (vérifier en DB que report `status=running` apparaît)
7. **Anti-abus** : re-soumettre le même email avec une AUTRE sous-cat ayant un rapport → redirect `/etude-sectorielle/limit-reached`
8. **Re-download même rapport** : même email + même sous-cat → autorisé (re-envoi email)
9. **CRM hook** : vérifier en DB que `prospects` a une nouvelle row avec `source='lead_magnet'`
10. **Email validation** : email invalide → error displayed sur form

**§4.2 Phase 1 stats fix** :
11. Trigger Phase 1 sur une sous-cat fresh → vérifier le summary retourne stats cohérentes (cited_by_1_llms, _2_llms, _3_llms, _4_llms)

**§4.3 Phase 2 build summary fix** :
12. Trigger Phase 2 sur Agences digitales FR (déjà 6 prospects) → summary doit retourner `total >= 6` (pas 0)

### 5.3 Test régression
- HP `/` rendu correct, CTAs cliquables
- `/saas` rendu correct
- Pages `/sample`, `/about`, `/contact`, `/privacy` toujours accessibles

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. Migrations SQL sauvées AVANT `apply_migration` MCP.
2. Fichiers >150 lignes : bash heredoc obligatoire.
3. `npm run build` vert AVANT proposition de push.
4. brand-500 = #2563EB.
5. **Pas de modification du PDF rendering** (Edge Function `render_white_paper`) — réutiliser tel quel.
6. **Pas de modification des templates emails existants** (`saas_send_alert_email`, etc.) — créer un nouveau pour le lead-magnet.
7. Sequence A FR1 Apollo reste paused. Pas de batch envoi outbound automatique avant fin warmup.
8. Email send : utiliser Resend, sender `hello@geoperf.com`. Mention RGPD opt-out obligatoire dans le template.

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Dev\GEOPERF\landing
npm run build
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S19: lead-magnet flow complet (page dediee form 3 champs + email gate + anti-abus + CRM hook + dispatch PDF/Phase 1) + bugs fix Phase 1 stats + Phase 2 build summary"
```

### 7.2 Edge Functions à déployer
```bash
npx supabase functions deploy saas_send_lead_magnet_email
npx supabase functions deploy saas_lead_magnet_crm_hook
```

### 7.3 Migration DB
- `20260506_saas_phase11_lead_magnet.sql` via `apply_migration` MCP

### 7.4 Workflows n8n
- Phase 1 (`7DB53pFBW70OtGlM`) : patch node Consolidate (init `cited_by_1_llms`)
- Phase 2 (`c85c3pPFq85Iy6O2`) : refacto connections Build summary → après dernier Upsert/Log

CC peut patcher via UI ou via MCP `update_workflow`. Pour Phase 1, le patch est trivial (1 caractère). Pour Phase 2, vérifier le diagram avant de toucher (risque cassage).

### 7.5 Push repo root
```powershell
cd C:\Dev\GEOPERF
git add -A
git commit -m "S19: lead-magnet flow + Phase 1/2 bugs fix + Edge Functions saas_send_lead_magnet_email + saas_lead_magnet_crm_hook + migration phase 11"
git push origin main
```

---

## 8. Reporté S20+

| Sujet | Sprint cible |
|---|---|
| Cacher coûts snapshots côté user | S20 |
| Page `/admin/saas/reports` + création catégories UI | S20 |
| Compte démo SaaS public avec 6 mois historique | S20 |
| A/B test sur la page lead-magnet | post-S20 (après data Vercel Analytics) |
| Ajout du dropdown au footer global | post-S20 (si conversion HP/saas insuffisante) |

---

## 9. Livrable de fin de sprint

`saas/docs/SPRINT_S19_RECAP.md` au format S18 :
- TL;DR check-list 3 axes (§4.1 → §4.3)
- Liens vers la nouvelle page `/etude-sectorielle` + screenshots du form
- Migration DB appliquée + nouvelles tables
- Edge Functions deployées
- Tests E2E lead-magnet (cas A, cas B, anti-abus)
- Notes méthodologiques

---

Bon sprint ! 🚀
