# Sprint S16.1 — Hotfix : Bugs PPT Round 1

**Date brief** : 2026-05-04
**Branche cible** : `main`
**Auteur** : Fred (préparé avec Claude/Cowork le 2026-05-04 après livraison S16 et constat que les 6 findings du PPT n'avaient pas été inclus dans le brief S16 originel)
**Effort estimé** : 1 session Claude Code courte (60-90 min)
**Pré-requis** : S16 mergé localement (build vert). Lecture rapide de `BUGS_AND_FEEDBACK.md` Round 1.

---

## 1. Pourquoi ce mini-sprint

Fred a fait sa première session de tests post-S15 en incognito et a identifié 6 findings (cf `BUGS_AND_FEEDBACK.md`) dont **2 P0 critiques** qui cassent le parcours signup → 1ère brand en plan Free. Ces findings devaient être inclus dans S16 mais le brief originel a été lancé avant que les edits d'intégration soient finis.

**S16.1 est un hotfix dédié** qui ne traite QUE les findings PPT. Pas de feature, pas de scope additionnel. Court, surgical, mergeable indépendamment de S16.

---

## 2. Périmètre

### In scope (5 findings, dans cet ordre)

1. 🚨 **#1.1** Prompts personnalisés ne s'enregistrent pas (`/app/brands/new`)
2. 🚨 **#1.2** Erreur "cadence hebdo réservée Solo+" en plan Free
3. 🔴 **#1.3** Mail Supabase post-signup non brandé
4. 🟠 **#1.4** Pas de CTA "Créer un compte" sur `/login`
5. 🟠 **#1.5** Deux boutons redondants sur `/app/dashboard` EmptyState

### Out of scope

- ❌ #1.6 auto-suggest concurrents (reporté S17 comme prévu)
- ❌ Toute amélioration tangentielle découverte pendant le sprint (à noter dans le recap pour S17)

---

## 3. Livrables

### 3.1 #1.1 Prompts personnalisés ne s'enregistrent pas

**Bug rapporté** : "Les prompts personnalisés ne fonctionnent pas (j'ai bien rempli nom/catégories mais ça ne marche pas)"

**Investigation à faire en premier** : lire les fichiers ci-dessous et identifier la rupture exacte avant de coder.

- `landing/app/app/brands/new/page.tsx` — UI form, savoir comment le composant `PromptSuggestionPicker` (livré S15) renvoie les prompts cochés
- `landing/app/app/brands/new/actions.ts` — server action `createBrand`, savoir si elle reçoit bien les prompts cochés et les persiste dans `saas_topics.prompts`
- Schéma `saas_topics` : la colonne `prompts` est-elle un JSONB array ? Quel format attendu (objets `{id, category, template}` ou strings) ?

**Hypothèses probables** :
- A) Le composant `PromptSuggestionPicker` n'est pas dans la balise `<form>` donc ses inputs ne sont pas dans le `FormData` du submit
- B) La server action `createBrand` reçoit la donnée mais n'écrit pas la column `prompts` dans `saas_topics` (oubli d'INSERT)
- C) Le format n'est pas compatible (string[] envoyé mais object[] attendu)

**Fix** : selon ce que l'investigation révèle. Documenter la cause root dans le recap.

**Test** : créer une brand avec 3 prompts perso cochés → vérifier `SELECT prompts FROM saas_topics WHERE brand_id = '<new>';` retourne bien les 3 prompts en plus des 30 par défaut (ou en override, selon la logique métier choisie en S15).

---

### 3.2 #1.2 Erreur "cadence hebdo réservée Solo+" en plan Free

**Bug rapporté** : "Quand je valide (plan Free) j'ai l'erreur : *La cadence hebdomadaire est réservée aux plans Solo et plus*. alors que l'option mensuelle est bien activée dans le formulaire."

**Indice fort** : le mot **"Solo"** dans le message d'erreur. **Solo n'existe plus dans la nomenclature des plans depuis S13** — on est passé à `Free / Starter / Growth / Pro / Agency`. Donc le code qui génère ce message est probablement obsolète.

**Investigation à faire** :

- Grep `Solo` dans le repo entier — devrait remonter du code legacy à fixer
- `landing/app/app/brands/new/actions.ts` — lire la validation de `cadence` et `tier`. Comment la cadence est-elle lue depuis le form ? Est-ce que la default value est `weekly` côté serveur même quand l'user a sélectionné `monthly` ?
- `landing/lib/saas-auth.ts` ou similaire — fonction qui valide `cadence` vs `tier_limits.cadence`

**Hypothèses probables** :
- A) Default value côté serveur est `weekly`, l'override `monthly` du form n'est pas lu (radio button mal nommé, FormData clé différente, etc.)
- B) La validation utilise un dictionnaire de tiers obsolètes (ex : `["solo", "pro", "agency"]`) au lieu du nouveau (`["starter", "growth", "pro", "agency"]`), donc Free n'autorise même pas `monthly`
- C) Bug compound : le form submit `weekly` par défaut + le check tier rejette parce que Free n'est pas dans la liste

**Fix** : selon root cause. Le message d'erreur lui-même doit être mis à jour avec les bons noms de tiers (`Starter+` au lieu de `Solo+`).

**Test** : créer un compte Free fresh → `/app/brands/new` → cocher cadence "Mensuelle" → submit → vérifier que la brand est créée avec `cadence='monthly'` sans erreur.

---

### 3.3 #1.3 Mail Supabase post-signup non brandé Geoperf

**Bug rapporté** : "Je reçois un mail de Supabase pour valider la création du compte. Le mail n'est pas du tout brandé Geoperf."

**Décision Fred** : option B (template HTML custom + sender geoperf.com), pas désactiver la confirmation.

**Action mixte (config + code)** :

**Phase A — Configuration Supabase Dashboard (Fred, hors agent)** :

1. Aller dans Supabase Dashboard → Authentication → Email Templates → "Confirm signup"
2. Coller le template HTML produit par l'agent (cf phase B)
3. Vérifier que le sender est `hello@geoperf.com` (configuré via Resend SMTP relay si possible, sinon via le SMTP custom Supabase)
4. Si SMTP custom pas encore configuré : Authentication → SMTP Settings → Provider Resend → API key + sender `hello@geoperf.com`

**Phase B — Code template HTML (agent)** :

Créer un fichier `saas/templates/supabase_auth_confirm_signup.html` qui contient le template HTML brandé Tech crisp, à coller dans Supabase Dashboard.

Structure attendue (cohérent avec le digest hebdo et les emails refondus en S16 §4.7) :
- En-tête : eyebrow "Confirmation requise" en JetBrains Mono uppercase brand-500
- Titre : "Bienvenue sur Geoperf, {{ .Email }}"
- Body : "Pour activer ton compte et commencer à monitorer ta marque dans ChatGPT, Claude, Gemini et Perplexity, clique sur le lien ci-dessous."
- CTA primaire : `<a href="{{ .ConfirmationURL }}">Confirmer mon email</a>` (style btn ink)
- Petit print : "Ce lien est valable 24h. Si tu n'as pas demandé cet email, ignore-le simplement."
- Footer : Ge·perf wordmark + lien `/privacy` + lien `/terms`

**Important Supabase template syntax** : utilise `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`. Pas de `{ }` simples.

**Test** : Phase A faite par Fred → signup avec email frais → vérifier que le mail reçu est brandé Geoperf et envoyé depuis `hello@geoperf.com`.

---

### 3.4 #1.4 CTA "Créer un compte" sur /login

**Bug rapporté** : "Il faudrait sous le 'se connecter' rajouter un bouton pour créer un compte. En effet, pour le moment, cette option est en haut à droite, donc complètement hors du contexte."

**Fix** : sous le bouton "Se connecter" du form `/login`, ajouter un texte court :
```
Pas encore de compte ? <a href="/signup">Créer un compte</a>
```

Style : `text-sm text-ink-muted text-center mt-4`. Le lien en `text-brand-500 hover:underline`.

**Optionnel** : retirer le lien "S'inscrire" du header sur la page `/login` pour éviter la redondance (mais le garder sur les autres pages publiques).

**Fichier** : `landing/app/login/page.tsx`

**Test** : ouvrir `/login` en incognito → vérifier que le CTA est visible sans scroll.

---

### 3.5 #1.5 Deux boutons redondants sur /app/dashboard EmptyState

**Bug rapporté** : "Les deux boutons ont des fonctions très proches. On devrait sûrement supprimer un des deux boutons, non ?"

**Décision** : virer "Form rapide". Garder uniquement le wizard `/app/onboarding` comme CTA primaire. Si un user veut aller vite, le wizard a déjà un mode `?skip=...` (cf S13).

**Fichier** : `landing/app/app/dashboard/page.tsx` (ou le composant EmptyState dédié si extrait)

Avant :
```tsx
<EmptyState
  primary={{ label: "Démarrer l'onboarding", href: "/app/onboarding" }}
  secondary={{ label: "Form rapide", href: "/app/brands/new" }}
/>
```

Après :
```tsx
<EmptyState
  primary={{ label: "Créer ma première marque", href: "/app/onboarding" }}
/>
```

(Adapter au pattern réel du code, ces snippets sont indicatifs.)

**Test** : compte fresh sans brand → `/app/dashboard` → vérifier qu'un seul CTA est affiché et qu'il pointe vers `/app/onboarding`.

---

## 4. Plan de tests

### 4.1 Build local
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
```
Doit passer vert.

### 4.2 Tests fonctionnels (parcours user)

Tester en incognito avec un email frais (ex: `flefebvre+s16-1@jourdechance.com`) :

1. **#1.4** — Aller sur `/login` → vérifier CTA "Créer un compte" sous le form
2. **#1.3** — Click → `/signup` → créer compte → vérifier mail Geoperf-brandé reçu (Phase A doit être faite)
3. **#1.5** — Login → `/app/dashboard` → vérifier 1 seul CTA EmptyState
4. **#1.1** — `/app/onboarding` ou `/app/brands/new` → saisir nom + catégorie → cocher 3 prompts perso → submit → vérifier en DB que les prompts sont persistés
5. **#1.2** — Pendant le même flow, sélectionner cadence "mensuelle" en plan Free → submit → pas d'erreur "Solo+"

---

## 5. Contraintes (cf. `CLAUDE.md` racine)

1. Pas de migration DB attendue. Si l'investigation révèle qu'il en faut une (ex: column `cadence` mal typée), elle est sauvée AVANT `apply_migration`.
2. `npm run build` vert AVANT toute proposition de push.
3. Pas de toucher à n8n.
4. brand-500 = #2563EB.
5. **Aucun scope additionnel**. Si l'agent voit un truc à améliorer hors des 5 findings, il le note dans le recap pour S17.

---

## 6. Push et deploy

### 6.1 Frontend
```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1 -Msg "S16.1 hotfix: 2 P0 (prompts perso + cadence Free) + 3 UX (login CTA, dashboard EmptyState, Supabase auth template)"
```

### 6.2 Edge Functions
Aucune modification d'Edge Function attendue (sauf découverte pendant l'investigation #1.1 ou #1.2).

### 6.3 Action manuelle Fred après deploy
- Phase A #1.3 : coller le template HTML dans Supabase Dashboard → Authentication → Email Templates → Confirm signup
- Configurer SMTP custom Resend si pas déjà fait (Authentication → SMTP Settings)

---

## 7. Livrable de fin de sprint

`saas/docs/SPRINT_S16_1_RECAP.md` (court, format S16 abrégé) :
- TL;DR check-list 5 findings avec status livré/skipped
- Root cause de chaque P0 (savoir si on a évité d'autres bugs similaires)
- Fichiers modifiés (`git status --short`)
- Reste à faire pour Fred : Phase A #1.3 dans Supabase Dashboard
- Mise à jour `BUGS_AND_FEEDBACK.md` : passer les 5 findings en statut ✅ Fixed

---

Bon hotfix ! 🚀
