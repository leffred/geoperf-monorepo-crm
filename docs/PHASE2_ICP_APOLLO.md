# Phase 2 — ICP & filtres Apollo par sous-catégorie

> **Cible Geoperf :** décideurs marketing/digital/brand dans les sociétés citées dans nos livres blancs sectoriels.
> **Pourquoi eux :** ils sont **propriétaires du brand awareness**, ils mesurent SEO/SEA/share-of-voice, et ils n'ont **pas encore d'outil pour mesurer la perception LLM**. C'est notre angle.

---

## 1. ICP générique B2B Geoperf

### Critères communs (toutes catégories)

**Personne :**
- **Titres** (FR + EN) : `Chief Marketing Officer`, `CMO`, `Directeur Marketing`, `Head of Marketing`, `VP Marketing`, `Director of Marketing`, `Head of Brand`, `Brand Director`, `Head of Digital Marketing`, `Director of Communications`, `Head of Communications`, `Directeur Communication`, `Head of Growth`, `Head of Product Marketing`, `Director of Product Marketing`
- **Seniority** Apollo : `c_suite`, `vp`, `director`, `head` (pas de `manager` ni `senior` sauf en backup pool)
- **Departments** Apollo : `marketing`, `c_suite` (pour les CMO purs)
- **Pas de** : `Sales`, `Operations`, `IT`, `Finance` (pour cette première séquence — on pourra élargir si conversion faible)

**Entreprise :**
- **Nom** = exact match avec une `companies.nom` du livre blanc OU `companies.domain` (lookup Apollo via `organization_search` puis person_search dans org)
- **Country** : on peut filtrer par pays si bilan régional, sinon laisser global
- **Size** : pas de filtre — toutes les sociétés du LB sont des "grosses" déjà filtrées par les LLM

**Email & qualité :**
- Apollo verifies email → on **prend uniquement** `email_verified = true` ou `email_status = 'verified'`. Sinon → marker `bounced` direct.
- Doit avoir `linkedin_url` non null → indispensable pour la touche LinkedIn

---

## 2. Spécifique : Asset Management (pilote)

### 2.1 Volume cible
- 11 sociétés dans le LB Asset Management 2026 → on vise **3 décideurs par société** (CMO + Head of Brand + Head of Digital) → **~33 prospects** pour le test pilote.
- Si Apollo retourne plus, on garde top-3 par seniority.

### 2.2 Payload Apollo `mixed_people_search` (1 société à la fois)

```json
{
  "q_organization_domains": ["blackrock.com"],
  "person_titles": [
    "CMO", "Chief Marketing Officer", "Directeur Marketing",
    "Head of Marketing", "VP Marketing", "Director of Marketing",
    "Head of Brand", "Brand Director",
    "Head of Digital Marketing", "Head of Digital",
    "Director of Communications", "Head of Communications",
    "Directeur Communication",
    "Head of Product Marketing", "Director of Product Marketing"
  ],
  "person_seniorities": ["c_suite", "vp", "director", "head"],
  "person_departments": ["marketing", "c_suite"],
  "page": 1,
  "per_page": 25
}
```

### 2.3 Particularités Asset Management
- Beaucoup de **Brand Directors** plutôt que CMO purs (héritage des banques et asset managers traditionnels). Cibler `Head of Brand` est **prioritaire**.
- US-heavy (BlackRock, Vanguard, Fidelity, State Street, JPM, Goldman) → sequence en **anglais** + variante FR pour Amundi, BNP Paribas AM, Natixis IM.
- Cycle d'achat long, mais la perception LLM est un sujet "wow" qui fait répondre vite.

### 2.4 Liste des 11 sociétés du LB pilote

| Rang | Société | Domaine principal | Pays | Visibilité IA |
|------|---------|-------------------|------|---------------|
| 1 | BlackRock | blackrock.com | US | 4/4 |
| 2 | Vanguard | vanguard.com | US | 4/4 |
| 3 | Fidelity Investments | fidelity.com | US | 4/4 |
| 4 | State Street Global Advisors | ssga.com | US | 4/4 |
| 5 | JP Morgan Asset Management | am.jpmorgan.com | US | 3/4 |
| 6 | Goldman Sachs Asset Management | gsam.com | US | 3/4 |
| 7 | Amundi | amundi.com | FR | 3/4 |
| 8 | UBS Asset Management | ubs.com | CH | 2/4 |
| 9 | Allianz Global Investors | allianzgi.com | DE | 2/4 |
| 10 | Invesco | invesco.com | US | 2/4 |
| 11 | T. Rowe Price | troweprice.com | US | 2/4 |

(Liste à confirmer une fois la consolidation Phase 1 ré-exécutée avec les bugfixes Sprint 1.2.)

---

## 3. Templates de payloads Apollo par autres sous-catégories

### 3.1 SaaS / Tech — CRM
- **Cible** : `CMO`, `VP Marketing`, `Head of Demand Gen`, `Head of Product Marketing`
- Variante par rapport à Asset Management : ajouter `Head of Demand Generation` et `Head of Growth` (très spécifique tech)

### 3.2 Conseil — Stratégie
- **Cible** : `CMO`, `Head of Brand`, `Director of Communications`, `Partner — Marketing & Communications` (les cabinets ont des partners, pas des Heads)
- Ajouter `partner` dans `person_seniorities` pour les big-4 et MBB

### 3.3 Industrie — Pharma
- **Cible** : `CMO`, `VP Communications`, `Head of Corporate Affairs`, `Head of Digital Marketing`
- Le digital et la corporate affairs sont souvent séparés du marketing produit (compliance) → cibler les 2

> Templates à compléter au fil de l'eau — Asset Management reste le pilote.

---

## 4. Scoring lead initial (à l'enrichissement)

À l'insertion dans `prospects`, calculer un `lead_score` initial 0-100 :

| Critère | Points |
|---|---|
| Email verified | +30 |
| LinkedIn URL présente | +15 |
| Title matche `CMO`/`Chief Marketing Officer` | +25 |
| Title matche `Head of Brand` ou `Head of Digital` | +15 |
| Title matche `VP Marketing` ou `Director of Marketing` | +10 |
| Société visibilité IA = 4/4 LLM | +15 |
| Société visibilité IA = 3/4 LLM | +10 |
| Société visibilité IA = 2/4 LLM | +5 |

Threshold pour entrer dans **Sequence A (premier batch)** : `lead_score >= 50`.
Sinon → `Sequence B (long tail, plus tardive)`.

---

## 5. Champs à mapper Apollo → `prospects`

| Apollo (camelCase) | Geoperf `prospects` |
|---|---|
| `id` | `apollo_person_id` |
| `first_name` | `first_name` |
| `last_name` | `last_name` |
| `name` | `full_name` |
| `email` | `email` |
| `email_status == 'verified'` | `email_verified` |
| `phone_numbers[0].sanitized_number` | `phone` |
| `linkedin_url` | `linkedin_url` |
| `title` | `title` |
| `seniority` | `seniority` |
| `departments[0]` | `job_function` |
| `organization.id` | `metadata.apollo_org_id` |
| `organization.website_url` | (lookup `companies` par domain) → `company_id` |

`category_id` et `report_id` sont passés en input du workflow (issus du LB qui a généré la liste).

---

## 6. Conformité GDPR / opt-out

- Tous les prospects EU doivent voir un lien `unsubscribe` dans chaque email.
- Geoperf opère depuis Jourdechance SAS (FR) → soft opt-in B2B accepté pour CMO/dirigeants (legitimate interest).
- Stocker la base légale dans `prospect_events.metadata.legal_basis` à chaque envoi.
- Si réponse "STOP", "remove me", "unsubscribe" → `status = 'opted_out'`, `opt_out_at = now()`, et **purger** les données dans 30 jours (cron Supabase).

---

## 7. À valider Sprint 2.1

- [ ] Approuver la liste des titles cible (validable directement par Fred)
- [ ] Choisir EN-only ou EN + FR pour les sociétés FR (Amundi)
- [ ] Décider si on inclut `manager` seniority en backup
- [ ] Confirmer 33 prospects max pour pilote OU élargir à 5 par société (~55)
