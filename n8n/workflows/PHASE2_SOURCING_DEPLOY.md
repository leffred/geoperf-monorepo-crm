# Phase 2 — Workflow Apollo Sourcing : déploiement

## Quoi
Workflow n8n `GEOPERF Phase 2 — Apollo Sourcing & Prospect DB` qui :
1. Reçoit `{report_id, max_per_company, min_lead_score}`
2. Lit les companies du LB depuis Supabase
3. Pour chaque société : appel Apollo `mixed_people/search` filtré sur titles marketing C-level
4. Scoring 0-100 par lead, garde top-N par société
5. Upsert dans `prospects` (ON CONFLICT apollo_person_id → update)
6. Log `prospect_created` dans `prospect_events`
7. Retourne summary `{total, verified, avg_score, sequence_a_eligible}`

## Prérequis avant import

### 1. Apollo API Key
- Apollo → Settings → Integrations → API → générer une clé
- Note : l'usage `mixed_people/search` consomme du quota Apollo (1 crédit / personne révélée)
- Dans n8n : créer un credential **Header Auth** :
  - Name : `Apollo API Key`
  - Header Name : `X-Api-Key`
  - Header Value : (la clé Apollo)

### 2. Postgres GEOPERF
Déjà créée pour la Phase 1, on réutilise la même.

## Import

```
n8n Cloud → Workflows → "+" → Import from File → geoperf_phase2_sourcing.json
```

## Configurer credentials sur les nodes

Sur les 3 nodes Postgres (`Get companies from report`, `Upsert prospect in Supabase`, `Log prospect_created event`, `Build summary`) :
- Credential → **Postgres GEOPERF**

Sur le node HTTP `Apollo people search` :
- Authentication → Generic Credential Type → Header Auth → **Apollo API Key**

## Activer

Toggle "Inactive" → "Active" en haut à droite.

## Test

```bash
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-sourcing \
  -H "Content-Type: application/json" \
  -d '{"report_id":"61be49be-8e19-48b4-b50a-9a59f3cb987a","max_per_company":3,"min_lead_score":50}'
```

Réponse attendue (en ~30-60s pour 11 sociétés × 3 prospects) :
```json
{
  "ok": true,
  "report_id": "61be49be-...",
  "summary": {
    "total": 33,
    "verified": 28,
    "avg_score": 67.4,
    "sequence_a_eligible": 24,
    "by_company": [{"company":"BlackRock","count":3}, ...]
  }
}
```

## Vérification post-run

```sql
-- Voir les prospects créés
SELECT first_name, last_name, title, email, lead_score, status
FROM prospects
WHERE report_id = '61be49be-8e19-48b4-b50a-9a59f3cb987a'
ORDER BY lead_score DESC;

-- Voir les events
SELECT event_type, COUNT(*)
FROM prospect_events
WHERE prospect_id IN (SELECT id FROM prospects WHERE report_id = '61be49be-...')
GROUP BY event_type;
```

## Quota Apollo à prévoir

Pour un LB de 11 sociétés × 12 prospects/recherche × 4 crédits = ~530 crédits Apollo par run.
Sur le plan Apollo Basic (~10k crédits/mois), on peut faire ~18 LBs/mois — largement suffisant pour le pilote.

## Bugs connus à surveiller

1. **Apollo schéma de retour** : selon plan/version API, le champ s'appelle `people` ou `contacts`. Le code JS accepte les deux.
2. **email_status** : peut être `verified`, `likely`, `guessed`, `unverified`. On ne valide que `verified`.
3. **Doublons** : le `apollo_person_id UNIQUE` constraint évite les doublons mais l'upsert remet à jour `lead_score` et `metadata`.
4. **SplitInBatches** : par défaut traite 1 item à la fois. Si Apollo rate-limit (429) → ajouter `Wait` node 1s entre batches.
