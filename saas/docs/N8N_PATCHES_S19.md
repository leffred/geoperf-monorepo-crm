# Patches n8n S19 — Phase 1 stats + Phase 2 race condition

**Date** : 2026-05-05
**Approche** : patch via UI n8n par Fred. MCP `update_workflow` exigerait réécriture SDK complète des workflows actifs — risque trop élevé. Les 2 patches ci-dessous se font en moins de 2 minutes via l'interface.

---

## §4.2 — Phase 1 Consolidate stats (workflow `7DB53pFBW70OtGlM`)

### Bug

Node **`Consolidate (JS)`** id `b88af458-fbdc-41c2-9771-75596723afa8`.
Ligne 130 du `jsCode` :

```javascript
const stats = {
  total_unique_companies: consolidated.length,
  cited_by_4_llms: 0,
  cited_by_3_llms: 0,
  cited_by_2_llms: 0,
  cited_by_1_llm: 0          // ← typo : singulier
};
for (const c of consolidated)
  stats['cited_by_' + c.visibility_score + '_llms'] = (stats['cited_by_' + c.visibility_score + '_llms'] || 0) + 1;
//                                       ↑ pluriel (correct, mais init manquante)
```

**Conséquence** : la boucle crée `cited_by_1_llms` (pluriel) à la volée via `|| 0`, mais l'objet sortie contient AUSSI `cited_by_1_llm: 0` (orphelin singulier). Les consumers downstream qui lisent la clé singulière voient toujours 0.

### Patch

**1 caractère à ajouter** : changer `cited_by_1_llm` → `cited_by_1_llms` (ajouter un `s`).

```javascript
const stats = {
  total_unique_companies: consolidated.length,
  cited_by_4_llms: 0,
  cited_by_3_llms: 0,
  cited_by_2_llms: 0,
  cited_by_1_llms: 0          // FIX S19 §4.2
};
```

### Méthode

1. Ouvrir n8n → workflow `7DB53pFBW70OtGlM`
2. Double-clic sur node **`Consolidate (JS)`**
3. Dans le code, ligne 130, changer `cited_by_1_llm: 0` → `cited_by_1_llms: 0`
4. Save
5. **Idem dans le node dupliqué** `Consolidate (JS)1` (id `d2bef7da-3fc3-4493-a16b-a092f5048b8a`) si le path 2 est encore actif. Le code est identique.

### Vérif

Trigger Phase 1 sur une sous-cat fresh (ex: `edtech-fr`) et inspecter le summary retourné :

```json
{
  "total_unique_companies": 28,
  "cited_by_4_llms": 5,
  "cited_by_3_llms": 8,
  "cited_by_2_llms": 9,
  "cited_by_1_llms": 6   // ← clé pluriel cohérente, plus de _1_llm orphelin
}
```

---

## §4.3 — Phase 2 Build summary race condition (workflow `c85c3pPFq85Iy6O2`)

### Diagnostic du diagram

Trace des connections actuelles du workflow Phase 2 (extraction MCP `get_workflow_details`) :

```
Webhook Trigger
  → Extract params
  → Get companies from report
  → Build Apollo searches (per company)
  → Split per company (splitInBatches v3, 2 outputs)
       ├── output 0 (done) → Build summary → Webhook response
       └── output 1 (loop) → Apollo people search
                               ↓ (FAN-OUT — bug)
                               ├→ Score & filter (top N per company)
                               │   → Aggregate for bulk_match
                               │   → Apollo bulk_match (enrich)
                               │   → Spread enriched results
                               │   → Upsert prospect in Supabase
                               │   → Log prospect_created event
                               │       (terminus — pas de retour vers Split)
                               └→ Split per company (loop-back IMMÉDIAT) ← bug
```

### Cause racine

`Apollo people search` envoie sa sortie en **fan-out** vers 2 nodes en parallèle :
1. `Score & filter` (chaîne d'enrichissement → upsert)
2. `Split per company` directement (loop-back immédiat pour next batch)

Le loop-back vers Split démarre l'itération suivante **avant** que la chaîne d'upsert ne soit terminée. Quand Split a fini d'itérer toutes les companies, son output 0 (done) déclenche Build summary — pendant que les derniers Upsert + Log de la dernière itération sont encore en flight.

→ Build summary fait `SELECT COUNT(*) FROM prospects WHERE report_id = ...` sur une DB qui n'a pas encore reçu les derniers commits → `total = 0` (ou un nombre partiel).

### Patch (Option B raffinée)

**Refacto des connections pour que le loop ne reprenne qu'après la fin de la chaîne d'upsert** :

1. **Retirer** la connection : `Apollo people search` → `Split per company`
2. **Ajouter** la connection : `Log prospect_created event` → `Split per company`

Schéma cible :

```
Split per company (output 1 loop)
  → Apollo people search
  → Score & filter
  → Aggregate for bulk_match
  → Apollo bulk_match (enrich)
  → Spread enriched results
  → Upsert prospect in Supabase
  → Log prospect_created event
  → Split per company (loop-back PROPRE — next batch après commit)
```

Quand toutes les iterations finissent → Split output 0 (done) → Build summary trouve toutes les rows commit → total cohérent.

### Méthode (UI n8n, ~1 min)

1. Ouvrir n8n → workflow `c85c3pPFq85Iy6O2`
2. **Supprimer** la flèche entre `Apollo people search` et `Split per company` (clic sur la flèche, Delete)
3. **Tirer** une nouvelle flèche depuis la sortie de `Log prospect_created event` vers l'entrée de `Split per company`
4. Save
5. Vérifier avec un test trigger sur `agences-digitales-fr` (déjà 6 prospects) — le summary doit retourner `total >= 6`.

### Test régression

Après le patch, valider :
- Le `total` dans la réponse webhook = nombre réel de prospects (pas 0)
- Pas de timeout sur les requêtes longues (le loop séquentiel ralentit légèrement le sourcing — acceptable car Apollo bulk_match est rate-limit naturel)
- L'erreur 429 Apollo (si rate limit atteint) est toujours gérée par le `timeout: 30000` des HTTP nodes

### Risques

- **Faible** : 2 modifications de connections, aucune logique métier touchée. Un rollback prend 30 secondes (refaire les flèches dans l'autre sens).
- **À surveiller** : si Apollo retourne 0 résultats sur une iteration, la chaîne `Score → Aggregate → bulk_match → Spread → Upsert → Log` s'exécute quand même en mode "no-op" — vérifier qu'aucun node ne plante sur `items` vide. Sinon ajouter un IF en garde-fou.

---

## Récapitulatif des fichiers à patcher

| Workflow | Node(s) | Changement |
|---|---|---|
| `7DB53pFBW70OtGlM` (Phase 1) | `Consolidate (JS)`, `Consolidate (JS)1` | 1 caractère `_llm` → `_llms` ligne 130 |
| `c85c3pPFq85Iy6O2` (Phase 2) | Connections globales | -1 flèche, +1 flèche |

Aucun risque structurel. Tous deux testables sur une sous-cat dédiée (ex `edtech-fr`) avant déploiement large.
