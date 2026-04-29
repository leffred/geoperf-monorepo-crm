# Best practices pour collaborer efficacement avec moi (Claude)

> Ce doc liste ce qui rend nos sessions plus rapides et plus fiables. Basé sur ce qui a fonctionné (ou pas) sur les premières heures GEOPERF.

---

## 1. Comment me briefer

### ✅ Ce qui marche
- **Une demande = un objectif clair.** "Je veux X" plutôt que "Tu peux explorer Y et me dire quoi faire ?"
- **Spécifie le périmètre** : "front uniquement", "juste la query SQL", "pas d'envoi mail"
- **Donne le contexte business** quand c'est non-évident : "c'est pour un client EU donc RGPD strict", "on veut éviter X parce que Y"
- **"Tu as carte blanche pendant N heures"** marche très bien — précise juste le périmètre (ex: "front + backend, pas la prod") et les contraintes (ex: "pas d'envoi mail", "pas de coût > $50")

### ❌ Ce qui ralentit
- **Demandes ouvertes sans contraintes** : "Améliore le projet" sans préciser quoi → je perds 20 min à choisir la priorité
- **Pas de feedback après ma proposition** : si je propose 3 options et que tu réponds "fais", j'hésite. Dis "Option B" ou "fais le P1 d'abord"
- **Ajout de demande au milieu d'une tâche** : si je suis en train de fixer un bug et tu ajoutes "et tant que tu y es, fais aussi Z", je peux soit interrompre soit retarder. Préviens-moi : "fini le bug, ensuite Z"

### Format optimal d'une demande
```
[Sub-projet] : backend|frontend|infra
[Objectif] : Je veux X
[Périmètre] : Touche à A et B, pas C
[Contraintes] : Pas plus de Y, doit marcher avec Z
[Critère de succès] : Quand W marche, c'est bon
```

Tags optionnels : `[CODE]` (skip narratif), `[BLOCKING]` (urgent), `[RESEARCH]` (web search), `[ADMIN]` (tâche pure backend).

---

## 2. Comment me dépanner quand je plante

### Quand un workflow / API / build échoue
**Bonne approche :** copy-paste l'erreur EXACTE (texte ou screenshot). Pas besoin de reformuler — la stack trace contient tout.

```
Bonne demande : "ça plante : Error: ETIMEDOUT at fetch (line 42)"
Mauvaise : "ça marche pas"
```

### Quand un déploiement Vercel échoue
- Va dans Vercel dashboard → projet → dernier deploy → onglet "Build Logs"
- Copy-paste les **20 dernières lignes** (pas tout, pas juste "ça a échoué")

### Quand n8n exécution rouge
- Active **"Allow MCP access"** dans les workflow settings une fois
- Ensuite dis simplement "exec X plante" — je vais lire le détail moi-même via MCP

---

## 3. Anti-patterns à éviter

### Le mont Excel
Tu as un .xlsx avec 200 lignes et tu me dis "fais quelque chose". Plus efficace :
- Décris le but final ("classer par X, exporter vers Y")
- Fournis 3-5 lignes représentatives
- Dis-moi le format de sortie attendu

### Le "rien marche"
Si **plusieurs** trucs cassent, prends les un par un. Sinon je vais sauter d'un fix à l'autre sans valider.

### Les apostrophes courbes / em-dashes
PowerShell, certains outils CLI, et des shells Windows déraillent sur les caractères `'`, `—`, `«»`, `→`. Quand tu copies-colles depuis un email/Notion, vérifie. Si tu as un doute, dis-moi "y'a peut-être des chars unicode".

### Le rebranding mid-stream
Si tu changes le nom d'un projet, d'un secteur, d'un produit en cours de session, ça crée des incohérences. Préviens : "À partir de maintenant, on appelle X au lieu de Y".

---

## 4. Mes outils et leurs limites

### Ce que je peux faire seul (autonome)
- Lire/écrire fichiers du workspace
- Exécuter SQL Supabase via MCP
- Déployer Edge Functions Supabase
- Lire/exécuter workflows n8n (si "Allow MCP access" actif)
- Construire artifacts Cowork (dashboards live)
- Build/test code localement (sandbox Linux + npm)
- Web search & web fetch (avec restrictions)

### Ce que je ne peux PAS faire seul
- **Push GitHub** : pas de credentials par défaut. Solution : tu lances un script `push_update.ps1` que je prépare
- **Vercel deploy** : pas de CLI auth. Le push GitHub déclenche un redeploy auto si Vercel est branché
- **Apollo / OpenRouter / Calendly UI** : pas d'auth. Tu fais les setups initiaux
- **Modifier credentials n8n** (passwords, API keys) : seul l'UI n8n permet
- **DNS OVH** : pas d'accès. Tu fais
- **Ouvrir une fenêtre browser pour OAuth** : impossible. Tu dois faire l'auth, je récupère les keys après

### Les 3 choses qui me font perdre du temps
1. **Truncation du mount Windows** : quand j'écris un fichier > 150 lignes via Write/Edit tool, parfois il tronque. Je dois passer par bash heredoc.
2. **Caractères unicode dans PowerShell** : `'` `—` cassent les scripts. Je tente de générer en pur ASCII.
3. **Schemas API tiers qui changent** (Apollo, n8n splitInBatches v3, etc.) : je découvre par essai-erreur. Si tu as la doc à portée, partage-la.

---

## 5. Mémoire vs contexte

### Ce qui est dans ma mémoire persistante (entre sessions)
- `active_sprint.md` — état courant du sprint, ce qui change
- `architecture.md` — système stable, workflow IDs, conventions
- `contacts.md` — Fred profile, credentials, services
→ chargés automatiquement via `MEMORY.md` index

### Ce qui n'est PAS dans ma mémoire (à recharger)
- État précis du code à l'instant T
- Dernières exécutions n8n
- Données live Supabase
- Conversations passées au-delà du résumé

### Comment me faire gagner 5 min en début de session
- "Hier on a fini sur X, on enchaîne sur Y" → je sais quoi reprendre
- Pointer un fichier précis : "regarde `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` ligne 42"
- Si tu sens que ma mémoire est confuse, dis-moi de relire `MEMORY.md`

---

## 6. Checkpointing — quand committer / sauvegarder

### Patterns qui marchent
- **Après chaque feature majeure** : push GitHub (déclenche Vercel deploy)
- **Après chaque migration SQL** : c'est appliqué live ET dans `supabase/migrations/`
- **Après chaque deploy Edge Function** : version+1 dans Supabase, code source à jour dans le repo
- **Après chaque fix workflow n8n** : je mets à jour le JSON local + tu re-importes (jusqu'à ce qu'on ait un meilleur sync)

### Anti-pattern
Faire 5 changements interdépendants sans push. Si une seule étape plante en prod (Vercel build fail, Supabase migration fail), tu ne sais plus laquelle. Push après chaque changement testé.

---

## 7. Coûts à surveiller

| Service | Coût actuel | Limite à connaître |
|---|---|---|
| OpenRouter (4 LLM extract + Haiku synthesis) | ~$0.20 / LB | $50 / mois si 250 LBs |
| PDFShift | Gratuit jusqu'à 250 PDF/mois | $9/mois pour 1000 PDF ensuite |
| Supabase | Gratuit | Stockage 1 GB / Storage / DB total |
| Vercel | Gratuit (Hobby) | 100 GB bandwidth / mois |
| Apollo | Basic 59€/mois | 2560 crédits/mois |
| n8n Cloud | $20 (Starter) | 10k executions / mois |
| Calendly | (à choisir) | Free OK, Pro $10 si besoin webhooks avancés |

**Budget mensuel prod réaliste** : ~$120-150 quand Phase 2 active.

---

## 8. Quand me dire "stop" / "reviens en arrière"

- Si je propose une migration SQL qui te semble risquée → "stop, vérifie d'abord X"
- Si je me lance dans une refacto qui dépasse ton intention → "trop, fais juste Y"
- Si je ré-explique 3 fois la même chose → "ok j'ai compris, fais"
- Si je sors du périmètre → "concentre-toi sur Z"

Je ne suis pas vexé. Plus tu cadres, plus on avance vite.

---

## 9. CLAUDE.md à la racine du projet

`CLAUDE.md` (root, <100 lignes) est le point d'entrée de chaque session. Il pointe vers les sub-CLAUDE :
- `docs/CLAUDE-backend.md` quand le sujet est backend (LB / contacts / sequences / CRM / cron)
- `landing/CLAUDE.md` quand le sujet est frontend
- `STATE_OF_PROJECT.md` pour audit complet

Ne mets PAS dans CLAUDE.md root : du code, des secrets, des éléments qui changent vite (status sprint → c'est dans la mémoire `active_sprint.md`).

---

## 10. Session Boundaries — quand splitter, comment garder le contexte propre

> Notre conversation Cowork accumule du contexte à chaque tour (system reminders, tool results, file reads). Au-delà de ~2-3h, le ratio signal/bruit chute fort et chaque tour coûte plus cher en tokens. Cette section dit quand fermer une session et comment recharger la suivante avec le minimum d'overhead.

### Quand splitter (déclencheurs)

- Un sous-objectif vient d'être atteint (feature pushée, workflow validé, doc rédigée)
- Tu changes de sous-projet (frontend → backend → infra)
- Tu sens que je deviens verbeux ou que je redemande des choses déjà discutées
- La session dure depuis 2h+
- Tu veux passer à un mode différent (coding sprint focused → besoin de Claude Code CLI plutôt que Cowork)

### Comment splitter proprement

1. **Avant de fermer** : me demander un récap < 200 mots avec ce qui a été fait + ce qui reste. Je le mets dans un fichier `SESSION_<date>_<topic>.md` à la racine GEOPERF.
2. **Mettre à jour `active_sprint.md`** dans la mémoire — c'est le fichier qui me chargera l'état au prochain démarrage.
3. **Fermer la conversation Cowork** (ou laisser dormir). Pas besoin de "save", c'est persistant.
4. **Ouvrir une nouvelle conversation** — j'aurai un fresh context window + memory à jour + CLAUDE.md compact + sub-CLAUDE thématique selon le brief.

### Pattern hybride Cowork × Claude Code

| Type de session | Outil | Durée | Quand |
|---|---|---|---|
| Strategy / décisions produit | Cowork | 60-90 min | Brainstorm, roadmap, arbitrages |
| Feature build (multi-fichier, plusieurs MCP, dashboard) | Cowork | 120-180 min, splitter ensuite | Tu pilotes en parallèle du coding |
| Coding sprint (1 feature, scope fermé, < 2h) | **Claude Code CLI** | 30-90 min | Refactor isolé, fix de bug, build feature pure-coding |
| Quick analytics (1 question DB, pas de pilotage) | Subagent `data:analyze` ou direct SQL | 5-20 min | "Combien de prospects ont download cette semaine ?" |

### Tagging des messages (réduit la verbosité)

- `[CODE]` : réponse pure technique, skip narratif/justifications
- `[BLOCKING]` : urgent, pas de suggestion de refactor
- `[RESEARCH]` : besoin de web search + synthèse
- `[ADMIN]` : tâche Supabase/n8n/Apollo pure, pas d'artifact

### Règles d'or

1. **Une tâche dépasse 5 min de mon contexte → sub-agent**, pas thread principal
2. **Output > 200 lignes → fichier**, pas message chat (sauf récap)
3. **Quand je propose "splitter ?" → toujours dire oui** (c'est un signal d'économie)
4. **Friday ritual** : tour de `MEMORY.md` + `active_sprint.md` pour supprimer le périmé

---

## 11. TLDR — les 5 trucs à retenir

1. **Brief court mais avec contraintes** : objectif + périmètre + critère de succès, taggé `[backend|frontend|infra]`
2. **Copy-paste les erreurs exactes** plutôt que reformuler
3. **Donne moi le détail avec des références** : "regarde le fichier X ligne Y" vaut 10 min de search
4. **Active "Allow MCP access" partout** (n8n, Supabase, GitHub) — ça me donne autonomie
5. **Splitter régulier** : session > 2h ou changement de sous-projet → nouveau thread
