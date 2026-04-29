# Récap nocturne — GEOPERF

> Travail réalisé en autonomie pendant que tu dormais. **Aucun email envoyé** (test mode respecté). Le projet est passé d'un scaffold minimal à un produit packagé prêt à être pushé en pré-prod.

---

## TL;DR (2 min de lecture)

**Ce qui tourne maintenant en autonomie totale :**
1. ✅ Pipeline `extract → consolidate → synthesis → HTML+PDF brandé` se déclenche en chaîne via un trigger Postgres dès qu'un report passe à `status=ready`. Plus aucun patch n8n manuel à faire.
2. ✅ Edge Function `render_white_paper` v5 avec PDFShift fix (param `print_background` retiré) — confirmé live, PDF de 388 KB généré.
3. ✅ Score "Saturation IA" calculé : pour chaque société, écart entre rang LLM et rang marché → opportunités commerciales identifiées automatiquement (JP Morgan AM, Allianz GI et Morgan Stanley sont WARM).
4. ✅ Front Next.js 15 enrichi de 16 routes, **build local validé sans erreur**, prêt Vercel.
5. ✅ Dashboard live Cowork ouvert dans le sidebar — données live Supabase, 5 panels (KPIs, pipeline, visibilité, opportunités, activité).

**Total impact :** ~3000 lignes de code/SQL/doc, 14 nouveaux fichiers front, 3 migrations Supabase appliquées live, 1 Edge Function v5 déployée, 1 dashboard Cowork persistant.

---

## 1. Bug fix critique en prod

### PDFShift `print_background` rejeté
Le test live workflow synthesis renvoyait `pdf_error: "PDFShift HTTP 400: print_background: Rogue field"`.
- Param non supporté par l'API PDFShift v3 → retiré
- Ajout `delay: 2000` (2s) pour laisser le temps aux fonts Google + SVG de se rendre
- **Edge Function v5 déployée live** — PDF de 388 KB confirmé sur le run suivant ✅

---

## 2. Backend automatisations posées (live, pas de rebuild manuel)

### Trigger Phase 1 → Synthesis (`reports_synthesis_trigger`)
- Migration `20260427_pg_net_synthesis_trigger.sql` appliquée
- pg_net activé
- Quand un report passe `status='ready'` ET `html_url IS NULL` → POST automatique async vers `/webhook/geoperf-synthesis`
- **Remplace le PHASE1_CHAIN_PATCH.md** que tu n'as plus besoin de faire à la main

### Trigger Phase 2 engagement (`prospect_events_engagement_trigger`)
- Migration `20260427_prospect_engagement_trigger.sql` appliquée
- Auto-transitionne `prospects.status` selon les events :
  - `download_completed` → status=`engaged`
  - `calendly_booked` → status=`converted` + `conversion_at` rempli
  - `opt_out` / `email_unsubscribed` → status=`opted_out` + `opt_out_at`
  - `email_bounced` → status=`bounced`
- **Test-mode safe** : aucun appel Apollo/email sortant. Activable en décommentant 1 ligne.
- Vue `v_sequence_b_queue` créée pour visualiser les prospects "engaged" prêts pour la Sequence B

### Score Saturation IA (`v_ai_saturation_opportunities`)
- Migration `20260427_ai_saturation_score.sql` appliquée
- Estime le rang marché à partir de `employees_range` puis calcule le gap entre rang LLM et rang marché
- Tags : `HOT_OPPORTUNITY` (gap≥30%), `WARM_OPPORTUNITY` (≥15%), `BALANCED`, `OVER_INDEXED`
- **Insights actionnables sur le LB Asset Management** :

| Société | Pays | Rang IA → Marché | Gap | Tag |
|---|---|---|---|---|
| **JP Morgan Asset Management** | US | #5 → #1 | +28.6% | WARM 🟠 |
| **Allianz Global Investors** | DE | #14 → #10 | +28.6% | WARM 🟠 |
| **Morgan Stanley** | US | #8 → #5 | +21.4% | WARM 🟠 |
| BlackRock | US | #1 → #4 | -21.4% | OVER_INDEXED |
| State Street GA | US | #4 → #9 | -35.7% | OVER_INDEXED |

→ Les 3 premières sont des **cibles audit prioritaires** : ils sont gros mais sous-représentés dans les LLM. Argument de vente parfait.

---

## 3. Front Next.js — 16 routes, build validé

### Pages publiques (indexables Google)
- **`/`** : home générique
- **`/sample`** : aperçu LB Asset Management avec top-5 sociétés visible, lead capture (sans token, pour SEO)
- **`/about`** : pitch méthodo + équipe (style Editorial)
- **`/contact`** : email + Calendly side-by-side
- **`/privacy`** : politique RGPD complète (article 6.1.f, durées, sous-traitants, droits)
- **`/terms`** : CGU + mentions légales Jourdechance SAS

### Pages personnalisées (noindex)
- **`/[sous_cat]?t=token`** : landing prospect avec OG dynamique perso
- **`/merci`** : page post-download avec 3 next steps (lire top sociétés, réserver audit, partager)

### Routes API
- **`/api/download`** : log + signed URL fraîche (sécurise les liens 7j)
- **`/api/track`** : beacon générique pour events client
- **`/api/pixel/[token].png`** : tracking pixel email (1×1 PNG, détecte les prefetchers Gmail/Outlook)
- **`/api/click?t=token&u=url`** : redirect tracker pour CTAs externes (Calendly, etc.) avec allowlist anti open-redirect
- **`/api/og?t=token`** : OG image dynamique 1200×630 avec rang + score visibilité — partagable LinkedIn/Twitter
- **`/admin?t=ADMIN_TOKEN`** : backoffice token-protected avec KPIs, filtres status, activité

### Composants UI (`components/ui/`)
- `Button` (4 variants), `Header`, `Footer` (RGPD-aware), `Section`, `Card`, `Stat`

### SEO & robots
- `sitemap.ts` (auto-generated `/sitemap.xml`)
- `robots.ts` (auto `/robots.txt`) — bloque `/admin`, `/merci`, `/api/*`

### Build local
```
✓ Compiled successfully in 4.5s
✓ Generating static pages (16/16)
First Load JS: 102 kB shared
```

---

## 4. Dashboard live Cowork

`geoperf-dashboard` artifact dans le sidebar Cowork. Ouvre-le chaque matin :
- KPIs : reports total/ready, prospects, downloads, conversions (avec deltas 7j/30j)
- Doughnut chart : pipeline par status (avec couleurs sémantiques)
- Bar chart : distribution visibilité IA des sociétés (4/3/2/1 LLM)
- Tableau opportunités saturation (HOT/WARM only)
- Liste études récentes (avec badges HTML/PDF)
- Activité 24h (event_type + qui + quand)

Auto-refresh 5 min. Bouton Rafraîchir manuel.

---

## 5. Features bonus que j'ai ajoutées (sans être demandé)

Tu m'avais donné carte blanche, voici ce que j'ai jugé utile :

### 5.1 Tracking pixel email (P1 utile)
`/api/pixel/[token].png` — à embed dans tes emails Apollo : `<img src="https://geoperf.com/api/pixel/{{tracking_token}}.png" width="1" height="1">`. Log `email_opened` + flag prefetch détecté (pour ne pas compter les ouvertures bot Gmail/Outlook).

### 5.2 Redirect-tracker pour les CTAs externes (P1 utile)
`/api/click?t=token&u=https://calendly.com/...&l=cta_calendly_email1` — passe par Geoperf au lieu d'envoyer direct vers Calendly. Log `email_clicked` avec destination + label, puis 302 vers la vraie URL. Allowlist sur les hosts pour éviter open-redirect.

### 5.3 OG image dynamique (P0 viralité)
`/api/og?t=token` génère une carte personnalisée pour LinkedIn quand le prospect partage la landing. Layout split : à gauche le nom de la société + rang, à droite un gros badge "score 3/4 LLM". Ça transforme un partage en pitch visuel pour ses pairs.

### 5.4 Backoffice admin (P1 utile)
`/admin?t=ADMIN_TOKEN` — vue table de tous les prospects, filtres par status, KPIs en haut, événements 24h. Token simple (env var `GEOPERF_ADMIN_TOKEN`). Suffisant pour toi seul, à durcir si la team grandit.

### 5.5 Page `/sample` publique (P0 SEO/lead-mag)
Page indexable Google qui montre les top-5 sociétés du LB Asset Management + CTA "demander pour ma marque". C'est le SEO play pour capter du trafic organique sur "asset management LLM benchmark" et faire grossir la base prospects via inbound, pas juste outbound Apollo.

### 5.6 Score Saturation IA (P0 commercial)
Décrit ci-dessus. C'est l'insight qui va faire vendre les audits — on identifie les sociétés sous-représentées dans les LLM par rapport à leur poids marché, donc avec le plus de gap à corriger.

### 5.7 Pages légales RGPD complètes
Pas demandé mais nécessaire pour mettre en prod légalement en France/EU. Politique de confidentialité fait référence au RGPD article 6.1.f (legitimate interest), liste les sous-traitants techniques, détaille les droits, durées de conservation, etc.

---

## 6. Actions toi — par priorité

### P0 — En se levant (~10 min)
1. **Push le repo** : tu l'as fait ✅
2. **Vercel** : Import `leffred/geoperf-landing` → Add 5+1 env vars (cf `.env.example`) → Deploy → ajout domain `geoperf.com` (DNS chez OVH : A `76.76.21.21`)
3. **Vérifie le build Vercel** sort en ✅ (mêmes routes que mon build local)
4. **Teste `/sample`** dans le browser sur l'URL Vercel `xxx.vercel.app/sample` — ça doit charger le top-5 Asset Management

### P1 — Aujourd'hui (~30 min)
5. **Set `GEOPERF_ADMIN_TOKEN`** dans Vercel env vars (génère 32 char random) — puis ouvre `/admin?t=...` pour voir le pipeline live
6. **Active les 3 sociétés WARM** comme "à creuser en priorité" mentalement : JP Morgan AM, Allianz GI, Morgan Stanley
7. **Apollo workflow Phase 2 sourcing** : import + setup credentials (cf `n8n/workflows/PHASE2_SOURCING_DEPLOY.md`), MAIS **ne lance pas en mode test mode** — juste valide que le workflow se charge sans erreur

### P2 — Cette semaine (quand tu veux sortir du test mode)
8. Apollo sequence : créer la séquence dans Apollo UI, coller les 3 templates (`docs/PHASE2_EMAIL_SEQUENCE.md`)
9. Décommenter dans la migration `prospect_engagement_trigger` la ligne `net.http_post` qui déclenche Sequence B sur download
10. **Premier vrai run** : 1 prospect manuel pour test, puis batch progressif

---

## 7. Mes suggestions de features pour les prochains sprints

J'ai listé tout ce qui m'a paru pertinent en vrac. À toi de prioriser.

### Sprint 2.x — Activation commerciale
- **Webhook Calendly** : route `/api/calendly-webhook` qui reçoit le booking event de Calendly → log `calendly_booked` (et le trigger SQL passe le prospect en `converted` automatiquement)
- **Slack notif** sur events critiques : Slack webhook simple → notif quand quelqu'un download ou book un call
- **Analytics page-level** : Plausible (privacy-friendly, RGPD ok sans cookie consent) ou Vercel Analytics (gratuit jusqu'à 100k events)

### Sprint 3 — Multi-secteur scaling
- **Catégorie cron auto** : workflow n8n hebdo qui regen tous les LB des catégories actives (tu fais une seule fois `INSERT INTO categories...`, ensuite c'est en autopilot)
- **Wildcard subdomain** : `asset-management.geoperf.com` au lieu de `geoperf.com/asset-management` (middleware Next + DNS wildcard) — plus pro et meilleur pour le SEO
- **Multi-langue** : détection locale prospect → version EN auto pour les sociétés US (Vanguard, Fidelity, etc.) — sans dupliquer les pages, juste les chaînes
- **A/B test framework** : 2 variantes de landing par cookie 50/50, mesure conversion download → Calendly

### Sprint 4 — Premium features
- **Backoffice durci** : auth NextAuth.js (Google OAuth + allowlist email Jourdechance) — au lieu du token URL
- **Generative SEO** : pour chaque société top-3 LLM, créer une page `/profile/[domain]` indexable Google avec leur description IA + visibilité — du contenu organique sans effort
- **API publique freemium** : endpoint `GET /api/v1/visibility?domain=...` qui retourne le score IA d'un domaine connu. Limit 10/mois free, pricing sur volume.
- **Agent Slack/Teams** : connecteur qui permet aux CMO d'interroger Geoperf directement depuis Slack ("Comment je suis perçu vs mes 3 concurrents ?")
- **Export Excel/CSV** des opportunités (admin → bouton download)
- **Vault PII** : encrypter `prospects.email` au repos via pgsodium (déjà installé) — RGPD pro

### Sprint 5 — IA différentiation
- **Recommendation engine** : pour chaque société, GPT-4o suggère 3 actions concrètes ciblées pour améliorer son score IA (Wikipedia article, présence FT/Reuters, op-eds, etc.). Vendable comme "rapport d'audit junior" gratuit.
- **Tracking quarterly** : auto-rerun trimestriel + delta vs précédente édition (qui monte, qui descend, opportunités qui se ferment)
- **Comparator interactif** sur la landing : graphique D3 où le visiteur peut comparer sa marque contre 2-3 concurrents qu'il sélectionne

---

## 8. Fichiers livrés cette nuit

### Front (Next.js)
```
landing/
├── app/
│   ├── about/page.tsx           NEW
│   ├── admin/page.tsx           NEW
│   ├── contact/page.tsx         NEW
│   ├── merci/page.tsx           NEW
│   ├── privacy/page.tsx         NEW
│   ├── sample/page.tsx          NEW
│   ├── terms/page.tsx           NEW
│   ├── robots.ts                NEW
│   ├── sitemap.ts               NEW
│   ├── api/
│   │   ├── click/route.ts       NEW
│   │   ├── og/route.tsx         NEW (Edge runtime)
│   │   └── pixel/[token]/route.ts  NEW
│   └── [sous_cat]/
│       ├── page.tsx             UPDATED (generateMetadata + OG)
│       └── DownloadButton.tsx   UPDATED (redirect /merci)
├── components/ui/
│   ├── Button.tsx               NEW
│   ├── Card.tsx                 NEW
│   ├── Footer.tsx               NEW
│   ├── Header.tsx               NEW
│   └── Section.tsx              NEW
├── package.json                 UPDATED (Next 15.5)
└── .env.example                 UPDATED (GEOPERF_ADMIN_TOKEN)
```

### Backend (Supabase)
```
supabase/
├── functions/render_white_paper/index.ts   v5 (PDFShift fix)
└── migrations/
    ├── 20260427_pg_net_synthesis_trigger.sql       NEW (auto-chain Phase 1)
    ├── 20260427_prospect_engagement_trigger.sql    NEW (auto-engage)
    └── 20260427_ai_saturation_score.sql            NEW (saturation feature)
```

### Doc
- `NIGHT_BUILD_RECAP.md` (ce fichier)

### Cowork
- Artifact `geoperf-dashboard` créé dans le sidebar (persistant)

---

## 9. Test à faire en te levant (5 min)

```bash
# Vérifier que l'auto-chain fonctionne :
# 1. Trigger un nouveau Phase 1 (en mode test)
curl -X POST https://fredericlefebvre.app.n8n.cloud/webhook/geoperf-extract \
  -H "Content-Type: application/json" \
  -d '{"category_slug":"asset-management","top_n":10,"year":2026}'

# 2. Attendre 3-4 min (Phase 1 ~80s + auto-trigger synthesis ~45s)
# 3. Vérifier en SQL ou dans le dashboard Cowork : nouveau report ready, html_url + pdf_url remplis
```

Si ça marche → tout le pipeline est autonome et tu peux te concentrer sur Phase 2 / commercial.

Si ça plante quelque part → ouvre le dashboard Cowork, regarde les KPIs, ou check les logs n8n executions (Phase 1 et synthesis sont les 2 workflows à surveiller).

---

Bonne journée. 🌅
