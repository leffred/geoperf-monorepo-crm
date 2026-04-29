# GEOPERF — Générateur de PDF

> Pipeline : `consolidated.json` + `sections.json` → `render.py` → HTML → `generate_pdf.js` → PDF brandé Geoperf

## Fichiers

- `template.html.j2` — template Jinja2 du livre blanc (couverture, sections, footer)
- `render.py` — script Python qui remplit le template avec les données
- `generate_pdf.js` — script Node qui convertit le HTML en PDF via Puppeteer
- `package.json` — déclare la dépendance `puppeteer`

## Installation

```bash
# Côté Python
pip install Jinja2 --break-system-packages

# Côté Node (dans pdf-generator/)
cd pdf-generator
npm install
```

## Pipeline complet (depuis le dossier racine GEOPERF)

```bash
# 1. Lancer les 4 LLM via OpenRouter (n8n ou bash)
#    → produit perplexity.json, openai.json, google.json, anthropic.json

# 2. Consolider
python prompts/phase1/consolidate.py \
    --perplexity perplexity.json \
    --openai openai.json \
    --google google.json \
    --anthropic anthropic.json \
    --output /tmp/consolidated.json \
    --report-id 12345-abc-...

# 3. Lancer Opus 4.7 avec le prompt 05_synthese_opus.md + consolidated.json
#    → produit /tmp/sections.json

# 4. Rendre le HTML
python pdf-generator/render.py \
    --consolidated /tmp/consolidated.json \
    --sections /tmp/sections.json \
    --output /tmp/lb.html \
    --report-id 12345-abc-... \
    --title "Asset Management" \
    --period "Avril 2026" \
    --top-n 50

# 5. Convertir en PDF
node pdf-generator/generate_pdf.js /tmp/lb.html /tmp/lb.pdf

# 6. Upload Supabase Storage (bucket white-papers/)
#    → fait par n8n via l'API Storage Supabase
```

## Notes

- Le template charge **Source Serif Pro**, **Inter** et **IBM Plex Mono** depuis Google Fonts. Pour générer des PDFs hors-ligne, il faut soit télécharger les fonts en local, soit s'assurer que le runtime Puppeteer a accès à internet.
- Les marges du PDF sont contrôlées par CSS `@page` (margin 22/18/24/18 mm), `printBackground: true` côté Puppeteer pour préserver les fonds navy/cream.
- Format A4 portrait par défaut. Pour A4 paysage : modifier `@page { size: A4 landscape }` dans le template.
- Le placeholder `{{ companies_data[loop.index0].visibility_score }}` dans le template suppose que `companies_data` (issu de `consolidated.json`) et `top_companies_summary` (issu de `sections.json`) sont alignés en index. C'est garanti par `render.py` qui slice les deux à la même longueur (`top_n`).
