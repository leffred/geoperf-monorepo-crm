# Sprint 1.2 + Phase 2 prep — Récap pour Fred

> **Travail fait en autonomie pendant ~3h pendant que tu débloquais le workflow synthesis.**
> 9 livrables prêts. Beaucoup d'actions pour toi côté setup (compte Apollo, compte PDFShift, n8n, Vercel) — ~90 min au total — mais tout le code et la doc sont en place.

---

## TL;DR

| Volet | État | Action Fred |
|---|---|---|
| **Bug Gemini maxTokens** | ✅ patché localement | Re-import workflow Phase 1 |
| **Bug doublon Goldman Sachs** | ✅ patché localement | Re-import workflow Phase 1 |
| **PDF auto via PDFShift** | ✅ Edge Function v3 déployée live | Compte PDFShift + ajouter `PDFSHIFT_API_KEY` en Secret Edge Function |
| **ICP Apollo** | ✅ doc complète | Valider la liste des titles (5 min) |
| **Workflow Phase 2 sourcing** | ✅ JSON prêt | Apollo API key + import + activate |
| **Email sequence Apollo** | ✅ 3 touches FR + EN | Créer la séquence dans Apollo + coller les 3 templates |
| **Landing pages Next.js** | ✅ scaffold complet (12 fichiers) | `npm install` + `vercel deploy` |
| **DB schema** | ✅ colonne `pdf_url` ajoutée | (rien) |

---

## 1. Sprint 1.2 — Bugfixes Phase 1

### 1.1 Gemini maxTokens 4000 → 8000
**Fichier patché :** `n8n/workflows/geoperf_phase1_extraction.json` ligne 136

Gemini 2.5 Pro est verbeux et tronque souvent à `companies:[]` quand il atteint 4000 tokens. Passé à 8000 → résolution attendue : ~80% des cas.

### 1.2 Dédoublonnage par nom_normalisé (résout doublon Goldman Sachs AM)
**Fichier patché :** `n8n/workflows/geoperf_phase1_extraction.json` (fonction `matchKey`)

Avant : key = `'d:' + domain` si domaine présent → 2 entrées GSAM (gsam.com vs goldmansachs.com).
Après : key = `'n:' + nom_normalisé` toujours → BlackRock = "blackrock" peu importe le domaine.

**Action Fred (5 min) :** réimporter le JSON dans n8n :
- Workflow `GEOPERF Phase 1 — Extraction & Consolidation` → ⋯ menu → **Import from File**
- Choisir `n8n/workflows/geoperf_phase1_extraction.json`
- Reconnecter les credentials (Postgres GEOPERF, OpenRouter GEOPERF) sur les nodes affectés

---

## 2. Sprint 1.2 — Edge Function v3 avec PDF auto

**Déployée live** : version 3, status ACTIVE, slug `render_white_paper`. Le code complet (28 KB, plus de stub) tourne maintenant en prod sur Supabase.

**Nouveau comportement :**
1. Render HTML → upload Storage `<report_id>.html` → signed URL 7j
2. **NOUVEAU :** Si `PDFSHIFT_API_KEY` est définie → call PDFShift API → upload PDF Storage `<report_id>.pdf` → signed URL 7j
3. UPDATE `reports.html_url + pdf_url + completed_at + status`
4. Return `{ok, html_url, pdf_url, html_size_bytes, pdf_size_bytes, pdf_error, stats}`

Si PDFShift échoue, le HTML est quand même servi (best-effort).

### Actions Fred (10 min)

**1. Créer un compte PDFShift** (gratuit jusqu'à 250 PDF/mois) :
- https://pdfshift.io → Sign up
- Dashboard → API Keys → copier la clé

**2. Ajouter la clé en Secret Edge Function :**
- Supabase Dashboard → Project Settings → Edge Functions → **Secrets**
- New Secret :
  - Name : `PDFSHIFT_API_KEY`
  - Value : (clé PDFShift)
- Save → la function la lira automatiquement au prochain call

**3. Tester end-to-end :** une fois le workflow synthesis débloqué (cf §3), un appel à `/webhook/geoperf-extract` devrait produire à la fois `html_url` et `pdf_url` dans la DB.

### Migration appliquée live

Colonne `reports.pdf_url TEXT` ajoutée (migration `add_pdf_url_to_reports`).

---

## 3. Workflow synthesis — toujours bloqué côté toi

Pour rappel, le diagnostic d'avant les 3h :
- Webhook `/webhook/geoperf-synthesis` répond 200 en 1.9s body vide → mode "Respond Immediately"
- Edge Function pas appelée par le workflow → exécution async qui plante quelque part

**Le plus probable** : credential mal bindée sur un des 3 nodes après import (Postgres, OpenRouter, ou Supabase Service Role Header Auth sur le HTTP).

**Quand tu débloques :** ouvre n8n → Workflow synthesis → onglet **Executions** → la dernière exécution rouge te dira exactement quel node a planté. Ou active "Allow MCP access" dans les workflow settings et je le lis directement.

---

## 4. Phase 2 — ICP Apollo Asset Management

**Doc :** `docs/PHASE2_ICP_APOLLO.md`

Contient :
- L'ICP générique B2B Geoperf (titles, seniority, departments)
- Le payload Apollo `mixed_people/search` complet pour Asset Management
- Les 11 sociétés du LB pilote avec domaine + visibility score
- Templates pour SaaS/CRM, Conseil/Stratégie, Pharma (à compléter plus tard)
- **Scoring lead 0-100** avec règles précises
- Champs mapping Apollo → `prospects` table
- Conformité GDPR / opt-out

**Action Fred (5 min) :** relire la liste des titles cible et me dire si tu veux ajouter/retirer.

---

## 5. Phase 2 — Workflow n8n sourcing

**Fichier :** `n8n/workflows/geoperf_phase2_sourcing.json`
**Doc déploiement :** `n8n/workflows/PHASE2_SOURCING_DEPLOY.md`

Pipeline :
```
Webhook /geoperf-sourcing
  → Extract params {report_id, max_per_company, min_lead_score}
  → SQL : SELECT companies du report
  → Build Apollo searches (per company)
  → SplitInBatches (1 société à la fois)
       → POST Apollo people search
       → Score & filter top-N par société
       → UPSERT prospects (ON CONFLICT apollo_person_id)
       → Log prospect_created event
       → Loop back
  → Build summary SQL
  → Webhook response {summary}
```

### Actions Fred (15 min)

1. **Apollo API Key** (si pas déjà créée) : Apollo → Settings → Integrations → API → générer
2. **Créer credential n8n** Header Auth :
   - Name : `Apollo API Key`
   - Header Name : `X-Api-Key`
   - Header Value : (la clé Apollo)
3. **Importer** `geoperf_phase2_sourcing.json` dans n8n
4. **Configurer credentials** sur les 4 nodes Postgres + le node HTTP Apollo
5. **Activer** le workflow
6. **Tester** :
   ```bash
   curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-sourcing \
     -H "Content-Type: application/json" \
     -d '{"report_id":"61be49be-8e19-48b4-b50a-9a59f3cb987a","max_per_company":3,"min_lead_score":50}'
   ```

Après run → vérifier en SQL : `SELECT first_name, last_name, title, lead_score FROM prospects ORDER BY lead_score DESC LIMIT 33;`

---

## 6. Phase 2 — Email sequence 3 touches

**Doc :** `docs/PHASE2_EMAIL_SEQUENCE.md`

Contient :
- 3 touches complètes en EN + FR (J+0, J+3, J+7)
- Subject lines avec 2-3 variantes A/B
- Variables Apollo à mapper (`{{first_name}}`, `{{ranking_position}}`, `{{landing_url}}`, etc.)
- Notes de tone (FT-style, factuel, pas d'enthousiasme commercial)
- Plan de test A/B (variant A = 3 emails, variant B = 2 emails + LinkedIn)
- Conformité GDPR / opt-out

### Actions Fred (30 min — création séquence Apollo)

1. **Apollo → Sequences → New Sequence** : `Geoperf - Asset Management - 3 touches FR`
2. **Step 1 (Day 0)** : Email — coller subject + body de la touche 1 FR (ou EN si tu fais bilingual)
3. **Step 2 (Day 3)** : Email — coller touche 2
4. **Step 3 (Day 7)** : Email — coller touche 3 (break-up)
5. **Custom fields à créer** dans Apollo (Settings → Custom Fields → Person) :
   - `landing_url` (text)
   - `ranking_position` (number)
   - `visibility_score` (text)
   - `competitor_top1` (text)
6. **Sender** : configure ta box mail (ou Gmail OAuth) avec SPF/DKIM (cf `docs/DNS_EMAIL_SETUP.md`)

---

## 7. Phase 2 — Landing pages Next.js

**Dossier :** `landing/` (12 fichiers, ~600 lignes TypeScript/TSX)
**Doc :** `landing/README.md`

Stack : Next.js 15 App Router, React 19, Tailwind 3, Supabase 2.45, TypeScript strict.

Routes :
- `/` — page publique générique
- `/[sous_cat]?t=<token>` — landing personnalisée (Hello {{first_name}}, voici l'étude {{company_name}}, position #{{ranking_position}})
- `POST /api/download` — log + signed URL fraîche
- `POST /api/track` — beacon générique

Tracking automatique :
- `landing_visited` au server render (dès qu'un token valide arrive)
- `download_started` + `download_completed` quand le bouton est cliqué
- Tous les events vont dans `prospect_events` + update `prospects.last_engagement_at` + `download_at`

### Actions Fred (30 min)

1. **Local dev** :
   ```bash
   cd landing
   cp .env.example .env.local
   # Renseigner :
   # - NEXT_PUBLIC_SUPABASE_URL=https://qfdvdcvqknoqfxetttch.supabase.co
   # - NEXT_PUBLIC_SUPABASE_ANON_KEY=<récup Supabase Settings → API>
   # - SUPABASE_SERVICE_ROLE_KEY=<idem>
   # - NEXT_PUBLIC_CALENDLY_URL=https://calendly.com/jourdechance/audit-geo
   # - NEXT_PUBLIC_SITE_URL=https://geoperf.com
   npm install
   npm run dev
   # http://localhost:3000
   ```

2. **Créer un prospect de test pour valider** :
   ```sql
   INSERT INTO prospects (report_id, first_name, last_name, full_name, email)
   VALUES ('61be49be-8e19-48b4-b50a-9a59f3cb987a', 'Test', 'User', 'Test User', 'test@example.com')
   RETURNING id, tracking_token;
   ```
   Puis ouvrir `http://localhost:3000/asset-management?t=<token>`

3. **Push GitHub + deploy Vercel** :
   - Créer repo `github.com/jourdechance/geoperf-landing` (ou monorepo `geoperf` avec sous-dossier `landing`)
   - Vercel → New Project → Import → root = `landing/`
   - Configurer les 5 variables d'env
   - Build
   - Add domain `geoperf.com` (DNS OVH : A → vercel)

---

## 8. Roadmap Sprint 2.2 (après pilote)

À faire quand le pilote tourne (Asset Management complet → ~33 prospects → premier emails envoyés) :

- [ ] **Workflow Phase 2.2** : trigger sur `download_completed` event → switch Sequence A → Sequence B (plus chaud)
- [ ] **Calendly webhook** → log `calendly_booked` + `calendly_attended`
- [ ] **Page `/asset-management/merci`** post-Calendly avec next steps
- [ ] **Tracking pixel** pour les emails (image 1x1 → log `email_opened`)
- [ ] **OG image dynamique** par prospect (Vercel OG generator)
- [ ] **Mirror Attio** : workflow n8n qui sync `prospects` → Attio Companies + People (cf `docs/TRACKING_ARCHITECTURE.md`)
- [ ] **Wildcard subdomain** `asset-management.geoperf.com` (middleware host-rewrite)
- [ ] **Variantes EN** auto par locale du prospect
- [ ] **Cron mensuel** : purge `prospects.opted_out` > 30j (RGPD)

---

## 9. Récap fichiers livrés

| Fichier | Type | Lignes | Action attendue |
|---|---|---|---|
| `n8n/workflows/geoperf_phase1_extraction.json` | patché | +5 | Re-importer dans n8n |
| `supabase/functions/render_white_paper/index.ts` | patché +PDFShift | +50 | Déjà déployé live (v3) |
| `docs/PHASE2_ICP_APOLLO.md` | nouveau | 175 | Relire + valider |
| `n8n/workflows/geoperf_phase2_sourcing.json` | nouveau | 165 | Importer + setup credentials |
| `n8n/workflows/PHASE2_SOURCING_DEPLOY.md` | nouveau | 90 | Suivre les étapes |
| `docs/PHASE2_EMAIL_SEQUENCE.md` | nouveau | 250 | Coller dans Apollo Sequences |
| `landing/` (12 fichiers) | nouveau | ~600 | npm install + Vercel deploy |
| `SPRINT_1_2_RECAP.md` | ce fichier | — | Le lire 😊 |

DB : colonne `reports.pdf_url` ajoutée (migration appliquée live).

---

## 10. Total temps Fred ~90 min

| Tâche | Temps | Priorité |
|---|---|---|
| Débloquer workflow synthesis (executions n8n) | 5 min | **P0 — bloquant** |
| Re-importer workflow Phase 1 patché | 5 min | P1 |
| Compte PDFShift + Secret `PDFSHIFT_API_KEY` | 10 min | P1 |
| Apollo API Key + import workflow Phase 2 | 15 min | P2 |
| Créer Sequence Apollo (3 templates) | 30 min | P2 |
| Vercel deploy landing | 25 min | P2 |

P0 d'abord (sinon rien ne tourne end-to-end), puis P1 pour avoir des PDF auto-générés, puis P2 pour démarrer Phase 2.
