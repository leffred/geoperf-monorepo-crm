# Sprint S12 — Refonte UX globale (Recap)

**Date** : 2026-05-01
**Branche** : main
**Status build** : ✅ vert (`npm run build` OK)
**Scope** : pages SaaS + auth + admin + landings publiques uniformisées au design system "Tech crisp" (référence : `app/page.tsx`).

---

## TL;DR

40 fichiers refondus (32 pages + 8 composants saas) au design system `components/ui/*`. Tous les hex hardcodés sont remplacés par les tokens Tailwind (`ink`, `brand-500`, `surface`, `success`, `warning`, `danger`). Les eyebrows passent en `font-mono uppercase tracking-eyebrow text-brand-500`, les H1 en `font-medium tracking-tight text-ink`. Les Cards utilisent `<Card>` du DS, les boutons `<Button>`. L'AppSidebar n'a pas été touchée.

---

## Méthodologie appliquée

### Patterns systématiques (utilisés sur toutes les pages)

| Avant | Après |
|---|---|
| `<p className="font-mono text-xs tracking-widest text-navy-light uppercase">` | `<Eyebrow>` |
| `<h1 className="font-serif text-3xl text-navy">` | `<h1 className="text-3xl md:text-4xl font-medium tracking-tight text-ink leading-tight">` |
| `<Section tone="cream">` | `<Section tone="white">` (rythmé alterné avec `tone="surface"`) |
| `bg-white p-5` (carte plate) | `bg-white rounded-lg border border-DEFAULT shadow-card p-5` ou `<Card variant="default">` |
| `<button className="bg-navy text-white px-4 py-2 ...">` | `<Button variant="primary" size="md">` |
| `<button className="bg-amber text-navy ...">` | `<Button variant="primary">` (brand-500) |
| `bg-cream` (form input) | `bg-white border border-DEFAULT focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30` |
| `border-l-2 border-amber bg-amber/15` | `border-l-2 border-l-warning bg-white` (semantic) |
| `bg-green-100 text-green-800` (status badge) | `bg-emerald-50 text-success rounded-md font-mono uppercase tracking-eyebrow` |
| `bg-red-50 text-red-900 border-red-600` | `bg-white border-l-2 border-l-danger text-danger` (alert blocks) |
| Inline `style={{ background: "#042C53" }}` (TopPanel bars) | Classes Tailwind (`bg-brand-500`) |
| `text-navy-light` | `text-brand-500` (eyebrows) ou `text-ink-subtle` (hints) |
| `text-navy` | `text-ink` |
| `text-ink-muted` | conservé (token est resté) |
| `divide-navy/5` | `divide-DEFAULT` |
| `border-navy/15` | `border-DEFAULT` (ou `border-strong` au hover) |

### Status badges harmonisés

Dans toutes les tables (snapshots, subscriptions, cron) :
```ts
const STATUS_BADGE = {
  completed/succeeded/active: "bg-emerald-50 text-success",
  failed: "bg-red-50 text-danger",
  running: "bg-brand-50 text-brand-600",
  default: "bg-surface text-ink-muted",
};
// Wrapped en : font-mono text-[10px] uppercase tracking-eyebrow rounded-md px-2 py-0.5
```

---

## Pages refaites (par priorité)

### Priorité 1 — Pages utilisateur principales (18 pages)

**Dashboard & marques**
- `app/app/dashboard/page.tsx` — Eyebrow "Tableau de bord" + H1 + KPI Stats `dark`/`default` + grid de marques en `<Link>` rounded-lg shadow-card hover:shadow-cardHover. EmptyState refondu (CTA Button DS).
- `app/app/brands/page.tsx` — Header + tableau wrappé `rounded-lg border shadow-card` + colonnes thead `font-mono uppercase tracking-eyebrow`. EmptyState DS.
- `app/app/brands/new/page.tsx` — Form via `<Card>` + inputs design system (`focus:ring-brand-500/30`) + Button DS.

**Brand detail**
- `app/app/brands/[id]/page.tsx` — Hero refondu, breadcrumb via Eyebrow, navigation rounded-md, KPI Stats, history table cohérente, status badges harmonisés.
- `app/app/brands/[id]/setup/page.tsx` — Form Card + alerts ronds-coins.
- `app/app/brands/[id]/snapshots/[sid]/page.tsx` — Stats + cost table + recos cards + responses `<details>` rounded-lg.

**Sub-pages brands (9)**
- `sentiment/page.tsx` — Donut wrap Card, history bars `bg-success`/`bg-warning`/`bg-danger` (plus d'inline hex), Top 5 articles bordés border-l-2 sémantique.
- `alignment/page.tsx` — GaugeBar avec classes Tailwind, gaps cards en grid lg:cols-2 avec borders sémantiques, themes inattendus en pills brand/warning.
- `content/page.tsx` — Form génération en Card, draft articles wrappés Card, Button DS.
- `sources/page.tsx` — Filter chips DS (active = bg-ink), table cohérente.
- `by-model/page.tsx` — Citation rate barres avec classes (`bg-brand-500`, `bg-emerald-500`, etc.), plus de hex inline.
- `by-prompt/page.tsx` — Tri chips + table des prompts avec heatmap LLM en `bg-brand-500`/`bg-brand-50`.
- `citations-flow/page.tsx` — Sankey wrappé Card, "Comment lire" en Card.
- `topics/page.tsx` — Liste topics en Cards rounded-lg, default = border-l-brand-500.
- `topics/new/page.tsx` — Form Card.
- `topics/[topicId]/page.tsx` — Stats + chart + recos cohérents.

**Pages compte (6)**
- `billing/page.tsx` — 5 cartes pricing : tier actuel = bg-ink, recommended = ring-2 ring-brand-500. Buttons DS.
- `settings/page.tsx` — Form Card + alerts cohérents.
- `team/page.tsx` — Membres en Card avec divide-DEFAULT, invitations en Card avec liens monospace.
- `team/invite/page.tsx` — Form Card.
- `integrations/page.tsx` — Form Card + intégrations en Cards individuelles + Button DS pour test/toggle/delete.
- `api-keys/page.tsx` — Affichage one-shot key dans bg-brand-50 box, Button "Documentation API" en secondary, table refondue.
- `alerts/page.tsx` — Filter chips DS, alert articles en rounded-lg shadow-card border-l-2 par sévérité, Button DS.

### Priorité 2 — Auth (2 pages)
- `signup/page.tsx` — Card form, Eyebrow conditionnel selon contexte (Invitation / Étude / Créer un compte), bg-white global.
- `login/page.tsx` — Card form, magic link section avec Eyebrow.

### Priorité 3 — Admin (4 pages)
- `admin/saas/page.tsx` — Stats KPI via `<Stat>`, navigation tabs avec hover:border-brand-500. Tables cohérentes.
- `admin/saas/snapshots/page.tsx` — Form filtres en Card, Button DS, pagination avec rounded-md.
- `admin/saas/users/[id]/page.tsx` — Hero breadcrumb, Stats grid, sections rythmées (white / surface alterné), tables uniformisées.
- `admin/saas/cron/page.tsx` — Stats + table cron runs avec status badges DS, code blocks bg-surface.

### Priorité 4 — Pages publiques (3 pages)
- `saas/page.tsx` — Hero `tone="dark"` avec H1 en `text-balance`, Features grid en `<Card>` (pattern `01/02/03`), Differentiators en Cards. Pricing 5 cards avec highlight = bg-ink. CTA finals en `<Section tone="dark">`.
- `saas/faq/page.tsx` — H1 + FAQ articles en Card border-l-2 brand-500, CTA dark final.
- `saas/api-docs/page.tsx` — Endpoints en Cards avec method badges (`bg-ink` pour GET, `bg-brand-500` pour POST), code blocks bg-surface, CTA Agency en dark.

---

## Composants saas refondus (8 fichiers)

| Composant | Changements |
|---|---|
| `EmptyState.tsx` | Eyebrow optionnel + H2 `font-medium tracking-tight text-ink` + Button DS. Tone `white`/`surface` au lieu de `cream`. SVG conservés. |
| `Skeleton.tsx` | `bg-navy/10` → `bg-surface-2`. Card skeleton wrap rounded-lg border shadow-card. |
| `RecommendationList.tsx` | Cards rounded-lg shadow-card border-l-2 par priorité (danger/warning/ink). Sources autorité en bordure + `border-t border-DEFAULT`. |
| `AlertBanner.tsx` | Border-l sémantique (`border-l-danger`/`border-l-warning`/`border-l-ink/15`), bg-white, hover:bg-surface. |
| `KPICard.tsx` | Variants : default = white border shadow-card, highlight = bg-ink, amber = bg-brand-50 border-brand-500/20. Animation count-up conservée. |
| `TopPanel.tsx` | `colorClass` au lieu de `color` hex. Bars en `bg-brand-500` par défaut. Hover:bg-surface sur les rows linkées. |
| `TopicSelector.tsx` | Active = bg-ink, default = border-l-brand-500, "+ Topic" = bg-brand-50 hover:bg-brand-500. |
| `TierBadge.tsx` | Free=surface, Starter=brand-50, Growth=brand-500, Pro=ink, Agency=ink+amber border (préservé pour effet "premium"). |

### Composants conservés tels quels
- `AppSidebar.tsx` (NE PAS TOUCHER, sera repris dans un sprint suivant)
- `BrandEvolutionChart.tsx`, `SentimentDonut.tsx`, `CompetitorMatrix.tsx`, `Sparkline.tsx`, `AdminCharts.tsx`, `BrandPill.tsx`, `CitationsSankey.tsx` (charts Recharts, internes inchangés — wrappés en Card côté pages)

---

## Décisions design notables

1. **`tone="cream"` reste valide** dans `<Section>` (alias mappé sur `bg-surface` dans le composant). Aucune migration nécessaire des appels existants côté pages publiques (about, contact, sample, merci, privacy, terms).
2. **`font-serif` reste utilisé** sur certaines pages publiques non-touchées par le sprint (about, contact, sample) — le tailwind config aliase `font-serif` sur Inter, donc visuellement c'est identique à `font-medium`. Pour les pages SaaS refondues, j'ai systématiquement remplacé par `font-medium tracking-tight` qui est le pattern de la HP.
3. **Status badges harmonisés** dans toutes les tables (snapshots, subscriptions, cron, drafts, alerts) : format `font-mono text-[10px] uppercase tracking-eyebrow rounded-md px-2 py-0.5` avec semantic colors. Cohérence garantie sur les 8+ tables refaites.
4. **Sidebar admin** : la navigation `/admin/saas/*` utilise `border-b-2 border-transparent hover:border-brand-500` (pattern HP) — anciens `hover:border-amber` remplacés.
5. **Hero `tone="dark"`** sur `/saas` et `/saas/api-docs` finaux : utilise `bg-ink text-white` + spans `text-amber` ponctuels pour l'identité Geoperf (le glyphe `·` ambré reste signature visuelle).
6. **TierBadge Agency = bg-ink text-amber border-amber/40** : préservé volontairement (effet "premium" cohérent avec branding initial). Tous les autres tiers passent en palette brand-500.
7. **Form inputs** : pattern `bg-white border border-DEFAULT hover:border-strong focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 rounded-md` réutilisé via constante `FIELD_INPUT` (string) plutôt que d'extraire un composant — cohérent avec la philosophie DS qui privilégie les classes Tailwind sur l'abstraction.
8. **`<Stat>` du DS** systématiquement adopté (au lieu de divs custom) pour les KPI cards admin — donne cohérence visuelle entre `/app/dashboard` et `/admin/saas`.
9. **Recharts charts**: contenu interne inchangé — risque de cassure de logique si touché. Wrappés `<div className="bg-white rounded-lg border shadow-card p-5">` côté pages au besoin.

---

## Stats

- **40 fichiers modifiés** (8 composants saas + 32 pages)
- **0 fichier supprimé, 0 fichier nouveau** (refonte pure)
- **0 nouvelle dépendance npm** installée
- **0 migration DB**
- **0 deploy Edge Function**
- **Build size** : `+8 B First Load JS` sur la majorité des routes (changements négligeables, pas de regression bundle)
- **Nouvelle route Sankey conservée** : `/app/brands/[id]/citations-flow` = 7.02 kB (Recharts Sankey)

---

## Bugs & limitations relevés

| # | Description | Action |
|---|---|---|
| 1 | `<AppSidebar />` toujours en style legacy (navy/amber) — non touchée par le brief. | À reprendre dans sprint dédié, pour cohérence finale. |
| 2 | Pages `/about`, `/contact`, `/merci`, `/privacy`, `/terms`, `/sample`, `/profile/[domain]` toujours en style legacy (font-serif, bg-cream, text-navy). Hors scope S12 (zone agent design selon `AGENTS_RULES.md` §1). | Signaler à l'agent design pour migration cohérente. |
| 3 | `/portal` (route customer Stripe), `/admin` (Outreach), `/admin/login`, `/admin/profiles`, `/admin/prospects/[id]` non refondues — hors scope SaaS du brief. | À traiter ultérieurement si besoin. |
| 4 | `Card` du DS supporte encore les variants legacy `highlight` et `bordered` (alias). Les pages refondues utilisent `default`/`dark`/`accent`/`surface` en priorité. | Pas d'action — alias gardés pour éviter de casser les imports tiers. |
| 5 | Le composant `Stat` ne supporte que `default | dark | highlight`. Pas de variant "amber" — le `KPICard` saas garde son variant "amber" dédié pour les cas où on veut un highlight bleu plus doux (bg-brand-50). | OK, pas d'action. |

---

## Validation visuelle suggérée (à faire en prod par Fred)

Brands de test :
- AXA : `e6497bcb-cfa1-4958-8f9f-4907c05a1d54`
- Allianz France : `400d6112-168a-43be-916c-b33048526b77`
- Qonto : `9f92f178-...`

Routes prioritaires à tester :
- `/app/dashboard` — Login Pro/Agency, vérifier KPI cards, EmptyState si compte vide.
- `/app/brands/<axa-id>` — Hero + Stats + Chart + RecommendationList + AlertBanner alignés.
- `/app/brands/<axa-id>/sentiment` — Donut + bars `bg-success`/`bg-warning`/`bg-danger`.
- `/app/brands/<axa-id>/citations-flow` — Sankey wrappé Card.
- `/app/billing` — 5 cartes pricing, tier actuel = bg-ink.
- `/app/integrations` — Form + Cards intégrations + buttons DS.
- `/app/api-keys` — Si Agency : génération clé + affichage one-shot dans bg-brand-50 box.
- `/signup` (avec `?source=etude` et `?invitation_token=xxx`) — variants Eyebrow/H1.
- `/saas` (public) — Hero dark, features cards, pricing 5 cards.
- `/admin/saas` — KPI Stats, navigation tabs.

---

## Git status final (40 fichiers)

```
 M app/admin/saas/cron/page.tsx
 M app/admin/saas/page.tsx
 M app/admin/saas/snapshots/page.tsx
 M app/admin/saas/users/[id]/page.tsx
 M app/app/alerts/page.tsx
 M app/app/api-keys/page.tsx
 M app/app/billing/page.tsx
 M app/app/brands/[id]/alignment/page.tsx
 M app/app/brands/[id]/by-model/page.tsx
 M app/app/brands/[id]/by-prompt/page.tsx
 M app/app/brands/[id]/citations-flow/page.tsx
 M app/app/brands/[id]/content/page.tsx
 M app/app/brands/[id]/page.tsx
 M app/app/brands/[id]/sentiment/page.tsx
 M app/app/brands/[id]/setup/page.tsx
 M app/app/brands/[id]/snapshots/[sid]/page.tsx
 M app/app/brands/[id]/sources/page.tsx
 M app/app/brands/[id]/topics/[topicId]/page.tsx
 M app/app/brands/[id]/topics/new/page.tsx
 M app/app/brands/[id]/topics/page.tsx
 M app/app/brands/new/page.tsx
 M app/app/brands/page.tsx
 M app/app/dashboard/page.tsx
 M app/app/integrations/page.tsx
 M app/app/settings/page.tsx
 M app/app/team/invite/page.tsx
 M app/app/team/page.tsx
 M app/login/page.tsx
 M app/saas/api-docs/page.tsx
 M app/saas/faq/page.tsx
 M app/saas/page.tsx
 M app/signup/page.tsx
 M components/saas/AlertBanner.tsx
 M components/saas/EmptyState.tsx
 M components/saas/KPICard.tsx
 M components/saas/RecommendationList.tsx
 M components/saas/Skeleton.tsx
 M components/saas/TierBadge.tsx
 M components/saas/TopPanel.tsx
 M components/saas/TopicSelector.tsx
```

Aucun fichier nouveau créé. Aucun fichier supprimé. Aucune opération git effectuée (lecture seule via `git status` uniquement).

---

## Prochaines étapes Fred

1. **Push frontend** :
   ```powershell
   cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
   powershell -ExecutionPolicy Bypass -File .\push_update.ps1
   ```
   Vercel auto-redeploy en 1-2 min.

2. **Test visuel en prod** sur les 10 routes prioritaires listées plus haut. Idéalement avec une session connectée Pro ou Agency sur AXA pour avoir des données.

3. **Sprint S13 suggéré** : refonte AppSidebar pour cohérence finale (seul élément du SaaS resté en navy/amber legacy). Hors scope S12 par décision du brief.

4. **Hors scope S12 — à signaler à agent design** : pages `about`, `contact`, `merci`, `privacy`, `terms`, `sample`, `profile/[domain]` toujours en style legacy. Pas d'urgence (zone d'ownership différente per `AGENTS_RULES.md`).

5. **Bonus skippé** : animations `animate-fade-in`, `animate-stagger`, scrollbar customisée. Faisable en sprint suivant si Fred trouve l'UX pas assez "vivante".

---

## Décision méthodologique : pourquoi `font-medium tracking-tight` au lieu de `font-serif`

Le `tailwind.config.ts` aliase `font-serif` sur Inter (sans-serif) — donc visuellement les deux donnent le même rendu. **MAIS** le DESIGN_SYSTEM.md pousse explicitement vers `font-medium tracking-tight` (avec letter-spacing négatif `tracking-tightish` -0.015em sur les valeurs numériques) qui est le pattern utilisé sur la HP. C'est plus aligné avec la "Tech crisp direction" :

- Plus court / plus lisible.
- `font-serif` est sémantiquement faux sur du Inter (developer confusion).
- Cohérent avec `Header.tsx`, `Card.tsx`, `Section.tsx` qui n'utilisent jamais `font-serif`.

Pour les pages SaaS refondues, j'ai donc systématiquement migré. Les pages publiques non-touchées par S12 (about, contact, etc.) gardent leur `font-serif` legacy en attendant l'agent design.
