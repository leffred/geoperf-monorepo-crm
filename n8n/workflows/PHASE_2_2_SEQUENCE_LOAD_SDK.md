# Phase 2.2 — Sequence Load Workflow (SDK code)

> Workflow n8n créé en stub le 2026-04-29 : ID `b6cwag080lQ2Kq4B` sur n8n cloud.
> URL : https://fredericlefebvre.app.n8n.cloud/workflow/b6cwag080lQ2Kq4B
> 
> **Le code SDK complet ci-dessous doit être poussé sur ce workflow.** L'API MCP a renvoyé 500 lors du premier essai (probablement transient n8n cloud), donc je l'ai stockée ici. Re-tenter avec `update_workflow` (workflowId: b6cwag080lQ2Kq4B, code: ce bloc).

## Webhook trigger

`POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-sequence-load`

Body:
```json
{
  "report_id": "uuid-du-report",
  "sequence_id": "id-de-la-sequence-Apollo",
  "lead_score_min": 50,
  "max": 50
}
```

## Pré-requis Apollo (côté Fred)

1. **Créer une sequence dans Apollo UI** (Outbound → Sequences → New). Garder en **Paused** tant que le test_mode n'est pas levé — ça empêche tout envoi pendant la phase de validation.
2. **Récupérer le `sequence_id`** : dans l'URL Apollo de la sequence, c'est l'ID après `/sequences/` (ex : `66a1b2c3...`).
3. **(Optionnel) Créer 5 custom fields** pour personnaliser les emails :
   - `landing_url` (URL)
   - `ranking_position` (number)
   - `visibility_score` (number)
   - `competitor_top1` (text)
   - `sous_categorie` (text)
   
   Si ces custom fields existent côté Apollo, modifier le `BUILD_PAYLOAD` du Code node pour ajouter `typed_custom_fields` au payload.

## Comportement

- Lit les prospects status='new', email_verified, lead_score >= min, du `report_id`.
- Pour chacun : crée un contact Apollo via `POST /api/v1/contacts` (avec `person_id` du search précédent → Apollo récupère email + nom auto).
- Stocke le `apollo_contact_id` dans `prospects.metadata`.
- À la fin du loop : aggrège les contact_ids et appelle `POST /api/v1/emailer_campaigns/{seq_id}/add_contact_ids`.
- Met à jour `prospects.status = 'sequence_a'` + log `sequence_a_enrolled` dans `prospect_events`.

## Crédits Apollo consommés

- `POST /api/v1/contacts` : 0 crédit (juste reformat de données existantes dans la DB Apollo).
- `POST /api/v1/emailer_campaigns/{id}/add_contact_ids` : 0 crédit (action sur sequence).
- **Pas de send email** tant que la sequence est paused dans Apollo UI.

## Test mode

- Tant que la sequence Apollo est **paused**, aucun email ne part même si on enroll des contacts.
- Pour lever le test_mode : Fred clique "Resume" dans Apollo UI sur la sequence après avoir validé les copies FR.

## SDK code complet à appliquer

```typescript
import { workflow, node, trigger, splitInBatches, nextBatch } from '@n8n/workflow-sdk';

const ELIGIBLE_QUERY = `WITH ranked AS (
  SELECT 
    p.id AS prospect_id, p.first_name, p.last_name, p.email, p.title, p.tracking_token,
    p.apollo_person_id, p.lead_score,
    c.nom AS company_name, c.domain AS company_domain,
    rc.rank, rc.visibility_score, r.sous_categorie,
    (SELECT c2.nom FROM report_companies rc2 JOIN companies c2 ON c2.id = rc2.company_id 
     WHERE rc2.report_id = p.report_id AND rc2.company_id <> p.company_id 
     ORDER BY rc2.rank ASC LIMIT 1) AS competitor_top1,
    LOWER(REPLACE(r.sous_categorie, ' ', '-')) AS sous_cat_slug
  FROM prospects p
  JOIN companies c ON c.id = p.company_id
  LEFT JOIN report_companies rc ON rc.report_id = p.report_id AND rc.company_id = p.company_id
  JOIN reports r ON r.id = p.report_id
  WHERE p.report_id = (($1::jsonb)->>'report_id')::uuid
    AND p.status = 'new'
    AND p.email IS NOT NULL
    AND p.email_verified = true
    AND p.lead_score >= (($1::jsonb)->>'lead_score_min')::int
    AND p.apollo_person_id IS NOT NULL
)
SELECT * FROM ranked ORDER BY lead_score DESC LIMIT (($1::jsonb)->>'max')::int;`;

const BUILD_PAYLOAD = `const out = items.map(i => {
  const p = i.json;
  const landing_url = \`https://geoperf.com/\${p.sous_cat_slug}?t=\${p.tracking_token}\`;
  return { json: {
    prospect_id: p.prospect_id,
    apollo_person_id: p.apollo_person_id,
    apollo_payload: {
      person_id: p.apollo_person_id,
      label_names: [\`geoperf:\${p.sous_cat_slug}\`, \`score-\${p.visibility_score || 0}-of-4\`, \`rank-\${p.rank || 'unknown'}\`]
    },
    personalization: {
      first_name: p.first_name,
      company_name: p.company_name,
      ranking_position: p.rank,
      visibility_score: p.visibility_score,
      landing_url,
      competitor_top1: p.competitor_top1,
      sous_categorie: p.sous_categorie
    }
  }};
});
return out;`;

const SAVE_CONTACT_ID = `const resp = items[0]?.json || {};
const contact = resp.contact || resp;
const contact_id = contact.id || resp.id;
const prospectId = $('Build Apollo payload').item.json.prospect_id;
return [{ json: { prospect_id: prospectId, apollo_contact_id: contact_id }}];`;

const webhookTrigger = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2,
  config: {
    name: 'Webhook Trigger',
    parameters: { httpMethod: 'POST', path: 'geoperf-sequence-load', responseMode: 'responseNode', options: {} },
    webhookId: 'geoperf-sequence-load',
    position: [0, 0]
  },
  output: [{ body: { report_id: 'uuid', sequence_id: 'sid' } }]
});

const extractParams = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract params',
    parameters: {
      assignments: {
        assignments: [
          { id: '1', name: 'report_id', value: '={{ $json.body.report_id }}', type: 'string' },
          { id: '2', name: 'sequence_id', value: '={{ $json.body.sequence_id }}', type: 'string' },
          { id: '3', name: 'lead_score_min', value: '={{ $json.body.lead_score_min || 50 }}', type: 'number' },
          { id: '4', name: 'max', value: '={{ $json.body.max || 50 }}', type: 'number' }
        ]
      },
      options: {}
    },
    position: [240, 0]
  },
  output: [{ report_id: 'uuid', sequence_id: 'sid', lead_score_min: 50, max: 50 }]
});

const getEligible = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Get eligible prospects',
    parameters: {
      operation: 'executeQuery',
      query: ELIGIBLE_QUERY,
      options: { queryReplacement: "={{ JSON.stringify({report_id: $json.report_id, lead_score_min: $json.lead_score_min, max: $json.max}) }}" }
    },
    position: [480, 0]
  },
  output: [{ prospect_id: 'uuid' }]
});

const buildPayload = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Apollo payload',
    parameters: { jsCode: BUILD_PAYLOAD },
    position: [720, 0]
  },
  output: [{ prospect_id: 'uuid', apollo_payload: {} }]
});

const splitProspect = splitInBatches({
  version: 3,
  config: {
    name: 'Split per prospect',
    parameters: { options: {} },
    position: [960, 0]
  }
});

const apolloCreateContact = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Apollo create contact',
    parameters: {
      method: 'POST',
      url: 'https://api.apollo.io/api/v1/contacts',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Cache-Control', value: 'no-cache' },
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.apollo_payload) }}',
      options: { timeout: 30000 }
    },
    position: [1200, 0]
  },
  output: [{ contact: { id: 'cid' } }]
});

const saveContactId = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Save contact_id',
    parameters: { jsCode: SAVE_CONTACT_ID },
    position: [1440, 0]
  },
  output: [{ prospect_id: 'uuid', apollo_contact_id: 'cid' }]
});

const updateProspectMetadata = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Update prospect metadata',
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE public.prospects SET metadata = metadata || jsonb_build_object('apollo_contact_id', ($1::jsonb)->>'apollo_contact_id', 'sequence_load_pending', true), updated_at = NOW() WHERE id = (($1::jsonb)->>'prospect_id')::uuid RETURNING id;",
      options: { queryReplacement: "={{ JSON.stringify($json) }}" }
    },
    position: [1680, 0]
  },
  output: [{ id: 'uuid' }]
});

const aggregateForEnroll = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Aggregate enrolled IDs',
    parameters: {
      operation: 'executeQuery',
      query: "SELECT array_agg(DISTINCT (metadata->>'apollo_contact_id')) FILTER (WHERE metadata->>'apollo_contact_id' IS NOT NULL AND metadata->>'sequence_load_pending' = 'true') AS contact_ids FROM public.prospects WHERE report_id = (($1::jsonb)->>'report_id')::uuid;",
      options: { queryReplacement: "={{ JSON.stringify({report_id: $('Extract params').item.json.report_id}) }}" }
    },
    position: [1200, 280]
  },
  output: [{ contact_ids: ['c1'] }]
});

const apolloEnroll = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Apollo enroll in sequence',
    parameters: {
      method: 'POST',
      url: '={{ "https://api.apollo.io/api/v1/emailer_campaigns/" + $(\\'Extract params\\').item.json.sequence_id + "/add_contact_ids" }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Cache-Control', value: 'no-cache' },
          { name: 'Content-Type', value: 'application/json' }
        ]
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ contact_ids: $json.contact_ids, sequence_no_email: false, sequence_active_in_other_campaigns_check: false }) }}',
      options: { timeout: 30000 }
    },
    position: [1440, 280]
  },
  output: [{ contacts: [] }]
});

const finalizeStatus = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Mark prospects as sequence_a',
    parameters: {
      operation: 'executeQuery',
      query: "UPDATE public.prospects SET status = 'sequence_a', first_contact_at = COALESCE(first_contact_at, NOW()), metadata = metadata - 'sequence_load_pending' || jsonb_build_object('sequence_a_started_at', NOW(), 'sequence_a_apollo_seq_id', ($1::jsonb)->>'sequence_id'), updated_at = NOW() WHERE report_id = (($1::jsonb)->>'report_id')::uuid AND metadata->>'sequence_load_pending' = 'true' RETURNING id;",
      options: { queryReplacement: "={{ JSON.stringify({report_id: $('Extract params').item.json.report_id, sequence_id: $('Extract params').item.json.sequence_id}) }}" }
    },
    position: [1680, 280]
  },
  output: [{ id: 'uuid' }]
});

const logEvents = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Log sequence_a_enrolled events',
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO public.prospect_events (prospect_id, event_type, channel, direction, metadata) SELECT id, 'sequence_a_enrolled', 'email', 'outbound', jsonb_build_object('apollo_seq_id', ($1::jsonb)->>'sequence_id', 'enrolled_at', NOW()) FROM public.prospects WHERE report_id = (($1::jsonb)->>'report_id')::uuid AND status = 'sequence_a' AND first_contact_at >= NOW() - INTERVAL '5 minutes';",
      options: { queryReplacement: "={{ JSON.stringify({report_id: $('Extract params').item.json.report_id, sequence_id: $('Extract params').item.json.sequence_id}) }}" }
    },
    position: [1920, 280]
  },
  output: [{ ok: true }]
});

const webhookResponse = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.1,
  config: {
    name: 'Webhook response',
    parameters: {
      respondWith: 'json',
      responseBody: "={{ { ok: true, report_id: $('Extract params').item.json.report_id, sequence_id: $('Extract params').item.json.sequence_id, enrolled_count: ($('Aggregate enrolled IDs').item.json.contact_ids || []).length } }}",
      options: {}
    },
    position: [2160, 280]
  },
  output: [{ ok: true }]
});

export default workflow('phase22-sequence-load', 'GEOPERF Phase 2.2 - Sequence Load (Apollo)')
  .add(webhookTrigger)
  .to(extractParams)
  .to(getEligible)
  .to(buildPayload)
  .to(splitProspect
    .onDone(aggregateForEnroll
      .to(apolloEnroll
        .to(finalizeStatus
          .to(logEvents
            .to(webhookResponse)))))
    .onEachBatch(apolloCreateContact)
  )
  .add(apolloCreateContact)
  .to(saveContactId.to(updateProspectMetadata))
  .add(apolloCreateContact)
  .to(nextBatch(splitProspect));
```

## Credentials

Le node "Apollo create contact" et "Apollo enroll in sequence" doivent utiliser le credential **`Apollo Api Key`** (HTTP Header Auth). À relier manuellement dans l'UI après update SDK car l'API MCP n'attache pas auto les credentials sur les nouveaux HTTP nodes.

## Test pas-à-pas

1. Push le workflow via SDK MCP (le retry du 500 a peut-être marché entre temps).
2. Relier les credentials Apollo sur les 2 HTTP nodes.
3. Activer le workflow.
4. Créer une sequence test dans Apollo UI (peut être un seul touche "Hello" pour valider). **PAUSE-la avant de continuer.**
5. Récupérer le sequence_id depuis l'URL Apollo.
6. Trigger le webhook avec un payload test :
   ```bash
   curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-sequence-load \\
     -H "Content-Type: application/json" \\
     -d '{"report_id":"61be49be-8e19-48b4-b50a-9a59f3cb987a","sequence_id":"<APOLLO_SEQ_ID>","lead_score_min":50,"max":3}'
   ```
   (Limit max=3 pour tester sur 3 prospects seulement.)
7. Vérifier dans Apollo UI que les 3 contacts sont créés et enrollés (mais pas envoyés car sequence paused).
8. Vérifier dans Supabase : `SELECT id, status, metadata FROM prospects WHERE report_id = '...'` — status doit être 'sequence_a' et metadata doit contenir apollo_contact_id + sequence_a_started_at.
9. Vérifier les events : `SELECT * FROM prospect_events WHERE event_type = 'sequence_a_enrolled' ORDER BY created_at DESC LIMIT 5`.

## Si tout est OK

10. Update copies FR de la sequence dans Apollo UI (utiliser les variables Apollo natives `{{first_name}}`, `{{company}}` et tes 5 custom fields si configurés).
11. Resume la sequence dans Apollo UI → emails partent selon le timing programmé (J+0, J+3, J+7 dans `docs/PHASE2_EMAIL_SEQUENCE.md`).
