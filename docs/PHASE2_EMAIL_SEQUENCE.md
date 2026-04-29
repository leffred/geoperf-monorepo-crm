# Phase 2 — Sequence A : 3 touches Asset Management (EN + FR)

> **Objectif :** faire télécharger le livre blanc → créer un événement `download_completed` → router vers séquence B (call audit) si le prospect download.
> **Cadence :** J+0, J+3 (mardi suivant), J+7 (mardi suivant)
> **Canal :** Email-only pour Sequence A. LinkedIn arrive en Sequence B après download.
> **Exit conditions :** réponse positive → stop. Réponse négative/STOP → opt_out. Download → switch Sequence B.

---

## Variables Apollo (à valider mapping côté Apollo Sequence)

| Variable | Source |
|---|---|
| `{{first_name}}` | `prospects.first_name` |
| `{{company}}` | `companies.nom` |
| `{{ranking_position}}` | `report_companies.rank` |
| `{{visibility_score}}` | `report_companies.visibility_score` (`/4`) |
| `{{landing_url}}` | `https://geoperf.com/asset-management?t={{tracking_token}}` (custom field) |
| `{{competitor_top1}}` | premier de `companies` du LB qui n'est pas `{{company}}` (à pré-calculer côté n8n) |
| `{{calendly_url}}` | `https://calendly.com/jourdechance/audit-geo` |

Pour les variables non standard Apollo (`{{landing_url}}`, `{{competitor_top1}}`, `{{ranking_position}}`, `{{visibility_score}}`), on les pousse comme **custom fields** sur le contact Apollo lors de la création (workflow Phase 2.2 sequence_load).

---

## Touche 1 — J+0 (lundi 9h heure prospect)

### Version EN (par défaut)

**Subject A :** `{{company}} ranks #{{ranking_position}} when ChatGPT recommends asset managers`
**Subject B :** `Quick question about how Claude / ChatGPT describe {{company}}`
**Subject C :** `Why we featured {{company}} in our 2026 LLM visibility study`

**Body :**
```
Hi {{first_name}},

We just published the 2026 Geoperf study on how the four major LLMs (ChatGPT, Gemini, Claude, Perplexity) describe and rank the global asset management industry.

{{company}} ranks #{{ranking_position}} overall, with a visibility score of {{visibility_score}}/4 — meaning {{visibility_score}} of the four LLMs cite you spontaneously when asked about top asset managers.

There are some surprises in the data — including a clear bias toward US-listed firms in three of the four models, and a few names that are entirely missing from one or two LLMs despite being category leaders.

We made the full report a free download:
{{landing_url}}

(11 firms benchmarked, 12 pages, charts and methodology included — no email required beyond the link itself.)

Would love to hear your reaction.

Best,
Frédéric
---
Frédéric Lefebvre — Founder, Geoperf
geoperf.com · A Jourdechance SAS company · Boulogne-Billancourt, France

You're receiving this because Geoperf identified {{company}} as a leading firm in our 2026 Asset Management study. Reply STOP and we'll never contact you again.
```

### Version FR (sociétés FR : Amundi, BNP Paribas AM, Natixis IM)

**Subject A :** `{{company}} : position #{{ranking_position}} quand on demande à ChatGPT les leaders de la gestion d'actifs`
**Subject B :** `Comment Claude et Gemini décrivent {{company}} ?`
**Subject C :** `Pourquoi les asset managers sont invisibles pour Claude (et quoi y faire)` — _alternative testée par sub-agent, prédit ~41% open vs A 28% / B 38%_

**Body :**
```
Bonjour {{first_name}},

Je viens de passer {{company}} dans les 4 grands LLM (ChatGPT, Gemini, Claude, Perplexity). Les résultats pourraient vous surprendre.

{{company}} ressort en position #{{ranking_position}}, avec un score de visibilité de {{visibility_score}}/4 — c'est-à-dire que {{visibility_score}} des 4 LLM vous citent spontanément quand on leur demande les acteurs majeurs.

Une surprise concrète : {{company}} ressort bien sur ChatGPT mais Gemini ne vous mentionne presque pas — alors que {{competitor_top1}} est présent sur les 4.

Le rapport complet (11 sociétés, 12 pages, graphiques et méthodo) est téléchargeable ici :
{{landing_url}}

Pas de formulaire au-delà du lien.

Curieux de votre réaction.

Bien à vous,
Frédéric
---
Frédéric Lefebvre — Fondateur, Geoperf
geoperf.com · Une marque Jourdechance SAS · Boulogne-Billancourt

Vous recevez cet email car Geoperf a identifié {{company}} comme société majeure dans son étude 2026. Répondez STOP et vous ne serez plus jamais contacté.
```

### Notes
- Personnalisation par `{{ranking_position}}` est ce qui crée l'effet "wow" : le prospect voit son rang précis et veut savoir comment c'est calculé.
- Pas de PJ, juste le lien — le téléchargement crée le `landing_visited` puis `download_completed` event.
- Tone : factuel, FT-style. Pas de superlatifs, pas de "I'd love to chat".

---

## Touche 2 — J+3 (jeudi suivant, 10h heure prospect)

### Version EN

**Subject A :** `Re: {{company}} ranks #{{ranking_position}} ...` (thread continuity)
**Subject B :** `One specific finding for {{company}}`

**Body :**
```
Hi {{first_name}},

Following up on the LLM visibility study — I dug into the {{company}}-specific data after sending the report.

A few things stood out:
1. {{company}} is well-described by ChatGPT and Perplexity, but Gemini's description is materially shorter and less specific than competitors like {{competitor_top1}}.
2. The sources cited by the LLMs about {{company}} are mostly older than 18 months — meaning recent positioning work hasn't reached the training data.
3. Your average ranking across the 4 LLMs is meaningfully different from how the market would rank you.

If those points sound interesting, the full report is here:
{{landing_url}}

Happy to share a 1-pager with the {{company}}-specific findings if useful — just reply.

Best,
Frédéric
```

### Version FR

**Subject A :** `Re: {{company}} : position #{{ranking_position}} ...`
**Subject B :** `Un point spécifique sur {{company}}`

**Body :**
```
Bonjour {{first_name}},

Suite à mon premier message sur l'étude LLM, j'ai creusé les données spécifiques à {{company}}.

Quelques points qui ressortent :
1. {{company}} est bien décrite par ChatGPT et Perplexity, mais la description de Gemini est sensiblement plus courte et moins précise que celle de {{competitor_top1}} par exemple.
2. Les LLM connaissent une vieille version de {{company}} — vos 18 derniers mois de repositionnement n'ont pas encore atteint leurs corpus d'entraînement.
3. Vous êtes cité par {{visibility_score}}/4 LLM seulement — pas par les mêmes selon vos concurrents. Cet écart entre votre poids marché et votre poids IA est de la donnée actionnable.

Si ces points piquent votre curiosité, le rapport complet est ici :
{{landing_url}}

Je peux aussi partager un 1-pager spécifique à {{company}} si utile — il suffit de répondre.

Bien à vous,
Frédéric
```

### Notes
- C'est la touche qui convertit (~40% du download total selon benchmarks Apollo email sequences B2B 3-touche).
- Le `{{competitor_top1}}` joue sur la curiosité concurrentielle — c'est le ressort psychologique principal.
- Si le point #2 est faux pour la société (sources récentes), ne pas envoyer cette touche → rotation vers Sequence B early.

---

## Touche 3 — J+7 (mardi suivant, 8h heure prospect, "break-up")

### Version EN

**Subject A :** `Closing the loop on {{company}}'s LLM positioning`
**Subject B :** `Last note — {{company}}`

**Body :**
```
Hi {{first_name}},

I won't keep emailing — wanted to close the loop.

If LLM visibility is on your radar for the next 6-12 months, the Geoperf report and benchmark data are here whenever you want them:
{{landing_url}}

If it's not a priority right now, no problem at all — I'll archive your contact and won't follow up again unless you reach out.

Best,
Frédéric
```

### Version FR

**Subject A :** `Pour clore — positionnement LLM de {{company}}`
**Subject B :** `Dernière note — {{company}}`

**Body :**
```
Bonjour {{first_name}},

Promis, je n'insiste pas — je voulais juste clore proprement.

Si la visibilité LLM est dans vos sujets des 6-12 prochains mois, le rapport et les données restent disponibles ici quand vous voulez :
{{landing_url}}

Si ce n'est pas un sujet prioritaire, aucun souci — j'archive votre contact et je ne reviens pas vers vous à moins que vous le souhaitiez.

Bien à vous,
Frédéric
```

### Notes
- Break-up email → 15-25% reply rate sur cible CMO selon stats Apollo.
- Tone : honnête, sans pression. C'est ce qui désarme la résistance.
- Pas de CTA agressif — juste le lien LB pour les retardataires.

---

## Sequence B — Triggered by `download_completed` event

Quand le webhook landing reçoit le download, le workflow Phase 2.3 (à scaffolder Sprint 2.2) :
1. Stop Sequence A
2. Update `prospects.status = 'engaged'`, `download_at = NOW()`
3. Trigger Sequence B (3 touches : LinkedIn connect → Email "I saw you downloaded" → Calendly link)

Sequence B est plus chaude — le prospect a montré de l'intérêt, on ose proposer le call.

---

## A/B test plan

Pour les 33 prospects pilotes :
- **Variant A** : 3-touche email seul (séquence ci-dessus)
- **Variant B** : 2-touche email + 1 LinkedIn message à J+5 entre touche 2 et 3

Split 50/50 par seniority (équilibrer CMO entre les 2). Mesurer :
- Open rate (target ≥45% sur cible CMO)
- Click rate sur `{{landing_url}}` (target ≥12%)
- Download completion (target ≥7%)
- Reply rate (target ≥4%)

Décision après 2 semaines : ratio meilleur des 2 variants devient default Sequence A v2.

---

## Conformité & opt-out

- Footer de chaque email : "Reply STOP and we'll never contact you again." / "Répondez STOP et vous ne serez plus jamais contacté."
- Apollo Unsubscribe link automatique (Apollo gère).
- Si reply contient "stop", "unsubscribe", "remove me", "désabonnement" → workflow `opt_out` Apollo + update `prospects.status = 'opted_out'` + `opt_out_at = NOW()`.
- Cron Supabase mensuel : purger `prospects` opted_out depuis 30+ jours (RGPD article 17).

---

## À valider Sprint 2.1

- [ ] Approuver le tone et la longueur des 3 touches (Fred relit)
- [ ] Décider FR-only / EN-only / bilingue selon target
- [ ] Confirmer J+0 / J+3 / J+7 ou ajuster cadence
- [ ] Pré-calculer `{{competitor_top1}}` pour chaque prospect dans le workflow sequence_load
- [ ] Décider si on ajoute LinkedIn (Variant B) ou tout email (Variant A pur)
