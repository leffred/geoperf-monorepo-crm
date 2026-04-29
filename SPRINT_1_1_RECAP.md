# Sprint 1.1 — Récap pour Fred

> Fait en autonomie pendant ton absence (1h). 4 livrables prêts, 6 actions à finir côté toi (~20 min).

## Architecture livrée

```
Workflow Phase 1 (déjà actif)
  → ... (extraction 4 LLM + consolidation + DB)
  → [À AJOUTER] HTTP node → Workflow Synthesis
       │
       └──► Workflow Phase 1.1 Synthesis (NEW, à importer)
              → Postgres SELECT consolidated payload
              → Code JS : build prompt
              → ChainLLM Haiku 4.5 (synthesis ~25s, $0.02)
              → Code JS : parse JSON sections
              → HTTP POST → Edge Function render_white_paper
                    │
                    └──► Edge Function Supabase (NEW, deploy à finaliser)
                          → Render HTML branded (template editorial inline)
                          → Upload Supabase Storage
                          → UPDATE reports.html_url
                          → Return signed URL (7 jours)
              → Webhook response avec html_url

Pipeline complet : extraction → consolidation → synthesis → HTML brandé en ~2 min, ~$0.20.
```

## Ce qui est prêt

✅ Bucket Supabase Storage `white-papers` créé  
✅ Colonne `reports.html_url` ajoutée  
✅ Code complet Edge Function (`supabase/functions/render_white_paper/index.ts`, 28 KB)  
✅ Stub Edge Function déployé (à mettre à jour avec le vrai code)  
✅ Workflow n8n synthesis complet (`n8n/workflows/geoperf_phase1_synthesis.json`)  
✅ Patch chaînage Phase 1 documenté (`n8n/workflows/PHASE1_CHAIN_PATCH.md`)  
✅ Doc deploy Edge Function (`supabase/functions/render_white_paper/DEPLOY.md`)

## Ce qu'il te reste à faire (~20 min)

### 1. Deploy Edge Function via Supabase CLI (5 min)

```bash
# Si pas déjà installée :
brew install supabase/tap/supabase   # ou npm install -g supabase

# Une seule fois :
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF
supabase login
supabase link --project-ref qfdvdcvqknoqfxetttch

# Deploy :
supabase functions deploy render_white_paper --no-verify-jwt
```

### 2. Variable d'environnement n8n (2 min)

n8n Cloud → Settings → Variables → New :
- Key : `SUPABASE_SERVICE_ROLE_KEY`
- Value : copier depuis Supabase Dashboard → Settings → API → `service_role` secret

### 3. Importer workflow synthesis dans n8n (2 min)

n8n Cloud → Workflows → "+" → Import from File → `n8n/workflows/geoperf_phase1_synthesis.json`

### 4. Configurer credentials sur les nodes (3 min)

Dans le workflow synthesis :
- Node Postgres "Get consolidated payload" → credential **"Postgres GEOPERF"** (déjà créée)
- Node "Model (Haiku 4.5)" → credential **"OpenRouter GEOPERF"** (déjà créée)

### 5. Activer le workflow synthesis (10 sec)

Toggle "Inactive" → "Active" en haut à droite

### 6. Patcher workflow Phase 1 pour chaîner (5 min)

Suivre les instructions de `n8n/workflows/PHASE1_CHAIN_PATCH.md` :
- Ouvrir workflow Phase 1
- Ajouter 1 node HTTP avant "Webhook response"
- Save

## Test end-to-end après ces 6 étapes

```bash
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract \
  -H "Content-Type: application/json" \
  -d '{"category_slug":"asset-management","top_n":10,"year":2026}'
```

Réponse attendue (en ~2 minutes) :
```json
{
  "ok": true,
  "report_id": "...",
  "stats": { ... },
  "top_5": [ ... ],
  "html_url": "https://qfdvdcvqknoqfxetttch.supabase.co/storage/v1/object/sign/white-papers/....html?token=..."
}
```

→ Tu cliques sur `html_url`, tu vois le livre blanc dans le navigateur.

## Test du workflow synthesis SEUL (sans relancer 4 LLM)

Si tu veux juste itérer sur le template/synthesis sans relancer toute la chaîne LLM coûteuse :

```bash
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-synthesis \
  -H "Content-Type: application/json" \
  -d '{"report_id":"61be49be-8e19-48b4-b50a-9a59f3cb987a","top_n":14}'
```

Cette commande utilise les données déjà en DB du dernier run et regénère juste le HTML. Idéal pour itérer sur le template.

## Roadmap Sprint 1.2 (optionnel, si tu veux le PDF auto)

3 options pour PDF auto :
- **Vercel Function avec puppeteer** : gratuit Hobby plan, ~10 min de setup
- **PDFShift API** : 250 PDF/mois gratuit, pas de code à déployer, juste un POST
- **Browserless.io** : 1000 PDF/mois gratuit

Mon vote : PDFShift, c'est le moins de friction (juste un POST depuis l'Edge Function avec le HTML qu'on génère déjà).

---

## Bugs connus à corriger en Sprint 1.2

1. **Doublon Goldman Sachs AM** dans la consolidation (gsam.com vs goldmansachs.com) — fix : matcher aussi par nom_normalisé même si domaines différents
2. **Gemini retourne souvent companies: []** — fix : monter `maxTokens: 8000` dans le node "Model: google/gemini-2.5-pro"
3. **Phase 1 workflow** : retirer le UNIQUE constraint sur `slug_public` (déjà fait) — vérifier que le node "Create report" n'a pas de problème si plusieurs reports même slug
