# ATTIO_MAPPING.md — Schema mapping Supabase ↔ Attio

> Source of truth du mapping pour le workflow `geoperf_phase4_attio_sync`.

## Direction de sync

**Unidirectionnelle Supabase → Attio.**
Supabase = source of truth (writes critiques DB).
Attio = miroir commercial pour Fred (vue pipeline).
Pas de write-back Attio → Supabase pour MVP.

## Mapping prospects → Attio People

| Supabase prospects | Attio People (objet `people`) | Type | Note |
|---|---|---|---|
| `email` | `email_addresses[]` (primary) | email[] | matching key Attio |
| `first_name` | `name.first_name` | personal-name | |
| `last_name` | `name.last_name` | personal-name | si pas `(pending enrichment)` |
| `title` | `job_title` | text | |
| `linkedin_url` | `linkedin` | text | |
| `phone` | `phone_numbers[]` | phone[] | |
| `lead_score` | custom field `geoperf_lead_score` | number | 0-100 |
| `status` | custom field `geoperf_status` | select | new/sequence_a/engaged/etc. |
| `tracking_token` | custom field `geoperf_tracking_token` | text | |
| `landing_url` (computed) | custom field `geoperf_landing_url` | url | `https://geoperf.com/{slug}?t={token}` |
| `reports.sous_categorie` | custom field `geoperf_subcategory` | text | depuis JOIN reports |
| `download_at` | custom field `geoperf_downloaded_at` | timestamp | |
| `call_booked_at` | custom field `geoperf_calendly_booked_at` | timestamp | |
| `conversion_at` | custom field `geoperf_converted_at` | timestamp | |

**Clé d'idempotence** : `prospects.attio_record_id` stocke l'ID Attio retourné après création. Le workflow check cette colonne pour PATCH (existe) vs POST (créer).

## Mapping companies → Attio Companies

| Supabase companies | Attio Companies (objet `companies`) | Type | Note |
|---|---|---|---|
| `domain` | `domains[]` (primary) | domain[] | matching key Attio |
| `nom` | `name` | text | |
| `country` | custom field `geoperf_country` | text | "France", "États-Unis", etc. |
| `description` | `description` | text | |
| (computed from latest `report_companies`) | custom field `geoperf_visibility_score` | number | 0-4 |
| (computed) | custom field `geoperf_ai_rank` | number | rank in AI agg |
| (computed) | custom field `geoperf_market_rank_estimate` | number | rank marché |
| (computed) | custom field `geoperf_ai_saturation_gap` | number | -100 à +100 |

**Clé d'idempotence** : `companies.attio_record_id` (à ajouter, pas encore en DB).

## Mapping prospect_events → Attio Notes

Pour MVP, on ne push QUE les **HOT events** :
- `download_completed` → Note "Downloaded LB on YYYY-MM-DD"
- `calendly_booked` → Note "Booked call: <event_url>"
- `call_held` → Note "Call held"
- `conversion` → Note "Converted: €XXX"

Les events `email_sent`, `email_opened`, `email_clicked` sont **ignorés** (Apollo s'en charge déjà).

## Custom fields Attio à créer (Settings → Custom fields)

### People (12 fields)
- `geoperf_lead_score` (Number)
- `geoperf_status` (Select : new, queued, sequence_a, sequence_b, engaged, converted, opted_out, bounced, disqualified)
- `geoperf_tracking_token` (Text)
- `geoperf_landing_url` (URL)
- `geoperf_subcategory` (Text)
- `geoperf_downloaded_at` (Timestamp)
- `geoperf_calendly_booked_at` (Timestamp)
- `geoperf_converted_at` (Timestamp)

### Companies (4 fields)
- `geoperf_country` (Text)
- `geoperf_visibility_score` (Number)
- `geoperf_ai_rank` (Number)
- `geoperf_market_rank_estimate` (Number)
- `geoperf_ai_saturation_gap` (Number)

## Endpoints Attio API utilisés

Base URL : `https://api.attio.com/v2`

| Action | Endpoint | Body / Note |
|---|---|---|
| Find person by email | `POST /objects/people/records/query` | filter: `email_addresses` matches |
| Create person | `POST /objects/people/records` | nested `data.values` |
| Update person | `PATCH /objects/people/records/{record_id}` | partial values |
| Find company by domain | `POST /objects/companies/records/query` | filter: `domains` matches |
| Create company | `POST /objects/companies/records` | |
| Update company | `PATCH /objects/companies/records/{record_id}` | |
| Add note | `POST /notes` | parent_object: people/companies, parent_record_id |

## Auth Attio

- Header : `Authorization: Bearer <ATTIO_API_KEY>`
- Stocker la clé dans **n8n credential nommée `Attio API Key`** (HTTP Header Auth)
- OU en backup : Supabase Vault `vault.decrypted_secrets WHERE name = 'attio_api_key'`

## Pipeline Attio recommandé

- Pipeline name : "GEOPERF Prospects"
- Stages : New → Engaged (downloaded LB) → Call Booked → Converted
- Mapping stage = `geoperf_status`
- Liste filtrée par sous-catégorie (smart list) — Fred crée à la main une fois les prospects sync.
