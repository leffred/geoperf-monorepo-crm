# Patch n8n Phase 1 — Prompt PME/ETI FR (S18)

**Workflow** : `7DB53pFBW70OtGlM` (Phase 1 extraction)
**Nodes ciblés** : 8 nodes `chainLlm` (4 LLMs × 2 paths webhook)
**Date** : 2026-05-04

---

## Liste exacte des nodes à patcher

Chaque node `@n8n/n8n-nodes-langchain.chainLlm` a un paramètre `text` qui contient le prompt. À remplacer **dans les 8 nodes** :

### Path 1 (webhook principal)
- `1. Perplexity Sonar Pro` (id `744b0553-...`)
- `2. GPT-4o search` (id `db7a5775-...`)
- `3. Gemini 2.5 Pro` (id `ed86320d-...`)
- `4. Claude Sonnet 4.6` (id `99ccd875-...`)

### Path 2 (webhook duplicaté, suffix "1")
- `1. Perplexity Sonar Pro1` (id `c8906533-...`)
- `2. GPT-4o search1` (id `05869b33-...`)
- `3. Gemini 2.5 Pro1` (id `618f1515-...`)
- `4. Claude Sonnet 4.1` (id `cb5cdd50-...`)

> Note : les 2 paths semblent dédoubler le pipeline. Patcher les 8 par cohérence. Si le path "1" est obsolète, Fred peut le supprimer en parallèle.

---

## Prompt AVANT (extrait, identique pour les 8)

```
=Tu es un analyste sectoriel B2B. Identifie les {{ $json.top_n }} sociétés mondiales les plus
importantes du secteur "{{ $json.sous_categorie }}" en {{ $json.year }}. Pour chaque société :
nom officiel, domaine principal (ex: blackrock.com), pays, ville du siège, fourchette
d'effectifs, description en 1 phrase, métrique clé du secteur (nom/valeur/unité/année),
3 sources web vérifiées (URL, titre, éditeur). Réponse en JSON STRICT, sans préambule,
sans backticks. Schéma : { ...identique... }
```

---

## Prompt APRÈS (à coller tel quel dans le champ `text` des 8 nodes)

```
=Tu es un analyste sectoriel français spécialisé dans les PME et ETI. Identifie {{ $json.top_n }} sociétés FRANÇAISES de la sous-catégorie "{{ $json.sous_categorie }}" en {{ $json.year }}.

CRITERES STRICTS DE SELECTION (toutes conditions cumulées) :
- Siège social en France (vérifié)
- Effectif estimé entre 50 et 500 employés (PME/ETI)
- Activité B2B principalement (ou B2B2C marqué)
- Marché français actif (pas une simple filiale locale d'un groupe étranger)
- Privilégier les acteurs en croissance / scale-ups FR

EXCLUSIONS OBLIGATOIRES (rejette d'office) :
- CAC 40, SBF 120, multinationales > 1000 employés
- GAFAM, Big4 (Deloitte, PwC, EY, KPMG), Big tech US/CN
- Filiales françaises de groupes étrangers (ex : Microsoft France)
- Sociétés sans présence commerciale FR significative

VALIDATION DU CHAMP "domain" — CRITIQUE (fix bug #4.1) :
Le champ "domain" DOIT être un nom de domaine racine valide :
- Format strict : nom-de-domaine.tld (ex: alan.com, doctolib.fr, payfit.com)
- Regex à respecter : ^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(\.[a-z]{2,})?$
- TLDs privilégiés pour ICP FR : .fr, .com, .io, .ai, .tech, .co
- INTERDIT : description, slogan, phrase, "n/a", null, chaîne vide
- INTERDIT : URL complète avec http(s):// ou path (donner "lemag.fr", pas "https://www.lemag.fr/about")
- Si le domaine est inconnu ou douteux : EXCLURE la société (ne pas inventer)

Pour chaque société retiens : nom officiel, domaine racine (ex: alan.com), pays (toujours "France"), ville du siège (FR), fourchette d'effectifs (entre "50-100", "100-250", "250-500"), description en 1 phrase factuelle, métrique clé du secteur (nom/valeur/unité/année), 3 sources web vérifiées (URL, titre, éditeur).

Réponse en JSON STRICT, sans préambule, sans backticks, schéma exact :
{"metadata":{"category":"...","year":...,"top_n_requested":...,"language":"fr"},"companies":[{"rank":1,"name":"...","domain":"...","country":"France","city":"...","employees_range":"...","description":"...","key_metric":{"name":"...","value":"...","unit":"...","as_of_year":2025},"sources":[{"url":"https://...","title":"...","publisher":"..."}]}]}
```

---

## Méthode de patch (UI n8n)

1. Ouvrir n8n → workflow `7DB53pFBW70OtGlM`
2. Pour chacun des 8 nodes ci-dessus :
   - Double-clic pour ouvrir le panneau du node
   - Champ "Prompt" / "Text" (mode `define`) → tout sélectionner → coller la version APRÈS
   - "Execute Step" sur le 1er node pour valider qu'il run sans erreur (dry-run)
   - Save
3. Save & Activate workflow
4. Test : trigger manuel sur sous-cat `agences-digitales-fr` (1 des 10 nouvelles S18) :
   ```bash
   curl -X POST "<webhook_url>" -H "Content-Type: application/json" \
     -d '{"sous_categorie":"agences-digitales-fr","top_n":30,"year":2026}'
   ```
5. Vérifier dans Supabase :
   ```sql
   SELECT name, domain FROM companies
   WHERE id IN (
     SELECT company_id FROM report_companies
     WHERE report_id = (
       SELECT id FROM reports
       WHERE sous_categorie = 'agences-digitales-fr'
       ORDER BY created_at DESC LIMIT 1
     )
   ) ORDER BY rank;
   ```
   - Les 30 marques doivent être PME FR (pas Microsoft / Accenture / Publicis)
   - Tous les `domain` doivent matcher la regex
   - 100 % en France

---

## Patch via MCP (option avancée)

Le MCP n8n `update_workflow` exige une réécriture complète SDK des 38 nodes — risque d'erreur sur workflow actif. **Préférer la méthode UI ci-dessus**. Si Fred veut automatiser :

```js
// pseudo : ne pas exécuter sans backup workflow
const wf = await n8n.getWorkflow('7DB53pFBW70OtGlM');
for (const node of wf.nodes) {
  if (node.type === '@n8n/n8n-nodes-langchain.chainLlm') {
    node.parameters.text = NEW_PROMPT;  // contenu ci-dessus
  }
}
await n8n.updateWorkflow('7DB53pFBW70OtGlM', wf);
```
