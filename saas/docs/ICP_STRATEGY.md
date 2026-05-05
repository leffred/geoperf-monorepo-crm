# Stratégie ICP Geoperf — Pivot PME/ETI FR (S18)

**Date** : 2026-05-04
**Décision** : Fred + revue post-tests E2E S17
**Statut** : adoptée — implémentée S18 §4.1

---

## 1. Constat

Les 5 reports produits S6-S17 (Asset Management ×2, CRM, Aéronautique, Transformation Digitale) ont généré ~76 prospects via Apollo, dont une majorité de **CMO/Head of Marketing chez de grandes entreprises** : Microsoft, BlackRock, Amundi, Accenture, Publicis, etc.

**Limite commerciale identifiée** :
- Cycle d'achat de ces comptes : 3-9 mois, multi-decision-makers, due diligence sécurité/RGPD lourde.
- Notre offre Geoperf (audit GEO 5-10k€ + SaaS 79-799 €/mois) cible un acheteur **mid-market** qui décide en 2-4 semaines, pas un Group CMO d'un CAC 40.
- Sur 76 prospects S17, ~24 ont été disqualifiés (anglophones), et le funnel de conversion vers audit reste théorique faute de réponses.

**Conclusion** : la cible "marques leaders mondiales" produite par le prompt Phase 1 ne match pas notre ICP commercial.

---

## 2. Nouveau ICP

| Critère | Valeur cible |
|---|---|
| Géographie | France (siège FR) |
| Effectif | 50 – 500 employés (PME / ETI) |
| Segment | B2B principal (ou B2B2C marqué) |
| Maturité | Société établie ou scale-up en croissance |
| Décideur | CMO, Head of Marketing, Directeur Communication |
| Budget marketing | Existant et identifiable (≥ 100 k€/an typique) |
| Sensibilité GEO | Comprend la valeur d'être citée par les LLM (souvent acteurs digital-natifs) |

**Exclusions explicites** : CAC 40, SBF 120, GAFAM, Big4, multinationales > 1000 emp, filiales FR de groupes étrangers.

---

## 3. Sous-catégories cibles (10 nouvelles, S18)

| # | Slug | Parent | Rationale |
|---|---|---|---|
| 1 | `agences-digitales-fr` | Marketing | Marketing-natifs, comprennent immédiatement le sujet GEO. ~200-300 acteurs FR adressables. |
| 2 | `esn-fr-mid-market` | SaaS / Tech | B2B tech, cycle achat court, CMO accessibles. Concurrence forte sur la visibilité IA. |
| 3 | `scaleups-saas-b2b-fr` | SaaS / Tech | Tech-natifs, sensibles à l'autorité LLM, budget marketing croissant. |
| 4 | `conseil-rh-fr` | Conseil | Concurrence FR forte, marketing-driven, notion de réputation centrale. |
| 5 | `edtech-fr` | SaaS / Tech | Marché FR concurrentiel, marketing crucial pour l'acquisition. |
| 6 | `healthtech-fr` | SaaS / Tech | B2B + B2B2C, marketing crucial, sujet d'autorité éditoriale. |
| 7 | `fintech-b2b-fr` | Finance | Mid-market, segmentation CMO claire, sensibles aux mentions LLM. |
| 8 | `cabinets-avocats-fr` | Conseil | Budget marketing (RP + SEO), enjeu de réputation important. |
| 9 | `food-d2c-fr` | Industrie | E-commerce mid-market, marketing-driven, marques en quête d'autorité. |
| 10 | `edition-medias-b2b-fr` | Marketing | Naturellement intéressés par les LLM (média = autorité éditoriale). |

Migration : `20260505_saas_phase10_icp_pme_categories.sql` — appliquée 2026-05-04.

---

## 4. Roadmap

### Phase 1 — Prioritaires S19 (3 sous-cat)
1. `agences-digitales-fr` (~200 marques cible, message le plus naturel)
2. `esn-fr-mid-market` (~150 marques, audience B2B tech)
3. `scaleups-saas-b2b-fr` (~150 marques, ICP idéal)

Lancement post-warmup mailbox Apollo (mi-mai 2026).

### Phase 2 — Élargissement S20+
4-7 : `conseil-rh-fr`, `fintech-b2b-fr`, `edtech-fr`, `healthtech-fr`

### Phase 3 — Long tail S21+
8-10 : `cabinets-avocats-fr`, `food-d2c-fr`, `edition-medias-b2b-fr`

---

## 5. Implications opérationnelles

### Prompt Phase 1 LLM (workflow n8n `7DB53pFBW70OtGlM`)
Patch détaillé dans `saas/docs/N8N_PROMPT_PHASE1_S18.md` :
- Cible explicite PME/ETI FR 50-500 emp
- Exclusion CAC40 / GAFAM / Big4 / multinationales
- Validation stricte du champ `domain` (regex + interdiction de phrases)

### Sequence Apollo (FR1 active)
Le ton actuel est calibré pour des CMO de grandes entreprises (formel, "stratégique"). Pour PME/ETI FR :
- Subject line plus direct ("Vos clients vous trouvent-ils via ChatGPT ?")
- Body : moins de jargon stratégique, plus de bénéfices concrets ("savoir si vos prospects voient votre nom quand ils demandent X à ChatGPT")
- Pas de copies à pousser tant que le warmup n'est pas terminé. Adaptation à faire avant le lancement S19.

### Page profile SEO (`/profile/[domain]`)
Pas d'impact direct — la page lit `companies` via `domain`. Les nouvelles companies issues des reports PME-FR seront automatiquement listées dans `/admin/profiles` et `/sitemap.xml`.

### Backfill anciennes études
**Non prioritaire**. Les reports Asset Management / Transformation Digitale gardent leur valeur d'archive. Ils ne seront pas re-générés en mode PME (les giants concernés sont identifiables, mais pas notre ICP).

---

## 6. Métrique de succès (revue S20)

- **Taux de réponse séquence Apollo** : objectif ≥ 8 % (vs ~3 % anticipé sur ICP CAC40)
- **Taux de conversion landing → demande audit** : objectif ≥ 1.5 %
- **Lead-to-paid SaaS** : objectif ≥ 5 % sur 30 jours
- **Coût CAC sur leads PME** : objectif < 200 € (sourcing Apollo + 1 audit gratuit)

Si les chiffres Phase 1 (3 sous-cat S19) confirment ces ordres de grandeur → industrialiser sur les 7 sous-cat restantes. Sinon → itérer sur le prompt / la sequence avant d'élargir.
