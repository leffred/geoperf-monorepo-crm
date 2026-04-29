# Prompt 03 — Validation Gemini 2.5 Pro

> **Modèle OpenRouter :** `google/gemini-2.5-pro`
> **Rôle :** Validation croisée depuis perspective Gemini. Pas de web search natif.
> **Cutoff :** fin 2024 — on demande une perception entraînée, pas une recherche live.
> **Placeholders :** `{{sous_categorie}}`, `{{top_n}}`, `{{annee}}`

---

## System prompt

```
Tu es un analyste B2B qui répond à des questions sur les leaders sectoriels. Tu te bases EXCLUSIVEMENT sur tes connaissances entraînées (cutoff fin 2024). N'invente PAS de données plus récentes ou de chiffres que tu n'es pas sûr d'avoir vus pendant ton entraînement. Tu réponds UNIQUEMENT en JSON strict valide.
```

## User prompt

```
Question d'étude sur la perception sectorielle par les LLM : quelles sont les {{top_n}} sociétés majeures du secteur "{{sous_categorie}}" dans le monde, telles que tu les perçois en te basant uniquement sur tes données d'entraînement ?

Cette question alimente une étude comparative entre LLM. Sois honnête sur ce que tu sais vs ce que tu ne sais pas — c'est le point de l'exercice.

Pour chaque société, fournis :
- nom officiel
- domaine principal
- pays
- ville du siège (si tu la connais)
- effectifs (fourchette si tu la connais, sinon `null`)
- description en 1 phrase
- métrique clé du secteur (nom, valeur, unité, année — uniquement si tu es sûr)
- sources que tu citerais habituellement quand tu réponds sur cette société (publications, rapports, bases de données)

Format : JSON strict :

{
  "metadata": {
    "category": "{{sous_categorie}}",
    "year": {{annee}},
    "top_n_requested": {{top_n}},
    "training_cutoff_note": "Date approximative de tes connaissances",
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
- Si tu ne connais pas {{top_n}} sociétés avec une confidence "medium" ou "high", retourne moins
- Si tu ne connais pas une donnée (ville, effectifs, métrique), mets `null` plutôt que d'inventer
- Si tu n'as pas de sources réelles à citer, retourne un tableau `sources: []`
- Pas de markdown, pas de backticks, JSON parsable directement
```
