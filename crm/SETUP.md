# SETUP.md — Phase 4 Attio CRM mirror

> Brief autosuffisant pour Claude Code CLI (CC CLI). Lis ce doc, exécute les TODO dans l'ordre. Pas besoin de remonter en Cowork — ce qui doit se faire en Cowork est listé en fin (étape 6) et Fred t'orientera.

## TL;DR

Construire la sync **Supabase → Attio** :
- Phase 4a : ajouter colonnes Attio sync (SQL migration) + vue helper
- Phase 4b : draft du workflow n8n `geoperf_phase4_attio_sync`
- Phase 4c : doc Fred-side pour créer les custom fields Attio + tester sync

Mode test : workflow flag `dry_run = true` par défaut, n'écrit pas vraiment dans Attio tant que Fred n'a pas validé.

## Pré-requis (Fred-side, déjà OK)
- ✅ Compte Attio créé
- ✅ API key Attio générée
- ✅ Credential n8n `Attio API Key` créée (HTTP Header Auth, header `Authorization` value `Bearer <key>`) — la clé reste dans n8n, JAMAIS dans le repo
- ✅ Documentation `crm/ATTIO_MAPPING.md` (mapping de référence)

**Note pour CC CLI** : tu n'as PAS besoin de la clé Attio. Le workflow n8n la lira via le credential `Attio API Key` quand on l'activera depuis Cowork. Ne mets JAMAIS de clé en clair dans `crm/attio_workflow_sdk.ts`.

## TODO en CC CLI (durée estimée : 60-90 min)

### Étape 1 — Lire `crm/ATTIO_MAPPING.md` (5 min)
Comprends le mapping prospects → Attio People + companies → Attio Companies. Notamment les 12 custom fields à créer dans Attio UI (étape Fred).

### Étape 2 — Vérifier la migration SQL draft (10 min)
Lis `crm/migrations_drafts/01_add_attio_sync_columns.sql`.
Validate :
- Colonnes ajoutées : `prospects.attio_synced_at`, `prospects.attio_sync_error`, `companies.attio_record_id`, `companies.attio_synced_at`, `companies.attio_sync_error`
- 2 index pour delta sync
- 1 vue `v_attio_prospects_sync_queue` qui join prospects + companies + reports + report_companies
- Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE VIEW`)

Si OK : copie `01_add_attio_sync_columns.sql` vers `supabase/migrations/20260429_attio_sync_columns.sql` (avec un timestamp préfixe).

### Étape 3 — Construire le draft du workflow n8n (40-60 min)

Crée `crm/attio_workflow_sdk.ts` avec le code SDK n8n suivant la structure :

```
Webhook trigger /webhook/geoperf-attio-sync (body: { dry_run?: bool, max?: int })
  → Extract params (default dry_run=true, max=20)
  → Get prospects to sync (Postgres → vue v_attio_prospects_sync_queue WHERE sync_state IN ('new','updated') LIMIT max)
  → Split per prospect (splitInBatches)
    onEachBatch:
      → Build Attio People payload (Code node, voir ATTIO_MAPPING.md)
      → Get company attio_record_id (Postgres → companies WHERE id = $1)
      → IF company.attio_record_id IS NULL :
          → POST /objects/companies/records → save company.attio_record_id
      → IF prospect.attio_record_id IS NULL :
          → POST /objects/people/records → save prospect.attio_record_id
        ELSE :
          → PATCH /objects/people/records/{id}
      → IF dry_run = false : Update prospect.attio_synced_at = NOW()
      → IF prospect.download_at, call_booked_at, conversion_at récents : POST /notes
    parallel branch :
      → nextBatch (loop continue même si Attio plante)
    onDone :
      → Aggregate stats (count synced, errors)
      → Webhook response { ok, dry_run, synced_count, errors }
```

**Conventions à respecter** (voir `docs/CLAUDE-backend.md`) :
- Tous params en `jsonb` pour les Postgres nodes
- Loop fan-out splitInBatches : nextBatch en branche parallèle, sinon le loop casse si une iteration plante
- Headers Attio : `Authorization: Bearer <key>` via credential n8n nommé `Attio API Key`

**Inspire-toi** des workflows existants dans `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` (même pattern).

### Étape 4 — Documenter les actions Fred-side (10 min)

Crée `crm/FRED_TODO.md` avec :

1. **Créer 12 custom fields Attio** (Settings → Custom fields)
   - 8 sur People : geoperf_lead_score, geoperf_status, geoperf_tracking_token, geoperf_landing_url, geoperf_subcategory, geoperf_downloaded_at, geoperf_calendly_booked_at, geoperf_converted_at
   - 4 sur Companies : geoperf_country, geoperf_visibility_score, geoperf_ai_rank, geoperf_market_rank_estimate, geoperf_ai_saturation_gap

2. **Créer credential n8n `Attio API Key`** (HTTP Header Auth)
   - Header name : `Authorization`
   - Header value : `Bearer <API_KEY>` (la clé que Fred a déjà)

3. **Créer Pipeline Attio "GEOPERF Prospects"** (optionnel, peut être fait après le 1er sync)
   - Stages : New → Engaged → Call Booked → Converted
   - Mapping stage = custom field `geoperf_status`

### Étape 5 — Commit + push GitHub (5 min)

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF
git add crm/ supabase/migrations/20260429_attio_sync_columns.sql
git commit -m "Phase 4 Attio CRM mirror : SQL + workflow SDK draft + docs"
git push origin main
```

(Note : le repo monorepo GEOPERF n'a pas le push_update.ps1 — c'est seulement le repo `landing/` qui en a un. Fais le `git push` standard.)

### Étape 6 — Actions à faire en Cowork (PAS en CC CLI)

Une fois CC CLI fini, dis "Phase 4 drafts prêts" à Claude en Cowork. Cowork va :
- Appliquer la migration SQL via MCP Supabase
- Créer le workflow n8n via MCP n8n SDK (depuis `crm/attio_workflow_sdk.ts`)
- Activer le workflow en mode dry_run pour test
- Trigger un premier sync, valider que les 27 prospects pré-existants apparaissent dans Attio
- Une fois validé : flip dry_run = false

## Critères de succès CC CLI

- [ ] `crm/migrations_drafts/01_add_attio_sync_columns.sql` validé
- [ ] `supabase/migrations/20260429_attio_sync_columns.sql` créé (copie horodatée)
- [ ] `crm/attio_workflow_sdk.ts` complet (~250 lignes, structure conforme au pattern Phase 2.2)
- [ ] `crm/FRED_TODO.md` rédigé avec 3 actions Fred-side
- [ ] `git push` réussi sur `main`

## Anti-patterns à éviter

- Ne PAS appliquer la migration SQL directement (pas d'accès Supabase MCP en CC CLI sans setup). Laisse Cowork le faire.
- Ne PAS créer le workflow n8n directement (pareil). Laisse Cowork le faire via MCP.
- Ne PAS hardcoder l'API key Attio dans le code. Le workflow doit la lire via le credential n8n.
- Ne PAS lever le dry_run par défaut. Fred doit valider avant.
- Ne PAS écrire de fichier > 150 lignes via Write tool sur ce mount. Si besoin, bash heredoc avec `cat > file << 'EOF'`.
