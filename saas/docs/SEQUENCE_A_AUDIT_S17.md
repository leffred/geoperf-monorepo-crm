# Sequence A — Audit copies FR + dry-run prospects (Sprint S17 §4.2)

**Date audit** : 2026-05-04
**Auteur** : Agent (Claude Code), audit only — Fred valide ou modifie.
**Source** : `docs/PHASE2_EMAIL_SEQUENCE.md` (248 lignes, 3 touches FR + EN + notes)

---

## 0. Recommandation globale

**Les copies FR sont propres et prêtes à être uploadées dans Apollo Sequence**, sous réserve de 4 ajustements mineurs détaillés ci-dessous (notamment §1 Touche 2 point #3 qui contient un calcul implicite). Le ton FT-style, factuel et non-superlatif est cohérent avec la promesse de marque Geoperf.

**Aucune modification appliquée par l'agent** (cf brief §6.7). Toutes les recommandations ci-dessous sont à valider ou rejeter par Fred avant l'upload Apollo.

---

## 1. Variables Apollo référencées dans les copies — mapping vs Phase 2.2

| Variable | Source DB | Mappé via Phase 2.2 ? |
|---|---|---|
| `{{first_name}}` | `prospects.first_name` | ✅ Apollo lit auto via `apollo_person_id` |
| `{{company}}` | `companies.nom` (via `prospects.company_id`) | ✅ Apollo lit auto via `organization_name` du contact |
| `{{ranking_position}}` | `report_companies.rank` | ⚠️ **Custom field Apollo** à créer côté Apollo (cf §3 ci-dessous) |
| `{{visibility_score}}` | `report_companies.visibility_score` (sur 4) | ⚠️ Custom field Apollo |
| `{{landing_url}}` | calculé par n8n : `https://geoperf.com/{slug}?t={tracking_token}` | ⚠️ Custom field Apollo |
| `{{competitor_top1}}` | premier `companies.nom` du LB ≠ `{{company}}` | ⚠️ Custom field Apollo |
| `{{calendly_url}}` | constante `https://calendly.com/jourdechance/audit-geo` | Pas utilisée dans Sequence A (Sequence B only) — OK |

**État actuel du workflow Phase 2.2** (`b6cwag080lQ2Kq4B`) :
Le node `Build Apollo payload` calcule `landing_url` localement en JS et le met dans `apollo_payload.label_names` (en label, pas en custom field). Les 4 variables `ranking_position`, `visibility_score`, `landing_url`, `competitor_top1` ne sont **PAS encore poussées comme `typed_custom_fields`** côté Apollo. C'est un gap connu (cf `PHASE_2_2_SEQUENCE_LOAD_SDK.md` ligne 22 : "(Optionnel) Créer 5 custom fields").

**Conséquence** : si Fred lance la sequence telle quelle, Apollo va mailer **sans personnalisation** de ces 4 variables — les emails partent avec `{{ranking_position}}` littéral dans le subject, ce qui ruine totalement l'effet "wow #2/4" qui est le ressort principal de la conversion.

**Action Fred (BLOQUANT avant rollout)** :
1. Créer 4 custom fields côté Apollo UI (Settings → Custom Fields → + Add Custom Field) :
   - `ranking_position` (number)
   - `visibility_score` (number)
   - `landing_url` (URL)
   - `competitor_top1` (text)
2. Récupérer les 4 IDs Apollo des custom fields (visibles dans l'URL ou via API).
3. Modifier le node `Build Apollo payload` du workflow `b6cwag080lQ2Kq4B` pour injecter ces 4 valeurs dans `apollo_payload.typed_custom_fields = [{id: "...", value: ...}, ...]`.

Sans cette étape, **les emails partent dépersonnalisés** — l'agent ne l'a pas faite par contrainte du brief (pas de modification du workflow actif sans validation Fred).

---

## 2. Audit copies par touche

### Touche 1 — J+0 (FR)

**Subjects** :
- A : `{{company}} : position #{{ranking_position}} quand on demande à ChatGPT les leaders de la gestion d'actifs`
  - 🟢 **OK**. Concret, chiffré, intrigant. Subject A devrait être le default split test.
  - ⚠️ Hors AM, le wording "leaders de la gestion d'actifs" est category-locked. Quand Fred enverra sur Pharma → adapter en "leaders pharma" ou rendre la variable dynamique `{{sous_categorie}}`.
- B : `Comment Claude et Gemini décrivent {{company}} ?`
  - 🟢 **OK**. Plus court, plus question. Bon pour split test.
- C : `Pourquoi les asset managers sont invisibles pour Claude (et quoi y faire)`
  - 🟢 **OK**. Open prédit ~41% selon notes — meilleur des 3. Mais category-locked.

**Body** : 🟢 Globalement OK. Tone factuel FT-style respecté.

**Recommandations** :
- ⚠️ **Recommandation 1** : la phrase « Une surprise concrète : {{company}} ressort bien sur ChatGPT mais Gemini ne vous mentionne presque pas — alors que {{competitor_top1}} est présent sur les 4. » fait une **affirmation factuelle non vérifiée** par les data. Si pour la company en question Gemini la mentionne BIEN, le mail devient incohérent et grille la confiance. Solution : soit conditionnel côté workflow (skip cette ligne si pas vrai), soit reformulation plus prudente : "Selon nos relevés, certains LLM vous citent moins que vos concurrents — détails dans le rapport".
- ⚠️ **Recommandation 2** : « Vous recevez cet email car Geoperf a identifié {{company}} comme société majeure dans son étude 2026. » — la base légale RGPD invoquée (intérêt légitime, cf `/privacy` post-S16 §1) doit être plus explicite : ajouter "(intérêt légitime art. 6.1.f RGPD)" dans le footer pour solidifier le terrain juridique.

### Touche 2 — J+3 (FR)

**Subjects** :
- A : `Re: {{company}} : position #{{ranking_position}} ...` (thread continuity)
  - 🟢 **OK**, exploite le thread reply.
- B : `Un point spécifique sur {{company}}`
  - 🟢 **OK**, plus standalone.

**Body** : ⚠️ ATTENTION sur le point #3.

**Recommandations** :
- 🚨 **Recommandation 3 (BLOQUANT)** : la phrase « Vous êtes cité par {{visibility_score}}/4 LLM seulement — pas par les mêmes selon vos concurrents. » contient un sub-claim implicite. Si `visibility_score = 4`, le mail dit "cité par 4/4 LLM seulement" → ridicule. Si `visibility_score = 0`, le mail dit "cité par 0/4 LLM seulement" → l'utilisateur quitte. **Conditional skip** nécessaire côté workflow : si `visibility_score >= 3`, reformuler en "présent sur 3/4 LLM, mais pas le 4ème — détails dans le rapport".
- ⚠️ **Recommandation 4** : « Les LLM connaissent une vieille version de {{company}} — vos 18 derniers mois de repositionnement n'ont pas encore atteint leurs corpus d'entraînement. » → claim fort, vrai en moyenne mais pas pour toutes les sociétés. Si `last_enriched_at` de la company est récent et que l'étude ne montre pas de dérive, cette ligne est fausse. Soit conditional skip, soit reformulation prudente : "Les corpus d'entraînement des LLM ont des cutoffs variables — il est probable que vos 12-18 derniers mois ne soient que partiellement reflétés".

### Touche 3 — J+7 (FR break-up)

🟢 **Aucune recommandation critique**. Tone honnête, pas de pression, conforme aux bonnes pratiques outbound. Subject et body cohérents.

---

## 3. Vérif "Solo+" résiduel post-S16.1

Grep effectué sur `docs/PHASE2_EMAIL_SEQUENCE.md` : **aucune occurrence de "Solo"** dans les copies. ✅ La sequence A ne référence aucune nomenclature de tier obsolète. C'était un risque post-S16.1 (les copies pourraient mentionner les plans SaaS), mais ce n'est pas le cas — la sequence A pointe uniquement vers `/sample` (lead-magnet), pas vers le SaaS.

---

## 4. Dry-run prospects éligibles (au 2026-05-04)

Requête exécutée via Supabase MCP :

```sql
WITH report_summary AS (
  SELECT r.id AS report_id, r.sous_categorie, r.created_at,
         COUNT(p.id) FILTER (
           WHERE p.status = 'new'
             AND p.email IS NOT NULL
             AND p.email_verified = true
             AND p.lead_score >= 50
             AND p.apollo_person_id IS NOT NULL
         ) AS eligible_count,
         COUNT(p.id) AS total_prospects
  FROM reports r
  LEFT JOIN prospects p ON p.report_id = r.id
  WHERE r.status = 'ready'
  GROUP BY r.id, r.sous_categorie, r.created_at
  ORDER BY r.created_at DESC
)
SELECT * FROM report_summary;
```

**Résultats** :

| Report | Sous-catégorie | Created at | Total prospects | Éligibles (status=new, verified, score≥50, apollo_id) |
|---|---|---|---|---|
| `60211e19-…` | Pharma | 2026-04-29 | 51 | **43** |
| `92733d8c-…` | Aéronautique | 2026-04-28 | 0 | 0 |
| `295c3590-…` | CRM | 2026-04-28 | 1 | 0 |
| `61be49be-…` | Asset Management | 2026-04-27 | 26 | **19** |
| `379be7b5-…` | Asset Management (legacy) | 2026-04-27 | 0 | 0 |

**Total prêts à enroll : 62 prospects** (43 Pharma + 19 Asset Management).

### Recommandations dry-run

- **Premier batch recommandé** : 10 prospects Asset Management (la sous-cat la mieux validée par Fred, cf brief originel §3.4 qui mentionne "27 prospects Asset Management"). Test technique avant ouverture progressive.
- **Phase 2 (J+2 du premier batch)** : si OK, ouvrir au reste des 19 AM (9 prospects de plus).
- **Phase 3 (semaine 2)** : ouvrir Pharma (43 prospects) en lots de 10/jour.
- **CRM et Aéronautique** : pas de prospects à enroller (étude sans sourcing encore). Pas d'action.

### Pourquoi 7 prospects AM "non éligibles" sur 26 ?

Les 7 prospects manquants sur le total AM sont probablement :
- email pas encore vérifié (`email_verified=false`)
- ou `lead_score < 50`
- ou `apollo_person_id IS NULL` (prospect créé manuellement sans match Apollo)
- ou `status` déjà avancé (engaged, opted_out, etc.)

Pas un blocker — Fred peut filtrer plus large (`lead_score >= 30`) si besoin de plus de volume.

---

## 5. Reste à faire pour Fred (par ordre)

1. **AVANT TOUT** : créer 4 custom fields Apollo (cf §1) et modifier le workflow Phase 2.2 pour les pousser. Sans ça, les emails partent dépersonnalisés.
2. Lire les 4 recommandations §2 et décider : appliquer / ignorer / autre.
3. Créer la Sequence A dans Apollo UI (Outbound → Sequences → New) avec les 3 touches FR validées.
4. Garder la Sequence en **Paused** dans Apollo UI tant que les recommandations §1 et §2 ne sont pas traitées.
5. Récupérer le `sequence_id` Apollo (URL après `/sequences/`).
6. Test webhook avec son propre email comme prospect test (ajouter Fred manuellement dans `prospects` table avec `email_verified=true, lead_score=99, apollo_person_id` valide).
7. Trigger webhook avec `report_id=61be49be-8e19-48b4-b50a-9a59f3cb987a`, `max=1`, `lead_score_min=99` — Fred reçoit 1 email Apollo et peut valider la personnalisation.
8. Si OK : Resume la Sequence Apollo + premier batch 10 AM.
9. Monitor 48h via Apollo dashboard + `prospect_events` table.

---

## 6. Sujets notés pour S18 (hors scope cette session)

- **Conditional skip côté workflow** pour les claims qui peuvent être faux selon les data (rec #1, #3, #4) — nécessite enrichissement du `Build Apollo payload` node.
- **A/B test Variant B (LinkedIn touche entre J+3 et J+7)** : à activer une fois variant A validé sur 2 semaines.
- **Sequence FR pour catégories non-AM** : adapter les wordings category-locked ("leaders de la gestion d'actifs", "asset managers") en variables `{{sous_categorie}}` ou créer Sequences dédiées par catégorie.
- **Footer RGPD enrichi** : ajouter explicitement "(intérêt légitime art. 6.1.f RGPD)" + lien `/privacy` dans le footer de chaque touche.

---

Fin de l'audit. Aucune modification de fichier source par l'agent.
