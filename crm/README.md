# crm/ — Phase 4 Attio CRM mirror (workspace de planning)

> Ce dossier regroupe les **drafts** Phase 4 (mapping, schema SQL, workflow SDK). Une fois validés, les pièces sont **copiées** dans :
> - SQL → `supabase/migrations/`
> - Workflow → n8n cloud (via SDK MCP en Cowork)
> - Doc → `docs/`
>
> `crm/` reste comme référence + lieu d'itération future (Phase 4.1, 4.2, etc.).

## Fichiers
- `SETUP.md` — guide pas-à-pas pour CC CLI + Fred-side actions
- `ATTIO_MAPPING.md` — schema mapping Supabase ↔ Attio (source of truth)
- `migrations_drafts/01_add_attio_sync_columns.sql` — colonnes à ajouter à `prospects` et `companies`
- `attio_workflow_sdk.ts` — code source du workflow `geoperf_phase4_attio_sync`

## Status
Draft initial créé 2026-04-29. À itérer en Claude Code CLI.
