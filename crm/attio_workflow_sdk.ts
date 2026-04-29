/**
 * GEOPERF Phase 4 — Attio CRM Sync (Supabase → Attio)
 *
 * Webhook : POST /webhook/geoperf-attio-sync
 * Body    : { dry_run?: boolean (default true), max?: number (default 20) }
 *
 * Flow par batch (1 prospect à la fois) :
 *   1. buildPayloads (Code) : transforme la ligne de v_attio_prospects_sync_queue
 *      en payloads Attio (company + person + note milestone éventuelle).
 *   2. upsertCompany (HTTP) : POST si company.attio_record_id IS NULL, sinon PATCH.
 *   3. saveCompanyId (Code + Postgres) : extrait record_id Attio, l'enregistre sur
 *      companies.attio_record_id, puis injecte le link dans person_payload.
 *   4. upsertPerson (HTTP) : POST si prospect.attio_record_id IS NULL, sinon PATCH.
 *   5. savePersonId (Postgres) : enregistre prospect.attio_record_id +
 *      attio_synced_at (uniquement si dry_run = false).
 *   6. ifHasNote → createNote (HTTP POST /notes) : note pour HOT event récent.
 *
 * Loop fan-out : nextBatch est branché en PARALLÈLE depuis buildPayloads
 *   (cf docs/CLAUDE-backend.md L61) — si Attio plante sur un prospect, le loop
 *   continue avec le prospect suivant.
 *
 * Credentials : node HTTP utilise credential n8n `Attio API Key`
 *   (HTTP Header Auth, header `Authorization` value `Bearer <key>`).
 *   À attacher manuellement après création du workflow via MCP.
 *
 * Mode dry_run : par défaut true. Les calls Attio sont exécutés (création visible
 *   dans Attio UI), mais Supabase n'écrit PAS attio_synced_at, donc le prospect
 *   re-rentrera dans la queue au sync suivant. Pour activer la sync réelle,
 *   trigger le webhook avec body { dry_run: false }.
 */

import { workflow, node, trigger, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

// =====================================================================
// SQL queries — tous les params en jsonb (cf CLAUDE-backend.md L23)
// =====================================================================

const GET_PROSPECTS_QUERY = `
SELECT *
FROM public.v_attio_prospects_sync_queue
WHERE sync_state IN ('new','updated')
ORDER BY prospect_id
LIMIT (($1::jsonb)->>'max')::int;`;

const SAVE_COMPANY_ID_QUERY = `
UPDATE public.companies
SET attio_record_id = COALESCE(attio_record_id, ($1::jsonb)->>'attio_id'),
    attio_synced_at = CASE WHEN (($1::jsonb)->>'dry_run')::bool = false THEN NOW() ELSE attio_synced_at END,
    attio_sync_error = NULL
WHERE id = (($1::jsonb)->>'company_id')::uuid
RETURNING id, attio_record_id;`;

const SAVE_PERSON_ID_QUERY = `
UPDATE public.prospects
SET attio_record_id = COALESCE(attio_record_id, ($1::jsonb)->>'attio_id'),
    attio_synced_at = CASE WHEN (($1::jsonb)->>'dry_run')::bool = false THEN NOW() ELSE attio_synced_at END,
    attio_sync_error = NULL,
    updated_at = NOW()
WHERE id = (($1::jsonb)->>'prospect_id')::uuid
RETURNING id, attio_record_id, attio_synced_at;`;

// =====================================================================
// Inline JS pour Code nodes
// =====================================================================

const BUILD_PAYLOADS_JS = `
const FRESH_MS = 24 * 60 * 60 * 1000;
const dry_run = $('Extract params').item.json.dry_run;
const now = new Date();
const isFresh = (ts) => ts && (now - new Date(ts)) < FRESH_MS;

return items.map(item => {
  const p = item.json;
  const subSlug = p.subcategory_slug || '';
  const landing_url = subSlug ? \`https://geoperf.com/\${subSlug}?t=\${p.tracking_token}\` : null;

  // -- Company payload (POST si NULL, PATCH sinon) --
  const company_values = {
    name: p.company_name,
    geoperf_country: p.company_country || null,
    geoperf_visibility_score: p.visibility_score,
    geoperf_ai_rank: p.ai_rank,
    geoperf_market_rank_estimate: p.market_rank_estimate,
    geoperf_ai_saturation_gap: p.ai_saturation_gap ? Number(p.ai_saturation_gap) : null
  };
  if (p.company_domain) company_values.domains = [{ domain: p.company_domain }];
  const company_method = p.company_attio_record_id ? 'PATCH' : 'POST';
  const company_url = p.company_attio_record_id
    ? \`https://api.attio.com/v2/objects/companies/records/\${p.company_attio_record_id}\`
    : 'https://api.attio.com/v2/objects/companies/records';
  const company_payload = { data: { values: company_values } };

  // -- Person payload (POST si NULL, PATCH sinon). Le link company sera injecté
  //    après upsert company (cf saveCompanyIdJs). --
  const last_name_clean = (p.last_name && !String(p.last_name).includes('pending')) ? p.last_name : '';
  const person_values = {
    name: [{ first_name: p.first_name || '', last_name: last_name_clean, full_name: p.full_name || \`\${p.first_name || ''} \${last_name_clean}\`.trim() }],
    job_title: p.title || null,
    geoperf_lead_score: p.lead_score,
    geoperf_status: p.status,
    geoperf_tracking_token: p.tracking_token,
    geoperf_landing_url: landing_url,
    geoperf_subcategory: p.sous_categorie || null,
    geoperf_downloaded_at: p.download_at,
    geoperf_calendly_booked_at: p.call_booked_at,
    geoperf_converted_at: p.conversion_at
  };
  if (p.email) person_values.email_addresses = [{ email_address: p.email }];
  if (p.linkedin_url) person_values.linkedin = p.linkedin_url;
  if (p.phone) person_values.phone_numbers = [{ original_phone_number: p.phone }];

  const person_method = p.prospect_attio_record_id ? 'PATCH' : 'POST';
  const person_url = p.prospect_attio_record_id
    ? \`https://api.attio.com/v2/objects/people/records/\${p.prospect_attio_record_id}\`
    : 'https://api.attio.com/v2/objects/people/records';

  // -- Note milestone (HOT event récent < 24h) --
  let note_payload = null;
  if (isFresh(p.conversion_at)) {
    note_payload = { title: 'GEOPERF · Converted', content: \`Conversion confirmed on \${p.conversion_at}.\`, milestone: 'conversion' };
  } else if (isFresh(p.call_booked_at)) {
    note_payload = { title: 'GEOPERF · Call booked', content: \`Calendly call booked on \${p.call_booked_at}.\`, milestone: 'calendly_booked' };
  } else if (isFresh(p.download_at)) {
    note_payload = { title: 'GEOPERF · LB downloaded', content: \`Downloaded LB "\${p.sous_categorie || 'unknown'}" on \${p.download_at}.\`, milestone: 'download_completed' };
  }

  return { json: {
    prospect_id: p.prospect_id, company_id: p.company_id, dry_run,
    company_method, company_url, company_payload,
    person_method, person_url, person_payload,
    has_note: !!note_payload, note_payload
  }};
});`;

const SAVE_COMPANY_ID_JS = `
const resp = items[0]?.json || {};
const data = resp.data || resp;
const attio_id = data?.id?.record_id || data?.id || null;
const ctx = $('Build payloads').item.json;
// Injecte le link company dans person_payload pour le upsert person suivant
const person_payload = JSON.parse(JSON.stringify(ctx.person_payload));
if (attio_id) {
  person_payload.data.values.company = [{ target_object: 'companies', target_record_id: attio_id }];
}
return [{ json: {
  attio_id,
  company_id: ctx.company_id,
  dry_run: ctx.dry_run,
  prospect_id: ctx.prospect_id,
  person_method: ctx.person_method,
  person_url: ctx.person_url,
  person_payload,
  has_note: ctx.has_note,
  note_payload: ctx.note_payload
}}];`;

const SAVE_PERSON_ID_JS = `
const resp = items[0]?.json || {};
const data = resp.data || resp;
const attio_id = data?.id?.record_id || data?.id || null;
const ctx = $('Save company id').item.json;
return [{ json: {
  attio_id,
  prospect_id: ctx.prospect_id,
  dry_run: ctx.dry_run,
  has_note: ctx.has_note,
  note_payload: ctx.note_payload,
  note_parent_record_id: attio_id
}}];`;

const BUILD_NOTE_BODY_JS = `
const ctx = items[0].json;
if (!ctx.has_note || !ctx.note_payload) return [];
return [{ json: {
  parent_object: 'people',
  parent_record_id: ctx.note_parent_record_id,
  title: ctx.note_payload.title,
  format: 'plaintext',
  content: ctx.note_payload.content
}}];`;

const AGGREGATE_STATS_JS = `
const dry_run = $('Extract params').item.json.dry_run;
const max = $('Extract params').item.json.max;
const initial = $('Get prospects to sync').all().length;
return [{ json: {
  ok: true,
  dry_run,
  max,
  attempted_count: initial,
  note: dry_run ? 'dry_run=true: Attio writes effectuées mais attio_synced_at NON mis à jour (re-sync au prochain trigger)' : 'dry_run=false: sync persisté en DB'
}}];`;

// =====================================================================
// Nodes
// =====================================================================

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2,
  config: {
    name: 'Webhook Trigger',
    parameters: { httpMethod: 'POST', path: 'geoperf-attio-sync', responseMode: 'responseNode', options: {} },
    webhookId: 'geoperf-attio-sync',
    position: [0, 0]
  },
  output: [{ body: { dry_run: true, max: 20 } }]
});

const extractParams = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract params',
    parameters: {
      assignments: {
        assignments: [
          { id: '1', name: 'dry_run', value: '={{ $json.body.dry_run !== false }}', type: 'boolean' },
          { id: '2', name: 'max', value: '={{ $json.body.max || 20 }}', type: 'number' }
        ]
      },
      options: {}
    },
    position: [240, 0]
  },
  output: [{ dry_run: true, max: 20 }]
});

const getProspects = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Get prospects to sync',
    parameters: {
      operation: 'executeQuery',
      query: GET_PROSPECTS_QUERY,
      options: { queryReplacement: "={{ JSON.stringify({ max: $json.max }) }}" }
    },
    position: [480, 0]
  },
  output: [{ prospect_id: 'uuid' }]
});

const splitProspect = splitInBatches({
  version: 3,
  config: {
    name: 'Split per prospect',
    parameters: { batchSize: 1, options: {} },
    position: [720, 0]
  }
});

const buildPayloads = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build payloads',
    parameters: { jsCode: BUILD_PAYLOADS_JS },
    position: [960, 0]
  },
  output: [{ prospect_id: 'uuid', company_payload: {}, person_payload: {} }]
});

const upsertCompany = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Upsert company (Attio)',
    parameters: {
      method: '={{ $json.company_method }}',
      url: '={{ $json.company_url }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.company_payload) }}',
      options: { timeout: 30000, response: { response: { responseFormat: 'json' } } }
    },
    position: [1200, 0]
  },
  output: [{ data: { id: { record_id: 'rid' } } }]
});

const saveCompanyIdCode = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Save company id',
    parameters: { jsCode: SAVE_COMPANY_ID_JS },
    position: [1440, 0]
  },
  output: [{ attio_id: 'rid', person_payload: {} }]
});

const persistCompanyId = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Persist company.attio_record_id',
    parameters: {
      operation: 'executeQuery',
      query: SAVE_COMPANY_ID_QUERY,
      options: { queryReplacement: "={{ JSON.stringify({ company_id: $json.company_id, attio_id: $json.attio_id, dry_run: $json.dry_run }) }}" }
    },
    position: [1680, 0]
  },
  output: [{ id: 'uuid', attio_record_id: 'rid' }]
});

const upsertPerson = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Upsert person (Attio)',
    parameters: {
      method: "={{ $('Save company id').item.json.person_method }}",
      url: "={{ $('Save company id').item.json.person_url }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify($('Save company id').item.json.person_payload) }}",
      options: { timeout: 30000, response: { response: { responseFormat: 'json' } } }
    },
    position: [1920, 0]
  },
  output: [{ data: { id: { record_id: 'rid' } } }]
});

const savePersonIdCode = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Save person id',
    parameters: { jsCode: SAVE_PERSON_ID_JS },
    position: [2160, 0]
  },
  output: [{ attio_id: 'rid', has_note: true }]
});

const persistPersonId = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Persist prospect.attio_record_id',
    parameters: {
      operation: 'executeQuery',
      query: SAVE_PERSON_ID_QUERY,
      options: { queryReplacement: "={{ JSON.stringify({ prospect_id: $json.prospect_id, attio_id: $json.attio_id, dry_run: $json.dry_run }) }}" }
    },
    position: [2400, 0]
  },
  output: [{ id: 'uuid', attio_synced_at: 'ts' }]
});

const ifHasNote = node({
  type: 'n8n-nodes-base.if',
  version: 2.2,
  config: {
    name: 'If has milestone note',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'strict' },
        conditions: [
          { id: '1', leftValue: "={{ $('Save person id').item.json.has_note }}", rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }
        ],
        combinator: 'and'
      },
      options: {}
    },
    position: [2640, 0]
  },
  output: [{ ok: true }]
});

const buildNoteBody = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build note body',
    parameters: { jsCode: BUILD_NOTE_BODY_JS },
    position: [2880, 0]
  },
  output: [{ parent_object: 'people', parent_record_id: 'rid' }]
});

const createNote = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Create Attio note',
    parameters: {
      method: 'POST',
      url: 'https://api.attio.com/v2/notes',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ data: { parent_object: $json.parent_object, parent_record_id: $json.parent_record_id, title: $json.title, format: $json.format, content: $json.content } }) }}",
      options: { timeout: 30000 }
    },
    position: [3120, 0]
  },
  output: [{ data: { id: { note_id: 'nid' } } }]
});

const aggregateStats = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Aggregate stats',
    parameters: { jsCode: AGGREGATE_STATS_JS },
    position: [960, 280]
  },
  output: [{ ok: true, dry_run: true }]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Webhook response',
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json) }}',
      options: {}
    },
    position: [1200, 280]
  },
  output: [{ ok: true }]
});

// =====================================================================
// Workflow graph
// =====================================================================

export default workflow('phase4-attio-sync', 'GEOPERF Phase 4 - Attio CRM Sync')
  .add(webhookTrigger)
  .to(extractParams)
  .to(getProspects)
  .to(splitProspect
    .onDone(aggregateStats.to(webhookResponse))
    .onEachBatch(buildPayloads)
  )
  // Per-batch chain : build → upsert company → save → upsert person → save → note
  .add(buildPayloads)
  .to(upsertCompany.to(saveCompanyIdCode.to(persistCompanyId
    .to(upsertPerson.to(savePersonIdCode.to(persistPersonId
      .to(ifHasNote)
    )))
  )))
  // IF has_note : TRUE branch → buildNoteBody → createNote (FALSE branch terminates)
  .add(ifHasNote)
  .to(buildNoteBody.to(createNote))
  // Loop fan-out : nextBatch en parallèle depuis buildPayloads (le loop continue
  // même si Attio plante sur ce prospect).
  .add(buildPayloads)
  .to(nextBatch(splitProspect));
