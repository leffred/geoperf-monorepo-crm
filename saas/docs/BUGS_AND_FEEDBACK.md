# GEOPERF — Bugs & Feedback Tracker

> Carnet de bord des retours utilisateur. Maintenir au fil de l'eau.
> Sert de source pour les briefs de sprints suivants.

---

## Légende

**Priorités** :
- 🚨 **P0** — Blocker. Empêche un parcours critique de fonctionner. Hotfix immédiat.
- 🔴 **P1** — Important. Gros impact UX/business. Prochain sprint.
- 🟠 **P2** — UX. Améliore le parcours. 1-2 sprints.
- 🟡 **P3** — Idée. Pas de friction actuelle, à explorer.

**Types** :
- 🐛 **BUG** — quelque chose ne marche pas comme attendu
- 💡 **FEEDBACK** — ça marche mais c'est sous-optimal
- ✨ **IDÉE** — nouvelle feature à creuser

**Statuts** :
- 🆕 **Open** — pas commencé
- 🛠️ **In progress** — en cours dans un sprint
- ✅ **Fixed** — corrigé, vérifié par Fred
- ⏭️ **Deferred** — reporté à plus tard avec justification
- ❌ **Won't fix** — décision de ne pas traiter

---

## Round 1 — Test Fred — 2026-05-04

**Source** : PPT `bugs et features.pptx` uploadé par Fred lors de sa première session de test en incognito post-S15.

### 🚨 Hotfixes urgents (P0)

#### 🐛 BUG #1.1 — Prompts personnalisés ne s'enregistrent pas
- **Statut** : 🆕 Open
- **Page** : `/app/brands/new`
- **Repro** : Saisir nom + catégorie + cocher des prompts perso (suggestion Haiku S15) → submit du form
- **Attendu** : prompts cochés persistés dans `saas_topics.prompts` en plus des 30 par défaut
- **Vu (Fred)** : "Les prompts personnalisés ne fonctionnent pas (j'ai bien rempli nom/catégories mais ça ne marche pas)"
- **Investigation à faire** : check `landing/app/app/brands/new/actions.ts` (server action `createBrand`) — la liste des prompts cochés est-elle dans le payload envoyé ? Est-elle persistée correctement ?
- **Sprint cible** : hotfix immédiat OU S16

#### 🐛 BUG #1.2 — Erreur "cadence hebdo réservée Solo+" en plan Free
- **Statut** : 🆕 Open
- **Page** : `/app/brands/new`
- **Repro** : Plan Free actif, sélectionner cadence "mensuelle" dans le formulaire, submit
- **Attendu** : brand créée avec cadence monthly (autorisée pour Free)
- **Vu (Fred)** : Erreur _"La cadence hebdomadaire est réservée aux plans Solo et plus"_ alors que l'option mensuelle est bien sélectionnée dans le form
- **Hypothèse** : la default value côté serveur est `weekly` et l'override `monthly` du form n'est pas lu, OU le tier limit check est buggué (mention "Solo" suggère un tier obsolète, on est en Starter/Growth/Pro/Agency depuis S13)
- **Sprint cible** : hotfix immédiat

---

### 🔴 P1 — À traiter en S16 ou avant

#### 🐛 BUG #1.3 — Mail de confirmation post-signup non brandé Geoperf
- **Statut** : 🆕 Open
- **Page** : email reçu juste après création de compte sur `/signup`
- **Repro** : signup avec un email frais
- **Attendu** : mail de bienvenue Geoperf-brandé (palette Tech crisp, sender `hello@geoperf.com`)
- **Vu (Fred)** : mail générique Supabase Auth (sender `noreply@mail.app.supabase.io`) pour confirmer l'email
- **Options proposées par Fred** :
  - A — Désactiver la confirmation email (jugé "pas idéal" par Fred)
  - B — Template HTML custom + sender geoperf.com
- **Recommandation** : option B. Configurer Supabase Dashboard → Authentication → Email Templates → "Confirm signup" → template HTML brandé Tech crisp + configurer SMTP relay via Resend (sender `hello@geoperf.com`). Ce template doit reprendre la palette du digest hebdo.
- **Sprint cible** : S16 (cohérent avec §4.7 unification palette emails)

---

### 🟠 P2 — UX, peut attendre

#### 🐛 BUG #1.4 — Pas de CTA "Créer un compte" sur /login
- **Statut** : 🆕 Open
- **Page** : `/login`
- **Repro** : visiteur arrive sur la page login depuis un lien email/marketing
- **Attendu** : un lien _"Pas encore de compte ? S'inscrire"_ visible sous le bouton "Se connecter"
- **Vu (Fred)** : le lien existe en haut à droite, _"complètement hors du contexte"_
- **Recommandation** : ajouter un texte/lien sous le bouton submit. Optionnellement le retirer du header sur la page login (redondant).
- **Sprint cible** : S16 (quick fix UX)

#### 💡 FEEDBACK #1.5 — Deux boutons redondants sur /app/dashboard EmptyState
- **Statut** : 🆕 Open
- **Page** : `/app/dashboard` (EmptyState)
- **Repro** : compte fresh sans aucune brand
- **Constat (Fred)** : 2 CTAs très proches "Démarrer l'onboarding" et "Form rapide" — _"les formulaires derrière sont quasiment les mêmes"_
- **Recommandations** :
  - Fred propose : renommer "Form rapide" → "Lancer directement", OU supprimer un des deux
  - Moi : virer "Form rapide", garder uniquement le wizard onboarding `/app/onboarding`. Si l'user veut aller vite, le wizard a `?skip=...` (cf S13). Réduit la confusion sans perdre de fonctionnalité.
- **Sprint cible** : S16 (quick fix UX)

---

### 🟡 P3 — Idées

#### ✨ IDÉE #1.6 — Auto-suggest concurrents à partir du nom de marque
- **Statut** : 🆕 Open
- **Page** : `/app/brands/new` ou `/app/onboarding`
- **Idée Fred** : à partir du nom de marque saisi, suggérer automatiquement 3-5 concurrents directs (champ pré-rempli, l'user peut modifier)
- **Pourquoi c'est intéressant** : réduit la friction d'onboarding, surtout pour les users qui ne savent pas exactement qui sont leurs concurrents directs
- **Implémentation possible** :
  - Edge Function `saas_suggest_competitors` qui appelle Haiku avec : "Donne les 5 concurrents directs de {brand_name} dans la catégorie {category}, format JSON [{name, domain}]"
  - Coût : ~$0.001 par appel (négligeable)
  - Pattern identique à `saas_suggest_prompts` livré en S15
  - Cap : 1 appel par minute par user (rate-limit)
- **Sprint cible** : S17 (groupable avec autres améliorations onboarding)

---

## Round 2 — (à venir)

> Quand tu refais une session de tests, ajoute un nouveau header `## Round 2 — Test Fred — YYYY-MM-DD` ici et reproduit la structure. Numérotation : `#2.1`, `#2.2`, etc.

---

## Statistiques (au 2026-05-04)

| Priorité | Open | In progress | Fixed | Total |
|---|---|---|---|---|
| 🚨 P0 | 2 | 0 | 0 | 2 |
| 🔴 P1 | 1 | 0 | 0 | 1 |
| 🟠 P2 | 2 | 0 | 0 | 2 |
| 🟡 P3 | 1 | 0 | 0 | 1 |
| **Total** | **6** | **0** | **0** | **6** |

---

## Notes pour les sprints suivants

**S16 — Pre-Launch Cleanup (en cours de définition)**
- À ajouter au scope : #1.1, #1.2 (P0 hotfixes), #1.3 (P1 brand mail), #1.4 + #1.5 (P2 quick fixes UX)
- Le brief S16 actuel ne couvre que les findings de l'audit `LAUNCH_READINESS_AUDIT.md`. À enrichir avec ces 5 findings avant lancement CC.

**S17 — Acquisition Launch**
- À ajouter : #1.6 (auto-suggest concurrents)
