# Sprint S17 — Brief : Acquisition Launch + Activation

**Date brief** : 2026-05-04
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-04 après audit Launch Readiness + S16 + S16.1)
**Effort estimé** : 1 nuit Claude Code longue (7-9h focus dev)
**Pré-requis** :
- S16 et S16.1 mergés et déployés
- LAUNCH_READINESS_AUDIT.md lu
- Phase A #1.3 du S16.1 effectuée par Fred (template Supabase Auth collé dans Dashboard)
- 5 actions S16 effectuées : push, deploy 12 Edge Functions, secrets Stripe yearly, TVA remplie, tests E2E

---

## 1. Pourquoi ce sprint

Avec S16 (5 CRITICAL fixés) + S16.1 (5 bugs PPT fixés), **le SaaS est techniquement prêt** pour facturer ses premiers users. Mais 2 trous restent qui empêchent l'acquisition réelle :

1. **Aucun mécanisme automatisé pour amener des leads**. Le workflow n8n Phase 2.2 sequence_load existe à l'état de spec mais n'est pas câblé. Le `test_mode` Apollo est encore actif. Aucun email n'est jamais parti vers les 27 prospects Asset Management.
2. **Aucun moteur d'acquisition gratuit (SEO)**. Les pages `/profile/[domain]` existent mais n'ont pas de metadata SEO uniques. Aucun sectoral leaderboard public n'existe.

**S17 = sprint qui ouvre le robinet acquisition** + ajoute 3 quick wins activation pour préparer la conversion (auto-suggest concurrents, trial expiring J-2, Sentry pour debug rapide).

**Anti-pattern à éviter** : si scope dépasse, l'agent priorise §4.1 → §4.5 (Acquisition) sur §4.6 → §4.8 (Activation). L'acquisition est plus urgente.

---

## 2. Périmètre

### In scope (8 livrables, par ordre de priorité)

**Acquisition (priorité 1)** :
1. **§4.1** Workflow n8n Phase 2.2 sequence_load câblé (Apollo Sequences API)
2. **§4.2** Préparation lever test_mode Apollo (audit copies FR + dry-run sequence A)
3. **§4.3** Sectoral leaderboard public `/leaderboard/[secteur]` (page SEO)
4. **§4.4** OG metadata dynamiques `/profile/[domain]` (SEO)
5. **§4.5** Sitemap + robots.txt mis à jour (inclure /leaderboard)

**Activation (priorité 2)** :
6. **§4.6** Auto-suggest concurrents (#1.6 BUGS_AND_FEEDBACK)
7. **§4.7** Trial expiring email J-2 (réduit churn surprise)
8. **§4.8** Sentry / error tracking minimal (Next.js + Edge Functions config)

### Out of scope (S18+ ou actions manuelles)

- ❌ Lever effectivement le `test_mode` Apollo et envoyer la première vague (action Fred après validation copies + dry-run)
- ❌ DKIM/SPF Resend domain (action Fred + DNS OVH, hors agent)
- ❌ Cross-brand benchmark anonymisé (S18, gros sprint dédié)
- ❌ Prompt Studio dans l'UI (S18+, gros chantier)
- ❌ Rate-limit API SaaS (S18, hardening)
- ❌ pg_cron alerting si fail (S18)
- ❌ Team seats enforcement (S18)
- ❌ Backfill rangs concurrents historiques (S18 ou skip si parser S14 OK)
- ❌ Webinaire mensuel / case studies / blog (marketing/contenu, hors dev)
- ❌ Mobile responsive audit complet (S18+)

---

## 3. État courant à connaître

### 3.1 Workflow n8n Phase 2.2 — référence existante
- Spec : `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md`
- Workflow ID : `b6cwag080lQ2Kq4B` (créé mais inactif sur n8n cloud `fredericlefebvre.app.n8n.cloud`)
- Trigger : POST `/webhook/geoperf-sequence-load` body `{report_id, sequence_id, lead_score_min, max}`
- État : `INACTIF par défaut` (cf `docs/CLAUDE-backend.md` ligne 67)

### 3.2 Apollo Sequences API
- Endpoint principal : `POST /api/v1/emailer_campaigns/{id}/add_contact_ids` body `{contact_ids[], emailer_campaign_id, send_email_from_email_account_id}`
- Endpoint contact create : `POST /api/v1/contacts` body avec `email`, `first_name`, `last_name`, `title`, `organization_name`, custom fields
- Custom fields à pousser :
  - `landing_url` = `https://geoperf.com/{sous_categorie}?t={tracking_token}`
  - `ranking_position` = `report_companies.rank`
  - `visibility_score` = `report_companies.visibility_score` (`/4`)
  - `competitor_top1` = top 1 du LB qui n'est pas la company
- Credential n8n : `Apollo Api Key` (HTTP Header Auth, header `x-api-key`)
- Plan Apollo Basic 59€/mois, 2560 crédits, ~26 utilisés → marge confortable

### 3.3 Copies sequence A
- Localisation : `docs/PHASE2_EMAIL_SEQUENCE.md` (248 lignes)
- 3 touches J+0, J+3, J+7 en FR + EN
- **À valider par Fred avant lever test_mode** (bloqueur connu depuis S8)

### 3.4 Données prospects existantes
- 27 prospects Asset Management dans `prospects` table
- 24 emails verified + 24 avec LinkedIn
- Status par défaut : `new`
- `lead_score >= 50` filtre pertinent (cf vue `v_ai_saturation_opportunities`)

### 3.5 Frontend — pages SEO existantes
- `/profile/[domain]` créée S8, indexable, listée dans sitemap
- `/admin/profiles` index admin
- Pas de generateMetadata dynamique (cf finding #6 LAUNCH_READINESS_AUDIT)
- Pas de page leaderboard sectoral

### 3.6 Données disponibles pour leaderboard
- Tables `categories` (34 sous-cat), `companies` (60), `reports` (4 ready), `report_companies` (67 links)
- 4 sous-cat ont un report ready : Asset Management ×2, CRM, Aéro
- Pour les autres sous-cat : page leaderboard doit gracefully gérer "pas encore de données" avec EmptyState

---

## 4. Livrables

### 4.1 Workflow n8n Phase 2.2 sequence_load

**Référence** : lire `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` AVANT de coder. Le SDK n8n MCP est déjà branché (cf docs/CLAUDE-backend.md ligne 112).

**Logique du workflow** :

```
[Webhook trigger /webhook/geoperf-sequence-load]
  body: { report_id, sequence_id, lead_score_min: 50, max: 50 }
  ↓
[Postgres SELECT — load eligible prospects]
  SELECT p.id, p.email, p.first_name, p.last_name, p.title, p.linkedin_url,
         p.lead_score, p.tracking_token,
         c.name AS company_name, c.domain AS company_domain,
         rc.rank AS ranking_position, rc.visibility_score,
         (SELECT name FROM report_companies WHERE report_id = $1 ORDER BY rank LIMIT 1) AS competitor_top1
  FROM prospects p
  JOIN companies c ON c.id = p.company_id
  JOIN report_companies rc ON rc.company_id = c.id AND rc.report_id = $1
  WHERE p.status = 'new' AND p.lead_score >= $2 AND p.email_verified = true
  ORDER BY p.lead_score DESC LIMIT $3
  ↓
[Loop par prospect]
  ↓
[HTTP POST Apollo /api/v1/contacts] (create or update)
  body: {
    email, first_name, last_name, title,
    organization_name: company_name,
    typed_custom_fields: [
      { id: "...", value: landing_url },
      { id: "...", value: ranking_position.toString() },
      { id: "...", value: visibility_score.toString() },
      { id: "...", value: competitor_top1 },
    ]
  }
  → récupère contact_id Apollo
  ↓
[Postgres UPDATE prospects.apollo_contact_id]
  ↓
[HTTP POST Apollo /api/v1/emailer_campaigns/{sequence_id}/add_contact_ids]
  body: { contact_ids: [apollo_contact_id], send_email_from_email_account_id: "..." }
  ↓
[Postgres UPDATE prospects.status = 'engaged', prospects.engaged_at = NOW()]
  ↓
[Postgres INSERT prospect_events (type='enrolled_in_sequence')]
  ↓
[End loop]
  ↓
[Webhook response]
  { ok: true, processed: N, errors: [...] }
```

**Important** :
- **Ne PAS activer le workflow** côté n8n. Le laisser en `inactive` jusqu'à validation Fred.
- Test : appeler le webhook avec un `report_id` factice + 1 prospect test (id Fred) → vérifier que le contact est créé dans Apollo + status passe `new → engaged`.
- Idempotence : si le contact Apollo existe déjà (par email), réutiliser son ID (Apollo `/api/v1/contacts/search` ou `bulk_match`).

**Fichier à créer/mettre à jour** :
- Le JSON exporté du workflow dans `n8n/workflows/geoperf_phase2_2_sequence_load.json` (créer)
- Si modification : mettre à jour `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md`

### 4.2 Préparation lever test_mode Apollo

**Audit copies FR** (par l'agent) :
- Lire `docs/PHASE2_EMAIL_SEQUENCE.md` en entier
- Identifier les variables Apollo référencées : `{{landing_url}}`, `{{ranking_position}}`, `{{visibility_score}}`, `{{competitor_top1}}`, `{{first_name}}`, `{{company_name}}`
- Vérifier que TOUTES sont injectables via le workflow Phase 2.2 (custom fields Apollo)
- Vérifier la cohérence wording (pas de "Solo+" résiduel après S16.1)
- Produire un commentaire par touche FR (J+0, J+3, J+7) avec recommandations d'amélioration éventuelles. Pas de modif des copies — Fred valide lui-même.

**Dry-run Phase 2.2** :
- Créer un test query SQL qui simule l'extraction prospects (sans toucher au statut)
- Vérifier qu'on a au moins 5 prospects éligibles `status='new', lead_score >= 50, email_verified=true` sur le report Asset Management
- Documenter dans le recap : nombre de prospects qui passeraient en `engaged` au premier run réel

**Action Fred (post-sprint)** :
1. Lire l'audit copies FR + valider/modifier
2. Créer la sequence dans Apollo UI (son compte) avec les 3 touches FR
3. Récupérer le `sequence_id` Apollo
4. Tester le webhook Phase 2.2 avec 1 prospect test (lui-même)
5. Si OK, activer le workflow n8n + lever `test_mode`
6. Premier batch sur 10 prospects, monitorer 48h, ensuite ouvrir à 50/jour

### 4.3 Sectoral leaderboard public `/leaderboard/[secteur]`

**Nouvelle route** : `landing/app/leaderboard/[secteur]/page.tsx`

**Logique** :
- Server component, dynamic rendering
- `params.secteur` = slug de catégorie (ex: `asset-management`, `crm`, `aeronautique`)
- Si la catégorie n'existe pas dans `categories` table → 404
- Si la catégorie existe mais aucun report ready → page leaderboard avec EmptyState "Étude en cours, premier publié X" + CTA email capture
- Si catégorie a un report ready → afficher le top 10 (ou le top défini par `categories.top_n`) avec :
  - Titre H1 : "Top 10 {category_name} dans les LLMs — {year}"
  - Sous-titre : "Selon ChatGPT, Claude, Gemini et Perplexity. Données du {report.created_at}"
  - Tableau : rang, logo, company name, domain, visibility_score (sur 4), saturation IA gap
  - CTA top : "Téléchargez l'étude complète gratuite" → `/sample`
  - CTA bottom : "Vous êtes dans le top 10 ? Bénéficiez d'un audit GEO offert" → `/contact`

**Index `/leaderboard`** : `landing/app/leaderboard/page.tsx`
- Liste les sous-cat qui ont un report ready (carte par catégorie avec thumbnail)
- Pour les autres : carte "Étude à venir" avec CTA email capture

**Metadata dynamiques** :
```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  const cat = await getCategoryBySlug(params.secteur);
  if (!cat) return { title: "Catégorie introuvable | Geoperf" };
  return {
    title: `Top 10 ${cat.name} dans ChatGPT et Claude — Geoperf`,
    description: `Classement officiel ${cat.name} 2026 selon les LLMs. Visibility, citation rate, saturation IA. Étude gratuite Jourdechance.`,
    openGraph: {
      title: `Top 10 ${cat.name} dans les LLMs`,
      description: `Quelles marques de ${cat.name} sont les plus citées par ChatGPT, Claude, Gemini ?`,
      images: [`/api/og?title=Top+10+${encodeURIComponent(cat.name)}&type=leaderboard`],
    },
  };
}
```

**Composants à créer** :
- `landing/components/leaderboard/LeaderboardTable.tsx`
- `landing/components/leaderboard/CategoryCard.tsx` (pour l'index)

**Style** : Tech crisp cohérent avec `/saas/vs-getmint`. Cards `border border-ink/[0.08]`, eyebrow JetBrains Mono, headings Inter 500 letter-spacing-tight.

### 4.4 OG metadata dynamiques `/profile/[domain]`

**Fichier** : `landing/app/profile/[domain]/page.tsx`

Ajouter `generateMetadata` :

```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  const data = await getProfileData(params.domain);
  if (!data) return { title: "Profil introuvable | Geoperf" };
  
  const { company_name, latest_visibility, latest_rank, category_name } = data;
  
  return {
    title: `${company_name} — Visibilité LLM ${latest_visibility}/4 | Geoperf`,
    description: `Comment ${company_name} apparaît dans ChatGPT, Claude, Gemini et Perplexity. Rang ${latest_rank} dans la catégorie ${category_name}. Étude indépendante Jourdechance.`,
    openGraph: {
      title: `${company_name} dans les LLMs — score ${latest_visibility}/4`,
      description: `Score visibility, citation rate, saturation IA pour ${company_name}.`,
      images: [`/api/og?title=${encodeURIComponent(company_name)}&score=${latest_visibility}&type=profile`],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${company_name} dans les LLMs`,
      description: `Score ${latest_visibility}/4 — analyse Geoperf.`,
    },
  };
}
```

**Action sur `/api/og`** : étendre le générateur OG image existant pour supporter le `type=profile` (image avec nom + score) et `type=leaderboard` (image avec catégorie).

**Vérifier** : que le sitemap inclut bien toutes les pages /profile/[domain] indexables (déjà le cas selon audit).

### 4.5 Sitemap + robots.txt

**Fichier** : `landing/app/sitemap.ts`

Ajouter les entries leaderboard :
```typescript
// Index leaderboard
{ url: `${baseUrl}/leaderboard`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 }

// Une entry par catégorie qui a un report ready
const categoriesWithReports = await getCategoriesWithReports();
const leaderboardEntries = categoriesWithReports.map(cat => ({
  url: `${baseUrl}/leaderboard/${cat.slug}`,
  lastModified: cat.latest_report_at,
  changeFrequency: 'monthly' as const,
  priority: 0.7,
}));
```

**Fichier** : `landing/app/robots.ts`

Vérifier que `/leaderboard` n'est PAS dans Disallow (doit être indexable). Pas de modification attendue normalement.

### 4.6 Auto-suggest concurrents (#1.6 BUGS_AND_FEEDBACK)

**Pattern identique à `saas_suggest_prompts` (S15)**.

**Nouvelle Edge Function** : `supabase/functions/saas_suggest_competitors/index.ts`

```typescript
// POST { brand_name, domain, category }
// → appelle Haiku via OpenRouter avec :
// system: "Tu es un analyste B2B. Tu connais le marché français en {category}.
//          Donne EXACTEMENT 5 concurrents directs de {brand_name} ({domain}).
//          Format JSON strict : [{\"name\":\"...\",\"domain\":\"...\"}]
//          Pas de markdown, pas de commentaire."
// → parse JSON, validate, return { suggestions: [{name, domain}] }
// Cap rate-limit : 1 appel par minute par user (saas_usage_log check)
```

**Composant React** : `landing/components/saas/CompetitorSuggestionPicker.tsx`
- Server-rendered initial state (vide)
- Bouton "Suggérer 5 concurrents" → server action → Edge Function
- Affichage d'une liste cochable (par défaut tous cochés)
- Submit : injecte les domains cochés dans le champ `competitor_domains` du form parent
- Style cohérent avec `PromptSuggestionPicker` post-S16.1 (card surface, heading H3, bouton primary noir, feedback vert)

**Intégration** : `landing/app/app/brands/new/page.tsx` ET `landing/app/app/onboarding/page.tsx`
- Ajouter le picker au-dessus du champ "Domaines concurrents"
- Lecture preserved : si l'user a déjà saisi des domaines, ne pas écraser, juste merger

### 4.7 Trial expiring email J-2

**Logique** :
- pg_cron tous les jours à 8h UTC scan les subscriptions `trialing` qui expirent dans <= 2 jours
- Pour chaque, fire `saas_send_trial_expiring_email`
- Idempotence : ne pas renvoyer si déjà envoyé (champ `trial_expiring_email_sent_at` à ajouter)

**Migration DB** :
```sql
ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS trial_expiring_email_sent_at TIMESTAMPTZ;
```

**Nouvelle Edge Function** : `supabase/functions/saas_send_trial_expiring_email/index.ts`

Pattern identique à `saas_send_payment_failed_email` (créé S16) :
- Receives `{ user_id, email, full_name, trial_end_date }` ou se débrouille seul (loop sur tous les eligible)
- Subject : `Ton trial Geoperf se termine dans X jours`
- Body : rappel des features Pro, CTA "Mettre à jour ma carte" → `/app/billing`
- Si pas de CB ajoutée : "Sans action de ta part, ton compte repassera en plan Free le {date}"
- Si CB ajoutée : "Ton paiement Pro à 399€ sera prélevé le {date}, tu peux annuler avant"

**Migration pg_cron** :
```sql
SELECT cron.schedule(
  'saas-trial-expiring-check',
  '0 8 * * *',  -- tous les jours à 8h UTC
  $$
  SELECT net.http_post(
    url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_trial_expiring_email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### 4.8 Sentry / error tracking minimal

**Frontend Next.js** :

```bash
cd landing
npm install @sentry/nextjs
```

Configuration auto via `npx @sentry/wizard@latest -i nextjs` ou manuelle :
- `sentry.client.config.ts` : `Sentry.init({ dsn, tracesSampleRate: 0.1 })`
- `sentry.server.config.ts` : idem
- `sentry.edge.config.ts` : idem
- `next.config.ts` : wrap avec `withSentryConfig`
- `instrumentation.ts` : register

**Env vars Vercel à ajouter** :
- `SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`

**Action Fred (avant sprint ou pendant)** : créer un compte Sentry gratuit, créer un projet "geoperf-saas" Next.js, récupérer le DSN.

**Edge Functions** : Sentry Deno integration possible via `@sentry/deno`. Mais pour S17, on se contente du frontend Next.js. Les erreurs Edge Functions restent dans Supabase logs (acceptable).

**Test** : trigger une erreur volontaire dans une page (ex: throw Error dans un server component) → vérifier qu'elle apparaît dans Sentry dashboard.

---

## 5. Plan de tests

### 5.1 Build local
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
```
Doit passer vert. Nouvelle dépendance attendue : `@sentry/nextjs`.

### 5.2 Tests fonctionnels par livrable

**§4.1 Workflow Phase 2.2** :
1. Trigger webhook avec `{report_id: 'asset-mgmt-uuid', sequence_id: 'fake_seq', lead_score_min: 50, max: 1}` → vérifier qu'aucun email ne part (Apollo en sandbox ou non-existing sequence)
2. Vérifier le SQL select retourne >= 1 prospect éligible
3. Si l'agent peut tester avec un sequence Apollo réel + 1 prospect Fred test : vérifier que le contact est créé dans Apollo + custom fields peuplés

**§4.2 Audit copies** :
4. Audit copies FR produit dans `saas/docs/SEQUENCE_A_AUDIT_S17.md` avec recommandations
5. Dry-run SQL produit avec count prospects éligibles documenté

**§4.3 Sectoral leaderboard** :
6. `/leaderboard` → liste les sous-cat avec/sans report
7. `/leaderboard/asset-management` → top 10 affichés correctement
8. `/leaderboard/categorie-inexistante` → 404
9. `/leaderboard/categorie-sans-report` → EmptyState avec CTA email

**§4.4 OG metadata profile** :
10. View source `/profile/{domain_existant}` → meta title, description, OG image présents et corrects
11. Tester via Twitter Card Validator ou opengraph.xyz : OG image bien générée

**§4.5 Sitemap** :
12. `/sitemap.xml` → contient `/leaderboard` + `/leaderboard/{slug}` pour chaque cat avec report
13. `/robots.txt` → `/leaderboard` allowed

**§4.6 Auto-suggest concurrents** :
14. `/app/brands/new` ou `/app/onboarding` : saisir nom + catégorie → click "Suggérer 5 concurrents" → 5 propositions affichées en <5s
15. Cocher 3, submit → vérifier que les domains sont ajoutés au champ `competitor_domains` de la brand créée
16. Rate-limit : 2 clicks en <60s → second renvoie 429

**§4.7 Trial expiring email J-2** :
17. Trigger manuel `curl -X POST .../saas_send_trial_expiring_email` → vérifier qu'au moins 1 user trialing reçoit l'email (si dispo)
18. Vérifier que `trial_expiring_email_sent_at` est setté → second appel skip cet user

**§4.8 Sentry** :
19. Trigger erreur volontaire → vérifier event dans Sentry dashboard

### 5.3 Tests régression
- Vérifier que toutes les pages SaaS post-S16 fonctionnent toujours (`/app/dashboard`, `/app/brands/[id]`, etc.)
- Vérifier que les emails post-S16 (welcome, alert, digest, payment_failed) partent toujours

---

## 6. Contraintes (cf. `CLAUDE.md` racine)

1. Migrations SQL sauvées AVANT `apply_migration` MCP.
2. Fichiers >150 lignes : bash heredoc obligatoire.
3. `npm run build` vert AVANT proposition de push.
4. brand-500 = #2563EB. Glyphe `·` ambré préservé.
5. **Workflow n8n Phase 2.2 reste en INACTIF**. Ne pas l'activer dans le SDK n8n MCP.
6. **Aucun email réel ne doit partir** depuis le workflow Phase 2.2 pendant le sprint. Tests uniquement avec sequence Apollo factice ou compte Fred.
7. Aucune modification des copies FR de la sequence A (l'agent les audite, Fred valide).
8. Si scope dépasse, prioriser §4.1 → §4.5 (Acquisition). §4.6 → §4.8 (Activation) reportable en S18.

---

## 7. Push et deploy

### 7.1 Frontend
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S17: acquisition launch (sectoral leaderboard, OG metadata profile, Phase 2.2 sequence_load) + activation (auto-suggest concurrents, trial expiring J-2, Sentry)"
```

### 7.2 Edge Functions à déployer
```bash
npx supabase functions deploy saas_suggest_competitors        # NEW §4.6
npx supabase functions deploy saas_send_trial_expiring_email  # NEW §4.7
```

### 7.3 Migration DB
- `20260505_saas_phase8_trial_expiring.sql` (column + pg_cron) → `apply_migration` MCP

### 7.4 Workflow n8n
- Push le JSON dans `n8n/workflows/geoperf_phase2_2_sequence_load.json`
- Le workflow reste **INACTIF** sur n8n cloud
- Fred l'activera lui-même après validation copies + dry-run + sequence Apollo créée

### 7.5 Env vars / secrets
- Vercel : `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
- Supabase : pas de nouveau secret normalement

---

## 8. Reporté S18+

| Sujet | Sprint cible | Pourquoi pas S17 |
|---|---|---|
| Cross-brand benchmark anonymisé | S18 | Gros sprint, vue Postgres + UI Pro+ |
| Prompt Studio dans l'UI | S18+ | Gros chantier, sortir des prompts JSON bundlés |
| Rate-limit API SaaS | S18 | Hardening, pas critique sans users |
| pg_cron alerting si fail | S18 | Hardening |
| Team seats enforcement | S18 | Edge case Growth+ |
| Backfill rangs concurrents historiques | S18 (ou skip) | À évaluer après usage S14 réel |
| DKIM/SPF Resend | Action Fred immédiate | Hors scope agent, DNS OVH |
| Mobile responsive audit | S18+ | Travail exploratoire 1-2j |
| Webinaire mensuel / case studies / blog | Marketing/contenu | Hors dev |

---

## 9. Livrable de fin de sprint

`saas/docs/SPRINT_S17_RECAP.md` au format S16 :
- TL;DR check-list 8 livrables avec status livré/skipped
- Section dédiée pour `SEQUENCE_A_AUDIT_S17.md` (recommandations sur copies FR)
- Section dédiée pour résultat dry-run Phase 2.2 (count prospects éligibles)
- Fichiers modifiés / créés (`git status --short` racine + landing)
- Reste à faire pour Fred (par ordre) :
  1. Lire `SEQUENCE_A_AUDIT_S17.md` + valider/modifier les copies FR
  2. Configurer DKIM/SPF Resend (DNS OVH)
  3. Créer la sequence Apollo dans son UI avec les 3 touches FR validées
  4. Récupérer `sequence_id` Apollo
  5. Créer le compte Sentry + remplir env vars Vercel
  6. Push frontend + deploy 2 Edge Functions + apply migration
  7. Test webhook Phase 2.2 avec son propre email comme prospect test
  8. Activer le workflow n8n Phase 2.2 + lever `test_mode`
  9. Premier batch 10 prospects, monitorer 48h, ouvrir progressivement

---

## 10. Plan de bataille post-S17 (pour info, hors agent)

Une fois S17 livré et toutes les actions Fred faites, voilà l'ordre de rollout commercial :

**Semaine 1 post-S17** :
- Active workflow Phase 2.2 + lever test_mode
- Premier batch 10 prospects Asset Management
- Monitor open rate + click rate via Apollo + Geoperf events
- Mesurer les downloads `/sample` venant du tracking_token

**Semaine 2** :
- Itérer copies si open rate < 30%
- Étendre à 50 prospects/jour
- Lancer le sectoral leaderboard sur LinkedIn (post Fred)

**Semaine 3-4** :
- Premier client payant attendu si funnel marche
- Itérer activation flow basé sur événements observés

**S18 sera défini selon ce que tu apprends en semaines 1-4**.

---

Bon sprint ! 🚀
