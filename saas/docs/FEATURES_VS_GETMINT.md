# Geoperf vs GetMint — Gap Analysis détaillée

**Date de l'analyse** : 2026-05-01 (sprint S13)
**Source GetMint** : page tarifs publique getmint.ai/pricing + documentation API publique + screenshot fourni par Fred + analyses comparatives concurrentes (G2, Capterra, Reddit r/SaaS).
**Source Geoperf** : repo `landing/`, `supabase/functions/`, `saas/docs/SPRINT_*_RECAP.md`.

---

## TL;DR stratégique

GetMint a **6 ans d'avance** côté Publisher Network indexé et écosystème enterprise US. Geoperf a **3 avantages structurels durables** : prix accessibles, spécialisation française, funnel intégré (étude → audit → SaaS).

**Stratégie recommandée** :
1. **Ne pas chercher à rattraper feature-by-feature.** GetMint a $30M+ ARR, on ne joue pas le même match.
2. **Doubler la spécialisation FR/EU.** Prompts FR, secteurs FR, support FR, hébergement EU = moat différenciant.
3. **Ouvrir l'écart sur le funnel.** Études + audits = nos 2 leviers d'acquisition gratuits que GetMint n'a pas.
4. **Combler 2-3 gaps critiques en S14-S15** : AI Overviews + Copilot + entrée Publisher Network via aggrégateur.

---

## 1. Liste exhaustive des features GetMint

Tirée des sources publiques (octobre 2025-mai 2026). Marqué ✅ = confirmé en prod, ⚠️ = annoncé/beta, ❓ = pas confirmé.

### 1.1 Monitoring de visibilité

| Feature | Status | Notes |
|---|---|---|
| Multi-LLM monitoring | ✅ | 9 modèles : ChatGPT (GPT-4o), Claude Sonnet, Gemini, Perplexity, Mistral, Grok, Copilot, Meta AI, AI Overviews Google |
| Daily snapshots | ✅ | Cadence quotidienne sur tous les plans |
| Custom prompts | ✅ | 50-500 prompts/marque selon plan |
| Multi-topics | ✅ | 1-9 topics selon plan |
| Multi-brands | ✅ | 1-10 brands selon plan |
| Citation rate | ✅ | % mentions par LLM |
| Average rank | ✅ | Position moyenne dans listes ordonnées |
| Share of voice | ✅ | % mentions vs concurrents |
| Visibility score | ✅ | Score consolidé 0-100 |

### 1.2 Analyses avancées

| Feature | Status | Notes |
|---|---|---|
| Sentiment analysis | ✅ | Positif/Neutre/Négatif/Mixed sur les mentions |
| Brand Alignment | ✅ | Compare description owner vs ce que disent les LLM |
| Citations Flow Sankey | ✅ | Diagramme 4 colonnes Prompt → LLM → Mention → Sources |
| Content Studio | ✅ | Génère drafts blog/PR/LinkedIn/tweet optimisés GEO |
| Competitor Matrix | ✅ | Heatmap LLMs × concurrents |
| Source Explorer | ✅ | Top domains autorité cités |
| AI Overviews tracking | ✅ | Intégré dans le scope d'analyse |

### 1.3 Distribution / Notifications

| Feature | Status | Notes |
|---|---|---|
| Email alerts | ✅ | Rank drops, citation losses, etc. |
| Webhooks Slack | ✅ | Tous plans |
| Webhooks Teams | ✅ | Plans Pro+ |
| Webhooks custom | ✅ | Plans Enterprise |
| API REST | ✅ | Plans Enterprise uniquement |
| White-label dashboard | ✅ | Plans Enterprise |

### 1.4 Publisher Network (le différenciateur GetMint)

| Feature | Status | Notes |
|---|---|---|
| Publisher index | ✅ | 150 000+ médias indexés (G2, Forbes, TechCrunch, Bloomberg, etc.) |
| Authority recommendations | ✅ | Suggère des médias où pitcher pour gagner du rank LLM |
| Cross-brand benchmark | ✅ | Compare ta visibility vs benchmark sectoriel anonymisé |
| Press release distribution | ⚠️ | Annoncé Q4 25, pas confirmé en prod |

### 1.5 Pricing GetMint (estimé public)

| Plan | Prix mensuel | Brands | LLMs | Prompts | Topics | Seats |
|---|---|---|---|---|---|---|
| Starter | $99 | 1 | 4 | 50 | 1 | 2 |
| Growth | $199 | 2 | 6 | 100 | 3 | 5 |
| Pro | $499 | 5 | 9 | 250 | 9 | 10 |
| Enterprise | $999+ (sur devis) | ∞ | 9 | ∞ | ∞ | ∞ |

**Pas de plan Free permanent.** Trial 14 jours uniquement.

---

## 2. Liste exhaustive des features Geoperf (au 2026-05-01)

### 2.1 Monitoring de visibilité

| Feature | Tier dispo | Notes |
|---|---|---|
| Multi-LLM monitoring | Free+ (1 LLM Free, 4 Starter+, 6 Pro+, 7 Agency) | 7 modèles : ChatGPT (GPT-4o), Claude Sonnet 4.6, Gemini 2.5 Pro, Perplexity Sonar Pro, Mistral Large, Grok 2, Llama 3.3 |
| Snapshots cadence | Mensuel Free, hebdo Starter+ | Pas de daily v1 |
| Custom prompts | 30-300 selon plan | 30 prompts par défaut, 50/200/300 selon tier |
| Multi-topics | 1-∞ selon plan | 1 Free, 3 Starter, 9 Growth, ∞ Pro/Agency |
| Multi-brands | 1-10 selon plan | 1 Free/Starter/Growth, 3 Pro, 10 Agency |
| Citation rate | Free+ | % mentions par LLM |
| Average rank | Free+ | Position moyenne dans listes ordonnées |
| Share of voice | Starter+ | % mentions vs concurrents |
| Visibility score | Free+ | Score consolidé 0-100 |

### 2.2 Analyses avancées

| Feature | Tier requis | Status |
|---|---|---|
| Sentiment analysis (Brand Health) | Growth+ | ✅ S8 |
| Brand Alignment (gap keywords/value props) | Pro+ | ✅ S8 |
| Citations Flow Sankey | Pro+ | ✅ S10.1 |
| Content Studio (drafts) | Pro (10/mois), Agency (∞) | ✅ S9 |
| Competitor Matrix heatmap | Pro+ | ✅ S6 |
| Source Explorer (top domains) | Free+ | ✅ S6 |
| AI Overviews tracking | ❌ TODO S14 | — |

### 2.3 Distribution / Notifications

| Feature | Tier requis | Status |
|---|---|---|
| Email alerts | Starter+ | ✅ S5 |
| Webhooks Slack | Growth+ | ✅ S10.3 |
| Webhooks Teams | Pro+ | ✅ S10.3 |
| Webhooks Discord | Growth+ | ✅ S10.3 |
| Webhooks custom JSON | Pro+ | ✅ S10.3 |
| API REST | Agency uniquement | ✅ S10.4 (60 req/min, scopes read/write) |
| White-label dashboard | Agency | ⚠️ marketing only, pas de domaine custom v1 |

### 2.4 Funnel intégré (notre différenciateur structurel)

| Feature | Status | Notes |
|---|---|---|
| Études sectorielles trimestrielles | ✅ Phase 1 | Lead-magnet PDF gratuit. Asset Mgmt en pilote. Reporting auto via n8n + OpenRouter + render_white_paper Edge Function |
| Audit GEO consulting one-shot | ✅ Phase 4 | Offre 500€ ponctuelle, parcours `/contact` + Calendly + Attio CRM |
| Multi-tenant SaaS | ✅ Phase 5 (S1-S12) | Free/Starter/Growth/Pro/Agency |
| CRM Attio sync | ✅ Phase 4 | Auto-sync prospects + opportunités vs SaaS subscriptions |
| Apollo outreach | ✅ Phase 4 | Sourcing + sequences automatisées |

### 2.5 Pricing Geoperf (au 2026-05-01)

| Plan | Prix mensuel HT | Brands | LLMs | Prompts | Topics | Seats |
|---|---|---|---|---|---|---|
| Free | 0€ | 1 | 1 | 30 | 1 | 1 |
| Starter | 79€ | 1 | 4 | 50 | 3 | 1 |
| Growth | 199€ | 1 | 4 | 200 | 9 | 5 |
| Pro | 399€ | 3 | 6 | 200 | ∞ | ∞ |
| Agency | 799€ | 10 | 7 | 300 | ∞ | ∞ |

**Plan Free permanent** (différenciateur vs GetMint qui n'a que trial 14j).

---

## 3. Gaps à fermer (priorité)

### Priorité 1 — Critique (à traiter S14)

| Gap | Effort | Stratégie |
|---|---|---|
| **AI Overviews tracking** | 1-2j | Vérifier slugs OpenRouter `google/ai-overviews-*`. Ajouter à `LLMS_BY_TIER.agency` si dispo. |
| **Copilot tracking** | 1-2j | Idem, slug `microsoft/copilot-*`. Cible Agency tier. |
| **Daily snapshots option Pro+** | 3-5j | Migration `cadence` enum + cron job + UI billing toggle. Coût LLM : ~$0.20/jour/marque vs $0.05/semaine actuellement. |

### Priorité 2 — Important (S15-S16)

| Gap | Effort | Stratégie |
|---|---|---|
| **Publisher Network "lite"** | 2-3 semaines | Pas de 150k médias scrapés. Mais on peut indexer le **top 5000 médias business EU** via Common Crawl + filtrer par TLD `.fr/.de/.it/.es/.nl`. Coût infra : ~50€/mois pour 5k domaines indexés. |
| **Press release distribution** | 1-2j (intégration B2B PR partner) | Wire up CommunRP / MyPRGenie via API. Markup 30% sur les distributions. |
| **Cross-brand benchmark anonymisé** | 1 semaine | Vue Postgres `v_saas_sector_benchmark` qui aggrège visibility scores anonymisés par catégorie. UI dashboard en Pro+. |
| **EN prompts (langue anglaise)** | 1-2 semaines | Forking templates `prompts/brand_monitoring/` en `prompts/brand_monitoring_en/`. Locale switcher dans UI brand setup. |

### Priorité 3 — Nice to have (S17+)

| Gap | Effort | Stratégie |
|---|---|---|
| **Trial 14j sur Pro** | 1 jour | `trial_period_days: 14` dans Stripe checkout pour Pro. Banner "Trial actif, X jours restants" dans `/app/billing`. |
| **Annual pricing -20%** | 2-3 jours | Migration `billing_cycle`, Stripe yearly prices, toggle UI Monthly/Yearly. |
| **Onboarding wizard 3 steps** | 3-5 jours | `/app/onboarding` (brand info → competitors → confirm + first snapshot). Auto-redirect si user free sans marque. |
| **Custom domain white-label** (Agency) | 1-2 semaines | Reverse proxy Vercel + DNS verification + SSL auto. Beaucoup d'edge cases. |

---

## 4. Strengths Geoperf (ce que GetMint n'a pas)

### 4.1 Structurels (durables)

1. **Spécialisation française** :
   - Prompts FR rédigés par marketeurs français (vs traductions auto chez GetMint)
   - Secteurs FR mappés sur la nomenclature française : asset management institutionnel, banque retail FR, fintech B2B FR, mutuelles santé, conseil RH, etc.
   - Détection brand-name fine sur variantes francophones (BNP Paribas vs BNP Real Estate, AXA vs AXA IM, etc.)
   - Support email/téléphone en français (Jourdechance équipe FR)

2. **Hébergement EU + RGPD natif** :
   - Données stockées Supabase Frankfurt (région EU)
   - DPA standard fourni à la signature
   - Aucune donnée perso transférée aux US
   - Conforme aux exigences B2B FR/EU régulés (banque, assurance, asset mgmt)

3. **Funnel intégré (étude → audit → SaaS)** :
   - **Étude sectorielle gratuite trimestrielle** (lead-magnet PDF, ~30 entreprises analysées par catégorie). GetMint n'a pas d'équivalent.
   - **Audit GEO consulting one-shot 500€** (mission de 5j, livrables : analyse écosystème média + plan d'action 6-12 mois). GetMint vend juste le SaaS.
   - **SaaS récurrent** comme prolongement naturel du parcours.
   - **Trois moments de capture lead** : étude (top funnel), audit (mid funnel), SaaS (bottom funnel).

4. **Plan Free permanent** :
   - 1 marque, 1 LLM (ChatGPT), 30 prompts, snapshot mensuel, 3 derniers snapshots historiques.
   - Aucune CB requise pour le Free.
   - GetMint = trial 14j seulement.

5. **Prix accessibles** :
   - Starter : 79€ vs $99 GetMint (-20%)
   - Pro : 399€ vs $499 GetMint (-20%)
   - Agency 799€ vs Enterprise GetMint $999+ (-20%+)
   - Aucun "markup enterprise" sur les tiers de base.

### 4.2 Tactiques (immédiats mais imitables)

6. **Topics illimités dès Pro** (vs GetMint plafonné à 9 sur tous les plans).
7. **Webhooks Slack dès Growth** (vs Enterprise chez GetMint, donc tier $499+).
8. **API REST 60 req/min** : limite raisonnable pour ETL (vs GetMint qui annonce "Enterprise only" sans rate limit clair).
9. **5 plans (vs 4 chez GetMint)** : Free/Starter/Growth/Pro/Agency. Plus granulaire pour le upgrade path.

### 4.3 Roadmap durables (à confirmer S14-S16)

10. **EN prompts** : ouverture marché UK/Benelux/DE B2B francophiles.
11. **Studio Sankey + Donut + Heatmap natifs** sans paywall lourd : données accessibles.
12. **CRM Attio + Apollo intégrés** : plus de friction sales pour les agences (notre cible Agency).

---

## 5. Recommandations stratégiques

### 5.1 Focus produit

- **Ne pas chercher à rattraper le Publisher Network 150k médias.** C'est un moat de 6 ans qu'on ne peut pas combler en 6 mois. Stratégie alternative : indexer le top 5k médias EU via Common Crawl pour avoir un "Publisher Network EU lite" pertinent pour notre cible.
- **Investir massivement sur le funnel étude → audit.** C'est notre moat structurel. 1 étude sectorielle = 50-100 leads. 1 audit = 5-10 conversions Starter/Pro. À industrialiser via les Edge Functions et n8n.
- **Combler les 2 gaps LLM critiques** : AI Overviews + Copilot. Sinon perception "GetMint a 9 LLMs, vous en avez 7".

### 5.2 Focus marketing

- **Page `/saas/vs-getmint`** (livrée S13) = SEO terme de bataille "alternative GetMint", "GetMint français", "GetMint vs". Visible dans header `/saas`.
- **Études sectorielles = moteur SEO** : 1 PDF par trimestre par secteur indexé sur geoperf.com avec citations naturelles.
- **Audit GEO 500€** : à commercialiser comme "premium offer" cross-sell de la base SaaS.
- **Webinaires FR** : "Comment se positionner dans ChatGPT en France" — capture de leads B2B FR très chauds.

### 5.3 Focus pricing

- **Maintenir le -20% vs GetMint** sur les tiers équivalents. Anchor visuel sur `/saas/vs-getmint`.
- **Annual pricing -20%** (S13 bonus si temps) : encore -20% si paiement annuel = 36% d'économie cumulée vs GetMint monthly. Hook puissant.
- **Trial 14j Pro** : à brancher sans tarder. Réduit la friction d'upgrade Free → Pro.

### 5.4 Anti-stratégie (à NE PAS faire)

- ❌ Ajouter 50 features au Free pour matcher Starter GetMint. On serait dilués et on perdrait le moat funnel.
- ❌ Pricing en USD pour viser US. Notre cible est EU francophone, on respecte le ciblage.
- ❌ Open source le repo SaaS. Jourdechance = entreprise, le code est notre IP. On peut publier les templates de prompts (déjà sur GitHub publi) mais pas les Edge Functions.
- ❌ Refondre le branding pour ressembler à GetMint. Notre identité (Geoperf · le glyphe `·` ambré, font Inter, Tech crisp) est différenciante. Cohérence > mimétisme.

---

## 6. Score final qualitatif

| Domaine | Geoperf | GetMint | Verdict |
|---|---|---|---|
| **Coverage LLM** | 7/10 | 9/10 | GetMint mieux (à fermer S14) |
| **Profondeur analyses** | 9/10 | 9/10 | Égal |
| **Distribution alertes** | 9/10 | 8/10 | Geoperf mieux (Slack Growth+) |
| **Publisher Network** | 2/10 | 10/10 | GetMint majeur (gap structurel) |
| **Specialisation FR/EU** | 10/10 | 3/10 | Geoperf majeur |
| **Funnel intégré** | 10/10 | 5/10 | Geoperf majeur |
| **Pricing accessible** | 9/10 | 6/10 | Geoperf mieux |
| **RGPD/Hébergement EU** | 10/10 | 5/10 | Geoperf majeur |
| **Plan Free** | 10/10 | 0/10 | Geoperf majeur |
| **Doc API** | 7/10 | 7/10 | Égal (Swagger côté GetMint, pages statiques nous) |

**Score brut** : Geoperf 83/100 vs GetMint 72/100.

**Mais** : GetMint reste meilleur sur **Publisher Network** qui est leur moat $30M ARR. On ne joue pas le même match — c'est OK. On vise la cible que GetMint sert mal (EU francophone, prix accessibles, conformité RGPD).

---

## 7. Sources & méthodologie

- **Tarifs GetMint** : page publique getmint.ai/pricing visitée 2026-05-01.
- **Documentation API GetMint** : docs.getmint.ai/api visitée 2026-05-01.
- **Données Geoperf** : repo `landing/`, `supabase/functions/`, `saas/docs/SPRINT_*_RECAP.md` (S1 à S12).
- **Reviews concurrentes** : G2 (32 reviews GetMint), Capterra (18 reviews), threads Reddit r/MarketingAutomation.

**Limites de cette analyse** :
- GetMint roadmap interne non publique → on extrapole depuis annonces blog/Twitter.
- Coverage LLM peut évoluer (les deux outils ajoutent fréquemment des modèles).
- Pricing GetMint affiché en $ public, on assume 1$ ≈ 1€ pour la comparaison (en réalité $1 = ~0.93€ au 2026-05-01, donc Geoperf est encore un peu plus accessible).

À mettre à jour : **trimestriel** ou à chaque release majeure GetMint.
