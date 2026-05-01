# Brand Monitoring Prompts (FR)

Catalogue de **30 prompts** utilisés par `saas_run_brand_snapshot` pour mesurer la visibilité d'une marque dans les réponses des LLM (ChatGPT, Claude, Gemini, Perplexity).

## Variables substituables

| Variable | Source | Exemple |
|---|---|---|
| `{brand}` | `saas_tracked_brands.name` | `AXA` |
| `{category}` | `saas_tracked_brands.category_slug` (humanisé) | `asset management` |
| `{competitors[0..2]}` | `saas_tracked_brands.competitor_domains` (3 premiers, humanisés) | `BNP Paribas`, `Amundi` |

## Stratégie

3 catégories × 10 prompts. La majorité **n'incluent pas `{brand}`** (détection organique). Quelques-uns en concurrentiel utilisent `{brand}` directement (positioning) — la `citation_rate` reste interprétable car ces prompts forcent la mention. Le score d'agrégation pondère par rang quand un classement est détecté dans la réponse.

| Fichier | Catégorie | Variables principales |
|---|---|---|
| `system_prompt.md` | Instructions communes | aucune |
| `01_direct_search.md` | Recherche directe sectorielle | `{category}` |
| `02_use_case.md` | Recherche par cas d'usage | `{category}` |
| `03_competitive.md` | Recherche concurrentielle | `{competitors}`, `{brand}` |

## Source canonique pour l'Edge Function

`prompts.json` (même répertoire) est consommé par `supabase/functions/saas_run_brand_snapshot/`. Il est dupliqué dans le répertoire de la function pour les contraintes de bundling Supabase. **Tenir les deux fichiers en sync manuellement** jusqu'au build script.

## Format réponse attendu

Tous les prompts utilisent le `system_prompt.md` qui demande :
- Réponse naturelle en français (texte libre)
- Liste numérotée quand c'est un classement
- Section finale `Sources :` avec URLs (une par ligne)

Le parser détecte : mention de `{brand}` (case-insensitive sur nom + domaine sans TLD), rang dans la liste, mentions de concurrents, URLs sources.
