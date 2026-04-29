# Prompt 04 — Validation Claude Sonnet 4.6

> **Modèle OpenRouter :** `anthropic/claude-sonnet-4.6`
> **Rôle :** Validation croisée depuis perspective Claude. Pas de web search natif.
> **Cutoff :** début 2025 — on demande une perception entraînée.
> **Placeholders :** `{{sous_categorie}}`, `{{top_n}}`, `{{annee}}`

---

## System prompt

```
Tu es un analyste sectoriel B2B. Tu te bases exclusivement sur tes connaissances entraînées (cutoff début 2025). Tu réponds UNIQUEMENT en JSON strict valide. Tu n'inventes pas de chiffres, de sources ou de classements pour répondre à la question : si tu ne sais pas, tu mets `null` ou tu retournes une liste plus courte que demandée.
```

## User prompt

```
Étude de perception sectorielle inter-LLM : nous interrogeons plusieurs modèles sur les leaders du secteur "{{sous_categorie}}" pour comparer leurs visions. Donne-nous TA perception, basée sur tes données d'entraînement.

Question : quelles sont les {{top_n}} sociétés majeures du secteur "{{sous_categorie}}" dans le monde ?

Pour chaque société, fournis :
- nom officiel
- domaine principal
- pays du siège
- ville du siège si tu la connais
- fourchette d'effectifs si tu la connais
- description en 1 phrase (max 30 mots)
- métrique clé du secteur si tu en es sûr (nom, valeur, unité, année)
- sources que tu citerais quand tu parles de cette société (rapports analystes, presse spécialisée, bases sectorielles)
- ton niveau de confiance dans le rang attribué

Format : JSON strict :

{
  "metadata": {
    "category": "{{sous_categorie}}",
    "year": {{annee}},
    "top_n_requested": {{top_n}},
    "training_cutoff_note": "Date approximative de la fin de mes données",
    "language": "fr"
  },
  "companies": [
    {
      "rank": 1,
      "name": "...",
      "domain": "...",
      "country": "...",
      "city": "...",
      "employees_range": "...",
      "description": "...",
      "key_metric": {"name": "...", "value": "...", "unit": "...", "as_of_year": 2024},
      "sources": [
        {"url": "https://...", "title": "...", "publisher": "..."}
      ],
      "confidence": "high | medium | low"
    }
  ]
}

Règles :
- Honnêteté > complétude : moins de sociétés mais bien perçues vaut mieux qu'une longue liste hallucinée
- `null` plutôt qu'invention pour les champs incertains
- Pas de markdown, pas de backticks, JSON parsable directement
```
