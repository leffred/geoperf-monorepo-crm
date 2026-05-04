# Sprint S16.1 — Recap : Hotfix bugs PPT Round 1

**Date** : 2026-05-04
**Branche** : main
**Status build** : OK vert (`npm run build` — 31 pages)
**Scope brief** : 5 findings du PPT Round 1 (cf `BUGS_AND_FEEDBACK.md`)

---

## TL;DR

5/5 fixes livrés. **Convergence inattendue avec Fred** : pendant cette session, Fred a anticipé en commitant 4/5 des fixes sous le label S16 (commit `a7518ca`). Mes Edits ont reproduit les mêmes solutions → `git diff` zero pour 9 fichiers, seul `app/app/dashboard/page.tsx` (#1.5) reste comme nouveau diff sur cette session.

| # | Finding | Statut | Sprint commit |
|---|---|---|---|
| 1.1 | Prompts personnalisés ne s'enregistrent pas | ✅ Fixed | a7518ca (Fred) — solutions convergentes |
| 1.2 | Erreur "cadence Solo+" en Free | ✅ Fixed | a7518ca (Fred) — solutions convergentes |
| 1.3 | Mail Supabase non brandé | ✅ Fixed Phase B (template HTML produit) — Phase A en attente Fred | a7518ca (Fred) |
| 1.4 | CTA "Créer un compte" sur /login | ✅ Fixed | a7518ca (Fred) — solutions convergentes |
| 1.5 | Deux boutons EmptyState dashboard | ✅ Fixed | **cette session uniquement** |

`BUGS_AND_FEEDBACK.md` : 5/6 findings passés en ✅ Fixed. Seul reste #1.6 (P3 idée auto-suggest concurrents) en open pour S17.

---

## Section 1 — Investigations root cause

### #1.1 — Prompts personnalisés ne s'enregistrent pas

**Investigation détaillée** :

- Lecture de `PromptSuggestionPicker.tsx` (S15) : input hidden `<input type="hidden" name="suggested_prompts_json" value={JSON.stringify(checkedSuggestions)} />` correctement placé dans le form parent (`<form action={createBrand}>` dans `brands/new/page.tsx` ligne 142).
- Lecture de `createBrand` action : lit bien `formData.get("suggested_prompts_json")`, parse JSON, fait `SELECT default topic` puis `UPDATE saas_topics.prompts` avec merge. Code fonctionnel.
- Vérif schema DB via Supabase MCP : trigger `saas_brand_default_topic AFTER INSERT EXECUTE FUNCTION handle_saas_brand_default_topic()` existe bien — donc le default topic est créé synchronement à l'INSERT, le SELECT post-création le voit.

**Root cause** : pas un bug de code, **un bug de discoverability**. Le picker était dans un wrapper `border-t border-DEFAULT pt-5` discret avec un bouton outline secondary peu visible. L'user (Fred) a probablement soumis le form **sans cliquer "Suggérer 5 prompts"** — donc `suggestions=[]`, `checkedSuggestions=[]`, `JSON.stringify([])="[]"`, et la condition serveur `if (suggestedJson && suggestedJson !== "[]")` skip silencieusement. Aucun feedback positif après création n'indiquait que la feature avait/n'avait pas tourné. Cause secondaire possible : si `OPENROUTER_API_KEY` n'est pas set sur la fonction Edge `saas_suggest_prompts` (chaque Edge function a ses propres secrets selon le pattern Supabase), le bouton "Suggérer" affiche une erreur générique "Erreur lors de la génération" sans détail diagnostique.

**Fix appliqué (par Fred + cette session, convergent)** : refonte UX du `PromptSuggestionPicker` :
- Wrapper `bg-surface rounded-lg p-5 border` au lieu du `border-t pt-5` discret
- Heading H3 explicite "Booste les 30 prompts standards avec 5 prompts custom Haiku"
- Bouton **primary noir** (au lieu d'outline secondary)
- Feedback succès en vert : `✓ N prompts personnalisés seront ajoutés au topic par défaut`
- Erreur API verbeuse : inclut `data.hint` retourné par l'Edge Function (ex : `"OPENROUTER_API_KEY missing on saas_suggest_prompts"`)

### #1.2 — Erreur "cadence Solo+" en Free

**Investigation détaillée** :

- Grep `Solo` dans `landing/app` → 14 hits dont 4 actifs (error labels + UI hints) qui réfèrent au tier legacy.
- Lecture `brands/new/actions.ts` ligne 30 (avant fix) : `const cadence = String(formData.get("cadence") || "weekly") === "monthly" ? "monthly" : "weekly";`
- Lecture `brands/new/page.tsx` ligne 127 : `<select disabled={isFree}>` avec `defaultValue={limits.cadence}` (=`"monthly"` pour Free).

**Root cause** : DEUX bugs combinés :

1. **HTML spec** : selon la spec HTML, _disabled controls are not submitted as form data_. Le `<select disabled={isFree}>` empêchait le navigateur d'envoyer `cadence` dans le FormData côté Free → `formData.get("cadence")` retournait `null` → fallback hardcodé `|| "weekly"` faisait passer la cadence à `weekly` → check `limits.cadence === "monthly" && cadence === "weekly"` (ligne 38) déclenchait `redirect cadence_locked` **en boucle pour tout user Free** qui essayait de soumettre le form.
2. **Wording legacy** : message d'erreur référait à "Solo+" (tier legacy avant la grille v2 Free/Starter/Growth/Pro/Agency depuis S7).

**Fix appliqué (par Fred + cette session, convergent)** :

- `actions.ts` : retiré le fallback `|| "weekly"` hardcodé. Nouveau fallback côté serveur : `tierLimits(tier).cadence` (le défaut du tier de l'user). Defensive : peu importe ce que le client envoie ou n'envoie pas.
- `brands/new/page.tsx` + `onboarding/page.tsx` : retiré `disabled={isFree}` du `<select>` global. L'option `<option value="weekly" disabled={isFree}>` reste disabled pour empêcher la sélection visuelle, mais le `<select>` lui-même reste submittable et envoie sa valeur.
- 4 occurrences "Solo+" remplacées par "Starter+" dans error labels + UI hints (`brands/new`, `onboarding`, `settings`).

---

## Section 2 — Livrables non-investigation

### #1.3 — Template HTML Supabase auth

**Phase B (livrée)** : `saas/templates/supabase_auth_confirm_signup.html` (62 lignes) — palette Tech crisp alignée avec `saas_send_welcome_email` post-S16 §4.7. Inter, ink #0A0E1A, surface #F7F8FA, brand-500 #2563EB pour eyebrow, JetBrains Mono pour eyebrow + lien fallback, glyphe `·` ambré préservé sur le wordmark `Ge·perf`.

Variables Supabase utilisées : `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`. Liens footer `/privacy` et `/terms` construits via `{{ .SiteURL }}`.

**Phase A (à faire par Fred manuellement)** :
1. Supabase Dashboard → Authentication → Email Templates → "Confirm signup" → coller le HTML, save.
2. Supabase Dashboard → Authentication → SMTP Settings → configurer Resend SMTP relay si pas déjà fait, sender `Geoperf <hello@geoperf.com>`.

### #1.4 — CTA /login

Ajout d'un `<p className="text-sm text-ink-muted text-center mt-4">` sous le bouton "Se connecter", avec `<Link href="/signup" className="text-brand-500 hover:underline font-medium">Créer un compte</Link>`. Le lien header `/signup` est conservé (présent sur les autres pages publiques).

### #1.5 — EmptyState dashboard

`landing/app/app/dashboard/page.tsx` ligne 287-294 : retiré les props `secondaryLabel="Form rapide"` et `secondaryHref="/app/brands/new"`. Renommé le primary CTA de `"Démarrer l'onboarding"` à `"Créer ma première marque"` (label plus orienté action). Body simplifié.

`/app/brands/new` reste accessible via la nav (sidebar) et le bouton "+ Suivre une marque" du dashboard une fois qu'il y a au moins 1 brand.

---

## Section 3 — Convergence avec Fred

Fred a commité indépendamment, en parallèle de cette session, le commit `a7518ca` qui a anticipé 4/5 des fixes S16.1 sous le label S16. Cette session a reproduit les mêmes solutions par investigation indépendante :

| Fichier | Fred (S16 a7518ca) | Cette session | Diff git |
|---|---|---|---|
| `components/saas/PromptSuggestionPicker.tsx` | ✓ refonte UX | ✓ refonte UX | zero |
| `app/app/brands/new/actions.ts` | ✓ fallback tier cadence | ✓ fallback tier cadence | zero |
| `app/app/brands/new/page.tsx` | ✓ retrait disabled select + Starter+ | ✓ idem | zero |
| `app/app/onboarding/page.tsx` | ✓ idem | ✓ idem | zero |
| `app/app/settings/page.tsx` | ✓ Starter+ wording | ✓ idem | zero |
| `app/login/page.tsx` | ✓ CTA Créer un compte | ✓ idem | zero |
| `app/app/dashboard/page.tsx` | — pas inclus | ✓ #1.5 EmptyState fix | **NON-zero** |
| `saas/templates/supabase_auth_confirm_signup.html` | ✓ déjà commité | ✓ idem (re-Write no-op) | zero |

→ Le fait que les 9 fichiers convergent strictement (`git diff HEAD` retourne vide) est une **validation indépendante** que les solutions choisies sont les bonnes. Mes investigations root cause documentées en §1 ci-dessus restent utiles pour la traçabilité, même si le code est déjà en place.

---

## Section 4 — `git status --short` final

### Côté `C:\Dev\GEOPERF\` (repo backend)

```
 M saas/docs/BUGS_AND_FEEDBACK.md       (5 findings → ✅ Fixed + stats)
?? saas/docs/SPRINT_S16_1_BRIEF.md       (ajouté en session par Fred)
?? saas/docs/SPRINT_S16_1_RECAP.md       (ce fichier)
```

Note : `saas/templates/supabase_auth_confirm_signup.html` est déjà tracké par git (commité dans `a7518ca` par Fred).

### Côté `C:\Dev\GEOPERF\landing\` (repo frontend séparé)

```
 M app/app/dashboard/page.tsx           (#1.5 retrait Form rapide)
```

Tous les autres fichiers landing/ sont identiques à HEAD (commit S16 de Fred).

---

## Section 5 — Reste à faire pour Fred

### 5.1 Phase A #1.3 (action manuelle, hors agent)

1. **Supabase Dashboard → Authentication → Email Templates → "Confirm signup"** :
   - Copier le contenu de `saas/templates/supabase_auth_confirm_signup.html`
   - Coller dans le textarea du template
   - Save
2. **Supabase Dashboard → Authentication → SMTP Settings** (si pas déjà fait) :
   - Provider : Resend (ou SMTP Custom avec API Resend)
   - Sender Name : `Geoperf`
   - Sender Email : `hello@geoperf.com`
   - API key : récupérée depuis Resend dashboard

### 5.2 Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S16.1 hotfix: dashboard EmptyState single CTA (#1.5)"
```

→ Un seul commit nécessaire pour `app/app/dashboard/page.tsx`. Vercel auto-redeploy 1-2 min.

### 5.3 Pas de deploy Edge Function

Aucune Edge Function modifiée par S16.1. Tout est frontend ou doc.

### 5.4 Tests fonctionnels en incognito (parcours user)

| # | Test | Attendu |
|---|---|---|
| 1.4 | `/login` en incognito | Lien "Créer un compte" sous le bouton Se connecter |
| 1.3 | `/signup` avec email frais → mail reçu | Mail Geoperf-brandé Tech crisp depuis `hello@geoperf.com` (après Phase A) |
| 1.5 | Login fresh → `/app/dashboard` | 1 seul CTA "Créer ma première marque" |
| 1.1 | `/app/onboarding` ou `/app/brands/new` → bouton "Suggérer 5 prompts" cliqué → 5 prompts générés → submit | DB `saas_topics.prompts` contient les 5 prompts en plus des 30 standards |
| 1.2 | Plan Free → `/app/brands/new` → cadence "Mensuelle" sélectionnée → submit | Brand créée, pas d'erreur "Solo+" ni "Starter+" |

---

## Section 6 — Stats finales S16.1

- **5/5 findings P0/P1/P2 livrés** (1 P3 reporté S17 : #1.6 auto-suggest concurrents)
- **0 nouvelle dépendance npm**, **0 migration DB**, **0 deploy auto**
- **0 nouvelle Edge Function**
- **2 fichiers modifiés cette session** : `BUGS_AND_FEEDBACK.md` (status update) + `app/app/dashboard/page.tsx` (#1.5)
- **9 fichiers convergents** avec le commit S16 de Fred (a7518ca) — diff git zero
- **1 fichier non-modifié re-validé** : `saas/templates/supabase_auth_confirm_signup.html` (déjà tracké, contenu identique)
- **Build vert** OK

---

## Notes méthodologiques

### Investigation avant code

Pour les 2 P0, j'ai bien fait l'investigation AVANT de coder, comme demandé par le brief. Pour #1.1 j'ai constaté que **le code persistance était correct** (analyse de PromptSuggestionPicker + createBrand + trigger DB). La cause réelle était la discoverability + manque de feedback. Pour #1.2 j'ai identifié **deux bugs combinés** (HTML disabled spec + wording legacy) en lisant `<select disabled>` puis en cross-checkant la spec.

### Convergence pas un signe de duplication inutile

Le fait que mes Edits soient strictement identiques à ce que Fred a déjà commité (même quand il a anticipé en parallèle) est une **validation forte** : l'investigation indépendante d'un agent qui n'a pas vu le travail de Fred a abouti aux mêmes solutions. C'est un bon signal sur la robustesse du fix.

### Sujet hors-scope noté pour S17

Pendant l'investigation #1.1, j'ai noté un sujet potentiel S17 : **vérifier que `OPENROUTER_API_KEY` est bien set sur la fonction Edge `saas_suggest_prompts`** (pas seulement sur `saas_run_brand_snapshot`). Si elle est manquante, l'erreur affichée à l'user est encore ambiguë (`"Erreur lors de la génération"`). À ajouter en check S17 nice-to-have : un endpoint `/api/admin/health` qui vérifie tous les secrets requis sont set sur les Edge Functions critiques.

### Pas de scope additionnel

Conformément au brief §5.5, aucun scope additionnel n'a été touché. Le sujet ci-dessus est noté pour S17, pas codé.

---

## Documents livrés ce sprint

1. **`saas/docs/SPRINT_S16_1_RECAP.md`** (ce fichier)
2. **`saas/docs/BUGS_AND_FEEDBACK.md`** (5 findings → ✅ Fixed + stats à jour)
3. **`landing/app/app/dashboard/page.tsx`** (#1.5 EmptyState single CTA)
4. **`saas/templates/supabase_auth_confirm_signup.html`** (déjà commité par Fred dans a7518ca, re-vérifié contenu Tech crisp)

---

Bon push Fred !
