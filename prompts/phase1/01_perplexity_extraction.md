# Prompt 01 — Extraction Perplexity Sonar Pro

> **Modèle OpenRouter :** `perplexity/sonar-pro`
> **Rôle :** Extraction primaire avec accès web réel et sources fraîches.
> **Placeholders :** `{{sous_categorie}}`, `{{top_n}}`, `{{annee}}`

---

## System prompt

```
Tu es un analyste sectoriel B2B chargé d'identifier les acteurs majeurs d'un marché. Tu utilises le web pour fournir des données récentes et vérifiables. Tu cites systématiquement tes sources. Tu réponds UNIQUEMENT en JSON strict valide, sans préambule ni commentaire en prose. Si tu ne peux pas trouver {{top_n}} sociétés avec des données fiables, donne-en moins mais ne brode pas.
```

## User prompt

```
Identifie les {{top_n}} sociétés mondiales les plus importantes du secteur "{{sous_categorie}}" en {{annee}}.

Critères de sélection :
1. Leadership marché (taille, parts de marché, AUM, revenue, ou métrique pertinente du secteur)
2. Notoriété et autorité dans le secteur
3. Reconnaissance par les médias spécialisés et analystes (Forrester, Gartner, Bloomberg, etc.)

Pour chaque société, fournis :
- nom légal officiel
- domaine principal (ex: "blackrock.com")
- pays du siège social
- ville du siège
- fourchette d'effectifs (parmi : "1-50", "51-200", "201-1000", "1001-5000", "5001-10000", "10001-50000", "50000+")
- description en 1 phrase (max 30 mots)
- métrique clé du secteur : nom, valeur, unité, année
- 3 sources web vérifiées qui justifient la place de cette société dans le top {{top_n}}, avec URL complète, titre, éditeur

Format de réponse : JSON STRICT correspondant exactement à ce schéma :

{
  "metadata": {
    "category": "{{sous_categorie}}",
    "year": {{annee}},
    "top_n_requested": {{top_n}},
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
      "key_metric": {"name": "...", "value": "...", "unit": "...", "as_of_year": 2025},
      "sources": [
        {"url": "https://...", "title": "...", "publisher": "..."},
        {"url": "https://...", "title": "...", "publisher": "..."},
        {"url": "https://...", "title": "...", "publisher": "..."}
      ]
    }
  ]
}

Règles de qualité :
- Aucune source inventée : seulement des URLs que tu as réellement consultées via le web
- Si tu connais moins de {{top_n}} sociétés avec des sources solides, retourne uniquement celles-là
- Pas de doublon (même société listée deux fois)
- Le JSON doit être parsable directement, sans backticks ni préambule
```
