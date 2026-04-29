# GEOPERF — Prérequis : accès, comptes, MCPs, skills

> **Document critique.** Ce que je dois pouvoir utiliser pour exécuter le plan. Pour chaque ligne :
> - ✅ = déjà OK, je peux l'utiliser
> - ⚠️ = à acquérir / configurer / connecter
> - 🔵 = action que je peux faire moi-même
> - 🟠 = action qui nécessite Fred (création de compte, achat, validation)

---

## 1. MCPs déjà connectés que j'utiliserai

Vérifié dans la session du 2026-04-27 :

| MCP | Usage GEOPERF | Statut |
|---|---|---|
| **Supabase** (mcp__66e2b66c…) | Création projet, migrations SQL, écriture/lecture tables, Storage pour PDF | ✅ |
| **Apollo** (mcp__9446d6f9…) | Recherche entreprises/personnes, enrichissement, sequences, contacts | ✅ |
| **Make** (mcp__ed66a5c9…) | *Pas utilisé pour ce projet* (Fred a choisi n8n Cloud) | — |
| **Gmail** (mcp__b618ffe9…) | Tests envoi mail Sprint 0, debug séquences | ✅ |
| **Calendar** (mcp__292e8d10…) | Vérifier dispos pour les calls Calendly | ✅ |
| **Claude in Chrome** | LinkedIn manuel, debug landing pages, scraping fallback | ✅ |
| **Web fetch + Web search** | Recherches concurrentielles, validation données LLM | ✅ |

---

## 2. Comptes externes à créer / configurer

| Service | Pourquoi GEOPERF en a besoin | Coût | Action | Owner |
|---|---|---|---|---|
| **n8n Cloud** | Orchestrer le workflow Phase 1 (4 LLM → consolidation → PDF) et les hooks Phase 2 | ~20€/mois plan Starter (2.5k exécutions) | Créer compte sur n8n.io | 🟠 Fred |
| **OpenRouter** | Gateway unifié vers Perplexity Sonar Pro, GPT-4o, Gemini 2.5 Pro, Claude Sonnet 4.5. Une seule API key, un seul billing. | Pay-per-use, prévoir 50$ de crédit initial | Créer compte sur openrouter.ai + recharger 50$ | 🟠 Fred |
| **Vercel** | Hosting des landing pages Next.js et des Vercel Functions (génération PDF) | Plan gratuit OK pour pilote | Créer compte ou utiliser celui existant | 🟠 Fred |
| **PhantomBuster** *(optionnel, pour scaler)* | Automatisation envoi DM LinkedIn quand on dépasse 100/jour | ~56€/mois | À décider après pilote | 🟠 Fred |
| **Calendly** | Booking des calls audit fin de séquence B | Gratuit pour 1 type d'event | Créer ou utiliser celui existant | 🟠 Fred |

---

## 3. Décisions branding / domaine à acter

Tu as dit : *« Domaine acheté »*. Il me manque le détail : 

| Question | Pourquoi ça compte | Statut |
|---|---|---|
| Quel est le domaine exact ? `geoperf.com`, `geoperf.io`, `geoperf.fr`, autre ? | URL des landing pages, configuration DNS, mail sender | 🟠 Fred à confirmer | GEOPERF.COM (enregistré chez OVH.) 
| On utilise le domaine GEOPERF dédié pour les landings, ou un sous-domaine de jourdechance.com (`geoperf.jourdechance.com`) ? | Impact identité produit vs marque mère | 🟠 Fred à arbitrer | On utilise GEOPERF.COM 
| Adresse mail expéditeur des séquences ? Ex : `fred@geoperf.com` ou `geoperf@jourdechance.com` ? | Délivrabilité, perception pro, configuration SPF/DKIM | 🟠 Fred à choisir | fred@geoperf.com (Attention, je n ai rien mis en MX / SMTP pour le moment) 
| Logo GEOPERF existant ou à créer ? | Pour PDF + landings + signature mail | 🟠 Fred à fournir | Je n'ai aucune charte graphique / Logo a date. : il faut tout créer (y compris pour la page linkedin linkedin.com/company/geoperf/ )

→ Tout ça est listé dans `DECISIONS.md`.

---

## 4. Identifiants / API keys que je devrai stocker

Je n'ai **aucun secret** en mémoire entre sessions. Pour chaque clé, deux options :
- **A)** Tu me la donnes en début de session quand on en a besoin (je la passe à Supabase Vault ou aux env vars n8n) puis je l'oublie.
- **B)** Tu la stockes une fois dans Supabase Vault (chiffré) et je la lis depuis là à chaque session. On fait option B 

Recommandation : **B pour les clés stables, A pour les tests ponctuels.**

| Clé / Secret | Où elle vit | Quand on en a besoin |
|---|---|---|
| OpenRouter API key | Supabase Vault + n8n credentials | Sprint 0 |
| Supabase Service Role key | n8n credentials | Sprint 0 |
| Apollo API key | n8n credentials | Sprint 2 |
| Vercel deploy token | GitHub Actions ou local | Sprint 1 |
| Domain registrar API *(optionnel)* | Pour automatiser DNS | Sprint 0 |
| PhantomBuster API key *(si retenu)* | n8n credentials | Sprint 4 |
Explique moi la procedure pour Supabase VAULT afin de stocker les clés 
---

## 5. Skills Cowork qui aideront

Skills déjà disponibles dans ta session, que j'utiliserai aux moments suivants :

| Skill | Usage GEOPERF |
|---|---|
| `apollo:prospect` / `apollo:enrich-lead` / `apollo:sequence-load` | Phase 2 — sourcing et chargement des séquences |
| `marketing:campaign-plan` | Affiner la stratégie de lancement de chaque livre blanc |
| `marketing:email-sequence` | Polir les séquences A et B |
| `marketing:draft-content` | Rédaction des landing pages, posts LinkedIn de promo |
| `pdf` | Skill de manipulation PDF (lecture/extraction si on doit auditer un livre blanc concurrent) |
| `data:build-dashboard` | Construire un dashboard interne de suivi (DL rate, KPIs) |
| `engineering:architecture` | Si on a besoin de formaliser une décision techno (ex: PDF lib choice) |
| `productivity:task-management` | Maintenir TASKS.md à jour en parallèle du roadmap |

---

## 6. MCPs additionnels qui seraient utiles (optionnel)

Pas critique, mais à connaître si on veut pousser :

| MCP candidat | Apport | Quand |
|---|---|---|
| **GitHub MCP** | Versionner le code Next.js + workflows n8n + migrations | Sprint 1 |
| **Vercel MCP** *(si existe)* | Déclencher les déploiements depuis chat | Sprint 1 |
| **n8n MCP officiel** *(à vérifier dispo)* | Créer/modifier les workflows directement plutôt que via interface web | Sprint 0 |
| **Stripe MCP** | Plus tard, quand on facturera les audits payants | Phase 3 |

→ Pour vérifier la disponibilité d'un MCP au catalogue, je peux utiliser `search_mcp_registry` (déjà connecté).
Oui ajoutons Git, vercel et n8n pour le moment. Verifie leur dispo. Stripe plus tard. 
---

## 7. Compétences humaines à mobiliser (toi ou tiers)

Pour ne pas être bloqué, identifier qui fait quoi :

| Tâche | Qui | Quand |
|---|---|---|
| Validation copy du LB (1ère version) | Fred + relecteur ? | Sprint 1 |
| Validation visuelle PDF brandé | Fred + designer si nécessaire | Sprint 1 |
| Validation juridique (mentions légales LB + RGPD séquences) | Avocat / DPO Jourdechance | Sprint 0 |
| Tenue des calls audit gratuits | Fred | Sprint 3+ |
| Rédaction des recommandations GEO post-audit | Fred ou moi | Sprint 3+ |

---

## 8. ⚠️ Sujets que je ne peux PAS faire seul

Pour transparence :

- **Achat de domaine** : tu dois le faire (carte bleue). DONE
- **Création de comptes SaaS payants** (n8n, OpenRouter top-up) : carte bleue. DONE
- **Envoi réel de DMs LinkedIn** : techniquement contre les ToS LinkedIn de tout automatiser sans outil dédié. Je peux *préparer* les DMs et toi tu les envoies, ou on passe par PhantomBuster.
- **Acceptation des CGU des plateformes** : c'est légalement Fred / Jourdechance. DONE
- **Validation finale du contenu d'un livre blanc avant publication** : ton call business. 
- **Mise en relation client** : pas de prospection en ton nom sans ton OK explicite.

---

## 9. Récap : check-list à compléter pour démarrer Sprint 0

```
[ ] Domaine GEOPERF confirmé : geoperf.com
[ ] Sous-domaine ou racine pour les landings : sous-categorie.geoperf.com
[ ] Adresse mail expéditeur : flefebvre@geoperf.com
[ ] Compte n8n Cloud créé (URL + login) https://fredericlefebvre.app.n8n.cloud/projects/6BdImo8lbZ2EZJSe/workflows
[ ] Compte OpenRouter créé (+ 50$ crédit) DONE
[ ] OpenRouter API key fournie
[ ] Vercel : compte choisi (perso/jourdechance/dédié) https://vercel.com/leffreds-projects
[ ] Logo GEOPERF (fichier PNG/SVG)
[ ] Calendly : URL du créneau "Audit GEOPERF gratuit 30 min"
[ ] Décision LinkedIn auto : manuel pour le pilote / PhantomBuster direct   PhantomBuster
[ ] Première sous-catégorie pour LB pilote : Asset management
[ ] Mentions légales validées (DPO Jourdechance ou modèle générique) DONE
```

Quand cette check-list est verte → on peut lancer le Sprint 1.
