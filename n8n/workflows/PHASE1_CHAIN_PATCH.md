# Patch : chaînage Phase 1 → Synthesis

> **Objectif :** quand le workflow `GEOPERF Phase 1 — Extraction & Consolidation` termine avec succès, déclencher automatiquement `GEOPERF Phase 1.1 — Synthesis & HTML Render` pour générer le livre blanc HTML brandé.

## Méthode 1 — HTTP webhook call (simple, recommandé)

Dans le workflow **`GEOPERF Phase 1 — Extraction & Consolidation`** :

1. Ouvre le node **"Mark report as ready"** (avant-dernier node)
2. Après lui (avant "Webhook response"), ajoute un node **"HTTP Request"** :
   - **Method** : POST
   - **URL** : `https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-synthesis`
   - **Headers** : `Content-Type: application/json`
   - **Body Type** : JSON
   - **Body** : `={{ JSON.stringify({ report_id: $('Consolidate (JS)').item.json.report_id, top_n: $('Extract params').item.json.top_n, model: 'anthropic/claude-haiku-4.5' }) }}`
   - **Options → Timeout** : `120000` (2 min)
   - **Options → Continue on Fail** : `true` (pour ne pas bloquer le 1er workflow si la synthèse échoue)
3. Connecte : `Mark report as ready` → `HTTP Synthesis trigger` → `Webhook response`
4. Update le node **"Webhook response"** pour inclure aussi le `html_url` :
   ```
   ={{ { ok: true, report_id: $('Consolidate (JS)').item.json.report_id, sous_categorie: $('Consolidate (JS)').item.json.sous_categorie, stats: $('Consolidate (JS)').item.json.consolidated.stats, top_5: $('Consolidate (JS)').item.json.consolidated.companies.slice(0,5).map(c => ({ rank: c.rank_consolidated, name: c.name, visibility: c.visibility_score + '/4' })), html_url: $('HTTP Synthesis trigger').item.json.html_url } }}
   ```

## Méthode 2 — Execute Workflow node (n8n natif)

Alternative si tu préfères : utilise le node `Execute Workflow` (au lieu de HTTP) :
- **Workflow** : sélectionne `GEOPERF Phase 1.1 — Synthesis & HTML Render`
- **Input data** : passe `{report_id, top_n, model}` en data

Plus propre que HTTP mais nécessite que le workflow synthesis soit "callable from sub-workflow" dans ses settings.

## Test du chaînage

Une fois le patch appliqué :
```bash
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract \
  -H "Content-Type: application/json" \
  -d '{"category_slug":"asset-management","top_n":10,"year":2026}'
```

La réponse doit inclure `html_url` (URL signée Supabase Storage, valide 7 jours).

## Workflow synthesis seul (sans chaînage)

Le workflow synthesis peut aussi être appelé directement avec un `report_id` existant :
```bash
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-synthesis \
  -H "Content-Type: application/json" \
  -d '{"report_id":"61be49be-8e19-48b4-b50a-9a59f3cb987a","top_n":14,"model":"anthropic/claude-haiku-4.5"}'
```

Cette commande régénère le HTML pour un report déjà consolidé (utile pour itérer sur le template sans relancer les 4 LLM d'extraction).
