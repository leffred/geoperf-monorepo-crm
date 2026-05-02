# Sprint S12 — Refonte UX globale (uniformiser SaaS = HP)

> Objectif : le SaaS doit ressembler **visuellement** à la HP `app/page.tsx` (design Tech crisp).
> Couleurs, typo, transitions, composants, layouts. Tout uniformisé.
> **Scope strict** : pages SaaS uniquement. Pas de touche à la sidebar `<AppSidebar />` (sera reprise dans un sprint suivant).

## Lecture obligatoire AVANT toute action

1. `AGENTS_RULES.md` (racine repo) — règles strictes
2. `DESIGN_SYSTEM.md` (racine landing/) — référence design system "Tech crisp"
3. `landing/app/page.tsx` — la HP, **modèle de référence absolu** pour le visuel
4. `landing/components/ui/Header.tsx`, `Footer.tsx`, `Section.tsx`, `Button.tsx`, `Card.tsx`, `Eyebrow.tsx`, `Badge.tsx`, `Input.tsx` — palette de composants à utiliser dans le SaaS
5. `landing/CLAUDE.md` — conventions frontend
6. `saas/docs/SPRINT_S10_RECAP.md` — état actuel SaaS

## Référence visuelle = la HP

Tout pattern visible sur `app/page.tsx` doit être appliqué aux pages SaaS :

- **Eyebrow** : `<p className="font-mono text-xs uppercase tracking-[0.2em] text-navy-light">CRÉER UN COMPTE</p>` (ou utiliser `<Eyebrow>`)
- **H1** : `<h1 className="font-serif text-5xl md:text-6xl tracking-tight leading-[1.05] text-navy mb-6">` (ou typo équivalente du DESIGN_SYSTEM)
- **Sections avec bg variants** : alterner `bg-cream`, `bg-white`, `bg-navy text-white` entre sections pour rythmer
- **Card style** : utiliser le composant `<Card>` de `components/ui/Card.tsx` (pas de inline div bg-white border)
- **Button style** : `<Button variant="primary" />` au lieu de `<button className="bg-navy ...">`
- **Transitions** : `transition-colors duration-200` ou `transition-all duration-150 ease-out` sur tous hover states
- **Borders** : `border-l-2 border-amber pl-4` pour les blocs accent (vu sur HP)
- **Spacing** : `py-16 md:py-24` pour les sections, `gap-6` pour les grids, `space-y-4` pour les listes verticales
- **Couleurs** : palette navy / amber / cream / ink / ink-muted exclusivement (jamais de hex hardcodé)

## Pages à uniformiser (par ordre de priorité)

### Priorité 1 — Pages utilisateur principales (jour 1-2)

| Route | Action |
|---|---|
| `/app/dashboard` | Refondre layout : eyebrow "TABLEAU DE BORD", H1 serif, KPI cards en `<Card>`, panels Top 10 stylés HP |
| `/app/brands` | Hero section style HP + grid de marques en `<Card>` avec hover state |
| `/app/brands/new` | Form style HP (Input, Button du design system, Eyebrow "+ NOUVELLE MARQUE") |
| `/app/brands/[id]` | Page hero avec brand name H1 serif + sections rythmées (Stats / Évolution / Recos / Alertes / Topics) |
| `/app/brands/[id]/sentiment` | Section bg-cream + KPI cards Card + donut centré, légende Eyebrow |
| `/app/brands/[id]/alignment` | Idem |
| `/app/brands/[id]/content` | Idem |
| `/app/brands/[id]/sources` | Idem |
| `/app/brands/[id]/by-model` | Idem |
| `/app/brands/[id]/by-prompt` | Idem |
| `/app/brands/[id]/citations-flow` | Idem (Sankey conservé mais wrapper Card) |
| `/app/brands/[id]/topics` | Liste topics en Cards style HP |
| `/app/brands/[id]/setup` | Form style HP |
| `/app/billing` | Refondre les 5 cartes pricing au style HP (highlight tier en bg-navy text-white) |
| `/app/settings` | Form style HP + sections séparées par eyebrow |
| `/app/team` | Liste members en Cards |
| `/app/integrations` | Idem |
| `/app/api-keys` | Idem |
| `/app/alerts` | Liste alerts en Cards avec severity color border-l-2 |

### Priorité 2 — Pages auth (jour 2)

| Route | Action |
|---|---|
| `/signup` | Eyebrow "CRÉER UN COMPTE", H1 serif, form en Card style HP |
| `/login` | Idem |
| `/auth/callback` | (route handler, pas de visuel) |

### Priorité 3 — Pages admin (jour 3)

| Route | Action |
|---|---|
| `/admin/saas` | KPI cards style HP, charts wrappers Card, sections rythmées |
| `/admin/saas/snapshots` | Tableau filtrable style HP |
| `/admin/saas/users/[id]` | Page detail style HP |
| `/admin/saas/cron` | Idem |

### Priorité 4 — Pages publiques (jour 3)

| Route | Action |
|---|---|
| `/saas` | Refonte alignée avec HP (déjà similaire mais à harmoniser) |
| `/saas/faq` | Style cohérent |
| `/saas/api-docs` | Style cohérent (mais code blocks restent monospace) |

## Composants spécifiques

### À garder tels quels

- **`<AppSidebar />`** — Fred refait après. NE PAS TOUCHER.
- **Charts Recharts** (`<BrandEvolutionChart>`, `<SentimentDonut>`, `<CitationsSankey>`, `<AdminCharts>`) — fonctionnels, juste les wrapper dans `<Card>` propres
- **`<TierBadge>`, `<BrandPill>`, `<KPICard>`** — déjà cohérents, juste vérifier qu'ils utilisent les classes du design system

### À refondre

- **`<EmptyState>`** : style HP (eyebrow + H2 serif + body + CTA Button primary)
- **`<Skeleton>`** : couleurs cohérentes (cream pulse au lieu de gris)
- **`<RecommendationList>`** : Cards avec border-l-2 amber, eyebrow "RECOMMANDATION"
- **`<AlertBanner>`** : Card avec severity border-left coloré

## Méthodologie suggérée

Pour chaque page :
1. Lire la version actuelle
2. Identifier les éléments à transposer (titres, cards, buttons, forms, lists)
3. Remplacer par les patterns/composants HP
4. Vérifier que les liens internes restent fonctionnels (pas casser les Server Actions)
5. `npm run build` régulier pour ne rien casser

Prends la HP comme inspiration mais sans copier-coller bêtement : les pages SaaS ont leur logique métier (filtres, formulaires, données dynamiques) qu'il faut préserver.

## Conventions strictes

- Aucun push GitHub
- Aucun deploy Edge Function
- Aucune migration DB (S12 est purement frontend)
- AUCUNE OPÉRATION GIT (lecture seule via `git status` autorisée)
- Bash heredoc pour fichiers >150 lignes (mount Windows truncation)
- Si `.gitignore` drama UTF-16 réapparaît : NE TOUCHE PAS, signale dans recap
- Si index git corrompu : signale, ne tente pas de fix
- npm install pour nouvelles deps OK, mais aucune dep n'est nécessaire normalement
- **Préfère** : composants existants `components/ui/*` sur shadcn

## Critères d'acceptation par page

Une page est "uniformisée" quand :
- ✅ Eyebrow font-mono uppercase tracking-[0.2em] présente où pertinent
- ✅ H1/H2 utilisent la typo HP (font-serif tracking-tight)
- ✅ Toutes les Cards utilisent le composant `<Card>` du design system
- ✅ Tous les boutons utilisent `<Button variant="primary|secondary">`
- ✅ Aucun hex couleur hardcodé (tout via classes Tailwind du config)
- ✅ Hover states + transitions cohérentes
- ✅ Spacing rythmé (py-12/16/24, gap-6/8)
- ✅ Sections alternant bg-cream / bg-white pour rythmer

## Reporting au matin

Recap dans `saas/docs/SPRINT_S12_RECAP.md` avec :
- ✅ Pages refaites (paths + transformations principales par page)
- ⚠️ Pages skippées et raison
- 🐛 Bugs trouvés (notamment si Header/Footer/AppSidebar API a dû être étendue)
- 🎨 Décisions design notables (genre "j'ai harmonisé toutes les Cards mais 2 cas spéciaux ont gardé leur layout custom car X")
- 📊 Stats : nb pages modifiées, lignes ajoutées/supprimées
- ▶️ Prochaines étapes Fred (push, tests visuels en prod, à valider en prod)
- `git status --short` final

## Brands de test pour validation visuelle

- AXA : `e6497bcb-cfa1-4958-8f9f-4907c05a1d54` (asset-management)
- Allianz France : `400d6112-168a-43be-916c-b33048526b77` (insurance)
- Qonto : `9f92f178-...` (fintech-b2b)

Tu peux tester chaque page avec ces brand_ids pour vérifier le rendu visuel.

## Bonus si temps

- **Animations subtiles** : `animate-fade-in` sur les pages, `animate-stagger` sur les listes (max 100ms delay entre items)
- **Hero variant pour les pages SaaS** : header avec breadcrumb + titre + actions à droite (cohérent avec HP qui a son hero)
- **Scrollbar customisée** : `scrollbar-thin scrollbar-thumb-navy/20`

Si pas le temps, skip et documente dans recap.

Bon courage. Build vert obligatoire à la fin.
