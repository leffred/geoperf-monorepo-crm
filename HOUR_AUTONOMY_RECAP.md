# Recap heure d'autonomie — 2026-04-29

## 1. Filtre pays FR — LIVRÉ

- Workflow Phase 2 sourcing (`c85c3pPFq85Iy6O2`) : ajout du param `country_filter` (string optionnel, ex `"France"`)
  - Filtre côté SQL : `c.country ILIKE '%France%'` → ne sélectionne que les sociétés FR du report
  - Filtre côté Apollo URL : `person_locations[]=france` → ne ramène que les CMOs basés en France
  - Si `country_filter` vide → comportement inchangé (tous pays)
- AdminActions UI : nouveau dropdown sourcing avec options `Tous pays / 🇫🇷 France / 🇺🇸 États-Unis / 🇬🇧 Royaume-Uni / 🇩🇪 Allemagne`
- API `/api/admin/trigger` : `country_filter` passe dans `params` automatiquement (déjà spread)
- Build local validé. Workflow publié actif.

**Données DB** : 6 companies `country = "France"` (BNP Paribas AM, Amundi, Natixis IM, etc.) + 1 mixte. Le filtre `ILIKE '%France%'` capture les deux.

## 2. Design audit — RAPPORT

Sub-agent design senior. Verdict : Editorial est bon, manque juste du polish moderne.

**Quick wins (30 min)** : 
- Hover/focus rings sur boutons (Button.tsx) + `active:scale-95`
- Sticky header avec `backdrop-blur-sm` 
- Pulse subtil sur le `·` amber du logo et eyebrows

**Plus ambitieux (2h)** :
- Fade-in scroll-triggered sur sections (CSS keyframes + IntersectionObserver vanilla)
- Skeleton loaders sur sample/[id] (Suspense + composant `SkeletonStat`)
- Hover relief sur les rangées du sample top 5

Détails complets ci-dessous.

## 3. Attio CRM plan — RAPPORT

Sub-agent solutions architect. Plan minimal viable en 6 étapes, ~5-6h Claude + 1h Fred-side.

**Mapping** : Supabase `prospects` → Attio People avec custom fields `geoperf_status`, `lead_score`, `tracking_token`, `landing_url`, `subcategory`. HOT events (download, calendly_booked, call_held, conversion) → Attio Activities.

**Architecture** : workflow n8n `geoperf_phase4_attio_sync`, trigger pg_net NOTIFY + schedule fallback 15 min, sync UNI-directionnelle Supabase → Attio.

**Pré-requis Fred** : confirmer plan Attio (Free / Plus), créer API key.

Détails complets ci-dessous.

## 4. Stratégie token reduction — RAPPORT

Sub-agent claude-code-guide. Économie potentielle : **40-60% des tokens** (~120-180k/mois).

**Actions priorisées** :
1. **[LARGE]** Compacter CLAUDE.md à 100 lignes max + splitter MEMORY.md en 3 fichiers thématiques
2. **[LARGE]** Switch partial vers **Claude Code CLI** pour le coding lourd (45-90 min closed scope), Cowork pour pilotage produit + sessions longues
3. **[LARGE]** Pattern "Session boundaries" : splitter chaque 2h max, nouveau thread = nouveau contexte propre
4. **[MEDIUM]** Skill `/consolidate-memory` Friday ritual
5. **[QUICK WIN]** Préfixer messages avec tags `[CODE]` `[BLOCKING]` `[RESEARCH]` pour adapter verbosité
6. **[QUICK WIN]** Build outputs en `.logs/builds.json` au lieu de chat
7. **[MEDIUM]** Centraliser configs n8n/Apollo en `docs/integrations.yaml` léger

**Verdict Cowork vs Claude Code** : Cowork reste outil principal (artifacts, multi-task, MCPs natifs). Claude Code = mode "coding sprint" ponctuel < 2h scope fermé.

**Pattern hybride recommandé** : Type A Strategy → Cowork 60-90min · Type B Feature Build → Cowork 120-180min splittable · Type C Debug/Refactor → Claude Code 30-60min · Type D Analytics → subagent data:analyze 20-30min.

Détails complets ci-dessous.

---

## Annexe A — Design audit complet (700 mots)

### 1. Micro-animations boutons (`Button.tsx:10-16`)
**Problème** : hover seul, pas de focus ring, pas de feedback tactile.
**Solution** :
```tsx
const VARIANTS = {
  primary: "bg-amber text-navy hover:bg-amber/90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber focus:ring-offset-2 transition-all duration-150",
  // idem pour secondary, ghost, outline-light
};
```

### 2. Fade-in scroll-triggered (`globals.css` + `layout.tsx`)
**Problème** : sections arrivent en dur, plat.
**Solution** : keyframes CSS `fadeInUp` + IntersectionObserver vanilla JS dans layout.

### 3. Hover relief sample rows (`sample/page.tsx:100`)
**Problème** : rangées Top 5 statiques.
**Solution** : `hover:shadow-lg hover:bg-cream/50 transition-shadow duration-200`

### 4. Skeleton loaders (Suspense + `SkeletonStat.tsx`)
**Problème** : data async, "—" pendant load.
**Solution** : composant skeleton avec `animate-pulse`, wrapper Suspense.

### 5. Gradient hero H1 (`page.tsx:18-21`)
**Problème** : H1 navy pur.
**Solution** : `bg-gradient-to-r from-navy to-navy-light bg-clip-text text-transparent`

### 6. Sticky header avec backdrop blur (`Header.tsx:15-17`)
**Problème** : header non sticky, user perd la nav en scroll.
**Solution** : `sticky top-0 z-50 bg-white/80 backdrop-blur-sm transition-colors duration-300`

### 7. Pulse sur dots amber
**Problème** : `·` amber statique.
**Solution** : keyframes `amberpulse 3s ease-in-out infinite` (opacity 1 → 0.6 → 1).

---

## Annexe B — Attio CRM plan complet

### Mapping Supabase ↔ Attio

| Supabase | Attio | Custom fields |
|---|---|---|
| `prospects` | `People` | geoperf_status, lead_score, landing_url, tracking_token, subcategory |
| `companies` | `Companies` | sector_tags, competitors_count |
| `prospect_events` (HOT only) | `Activities` | event_type, timestamp |
| `reports` | Custom object `LB` | report_id, category_slug, html_url |

### Workflow n8n `geoperf_phase4_attio_sync`

```
Trigger NOTIFY pg_net + schedule 15min fallback
  → Query prospects WHERE synced_at IS NULL OR updated_at > last_sync
  → Pour chaque prospect :
      ├─ GET /people search by email → existe?
      │  ├─ OUI → PATCH /people/{id} (status, lead_score)
      │  └─ NON → POST /people (create + custom fields)
      └─ UPDATE prospects.attio_record_id = response.id
  → Pour chaque HOT event → POST /activities
  → Error handling : retry 3×, log failure
```

### Étapes (5-6h Claude + 1h Fred)

1. **Fred (30 min)** : confirmer plan Attio, créer API key, valider custom fields
2. **Claude (1h)** : ajouter `attio_record_id`, `attio_synced_at`, `sync_error` à prospects + trigger NOTIFY
3. **Claude (2h)** : workflow n8n People sync (CREATE/PATCH), test 5 prospects existants
4. **Claude (45 min)** : custom fields setup + activities sync (HOT events)
5. **Fred (30 min)** : valider Attio (27 prospects importés)
6. **Claude (15 min)** : enable trigger NOTIFY production

### Pipeline Attio recommandé

- Stages : New → Engaged (LB downloaded) → Call Booked → Converted
- Smart lists par sous-catégorie

### Priorités

- **P0** : Schema + trigger NOTIFY + workflow People sync + custom fields
- **P1** : Activities sync, smart lists, job nocturne pull notes
- **P2** : Automations Attio, export Sheets, webhook Slack

---

## Annexe C — Stratégie token reduction complète

### Diagnostic des fuites

1. System reminders sur-chargés : ~8-12k tokens/tour après tour 5 = **175k tokens perdus** sur 70 tours
2. Redondances triple-couche (CLAUDE.md + MEMORY.md + system reminder)
3. Cowork artifacts read-only n'influencent pas le contexte suivant
4. Sous-agents mal utilisés (tâches courtes restent dans le thread principal)
5. Deux repos GitHub parallèles = double context

### Pattern hybride

| Type | Outil | Durée | Pattern |
|---|---|---|---|
| A Strategy/Decisions | Cowork | 60-90 min | Brief + dashboard artifact, few tool calls |
| B Feature Build | Cowork | 120-180 min splittable | 1 sous-projet, 1 file/10 min, splitter 2h max |
| C Debug/Refactor | **Claude Code CLI** | 30-60 min | cd repo, edit, build, test, push |
| D Analytics | Subagent data:analyze | 20-30 min | Fire-and-forget, zero overhead |

### Règles pratiques (à imprimer)

1. Session max 2h sans splitter
2. Output > 200 lignes = fichier, pas artifact wall-of-text
3. Tag tes messages `[CODE]` `[BLOCKING]` `[RESEARCH]` pour adapter verbosité
4. Une tâche = une MCP call (pas read+analyze+read again)
5. Friday ritual : `/consolidate-memory` skill
6. Relire CLAUDE.md mensuel
7. Quand Claude propose splitter → toujours dire oui

### Refactoring proposé pour cette semaine

- Compacter CLAUDE.md root à <100 lignes (TL;DR + Stack table + 3 commandes clés)
- Splitter MEMORY.md en `memory/active_sprint.md` + `memory/architecture.md` + `memory/contacts.md`
- Ajouter section "Session Boundaries" dans COLLABORATION_BEST_PRACTICES.md
- Tester Claude Code sur la prochaine feature pure-coding (ex : Attio phase 4)
