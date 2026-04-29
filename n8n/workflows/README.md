# GEOPERF — Workflows n8n

## Workflows

### `geoperf_phase1_extraction.json`

**Rôle :** orchestre l'extraction Phase 1.

```
Webhook POST /geoperf-extract
    ↓ {category_slug, top_n, year, owner_email}
Get category from Supabase (slug → id)
    ↓
Insert report (status=running)
    ↓
[Parallel × 4 LLM via OpenRouter]
  ├─ Perplexity Sonar Pro
  ├─ GPT-4o search-preview
  ├─ Gemini 2.5 Pro
  └─ Claude Sonnet 4.6
    ↓
Merge 4 responses
    ↓
Code node : consolidation cross-LLM (port JS de consolidate.py)
    ↓
Insert raw_responses (4 rows)
    ↓
Upsert companies + report_companies
    ↓
Update report (status=ready)
    ↓
Webhook response → { ok, report_id, stats, top_5 }
```

**Limite v1 :** s'arrête à la consolidation + écriture DB. La synthèse Opus 4.7 et la génération PDF se font hors n8n pour le moment via les scripts du dossier `pdf-generator/`. Sera intégrée dans un workflow chaîné `geoperf_phase1_synthesis_pdf` une fois la Vercel Function déployée (Sprint 1.1).

---

## Procédure d'import dans n8n cloud

1. Ouvre **https://fredericlefebvre.app.n8n.cloud**
2. Workflows → bouton **"+" en haut à droite** → **"Import from File"**
3. Sélectionne `geoperf_phase1_extraction.json`
4. Le workflow apparaît avec tous les nodes wirés mais **2 credentials manquants à configurer** (cf. ci-dessous)

---

## Credentials à configurer

### 1. Postgres GEOPERF (pour les 5 nodes Postgres)

⚠️ **Important :** la connexion DIRECTE à Supabase (`db.<ref>.supabase.co:5432`) ne fonctionne **PAS** depuis n8n cloud (problème IPv6 / ENETUNREACH). Il FAUT utiliser le **Transaction Pooler** (IPv4).

Crée une nouvelle credential **Postgres** dans n8n avec ces valeurs exactes :

| Champ | Valeur |
|---|---|
| Host | `aws-0-eu-central-1.pooler.supabase.com` |
| Port | `6543` (transaction mode, recommandé pour n8n) |
| Database | `postgres` |
| User | `postgres.qfdvdcvqknoqfxetttch` (noter le suffixe `.qfdvdcvqknoqfxetttch`) |
| Password | `qc8RkJH8dlEbGdOX` ⚠️ **à rotater dès que possible** |
| SSL | `require` |

Nomme-la **"Supabase GEOPERF"**, puis sélectionne-la dans chacun des 5 nodes Postgres du workflow.

> **Sécurité :** le mot de passe DB a transité en clair dans le chat le 2026-04-27. À rotater depuis Supabase Dashboard → Settings → Database → Reset Password.

### 2. OpenRouter (pour les 4 nodes Model)

Crée une nouvelle credential **OpenRouter API** dans n8n :

| Champ | Valeur |
|---|---|
| API Key | (la clé OpenRouter — récupère-la via Vault) |

Récup de la clé depuis Vault (à exécuter dans Supabase SQL Editor ou via le MCP Supabase) :
```sql
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'openrouter_api_key';
```

Nomme la credential **"OpenRouter GEOPERF"**, sélectionne-la dans les 4 nodes "Model: ..." du workflow.

---

## Test du workflow

Une fois les credentials configurés :

1. Active le workflow (toggle en haut à droite)
2. Récupère l'URL du webhook (clic sur le node Webhook → onglet "Production URL")
3. Test :
   ```bash
   curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract \
     -H "Content-Type: application/json" \
     -d '{"category_slug": "asset-management", "top_n": 10, "year": 2026, "owner_email": "flefebvre@geoperf.com"}'
   ```
4. **Attendu :** réponse JSON `{ ok: true, report_id: "...", stats: {...}, top_5: [...] }`
5. Vérifier dans Supabase :
   ```sql
   SELECT id, sous_categorie, status, completed_at FROM public.reports ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM public.report_companies WHERE report_id = '<id>' ORDER BY rank LIMIT 10;
   ```

---

## Coût attendu d'une exécution

Pour `top_n=50` sur Asset Management :
- Perplexity Sonar Pro : ~$0.10 (input small + output volumineux avec sources)
- GPT-4o-search : ~$0.08
- Gemini 2.5 Pro : ~$0.06
- Claude Sonnet 4.6 : ~$0.08
- **Total ~$0.30-0.50 par exécution**

Pour test rapide : commence par `top_n=10`, coût < $0.10.

---

## Workflows à venir (Sprint 1.1+)

- `geoperf_phase1_synthesis_pdf` : prend un `report_id` ready, appelle Opus 4.7, render PDF via Vercel Function, upload Storage, update `reports.pdf_url`.
- `geoperf_phase2_apollo_sourcing` : pour un `report_id`, recherche les top 500 sociétés dans Apollo, récupère leurs décideurs, crée les `prospects`.
- `geoperf_phase2_sequence_dispatcher` : envoie les séquences mail A et B selon le statut de chaque prospect, log tous les events.
- `geoperf_sync_to_attio` : push les changements Supabase vers Attio en quasi-temps réel.
