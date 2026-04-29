# GEOPERF — Plan Maître

> **Produit de Jourdechance SAS** — Phase pilote en cours, structure dédiée à créer si traction.
> **Tagline de travail :** *"Mesurez et améliorez votre référencement dans les LLM"*
> **Date d'initialisation :** 2026-04-27
> **Owner :** Fred Lefebvre (flefebvre@jourdechance.com)

---

## 1. Vision & positionnement

### 1.1 Le problème
Les CEO et Directeurs Marketing B2B n'ont **aucune visibilité sur la façon dont leur entreprise est perçue par les LLM** (ChatGPT, Gemini, Claude, Perplexity). Or, ces LLM deviennent rapidement la nouvelle porte d'entrée de la recherche d'information professionnelle. Une entreprise non-citée — ou mal citée — par les LLM perd des opportunités sans même le savoir.

### 1.2 La proposition GEOPERF
Produire des **livres blancs sectoriels** qui :
1. Listent les acteurs majeurs d'un secteur tel que perçu par les LLM (ex : top 50 sociétés d'asset management).
2. **Comparent** la perception de chaque LLM (qui cite qui, quelles sources, quels classements).
3. Identifient les **écarts** entre la réalité du marché et la perception IA.

Ce livre blanc sert de **cheval de Troie commercial** : l'entreprise citée le télécharge → on la qualifie → on lui vend un audit GEOPERF + des prestations d'optimisation de son référencement IA (« Generative Engine Optimization »).

### 1.3 Modèle économique (à valider en Phase 3)
- **Lead magnet gratuit :** livre blanc sectoriel (Phase 1).
- **Audit gratuit en call :** premier contact qualifié (fin Phase 2).
- **Prestation payante :** audit approfondi + plan d'action GEO (à structurer).
- **Récurrent :** monitoring mensuel de la perception LLM.

---

## 2. Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│                         PHASE 1 — REPORTING                     │
│                                                                 │
│  [Choix catégorie]                                              │
│        │                                                        │
│        ▼                                                        │
│  [n8n Cloud Workflow]                                           │
│        │                                                        │
│        ├──► Perplexity (via OpenRouter) ──┐                     │
│        ├──► GPT-4o (via OpenRouter)      ├──► Supabase          │
│        ├──► Gemini 2.5 Pro (OpenRouter)  │   (raw_responses)    │
│        ├──► Claude Sonnet 4.5 (OpenRouter)─┘                    │
│        │                                                        │
│        ▼                                                        │
│  [Synthèse Claude Sonnet 4.5]                                   │
│        │                                                        │
│        ▼                                                        │
│  [Génération PDF brandé GEOPERF]                                │
│        │                                                        │
│        ▼                                                        │
│  Supabase Storage + landing /lb/[token]                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PHASE 2 — PROSPECTION                     │
│                                                                 │
│  [Liste sociétés extraite du livre blanc]                       │
│        │                                                        │
│        ▼                                                        │
│  [Apollo : enrichissement + récup contacts décideurs]           │
│        │                                                        │
│        ▼                                                        │
│  [Création tokens personnalisés /lb/[token] par contact]        │
│        │                                                        │
│        ▼                                                        │
│  [Apollo Sequences : LinkedIn → Mail 1 → 2 → 3]                 │
│        │                                                        │
│        ├─► Si DL (tracking webhook) ──► Séquence X1 → X2 → X3   │
│        │                                                        │
│        ▼                                                        │
│  [Calendly : booking call audit gratuit]                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. PHASE 1 — Reporting automatisé

### 3.1 Définition des catégories

Je propose une taxonomie B2B en 2 niveaux. **Première catégorie de test à valider avec Fred** (cf. DECISIONS.md).

**Exemples Catégories / Sous-catégories B2B :**

| Catégorie | Sous-catégories pilotes |
|---|---|
| **Finance** | Asset management, Banque privée, Fintech B2B, Assurance entreprise, Conseil M&A |
| **SaaS / Tech** | CRM, ERP, Cybersécurité, DevOps, Data analytics |
| **Conseil** | Stratégie, Transformation digitale, RH, Audit, Juridique |
| **Industrie** | Aéronautique, Automotive, Énergie, Pharma, Agro-industrie |
| **Marketing** | Agences digitales, Médias B2B, Influence B2B, MarTech |
| **Logistique** | Supply chain SaaS, Transport, Entreposage, Last-mile |

Source de la taxonomie : **inspirée des codes NAF/SIREN + référentiels Apollo/LinkedIn**. Stockée dans la table `categories` Supabase (cf. §6).

### 3.2 Workflow n8n Cloud — détail technique

**Nom du workflow :** `geoperf_phase1_white_paper`

**Trigger :** Webhook ou form Supabase → reçoit `{categorie, sous_categorie, top_n}` (ex: top 50)

**Étapes :**

1. **Création d'un `report_id`** dans Supabase (table `reports`, statut `pending`).

2. **Prompt #1 — Extraction Perplexity Sonar Pro** (extraction web réel, sources fraîches)
   - Modèle OpenRouter : `perplexity/sonar-pro` ($3/1M in, $15/1M out, 200k ctx)
   - Prompt : *"Liste les 50 meilleures sociétés de [sous_categorie] dans le monde. Pour chaque société : nom, site web, pays, taille (effectifs), brève description (1 phrase), 3 sources web vérifiées. Format : JSON strict."*
   - Stockage brut dans `raw_responses` (provider=`perplexity`).

3. **Prompt #2 — Validation croisée GPT-4o avec web search**
   - Modèle OpenRouter : `openai/gpt-4o-search-preview` ($2.50/1M in, $10/1M out)
   - **Important :** GPT-4o standard refuse de "prédire 2026" sans données. La variante `search-preview` ajoute le web, indispensable pour la fraîcheur.
   - Prompt similaire adapté.

4. **Prompt #3 — Validation croisée Gemini 2.5 Pro**
   - Modèle OpenRouter : `google/gemini-2.5-pro` ($1.25/1M in, $10/1M out, 1M ctx)
   - Prompt similaire adapté. Cutoff fin 2024 → précise ce point dans le prompt.

5. **Prompt #4 — Validation croisée Claude Sonnet 4.6**
   - Modèle OpenRouter : `anthropic/claude-sonnet-4.6` ($3/1M in, $15/1M out, 1M ctx)
   - **Mise à jour 2026-04-27 :** on utilise Sonnet **4.6** (pas 4.5), modèle plus récent même prix.
   - Prompt similaire adapté.

6. **Consolidation & dédoublonnage** (étape Code n8n en JS)
   - Match par `nom normalisé + domaine` → table `companies` (créée ou updated).
   - Pour chaque société : qui la cite (Perplexity ✓ / ChatGPT ✗ / Gemini ✓ / Claude ✓), score de visibilité IA (= nb LLM qui citent / 4).

7. **Génération de la synthèse rédactionnelle — Claude Opus 4.7**
   - Modèle OpenRouter : `anthropic/claude-opus-4.7` ($5/1M in, $25/1M out, 1M ctx)
   - Pourquoi Opus et pas Sonnet : qualité éditoriale supérieure, 1M de contexte permet de digérer toutes les réponses LLM brutes en un seul appel.
   - Reçoit le JSON consolidé en entrée.
   - Produit les sections rédigées du livre blanc (en français) :
     - Résumé exécutif
     - Méthodologie
     - Vue d'ensemble du secteur
     - **Analyse de visibilité IA** (section différenciante)
     - Top 50 sociétés (mini-fiche par société)
     - Insights & recommandations
     - À propos de GEOPERF

8. **Génération PDF brandé GEOPERF**
   - Service : Node.js script avec `puppeteer` ou `@react-pdf/renderer`, déployé sur Vercel Functions.
   - Template HTML/CSS aux couleurs GEOPERF, logo Jourdechance en footer + mentions légales.
   - Upload sur Supabase Storage : `white-papers/[report_id].pdf`.

9. **Mise à jour Supabase :** `reports.status = 'ready'`, `reports.pdf_url = ...`.

### 3.3 La section différenciante : "Analyse de la visibilité IA"

Pour chaque société du top 50, on calcule et on visualise :
- **Score IA** : pondération nb LLM qui citent (Perplexity = +1, GPT = +1, Gemini = +1, Claude = +1).
- **Cohérence inter-LLM** : si une société est citée par 4/4 → forte visibilité ; 1/4 → niche / sous-représentée.
- **Sources moyennes** : combien de sources distinctes sont citées par les LLM pour la mentionner (proxy d'autorité).
- **Position moyenne** : si la société est citée en #3 par GPT, #12 par Claude, etc.

Cette section seule justifie la valeur du livre blanc — c'est ce que ni Forrester ni Gartner ne fournissent aujourd'hui.

---

## 4. PHASE 2 — Prospection commerciale

### 4.1 Sourcing des contacts (Apollo)

À partir de la liste des sociétés du livre blanc :

1. **Enrichissement société** via `apollo_organizations_enrich` (domaine → ID Apollo, taille, revenu, tech stack).
2. **Recherche personnes** via `apollo_mixed_people_api_search` avec filtres :
   - `organization_ids` : la société.
   - `person_titles` : `["CEO", "CTO", "CIO", "DSI", "CMO", "VP Marketing", "VP Communication", "Director Marketing", "Director Communication", "Head of Growth", "Head of Marketing"]`
   - **Suggestion supplémentaire** : `Head of Digital`, `Chief Digital Officer`, `Head of Content`, `Head of Brand` — ces roles sont souvent les premiers concernés par la visibilité IA.
3. **Récupération mail/tel** via `apollo_people_match` (révèle les coordonnées).
4. Insertion dans `prospects` Supabase avec un `tracking_token` unique par prospect.

**Cible volumétrique :** Top 500 sociétés × ~3-4 décideurs = **~1500-2000 prospects par sous-catégorie**.

### 4.2 Personnalisation : landing /lb/[token]

**Architecture URL retenue (décidée 2026-04-27) : un sous-domaine dédié par sous-catégorie.**

Format : `[sous-categorie].geoperf.com/lb/{token}`

Exemple pour le pilote : `asset-management.geoperf.com/lb/abc123`

Avantages :
- SEO : le mot-clé sectoriel est dans le hostname.
- Mémorabilité : un prospect d'asset management voit `asset-management.geoperf.com` → relevance immédiate.
- Isolation : un sous-domaine = un livre blanc public + un site éditorial dédié à terme.
- Multi-tenant propre : chaque LB a sa propre version, sa propre route Vercel, sa propre table d'events.

Conséquences techniques :
- Vercel : un projet Next.js par sous-domaine (ou un seul projet avec wildcard `*.geoperf.com` + middleware de routing par hostname). **Recommandation : monorepo Next.js avec wildcard + middleware** — un seul deploy, configuration DNS plus simple.
- DNS OVH : ajouter un CNAME wildcard `*.geoperf.com → cname.vercel-dns.com.` (à faire au Sprint 1).
- Vercel : domaine custom `*.geoperf.com` à ajouter dans Project → Domains.

Comportement de la page :
- Si visiteur arrive : on logge `landing_visit` (token, IP, user agent, timestamp) → table `events`.
- Headline personnalisé : *"Bonjour [Prénom], voici le livre blanc qui mentionne [Société]"*.
- Formulaire pré-rempli avec mail Apollo, modifiable.
- Sur submit : log `download_completed`, envoi du PDF par mail + redirection lecture inline.
- Webhook Apollo pour avancer la séquence (passer en branche X1).

### 4.3 Séquences messages — détail copy

#### **Séquence A : "Cold" (avant download)**

| Étape | Canal | Délai | Objet | Corps (résumé) |
|---|---|---|---|---|
| **L0** | LinkedIn DM | J0 | — | *"Bonjour [Prénom], nous venons de sortir le dernier livre blanc du référencement IA sur [sous-catégorie]. [Société] y est citée. Si vous souhaitez le télécharger gratuitement : [lien tracking]"* |
| **M1** | Email | J+3 (si pas DL) | *"[Société] dans notre étude — votre exemplaire offert"* | Texte similaire au DM + 2-3 résumés intéressants ("Saviez-vous que 73% des CEO ne savent pas comment leur marque apparaît dans ChatGPT ?"). CTA bouton |
| **M2** | Email | J+8 (lun-ven 8h-10h) | *"On vous a réservé un exemplaire"* | Court, droit au but. Rappel + lien |
| **M3** | Email | J+14 | *"Les 10 leaders du référencement IA en [sous-catégorie]"* | Email plus long, valeur d'abord : top 10 commenté en teaser, le reste dans le LB. Lien final |

#### **Séquence B : "Engagé" (après download)**

| Étape | Canal | Délai | Objet | Corps (résumé) |
|---|---|---|---|---|
| **X1** | Email | DL + 30 min | *"Votre audit GEO offert — 30 min avec notre fondateur"* | Merci + offre call gratuit pour analyser le positionnement IA de [Société]. Lien Calendly |
| **X2** | Email | DL + 3 jours | *"3 axes d'amélioration que j'ai vus pour [Société]"* | Teaser de 2-3 insights spécifiques (à générer via prompt LLM sur le site de la société) + lien Calendly |
| **X3** | Email | X2 + 6 jours | *"Ne pas agir, c'est laisser vos concurrents prendre le terrain IA"* | Plus directif. Rappel de l'enjeu : « les LLM consolident leur perception de votre secteur, plus vous attendez plus c'est dur de bouger les lignes ». Calendly |

### 4.4 Logique d'arrêt
- **Stop séquence A** dès que `download_completed` → bascule sur séquence B.
- **Stop séquence B** dès que `calendly_booked`.
- **Stop tout** sur reply avec opt-out keywords (`unsubscribe`, `désabonner`, `pas intéressé`).
- **RGPD** : footer obligatoire avec lien désinscription, mention `Jourdechance SAS, [adresse]`.

---

## 5. ⚠️ Sujet sensible : automatisation LinkedIn

**Apollo ne fait PAS d'envoi automatique de DMs LinkedIn.** Il crée des "tâches" que tu dois exécuter manuellement, OU il faut un outil tiers.

**Options :**
1. **Manuel via LinkedIn Premium** : faisable pour 50-100 prospects/jour, pas plus. Risqué de scaler.
2. **PhantomBuster** (~56€/mois) : automatise envoi DMs, intégrable à n8n via webhook.
3. **Lemlist / La Growth Machine** (~80€/mois) : email + LinkedIn unifié, mais redonde Apollo.
4. **Skip LinkedIn DM** : démarrer par email seul (plus safe, plus scalable).

**Recommandation :** démarrer en **manuel + LinkedIn Premium** pour le pilote (1ère sous-catégorie), puis **PhantomBuster** dès qu'on valide la conversion. Cf. DECISIONS.md.

---

## 6. Schéma de données Supabase

```sql
-- Référentiel
categories (id, nom, slug, parent_id, ordre)

-- Workflow Phase 1
reports (
  id, category_id, sous_categorie, top_n,
  status (pending|running|ready|failed),
  pdf_url, slug_public,
  created_at, completed_at, owner_email
)

raw_responses (
  id, report_id, provider (perplexity|openai|google|anthropic),
  model, prompt, response_json, sources_json,
  tokens_in, tokens_out, cost_usd, created_at
)

companies (
  id, nom, nom_normalise, domain, country, employees_range,
  description, sector_tags[],
  created_at, last_enriched_at
)

report_companies (
  id, report_id, company_id, rank,
  cited_by (jsonb : {perplexity:bool, openai:bool, google:bool, anthropic:bool}),
  visibility_score (1-4),
  avg_position_in_lists,
  source_count
)

-- Workflow Phase 2
prospects (
  id, company_id, apollo_id, first_name, last_name,
  email, phone, title, linkedin_url,
  tracking_token (unique), 
  status (cold|engaged|converted|opted_out),
  created_at
)

sequences (
  id, prospect_id, sequence_type (A|B), 
  current_step, last_action_at, next_action_at,
  apollo_sequence_id
)

events (
  id, prospect_id, type (linkedin_sent|email_sent|email_opened|landing_visit|download_completed|calendly_booked|reply|opt_out),
  metadata jsonb, created_at
)

-- Génération de la séquence X2 (insights spécifiques)
prospect_insights (
  id, prospect_id, generated_at,
  insights_json (3 axes d'amélioration GEO)
)
```

Migrations : versionnées dans `/supabase/migrations/`, déployées via `supabase` CLI ou via le MCP Supabase déjà connecté.

---

## 7. Stack technique consolidée

| Couche | Outil | Statut |
|---|---|---|
| **Orchestration** | n8n Cloud | ⚠️ Compte à créer (~20€/mois) |
| **LLM gateway** | OpenRouter | ⚠️ Compte + crédit à créer |
| **DB + Storage + Auth** | Supabase | ✅ Compte existant |
| **Prospection** | Apollo + LinkedIn Premium | ✅ Comptes existants |
| **Email sending** | Apollo Sequences | ✅ Inclus dans Apollo |
| **Booking** | Calendly | ⚠️ Plan basique gratuit OK pour démarrer |
| **Landing pages** | Next.js sur Vercel | ⚠️ À développer (gratuit) |
| **PDF generation** | Vercel Function (puppeteer) | ⚠️ À développer |
| **LinkedIn auto** | Manuel puis PhantomBuster | ⚠️ Décision à prendre |
| **Domaine** | `geoperf.com` (chez OVH) avec wildcard `*.geoperf.com` pour les LB | ✅ Décidé 2026-04-27 |
| **Mail expéditeur** | `flefebvre@geoperf.com` (OVH MX + envoi via Apollo SMTP) | ⚠️ MX/SPF/DKIM/DMARC à configurer (cf. docs/DNS_EMAIL_SETUP.md) |
| **Suivi des coûts LLM** | Dashboard Supabase custom | À développer après pilote |

---

## 8. KPIs pilote (1ère sous-catégorie)

| Métrique | Cible pilote | Mesuré dans |
|---|---|---|
| Coût LLM par livre blanc | < 5$ (cible révisée) — observé sur test mini : ~$0.04 pour top 3 × 4 LLM | `raw_responses.cost_usd` |
| Délai génération LB | < 30 min | `reports.completed_at` |
| Prospects identifiés | 1500-2000 | `prospects.count` |
| Taux DL (séq A) | 8-12% | `events` |
| Taux booking call (séq B) | 15-25% | `events` |
| Coût d'acquisition lead qualifié | < 50€ | calcul global |

---

## 9. Roadmap d'exécution

### Sprint 0 — Setup (semaine 1, ~5 jours)
- Achat domaine si pas geoperf.com déjà (cf. DECISIONS).
- Création compte n8n Cloud + OpenRouter (+ crédit 50$ initial).
- Branchement MCP n8n (via webhooks REST que je peux déclencher).
- Création projet Supabase dédié `geoperf` + premières migrations.
- Setup repo Next.js landing.

### Sprint 1 — Phase 1 MVP (semaine 2-3)
- Workflow n8n complet pour 1 sous-catégorie.
- Templates prompts validés sur 1 cas concret (Asset Management ?).
- Génération PDF brandé.
- Premier livre blanc complet.

### Sprint 2 — Phase 2 setup (semaine 4)
- Apollo : sourcing 500 sociétés + 1500 contacts.
- Création des 1500 tokens + landing /lb/[token].
- Configuration séquences Apollo (A et B).
- Tests envoi sur 10 prospects amis.

### Sprint 3 — Lancement pilote (semaine 5-6)
- Envoi séquence A à 200 prospects.
- Suivi quotidien des KPIs.
- Itération copy emails selon réponses.
- Premiers calls audit.

### Sprint 4 — Itération & scale (semaine 7+)
- Validation modèle économique.
- 2ème sous-catégorie.
- Décision création structure dédiée GEOPERF.

---

## 10. Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| LLM hallucinations dans top 50 | Élevée | Moyen | Validation croisée 4 LLM + spot-check humain avant publication |
| Apollo block / rate limit | Moyenne | Élevé | Throttling + monitoring quota + plan B Lusha/Cognism |
| Mauvaise délivrabilité email | Moyenne | Élevé | Domaine d'envoi dédié, warm-up, SPF/DKIM/DMARC |
| Plainte RGPD prospect | Moyenne | Élevé | Mentions légales + opt-out 1-clic + liste de suppression |
| LinkedIn restriction compte | Moyenne | Moyen | Volume modéré, pas de scraping aggressif |
| Coût LLM qui dérape | Faible | Moyen | Hard cap dans OpenRouter + alerte Supabase à 80% budget |
| LB pas perçu comme valeur | Moyenne | Élevé | Tester 1 LB, mesurer DL rate avant scaling |

---

## 11. Comment je tracerai l'avancement

Trois fichiers vivants à la racine de `GEOPERF/` :

1. **`PROJECT_PLAN.md`** (ce document) — version de référence du plan. Je l'updaterai à chaque changement majeur.
2. **`DEVELOPMENT_HISTORY.md`** — journal chronologique : chaque session avec Fred → ce qui a été fait, ce qui a été décidé, blocages rencontrés.
3. **`DECISIONS.md`** — backlog des décisions à prendre. Je l'allège au fur et à mesure que tu trances.

Et un dossier `docs/` pour les sous-documents thématiques (prompts, séquences mail, schéma détaillé, etc.) au fur et à mesure du développement.
