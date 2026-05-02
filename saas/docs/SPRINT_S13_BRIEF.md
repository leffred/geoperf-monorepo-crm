# Sprint S13 — Polish final + PDF refresh + Audit GetMint + Bonus features

> Gros sprint nuit. Lis AGENTS_RULES.md à la racine du repo AVANT toute action.
> Build vert obligatoire à la fin (`npm run build`).
> Aucun push GitHub. Aucun deploy Edge Function. Aucune migration appliquée sans signal.

## Objectifs (ordre de priorité)

1. **PDF white-paper** : refresh avec la nouvelle charte (Tech crisp, brand-500, font-medium, etc.)
2. **Audit visuel SaaS vs HP** : identifier les écarts résiduels et les fixer page par page
3. **Page comparative Geoperf vs GetMint** : recap features complet, public, en page Markdown→HTML
4. **Bonus features** (si temps) : annual pricing -20%, trial 14j, onboarding wizard

---

## 1. PDF white-paper refresh

### Contexte

Le rapport sectoriel est généré par `supabase/functions/render_white_paper/index.ts` qui produit du HTML stylé puis envoyé à PDFShift. Le HTML actuel utilise l'ancien design (font-serif Editorial, navy/amber/cream). Il doit ressembler à la **HP actuelle** : Tech crisp, brand-500 (vert), font-medium tracking-tight, fonts Inter + JetBrains Mono.

### Tâches

- Lis `supabase/functions/render_white_paper/index.ts` (fichier ~30k lignes, attention à la taille)
- Identifie les sections HTML stylées : header, hero, charts SVG, tables companies, sections sources, footer
- Refait le CSS inline pour utiliser :
  - Couleurs : `#22C55E` (brand-500 = vert HP), `#0A0A0B` (text ink), `#F8F9FA` (bg surface), `#E5E7EB` (border DEFAULT), `#F59E0B` (amber accent), navy `#0F172A` reservé aux sections "dark"
  - Typo : `font-family: Inter, sans-serif` partout, `font-weight: 500` pour H1/H2 (font-medium au lieu de serif), `letter-spacing: -0.025em` (tracking-tight), `font-family: "JetBrains Mono"` pour les eyebrows / code / tabular numbers
  - Eyebrow : `font-mono uppercase` `letter-spacing: 0.15em` `font-size: 11px` `color: brand-500`
  - H1 : `font-size: 48-56px font-weight: 500 letter-spacing: -0.025em line-height: 1.05 color: ink`
  - Sections rythmées par `bg-surface` / `bg-white` / `bg-navy text-white`
  - Cards : `bg-surface border border-DEFAULT` au lieu de `border-navy`
  - Charts SVG : couleur primaire `brand-500`, labels en `JetBrains Mono`
- Conserve les charts SVG existants (geo distribution, top 10 visibility, etc.) mais avec les nouvelles couleurs
- Préserve la mécanique upload Storage + signed URL 7j

### Test

- Modifie le fichier mais NE DEPLOY PAS la fonction. Fred deploy manuellement.
- Si possible : exporte le HTML rendu sur un report existant (ex `asset-management-2026`) en local pour vérifier le rendu sans deploy. Sinon, signale ça dans le recap.

---

## 2. Audit visuel SaaS vs HP

### Référence

- `landing/app/page.tsx` = HP, modèle absolu
- `DESIGN_SYSTEM.md` = tokens

### Méthodologie

Pour chaque page SaaS :
1. Compare visuellement les **patterns** utilisés vs ceux de la HP (eyebrow, H1, cards, buttons, sections, transitions)
2. Note les **écarts** : composant X manque, couleur Y hardcodée, transition Z absente, etc.
3. Fix sur place

### Pages à auditer en priorité

```
/app/dashboard
/app/brands
/app/brands/[id]
/app/brands/[id]/sentiment
/app/brands/[id]/alignment
/app/brands/[id]/content
/app/brands/[id]/sources
/app/brands/[id]/by-model
/app/brands/[id]/by-prompt
/app/brands/[id]/citations-flow
/app/brands/[id]/topics
/app/brands/[id]/setup
/app/brands/[id]/snapshots/[sid]
/app/billing
/app/settings
/app/team
/app/integrations
/app/api-keys
/app/alerts
/admin/saas
/admin/saas/users/[id]
/admin/saas/snapshots
/admin/saas/cron
/saas
/saas/faq
/saas/api-docs
```

### Checklist par page

- [ ] Header sticky utilise le pattern HP (`sticky top-0 z-40 border-b border-DEFAULT bg-white/85 backdrop-blur-md`)
- [ ] Eyebrow font-mono tracking-eyebrow
- [ ] H1/H2 font-medium tracking-tight (pas font-serif)
- [ ] Cards via composant `<Card>` ou pattern `bg-surface border border-DEFAULT`
- [ ] Buttons via `<Button>` (pas de inline `<button className="bg-navy">`)
- [ ] Inputs avec `focus:border-brand-500 focus:ring-brand-500/30`
- [ ] Pas de hex hardcodé
- [ ] Hover transitions `transition-colors duration-150 ease-out`

### Reporting

Documente chaque page auditée + les fixes appliqués dans `saas/docs/SPRINT_S13_AUDIT_UX.md` (en plus du recap général).

---

## 3. Page comparative Geoperf vs GetMint

### Objectif

Page publique `/saas/vs-getmint` qui présente honnêtement (mais à notre avantage) la comparaison Geoperf vs GetMint.

### Contenu (pas exhaustif, à compléter)

#### Hero
- Eyebrow : "COMPARAISON HONNÊTE"
- H1 : "Geoperf vs GetMint — quel choix pour votre marque ?"
- Sous-titre : "Geoperf est l'alternative française à GetMint. Plus accessible, plus spécialisée, avec un funnel intégré (étude sectorielle → audit → SaaS)."

#### Tableau de comparaison features

| Feature | GetMint | Geoperf |
|---|---|---|
| **Prix** | $99-$499/mois | 79-799€/mois (-20% en moyenne) |
| **Marché cible** | US/UK enterprise | France + Europe francophone |
| **Langues prompts** | EN principal | FR principal (à venir : EN) |
| **LLMs supportés** | 9 (ChatGPT, Claude, Gemini, Perplexity, Mistral, Grok, Copilot, Meta AI, AI Overviews) | 7 (mêmes - AI Overviews/Copilot à venir) |
| **Topics par marque** | 1-9 selon plan | 1-∞ selon plan |
| **Sentiment analysis** | ✅ | ✅ |
| **Brand Alignment** | ✅ (alignment) | ✅ |
| **Content Studio** | ✅ | ✅ |
| **Citations Flow Sankey** | ✅ | ✅ |
| **Multi-seats** | 2-∞ | 1-∞ |
| **API publique** | Enterprise only | Agency (799€) |
| **Webhooks Slack/Teams** | ✅ | ✅ (Growth+) |
| **Publisher Network** | ✅ (150k+ médias) | ❌ (à investiguer via aggrégateur) |
| **Études sectorielles** | ❌ | ✅ (lead-magnet gratuit) |
| **Audit consulting** | ❌ | ✅ (offre 500€ ponctuelle) |
| **Support FR** | ❌ | ✅ |
| **Hébergement UE** | ❌ (US) | ✅ (Frankfurt, RGPD-friendly) |

#### Section "Pourquoi choisir Geoperf"

3 colonnes :
1. **Spécialisation française** : prompts en FR, secteurs FR (asset mgmt, banque retail, fintech B2B), partenaires FR
2. **Prix accessibles** : 20% moins cher en moyenne, pas de markup enterprise pour le tier de base
3. **Funnel intégré** : étude gratuite → audit consulting → SaaS récurrent. GetMint vend juste le SaaS.

#### Section "Quand choisir GetMint"

Honnêteté : on ne ment pas.
- Si vous êtes une enterprise US/UK avec budget illimité
- Si vous avez besoin du Publisher Network 150k+ médias
- Si vous voulez de la doc/UI 100% en anglais

#### CTA final

"Essayez Geoperf gratuit — Free permanent, sans CB"

### Implémentation

- Page Next.js `landing/app/saas/vs-getmint/page.tsx`
- Style : Tech crisp (eyebrow brand-500, H1 font-medium, sections rythmées par bg variants)
- Composants : `<Section>`, `<Eyebrow>`, `<Card>`, `<Button>` du design system
- Responsive (la table devient scrollable horizontalement en mobile)
- SEO : `<meta>` description ciblée "alternative française GetMint", canonical URL
- Lien depuis `/saas` (header de section ou footer "Comparaisons")

### Recap features détaillé

En plus de la page publique, génère un fichier `saas/docs/FEATURES_VS_GETMINT.md` avec :
- Liste exhaustive des features GetMint (tirées du screenshot Fred + recherche docs publiques)
- Liste exhaustive des features Geoperf (tirées du code repo)
- Gaps à fermer (priorité 1, 2, 3)
- Strengths Geoperf (ce qu'ils n'ont pas)
- Recommandations stratégiques (focus, pas tout faire)

---

## 4. Bonus features (si temps)

### 4.1 Tarif annuel -20%

**DB** :
```sql
ALTER TABLE saas_subscriptions
  ADD COLUMN billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual'));
```

**Stripe** : créer 4 nouveaux prices yearly (ex: `geoperf_starter_yearly` à 758€/an au lieu de 79×12=948€). NE PAS créer dans Stripe ce sprint, juste documenter dans le recap les commandes Fred à exécuter.

**Frontend** :
- Toggle Monthly/Yearly sur `/saas` et `/app/billing`
- Display prices yearly en cas de switch + "économisez X€/an"

### 4.2 Trial 14 jours sur Pro

**Stripe** : `trial_period_days: 14` au moment du `create_checkout_session` pour le tier Pro.

**Frontend** :
- Bouton "Essayer Pro 14 jours gratuit" sur `/app/billing` au lieu de "Passer Pro"
- Banner "Vous êtes en trial Pro, X jours restants" si trial actif

### 4.3 Onboarding wizard 3 étapes

Page `/app/onboarding` (step 1: brand info, step 2: competitors, step 3: confirm + first snapshot)

Si user free vient de s'inscrire et n'a pas encore de marque, redirect auto vers `/app/onboarding`.

Composant `<WizardStepper>` avec progress bar.

### 4.4 Empty states actionnables

Pour chaque page SaaS qui a un EmptyState, vérifier que le CTA est cliquable et fait quelque chose de concret :
- "Pas encore de snapshot" → bouton "Lancer mon 1er snapshot" (POST refreshBrand)
- "Pas encore de marque" → "Ajouter ma 1ère marque" (lien /app/brands/new)
- "Pas de recos" → "Forcer la régénération" (POST regenerate)

### 4.5 (Skip si peu de temps) Doc API Swagger interactive

Remplacer `/saas/api-docs` statique par une page avec spec OpenAPI YAML + swagger-ui-react try-it-out.

---

## Conventions strictes

- AGENTS_RULES.md respecté à la lettre
- Aucune opération git destructive
- Aucun push, aucun deploy
- Migrations via apply_migration MCP UNIQUEMENT (pas SQL editor manuel)
- Build vert obligatoire à la fin
- Bash heredoc pour fichiers >150 lignes (mount Windows)
- Si .gitignore drama UTF-16 réapparaît : ne touche pas, signale
- Si index git corrompu : signale, ne tente pas de fix

## Reporting au matin

Crée `saas/docs/SPRINT_S13_RECAP.md` avec :

### Section 1 — PDF refresh
- Avant/après (lignes de CSS modifiées, sections refondues)
- Test de rendu si possible (ou commande pour Fred)

### Section 2 — Audit UX
- Lien vers `saas/docs/SPRINT_S13_AUDIT_UX.md`
- Stats : pages auditées, fixes appliqués, écarts résiduels

### Section 3 — Page vs GetMint
- Path frontend
- Lien vers `saas/docs/FEATURES_VS_GETMINT.md`
- Capture des sections (en texte si tu peux pas faire de screenshot)

### Section 4 — Bonus livrés
- Liste des bonus tentés et leur status

### Section 5 — Reste à faire pour Fred
- Push frontend
- Deploy Edge Functions modifiées
- Stripe yearly prices à créer
- Tests E2E suggérés

### Section 6 — `git status --short` final

---

Bon courage. C'est un gros sprint, environ 4-6h. Méthodique, pas de panique.
