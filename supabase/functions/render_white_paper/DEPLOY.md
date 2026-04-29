# Edge Function `render_white_paper` — Procédure de déploiement

## Statut

- ✅ Code complet écrit dans `supabase/functions/render_white_paper/index.ts` (28 KB, 372 lignes)
- ✅ Bucket Supabase Storage `white-papers` créé (private, 50 MB max, accept HTML/PDF)
- ✅ Colonne `html_url` ajoutée à la table `reports`
- ⚠️ **Function déployée en stub** — il faut redeployer avec le vrai contenu

## Pourquoi le stub ?

Le code complet (28 KB) est trop gros pour être passé inline dans un appel MCP unique. Il faut utiliser la Supabase CLI ou la Management API pour le déploiement final.

## Déploiement via Supabase CLI (recommandé — 5 min)

### 1. Installer la CLI (une seule fois)

```bash
brew install supabase/tap/supabase   # macOS
# ou
npm install -g supabase
```

### 2. Login + lien projet

```bash
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF
supabase login
supabase link --project-ref qfdvdcvqknoqfxetttch
```

### 3. Deploy la function

```bash
supabase functions deploy render_white_paper --no-verify-jwt
```

(Le `--no-verify-jwt` est important : on appelle la function depuis n8n sans JWT user, on utilise le service role key dans le header.)

### 4. Tester

```bash
# Récupérer la service role key dans Supabase Dashboard → Settings → API
SERVICE_ROLE_KEY="eyJh..."

# Avec un report_id existant et un sections JSON minimal
curl -X POST https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/render_white_paper \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "report_id": "61be49be-8e19-48b4-b50a-9a59f3cb987a",
    "sections": {
      "executive_summary": "Test summary",
      "methodology": "Test method",
      "sector_overview": "Test overview",
      "ai_visibility_analysis": "Test analysis",
      "top_companies_summary": [],
      "insights_and_recommendations": [],
      "about_geoperf": "Test about"
    },
    "top_n": 14
  }'
```

Réponse attendue :
```json
{
  "ok": true,
  "report_id": "61be49be-...",
  "html_url": "https://qfdvdcvqknoqfxetttch.supabase.co/storage/v1/object/sign/white-papers/61be49be-....html?token=...",
  "html_size_bytes": 30000,
  "stats": { ... }
}
```

## Déploiement alternatif via MCP (à venir)

Quand le MCP Supabase supportera le passage de gros fichiers, on pourra rédéployer directement depuis chat.

## Configuration n8n

Dans n8n Cloud, le node HTTP qui appelle la function dans `geoperf_phase1_synthesis.json` utilise :

```
URL : https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/render_white_paper
Headers :
  Content-Type: application/json
  Authorization: Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}
```

Il faut donc setup la variable d'environnement `SUPABASE_SERVICE_ROLE_KEY` dans n8n :
- n8n Cloud → Settings → Variables → New Variable
- Key : `SUPABASE_SERVICE_ROLE_KEY`
- Value : (récupérer depuis Supabase Dashboard → Settings → API → `service_role` secret)

## Logs de la function

Une fois déployée, voir les exécutions :
- Supabase Dashboard → Edge Functions → render_white_paper → Logs
- ou via CLI : `supabase functions logs render_white_paper`

## Limites Supabase Edge Functions

- **Timeout** : 25s en runtime gratuit (suffisant pour notre rendering, on ne fait pas d'appel LLM dedans)
- **Mémoire** : 512 MB
- **Cold start** : ~200 ms
- **Custom runtime** : Deno (pas Node)
