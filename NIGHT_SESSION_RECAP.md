# Night session recap — 2026-04-29

> 8h en autonomie pendant que Fred dort. Aucun envoi email. Pas de push GitHub (tu fais ça au réveil).

---

## TL;DR

**3 livrables concrets** et **1 audit complet** :

1. ✅ Pages admin `/admin/profiles` et `/admin/prospects/[id]` — preview SEO + drill-down par lead
2. ✅ Workflow n8n **Phase 2.2 sequence_load** créé (`b6cwag080lQ2Kq4B`) — enroll prospects en Apollo Sequence. **INACTIF** (à activer manuellement après que tu auras créé ta sequence Apollo)
3. ✅ Workflow n8n **Phase 3 Cron Trimestriel** créé (`UxuPlDTLEM6MceHR`) — schedule 1er du trimestre. **INACTIF** (active quand tu valides la cadence)
4. ✅ `STATE_OF_PROJECT.md` — audit complet (266 lignes, à actualiser après chaque session)

Build local validé en final : 25 routes Next.js, middleware 88 kB. Tout vert.

---

## À faire au réveil (10 min)

1. **Push GitHub** (déploie 5 nouvelles routes + actions admin) :
   ```powershell
   cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
   powershell -ExecutionPolicy Bypass -File .\push_update.ps1
   ```

2. **Supprimer le fichier PII Apollo** (les 760 résultats du test curl restent en local) :
   ```powershell
   Remove-Item C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing\apollo_test.json
   ```

3. **Tester en live** (après que Vercel ait redéployé, ~1-2 min) :
   - https://geoperf.com/admin/profiles → liste de 12 cards (12 sociétés avec report ready)
   - https://geoperf.com/admin → cliquer un prospect → page détail
   - https://geoperf.com/profile/blackrock.com → page SEO publique

4. **Lier credentials Apollo Api Key** sur 2 nouveaux nodes (n8n MCP ne le fait pas auto) :
   - Workflow Phase 2.2 (`b6cwag080lQ2Kq4B`) → nodes "Apollo create contact" + "Apollo enroll in sequence"
   - Workflow Phase 3 cron : aucune Apollo cred requise (juste un POST webhook Phase 1)

---

## Détail des livrables

### A. Pages admin (frontend)

#### `/admin/profiles`
- 12 cards (1 par société avec report ready), triées par visibility_score décroissant
- Chaque card : nom + domaine + 4 dots score IA + rang dans étude + badge "Sous-représenté/Sur-représenté" si gap > 10%
- Click → ouvre `/profile/[domain]` dans nouvel onglet
- Nav header : "← Pipeline" et "Logout"

#### `/admin/prospects/[id]`
- Header avec nom + titre + lead score 0-100 + status badge
- Grid 2x2 : Email (avec copy button), LinkedIn, Société (lien profil SEO), Étude source
- Mini-grid 2x4 : Created / 1er contact / Download / Call book
- Boutons "Voir portal client" + "Voir landing perso" en bas
- Section historique events (50 max) avec event_type + channel + truncated metadata
- `<details>` avec metadata brut (Apollo enrichment, etc.)
- Liens slug landing perso normalisent les accents (Aéronautique → aeronautique)

#### Modifications `/admin`
- Nav header : ajout link "Profils SEO"
- Chaque ligne du tableau prospects → cliquable vers `/admin/prospects/{id}`

### B. Workflow Phase 2.2 sequence_load

**ID** : `b6cwag080lQ2Kq4B` · **URL n8n** : https://fredericlefebvre.app.n8n.cloud/workflow/b6cwag080lQ2Kq4B

**Webhook** : `POST /webhook/geoperf-sequence-load`

**Body** :
```json
{
  "report_id": "61be49be-8e19-48b4-b50a-9a59f3cb987a",
  "sequence_id": "<TON_APOLLO_SEQUENCE_ID>",
  "lead_score_min": 50,
  "max": 50
}
```

**Flow** :
1. Pull eligible prospects (status='new' + email_verified + lead_score >= min)
2. Pour chaque : `POST /api/v1/contacts` Apollo (avec `person_id` + label_names) → save `apollo_contact_id` dans metadata
3. À la fin : aggregate contact_ids → `POST /api/v1/emailer_campaigns/{seq_id}/add_contact_ids`
4. Update prospects.status = 'sequence_a' + log events `sequence_a_enrolled`

**Test mode safety** : tant que la sequence Apollo est **paused**, aucun email ne part même après enrollment.

**Doc complète** : `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` (test pas-à-pas + SDK code source).

**Crédits Apollo consommés** : 0 (création contact + enrollment ne consomment pas de crédits).

**Action `sequence_load` ajoutée à `/api/admin/trigger`** : tu peux trigger via curl ou PowerShell sans passer par l'UI :
```powershell
$body = '{"action":"sequence_load","params":{"report_id":"61be49be...","sequence_id":"XXX","max":3}}'
Invoke-RestMethod -Uri "https://geoperf.com/api/admin/trigger" -Method POST `
  -Headers @{ "Authorization" = "Bearer $env:GEOPERF_ADMIN_TOKEN"; "Content-Type" = "application/json" } `
  -Body $body
```

**Bouton UI à ajouter dans `/admin` quand prêt** : laissé hors de scope tant que test_mode actif.

### C. Workflow Phase 3 Cron Trimestriel

**ID** : `UxuPlDTLEM6MceHR` · **Status** : INACTIVE par défaut

**Schedule** : `0 8 1 1,4,7,10 *` (1er Jan/Apr/Jul/Oct à 8h UTC)

**Flow** :
1. Schedule trigger
2. Get active sub-categories (toutes celles ayant >=1 report ready)
3. Build payloads `{ category_slug, top_n: 10, year: <current> }`
4. Loop : POST chaque payload sur webhook `/webhook/geoperf-extract` avec sleep 60s entre (anti rate-limit OpenRouter)
5. Done node final

**Pour activer** : clique "Active" toggle dans n8n UI sur le workflow `UxuPlDTLEM6MceHR`. Aucune cred à brancher.

### D. STATE_OF_PROJECT.md (266 lignes)

Audit complet :
- TL;DR + données live (4 reports, 27 prospects, 65 events)
- 4 sous-projets détaillés (reporting/outreach/frontend/infra)
- Coûts mensuels (~$80 actuel, cible $120-150)
- Trous, dettes techniques, à surveiller
- Roadmap Sprint 9-12
- Documentation existante listée
- Comment me briefer

À actualiser après chaque session importante. Place ce fichier comme référence partagée.

---

## Status DB après cette session

Inchangé côté data — j'ai juste lu, pas modifié :
- Reports : 4 ready (Asset Management ×2, CRM, Aéronautique)
- Prospects : 27 (26 avec email, 24 verified, 24 avec LinkedIn)
- Events : 65 events tracés
- Sociétés : 60 (57 unique domains)

---

## Bug / friction notable

L'API n8n MCP `update_workflow` a renvoyé `500` à plusieurs reprises sur les workflows complexes. Pattern qui marche :
1. Créer un workflow stub minimal (1-2 nodes) via `create_workflow_from_code`
2. Update avec le code complet via `update_workflow` (peut prendre 1-3 essais avec sleep entre)

J'ai aussi découvert que `placeholder` est un mot réservé du SDK n8n — utiliser `stub`, `myPlaceholder`, etc.

---

## Ce qui ne change PAS

- Test mode toujours actif. Aucun email réel envoyé.
- Apollo crédits utilisés ce session : 0 (juste lecture DB + n8n SDK calls + Supabase queries).
- DB unchanged.
- Branding Editorial intact.
- Pipeline existant fonctionne — `/admin` tourne avec session Supabase.

---

## Ce qui restera à faire après ton push

### Activation Phase 2.2 (quand tu valides les copies FR sequence)
1. Créer une sequence dans Apollo UI, **PAUSE-la**, copier son ID
2. Copier les 3 emails FR de `docs/PHASE2_EMAIL_SEQUENCE.md` dans la sequence Apollo
3. Configurer custom fields Apollo si tu veux personnalisation `{{landing_url}}` etc. (voir `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md`)
4. Test workflow avec max=3 sur 1 report (Apollo paused = no send)
5. Resume sequence Apollo une fois validé

### Activation Phase 3 cron
1. Toggle "Active" dans n8n UI sur workflow `UxuPlDTLEM6MceHR`
2. Le prochain trigger sera 1er Jul 2026 8h UTC (3 mois après la dernière fenêtre Apr 1)
3. Tu peux aussi trigger manuellement via le bouton "Run" dans n8n

### Build sprints futurs (cf. STATE_OF_PROJECT.md section 7)
- Sprint 9 : UI `/admin/sequences` pour preview/dry-run/enroll
- Sprint 10 : Cron auto déjà fait, mais ajouter email digest à Fred après chaque run
- Sprint 11 : Attio CRM mirror
- Sprint 12 : A/B testing landings perso

---

## Fichiers modifiés cette session

| Fichier | Type | Lignes |
|---|---|---|
| `landing/app/admin/profiles/page.tsx` | NEW | 128 |
| `landing/app/admin/prospects/[id]/page.tsx` | NEW | 170 |
| `landing/app/admin/prospects/[id]/CopyButton.tsx` | NEW | 22 |
| `landing/app/admin/page.tsx` | EDIT | nav + lien prospect |
| `landing/app/api/admin/trigger/route.ts` | EDIT | action `sequence_load` |
| `landing/CLAUDE.md` | EDIT | routes + auth pattern |
| `n8n/workflows/PHASE_2_2_SEQUENCE_LOAD_SDK.md` | NEW | 363 |
| `STATE_OF_PROJECT.md` | NEW | 266 |
| `DEVELOPMENT_HISTORY.md` | EDIT | session 9 entry |
| `NIGHT_SESSION_RECAP.md` | NEW | this file |

**Workflows n8n cloud créés** :
- `b6cwag080lQ2Kq4B` — Phase 2.2 Sequence Load (INACTIF, ready à activer)
- `UxuPlDTLEM6MceHR` — Phase 3 Cron Trimestriel (INACTIF, ready à activer)

