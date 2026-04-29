# FRED_TODO.md — Phase 4 Attio CRM mirror

> Actions à faire dans Attio + n8n UI **avant** que Cowork ne lance le 1er sync.
> Durée estimée : 30-45 min. Tout est à faire dans des UIs (Attio Settings, n8n cloud).

## ✅ Pré-requis déjà OK
- Compte Attio créé
- API key Attio générée (en Settings → Developers → API tokens)
- Documentation source : [`crm/ATTIO_MAPPING.md`](./ATTIO_MAPPING.md)

---

## 1. Créer 12 custom fields dans Attio (20 min)

Aller dans **Attio → Settings → Objects**, sélectionner l'objet, puis "Add attribute".

**Important** : le `slug` doit être EXACTEMENT celui listé ci-dessous (lowercase, snake_case, préfixe `geoperf_`). Le workflow n8n s'en sert pour matcher les fields. Si tu changes le slug côté Attio, il faut aussi le changer dans `crm/attio_workflow_sdk.ts` puis re-sync via Cowork.

### Sur l'objet **People** (8 fields)

| Slug Attio | Type | Notes |
|---|---|---|
| `geoperf_lead_score` | Number | Range 0-100 |
| `geoperf_status` | Select | Options : `new`, `queued`, `sequence_a`, `sequence_b`, `engaged`, `converted`, `opted_out`, `bounced`, `disqualified` |
| `geoperf_tracking_token` | Text | 24-hex token unique |
| `geoperf_landing_url` | URL | Format `https://geoperf.com/{slug}?t={token}` |
| `geoperf_subcategory` | Text | ex : "Asset Management" |
| `geoperf_downloaded_at` | Timestamp | |
| `geoperf_calendly_booked_at` | Timestamp | |
| `geoperf_converted_at` | Timestamp | |

### Sur l'objet **Companies** (4 fields)

| Slug Attio | Type | Notes |
|---|---|---|
| `geoperf_country` | Text | ex : "France", "États-Unis" |
| `geoperf_visibility_score` | Number | 0-4 (nombre de LLM qui citent) |
| `geoperf_ai_rank` | Number | Rang dans l'agg LLM |
| `geoperf_market_rank_estimate` | Number | Rang marché estimé |
| `geoperf_ai_saturation_gap` | Number | Range -100 à +100 (positif = sous-représenté = opportunité) |

> **Anti-piège** : pour le field `geoperf_status` (Select), il faut taper les 9 options manuellement dans l'UI Attio. Ne pas mettre de virgule ni de point — uniquement le slug brut.

---

## 2. Créer le credential n8n `Attio API Key` (5 min)

Dans n8n cloud (`https://fredericlefebvre.app.n8n.cloud`) :

1. Settings → Credentials → New
2. Type : **HTTP Header Auth**
3. Name : `Attio API Key` (exactement, sensible à la casse — le workflow référence ce nom)
4. Header Name : `Authorization`
5. Header Value : `Bearer <ton_api_key_attio>` (la clé que tu as copiée depuis Attio Settings → Developers)
6. Save

**Sécurité** : l'API key reste dans n8n vault, JAMAIS dans le repo GitHub. Le workflow `phase4-attio-sync` lit le credential par référence de nom, pas en clair.

---

## 3. Créer le pipeline Attio "GEOPERF Prospects" (10 min — optionnel après 1er sync)

Cette étape peut être faite APRÈS le 1er sync (une fois que tu vois les 27 prospects dans Attio People). Elle organise la vue commerciale.

1. Attio → Lists → New List
2. Nom : `GEOPERF Prospects`
3. Type : Pipeline
4. Object : People
5. Stages :
   - **New** (default)
   - **Engaged** (downloaded LB)
   - **Call Booked** (Calendly booké)
   - **Converted** (audit GEO payé)
6. Mapping stage = custom field `geoperf_status`
   - `new`, `queued`, `sequence_a`, `sequence_b` → stage **New**
   - `engaged` → stage **Engaged**
   - status avec `call_booked_at` non NULL → stage **Call Booked**
   - `converted` → stage **Converted**
7. Filtre par sous-catégorie : créer une smart list filtrée sur `geoperf_subcategory = "Asset Management"` (etc.) selon ce qui t'intéresse.

---

## ✅ Critères de validation avant de dire "GO" à Cowork

- [ ] Les 12 custom fields existent (8 People + 4 Companies) avec les bons slugs
- [ ] Credential n8n `Attio API Key` créée et testable (cliquer "Test" dans n8n donne 200)
- [ ] Tu as l'URL du workflow Attio sync que Cowork va créer (à confirmer après que Cowork ait push)

Une fois ces 3 cases cochées, dis à Cowork **"Phase 4 prêt côté Fred"** → Cowork :
1. Applique la migration `20260429_attio_sync_columns.sql` via MCP Supabase
2. Crée le workflow `geoperf_phase4_attio_sync` via MCP n8n SDK depuis `crm/attio_workflow_sdk.ts`
3. Trigger un test sync `dry_run=true, max=5` pour valider que les 5 premiers prospects + leurs companies apparaissent dans Attio (sans persister `attio_synced_at` côté Supabase)
4. Si OK → trigger le sync complet `dry_run=false, max=50` pour persister la sync
5. Vérifie en SQL : `SELECT COUNT(*) FROM prospects WHERE attio_synced_at IS NOT NULL;`

---

## Anti-patterns

- ❌ Ne PAS créer manuellement des records Attio à la main — le workflow va les créer/upsert. Si tu pré-crées, l'upsert va dédoublonner sur `email_addresses` (people) ou `domains` (companies), donc en théorie ça fusionne, mais c'est plus propre de laisser le workflow tout créer.
- ❌ Ne PAS partager l'API key Attio dans Slack/email/repo. Si elle leak, regenerate immédiatement dans Attio Settings.
- ❌ Ne PAS lever `dry_run = false` au 1er sync. Faire d'abord un dry_run pour vérifier que les data dans Attio sont propres (noms corrects, custom fields populés, etc.), puis seulement après dire à Cowork de re-trigger en `dry_run=false`.
