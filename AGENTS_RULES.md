# AGENTS_RULES.md — Règles pour tous les agents qui bossent sur Geoperf

> **À LIRE EN PREMIER avant toute session de travail.**
> Maintenu par Fred. Toute modif de ces règles passe par Fred uniquement.

## Pourquoi ce document existe

Geoperf a souvent plusieurs agents qui tournent en parallèle (Claude Code CLI, Claude Cowork, agent design, etc.). Sans règles claires, les agents s'écrasent (cf. drama du 2026-04-30 où un agent a unstage tous les nouveaux fichiers en touchant à git, et le push a foiré). Ces règles évitent ça.

---

## 1. Zones d'ownership

Chaque agent a une **zone exclusive** qu'il modifie. Sortir de sa zone = demander à Fred d'abord.

| Zone | Owner type | Chemins |
|---|---|---|
| **SaaS backend** | CC CLI Sprint S* | `landing/app/app/*`, `landing/app/admin/*`, `landing/app/signup/*`, `landing/app/login/*`, `landing/app/auth/*`, `landing/lib/saas-auth.ts`, `landing/middleware.ts`, `landing/components/saas/*`, `supabase/functions/saas_*`, `supabase/migrations/*saas*`, `saas/*` |
| **Design system + pages publiques** | Agent design | `landing/components/ui/*`, `landing/app/page.tsx`, `landing/app/about/*`, `landing/app/contact/*`, `landing/app/merci/*`, `landing/app/privacy/*`, `landing/app/sample/*`, `landing/app/terms/*`, `landing/app/saas/*` (marketing, hors `/app/saas` admin), `landing/app/globals.css`, `landing/tailwind.config.ts`, `DESIGN_SYSTEM.md` |
| **Reporting / lead-magnet** | CC CLI ou n8n humain | `n8n/*`, `prompts/*`, `pdf-generator/*`, `supabase/functions/render_white_paper`, `supabase/functions/generate_white_paper`, autres migrations non-saas |
| **Outreach / Apollo** | Manuel ou Apollo MCP | n8n workflow Apollo, tables `prospects` / `prospect_events` / `tracking_token` |

**Composants partagés** (`Header`, `Footer`, `Button`, etc.) : si un agent SaaS a besoin de modifier un composant UI, il **demande à Fred** au lieu de toucher directement. Inverse pour l'agent design qui voudrait modifier une page SaaS.

**Fichiers communs sensibles** (à ne PAS modifier sans Fred) :
- `package.json`, `package-lock.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.mjs`
- `.gitignore`, `.gitattributes`, `.git/*`
- `landing/middleware.ts` (sauf agent SaaS qui l'a expressément en charge)
- `CLAUDE.md`, `AGENTS_RULES.md` (ce fichier)

---

## 2. Interdictions git absolues

Aucun agent ne doit jamais exécuter ces commandes :

- ❌ `git push` — Fred pousse, point.
- ❌ `git rm`, `git rm -r` — n'efface jamais de fichier en mode tracké
- ❌ `git reset --hard`, `git reset HEAD` — laisse l'index tranquille
- ❌ `git clean -fd`, `git clean -fdx` — supprime fichiers untracked, dangereux
- ❌ `git checkout main`, `git checkout <autre-branche>` — change pas de branche
- ❌ `git stash`, `git stash pop` — sauf si Fred le demande explicitement
- ❌ `git rebase`, `git merge` — Fred merge à la main
- ❌ `git config` — modif de config locale = grand n'importe quoi
- ❌ `git add` global (`git add -A`, `git add .`) — préfère ajouts ciblés ou laisse Fred faire

**Ce qui est autorisé** :
- ✅ `git status` (lecture)
- ✅ `git log`, `git diff`, `git show` (lecture)
- ✅ `git ls-files`, `git ls-tree` (lecture)
- ✅ Modifier les fichiers physiquement avec ses outils (Write, Edit, bash heredoc)

**Le pattern correct** : l'agent modifie les fichiers, Fred fait `git status` à la fin et add/commit/push.

---

## 3. Interdictions filesystem absolues

- ❌ Toucher à `.git/`, `.git/objects/`, `.git/index`, `.git/refs/`
- ❌ Modifier `node_modules/` ou `.next/` ou `out/`
- ❌ Supprimer `package-lock.json` (toujours `npm install` proprement)
- ❌ Créer des fichiers `.bak`, `.old`, `.orig` sans demander (utilise git pour les versions)
- ❌ Renommer ou déplacer des fichiers existants sans signaler explicitement

---

## 4. Workflow recommandé (chaque session)

```
1. LIRE
   - AGENTS_RULES.md (ce fichier)
   - CLAUDE.md (root)
   - landing/CLAUDE.md ou docs/CLAUDE-backend.md selon ta zone
   - saas/SPEC.md si tu travailles sur le SaaS
   - Le brief spécifique de la session (ex: SPRINT_S7_BRIEF.md)

2. VÉRIFIER L'ÉTAT INITIAL
   - git status (lecture seule, pour voir l'état du repo)
   - Si l'état est weird (AD, conflits, fichiers en D inattendus), STOP et dis-le à Fred

3. TRAVAILLER
   - Modifier les fichiers UNIQUEMENT dans ta zone d'ownership
   - Utilise les outils Write/Edit (ou bash heredoc pour fichiers >150 lignes)
   - Tester avec `npm run build` régulièrement (pour la zone frontend)
   - Tester les SQL via apply_migration MCP (pour la zone DB)

4. NE PAS COMMIT/PUSH
   - Laisser tous les changements dans le working tree
   - Fred fait git add/commit/push à la main

5. RECAP
   - Écrire un fichier saas/docs/SPRINT_*_RECAP.md ou équivalent
   - Inclure : fichiers modifiés (path + rôle), bugs trouvés, prochaines étapes
   - Inclure le `git status --short` final pour que Fred voie l'état
```

---

## 5. Checklist obligatoire en fin de session

Avant de rendre la main à Fred, l'agent doit :

- [ ] Confirmer que `npm run build` passe (si frontend touché)
- [ ] Confirmer qu'aucune Edge Function n'a été déployée sans validation
- [ ] Confirmer qu'aucune migration n'a été appliquée en prod sans validation
- [ ] Lister explicitement TOUS les nouveaux fichiers créés (paths complets)
- [ ] Lister explicitement TOUS les fichiers modifiés
- [ ] Inclure `git status --short` dans le recap
- [ ] Lister les variables d'env / secrets nouveaux nécessaires
- [ ] Lister les commandes de deploy/test à faire par Fred

Sans ce recap, Fred peut rater des fichiers (cf. drama du 2026-04-30 où Eyebrow.tsx + TopicSelector.tsx + 14 autres fichiers n'ont pas été pushés car pas listés clairement).

---

## 6. Cas d'usage / FAQ

**Q : Mon code a besoin d'un nouveau composant UI partagé. Je le crée moi-même ?**
A : Non. Si c'est un composant pour ta zone SaaS, mets-le dans `components/saas/`. Si c'est un composant générique réutilisable, demande à l'agent design (via Fred) de le créer dans `components/ui/`.

**Q : Mon code a besoin de modifier un import dans un fichier d'une autre zone (ex: ajouter un Link dans Header) ?**
A : Demande à Fred. Il décidera si tu peux toucher ou si l'autre agent doit faire la modif.

**Q : Je vois un bug évident dans une zone qui n'est pas la mienne. Je le fix ?**
A : Non. Tu signales dans le recap, Fred ou l'autre agent fix ensuite.

**Q : Le `git status` montre des fichiers en D que je n'ai pas supprimés.**
A : STOP. Ne fais rien. Dis-le à Fred. C'est probablement un drama git d'une session précédente.

**Q : J'ai vraiment besoin de faire `git rm` ou `git reset` ?**
A : Non, jamais. Si tu pense en avoir besoin, c'est un signal que la situation est anormale → demande à Fred.

**Q : Je veux installer un nouveau package npm.**
A : Demande à Fred. C'est une décision projet, pas une décision agent.

**Q : Comment savoir quelle est ma zone précisément ?**
A : Section 1 ci-dessus. Si pas clair pour ta tâche, demande à Fred avant de commencer.

---

## 7. Sanctions en cas de non-respect

Aucune (tu es un agent, pas un employé). Mais Fred révoque ton accès et redémarre une session propre depuis zéro. Donc tu perds tout ton contexte. Mieux vaut respecter.

---

## 8. Historique des incidents

| Date | Incident | Fix |
|---|---|---|
| 2026-04-30 | Agent design + CC CLI en parallèle. Le `.git/index.lock` est resté pendant un push, et `git add -A` a unstage les nouveaux fichiers (Eyebrow, TopicSelector, dossiers team/topics/auth/accept). Push incomplet → Vercel build cassé. Fix manuel par Fred avec `git add -f` explicite par fichier. | AGENTS_RULES.md créé pour éviter récidive. |

---

> Toute modif de ce fichier passe par Fred. Pas de PR auto sur ce fichier.
