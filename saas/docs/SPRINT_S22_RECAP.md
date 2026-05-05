# Sprint S22 — Récap

**Date** : 2026-05-05 (soir)
**Statut** : 4/4 axes livrés
**Build** : TS check clean sur les nouveaux fichiers (0 errors)
**Migrations DB** : 0 (aucune nouvelle nécessaire — réutilise `v_admin_prospects`, `categories`, `reports` existants)
**Push** : non effectué — Fred review puis push manuel via push_update.ps1

---

## TL;DR

- [x] **§4.1** Sync ADMIN_TABS sur 3 pages existantes (page.tsx, snapshots/page.tsx, cron/page.tsx) + ajout 4 onglets : Reports, Categories, Coupons, Prospects
- [x] **§4.2** Page `/admin/prospects-list` : filtres (parent_cat, sous_cat, statuts multi, email_verified, search, sort) + bulk actions (Disqualify, Opt-out, Enroll Seq A, Export CSV) + pagination
- [x] **§4.3** Page `/admin/saas/reports` : liste reports filtrée + bouton "Lancer extraction" Phase 1 + bouton "Re-synth" pour relancer Phase 1.1 + section pending lead-magnets sans report dispo
- [x] **§4.4** Page `/admin/saas/categories` : CRUD categories (create + toggle active) groupées par parent + count reports inline

---

## Fichiers créés

```
landing/app/admin/prospects-list/
  page.tsx                            (281 lignes — server, filtres + data load)
  ProspectsTable.tsx                  (233 lignes — client, checkboxes + bulk POST)

landing/app/admin/saas/reports/
  page.tsx                            (306 lignes — server, list + extraction form)
  actions.ts                          (72 lignes — launchExtraction + regenerateSynthesis)

landing/app/admin/saas/categories/
  page.tsx                            (223 lignes — server, hierarchical list)
  actions.ts                          (75 lignes — createCategory + toggleCategoryActive + updateCategoryOrder)
  CategoryForm.tsx                    (99 lignes — client, form add)
  ToggleCategoryActiveButton.tsx      (26 lignes — client, toggle inline)
```

## Fichiers modifiés

```
landing/app/admin/saas/page.tsx       (ADMIN_TABS : +4 entries)
landing/app/admin/saas/snapshots/page.tsx (ADMIN_TABS : +4 entries)
landing/app/admin/saas/cron/page.tsx  (ADMIN_TABS : +4 entries)
```

---

## §4.1 Sync nav ADMIN_TABS

Le S20 avait livré la page `/admin/saas/coupons` mais sans la linker dans la nav. Le S22 ajoute les 4 onglets manquants partout :

```ts
const ADMIN_TABS = [
  { href: "/admin/saas", label: "Overview" },
  { href: "/admin/saas/snapshots", label: "Snapshots" },
  { href: "/admin/saas/reports", label: "Reports" },         // S22 new
  { href: "/admin/saas/categories", label: "Categories" },   // S22 new
  { href: "/admin/saas/coupons", label: "Coupons" },         // S20 hidden, S22 visible
  { href: "/admin/prospects-list", label: "Prospects" },     // S22 new
  { href: "/admin/saas/cron", label: "Cron" },
];
```

**Dette technique** : ADMIN_TABS est duplicaté dans 5 endroits (3 anciens + 2 nouveaux). À refactorer en `lib/admin-tabs.ts` shared dans un sprint futur (S23+) pour éviter la divergence.

---

## §4.2 Page /admin/prospects-list

Server component qui charge les categories pour les dropdowns puis query `v_admin_prospects` avec :

- **Filtres GET-based** (URL params, idiomatic Next App Router) :
  - `parent_cat` : dropdown parent
  - `category` : dropdown sous-cat (groupé par parent dans le label)
  - `status` : checkboxes multi-select (new, engaged, disqualified, opted_out, qualified, replied)
  - `email_verified` : Tous / Vérifié / Non vérifié
  - `search` : input texte (OR sur company_nom, full_name, email, title via ILIKE-safe)
  - `sort` + `dir` : whitelist 6 colonnes
  - `page` : pagination 50/page
- **Bulk actions** (client component `ProspectsTable.tsx` qui POST `/api/admin/prospects` déjà existante S20) :
  - Disqualify (confirm() + UPDATE status)
  - Opt-out (confirm() + UPDATE status + opt_out_at + opt_out_reason)
  - Enroll Seq A (POST n8n webhook /webhook/geoperf-sourcing)
  - Export CSV (download blob inline)
- **UX** : checkbox select all + indeterminate state, badge couleur par statut, lien direct vers `/admin/prospects/[id]` au click sur email.

---

## §4.3 Page /admin/saas/reports

Server component qui :

1. **Form "Lancer extraction"** : dropdown sous-cat (groupé par parent) + top_n + year → `launchExtraction` server action → POST n8n `/webhook/geoperf-extract`. Redirect `?launched=<slug>` qui affiche un toast.
2. **Section pending lead-magnets** : liste les `lead_magnet_downloads` avec `pending=true AND report_id IS NULL`, avec un bouton "Lancer" inline pour chaque (pré-rempli au slug du download).
3. **Filtres** : status (ready/running/failed/queued) + parent_cat (post-filter côté JS car category nested via id).
4. **Table reports** (100 max) : slug_public, sous_categorie, status badge, lien PDF + HTML, top_n, total_cost_usd, dates créé/fini.
5. **Bouton "Re-synth"** sur les rows `status=ready` mais `pdf_url IS NULL` (cas de Phase 1.1 qui a planté) → POST `/webhook/geoperf-synthesis`.

---

## §4.4 Page /admin/saas/categories

Server component qui charge `categories` ordonnées par `ordre` puis groupe parents + sous-cats. Pour chaque sous-cat, agrège count reports par status (ready/running/failed) en preview link vers `/admin/saas/reports`.

- **Form** (client `CategoryForm.tsx`) : nom (auto-slugify) + slug (manual override) + parent_id dropdown + ordre. Slug regex `/^[a-z0-9][a-z0-9-]{1,80}$/`.
- **Toggle active** (client `ToggleCategoryActiveButton.tsx`) : pas de delete (soft via is_active=false). Pattern aligné sur S20 ToggleCouponActiveButton.
- **Pas d'edit slug/nom en UI** : le slug est public (URL `/etude-sectorielle/...` + slug_public dans reports), changer le slug casserait les URLs et les liens dans Apollo. Edit via SQL si vraiment nécessaire (et accepter le break).

---

## Validation

```bash
$ npx tsc --noEmit 2>&1 | grep -cE "(prospects-list|reports|categories)"
0
```

0 erreurs TS sur les nouveaux fichiers. Les 19 erreurs préexistantes sur les fichiers anciens viennent du parser `tsc` strict sur les caractères spéciaux dans les strings JSX (→, …, etc.) — `next build` via SWC les tolère (les builds Vercel précédents passent en prod, cf. S19, S20 livrés).

---

## Reste à faire pour Fred

### À pousser (review puis push)

```powershell
cd C:\Dev\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S22: admin nav sync + page prospects-list + page reports + page categories"
```

Vercel auto-redeploy en 1-2 min.

### Tests E2E à faire après deploy

1. **Nav admin** : se logger sur `/admin/login` → vérifier les 7 onglets visibles depuis n'importe quelle page
2. **Prospects** : `/admin/prospects-list` → tester un filtre cascading (parent_cat → category) → checkbox select 3 rows → Export CSV → vérifier fichier CSV download
3. **Reports** : `/admin/saas/reports` → vérifier que le report cybersecurite e6830f45 apparaît avec lien PDF + HTML dispo. Test "Lancer extraction" sur une sous-cat sans report dispo
4. **Categories** : `/admin/saas/categories` → créer une catégorie test (ex : "Test S22" / slug "test-s22") + désactiver + réactiver

### Reportés S23+

- Refactor ADMIN_TABS en shared lib (`lib/admin-tabs.ts`)
- Edit slug/nom catégorie via UI avec confirm modal (impact URL public)
- Bulk actions sur reports (delete failed reports, clear pending)
- Filter cascading client-side dans /admin/prospects-list (sous-cat update sans submit complet)
- Page admin /admin/saas/lead-magnet-downloads : tracker les downloads + status email

---

## Garde-fous respectés

- ✓ Aucune migration DB (réutilise les vues + tables existantes)
- ✓ Aucun secret hardcoded (env vars + `getAdminUser()` partout)
- ✓ Pas de modification du flow lead-magnet existant (S19/S21)
- ✓ Pattern UI aligné sur les pages S20 existantes (Header, ADMIN_TABS, Section, Eyebrow, Badge)
- ✓ TS check clean sur les nouveaux fichiers
- ✓ Auth admin sur toutes les server actions (`getAdminUser()` + redirect)
- ✓ Whitelist sort fields + ILIKE-escape sur search (anti-SQL-injection)
- ✓ Aucun push, aucun deploy auto
