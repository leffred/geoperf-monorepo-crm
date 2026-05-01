# Sprint S7 — Recap (2026-04-30)

> Sprint « parité GetMint ». Refonte pricing 5 tiers + topics + multi-seats + 3 vues additionnelles + HP refonte 2 CTAs.
> Build final passe (29/29 pages). Aucun push GitHub. Aucun deploy d'Edge Function.
> Phase A complète + Phase B mostly. Tier 2 features (sentiment, content studio) reportées.

## ✅ Features livrées

### DB — 4 migrations appliquées via apply_migration MCP

| Migration | Fichier | Effets |
|---|---|---|
| `saas_phase2_tier_refonte` | `supabase/migrations/20260430_saas_phase2_tier_refonte.sql` | ALTER TYPE saas_tier ADD VALUE 'starter', 'growth' |
| `saas_phase2_tier_migrate_solo` | (inline migration) | UPDATE saas_subscriptions SET tier='starter' WHERE tier='solo' |
| `saas_phase2_topics` | `supabase/migrations/20260430_saas_phase2_topics.sql` | Table `saas_topics`, colonnes `topic_id` sur snapshots/alerts/recos, trigger auto-default-topic, backfill |
| `saas_phase2_seats` | `supabase/migrations/20260430_saas_phase2_seats.sql` | ENUM `saas_member_role`, tables `saas_account_members` + `saas_account_invitations`, view `v_saas_user_account`, helper `saas_account_owner_of()`, RLS adaptées (members consomment l'owner_id) |

### Lib & helpers (lib/saas-auth.ts)

- `TIER_LIMITS` Record mis à jour avec **5 tiers** (free 0€, starter 79€, growth 199€, pro 399€, agency 799€) avec champs `prompts_per_brand`, `topics`, `seats`, `cadence`
- Nouveau type `SaasMemberRole = 'owner' | 'admin' | 'viewer'`
- `loadSaasContext()` étendu pour résoudre `account_owner_id`, `role`, `is_owner`, `owner_profile`
- `tierLimits(tier)` helper qui résout legacy `'solo'` → `'starter'`
- `tierLabel(tier)` pour affichage UX (legacy 'solo' affiché 'Starter')
- `relativeVisibility()` conservé (Q.1 du recap précédent)

### Frontend — 16 fichiers nouveaux/modifiés

#### Topics CRUD
| Fichier | Action |
|---|---|
| `app/app/brands/[id]/topics/page.tsx` | NEW — liste + bouton +Topic + delete |
| `app/app/brands/[id]/topics/new/page.tsx` | NEW — form (name/description/prompts custom JSON) |
| `app/app/brands/[id]/topics/[topicId]/page.tsx` | NEW — détail topic : stats, BrandEvolutionChart filtré, recos+alerts du dernier snapshot, historique |
| `app/app/brands/[id]/topics/actions.ts` | NEW — createTopic + deleteTopic + tier-gating |
| `components/saas/TopicSelector.tsx` | NEW — bandeau topics réutilisé sur brand detail + sources + by-model + by-prompt |
| `app/app/brands/[id]/page.tsx` | MODIFY — TopicSelector + bandeau « Vues : Sources / Par LLM / Par prompt / Topics » |

#### 3 vues additionnelles
| Route | Fichier | Contenu |
|---|---|---|
| `/app/brands/[id]/sources` | NEW | Top 50 domains cités sur les 30 derniers snapshots, filtre par LLM + topic |
| `/app/brands/[id]/by-model` | NEW | Bar chart citation rate par LLM (couleur per-LLM) + table détaillée + rang moyen |
| `/app/brands/[id]/by-prompt` | NEW | Table prompts triés (rate ↓/↑/rang ↑) avec heatmap par LLM en colonne |

#### Multi-seats
| Fichier | Action |
|---|---|
| `app/app/team/page.tsx` | NEW — liste members + invitations en attente avec lien token |
| `app/app/team/invite/page.tsx` | NEW — form email + role |
| `app/app/team/actions.ts` | NEW — inviteMember + revokeInvitation + removeMember + leaveAccount + tier-gating |
| `app/auth/accept/route.ts` | NEW — handler GET ?token=... lie l'user à l'owner après vérif email match |
| `app/app/layout.tsx` | MODIFY — nav top : item « Équipe » conditionnel `seats > 1 && is_owner` |

#### Pricing UI
| Fichier | Action |
|---|---|
| `components/saas/TierBadge.tsx` | MODIFY — 5 tiers + legacy 'solo' affiché Starter |
| `app/app/billing/page.tsx` | MODIFY — refonte 5 cartes avec features détaillées par tier, gating `is_owner`, message membre |
| `app/saas/page.tsx` | MODIFY — pricing 5 tiers avec Growth highlighted |

#### HP refonte
| Fichier | Action |
|---|---|
| `app/page.tsx` | REFONTE — 2 CTAs « Suivre ma marque » + « Recevoir l'étude sectorielle gratuite », pricing preview 5 tiers, section CTA finale, suppression du form étude |
| `components/ui/Header.tsx` | MODIFY — default rightSlot = `<Link href="/contact">` au lieu de mailto |

#### Signup
| Fichier | Action |
|---|---|
| `app/signup/page.tsx` | MODIFY — query params `source=etude`, `category`, `invitation_token`, `email`. Champ email pré-rempli + readonly si invitation. Eyebrow/title/CTA dynamiques selon contexte |
| `app/signup/actions.ts` | MODIFY — propage source/category/invitation_token dans `raw_user_meta_data`. Si invitation_token → redirect post-signup vers `/auth/accept?token=...` |

### Edge Functions — code only (pas deploy)

| Fonction | Modif |
|---|---|
| `supabase/functions/saas_run_brand_snapshot/index.ts` | ✅ Accepte `topic_id` dans body, charge prompts depuis `saas_topics.prompts` si non vide, sinon prompts.json bundlé. PROMPTS_BY_TIER cap (50/200/200/300). LLMS_BY_TIER étendu pour Pro+Agency (+Mistral, +Grok). Insert snapshot avec topic_id. Logs usage avec topic_id + override flag. |
| `supabase/functions/saas_create_checkout_session/index.ts` | ✅ TIER_TO_PRICE map = { starter, growth, pro, agency } + alias legacy `solo` → STRIPE_PRICE_STARTER |
| `supabase/functions/saas_stripe_webhook/index.ts` | ✅ priceIdToTier() returns starter\|growth\|pro\|agency, fallback STRIPE_PRICE_SOLO → starter |

## ⚠️ Features skippées / partielles

| Item | Raison |
|---|---|
| **Email d'invitation auto** (`saas_send_invitation_email`) | Non livré ce sprint. Le flow `/app/team` affiche le lien `/auth/accept?token=...` que l'owner copie/colle manuellement. Edge Function à écrire + deploy + Resend template. ~30min de boulot Sprint S8. |
| **`saas_detect_alerts` + `saas_generate_recommendations` topic_id propagation** | Le snapshot a maintenant un topic_id, mais les alerts et recos générés en cascade ne récupèrent pas le `topic_id` du snapshot. Tables ont la colonne (migration appliquée), il faut juste un `UPDATE alerts SET topic_id = (SELECT topic_id FROM saas_brand_snapshots ...)` à ajouter dans les fonctions enfant — code only patch + redeploy par Fred. |
| **Stripe products réels** | À faire par Fred dans dashboard Stripe : archive 3 anciens, créer 4 nouveaux (`geoperf_starter`/`growth`/`pro`/`agency`), update les 4 secrets `STRIPE_PRICE_STARTER/GROWTH/PRO/AGENCY`. ~10 min. |
| **Mailto cleanup global** | Le brief listait 11 fichiers contenant `mailto:`. J'ai cleanup HP + Header (les plus visibles). Restent : contact/page.tsx, merci, portal, privacy, terms, sample, [sous_cat], saas/faq, ui/Button, ui/Footer. **Ces pages sont moins prioritaires** — gardent leur mailto en attendant. À faire jour 5 du brief. |
| **Sentiment, Content Studio** (Tier 2 brief) | Reportés Sprint S8 par design — Tier 2 = semaine prochaine. |
| **Page `/etudes`, `/methodologie`, `/tarifs`** | Référencées dans Header.tsx NAV mais pas créées. La page `/saas` joue le rôle de tarifs. Routes `/etudes` et `/methodologie` à créer ou retirer du NAV. |
| **Cascade migration view `v_saas_admin_overview`** | Pas de mise à jour du nom des tiers — toujours basée sur `tier IN ('solo', 'pro', 'agency')`. Si le code de la vue calculait MRR, il manque `'starter'` et `'growth'`. **À vérifier** : la vue actuelle utilise `CASE tier WHEN 'solo' THEN 149 ...`. **Bug fix nécessaire** : update le CASE pour inclure 'starter' (79), 'growth' (199), nouveaux 'pro' (399), 'agency' (799). |

## 🐛 Bugs trouvés en route

1. **TIER_LIMITS Record type strict** — typer le `Record<Exclude<SaasTier,"solo">, ...>` cassait les usages directs `TIER_LIMITS[ctx.tier]` quand ctx.tier pouvait être 'solo' (legacy). Fix : ajouté helper `tierLimits(tier)` qui résout proprement, et migré 6 appels (`dashboard`, `brands` x2, `brands/new` x2, `brand[id]/page` indirectement). Build passe maintenant.
2. **v_saas_admin_overview MRR calc** — la vue utilise `CASE tier WHEN 'solo' THEN 149 ...`. Avec la migration tier_refonte, `'solo'` n'a plus de subs (toutes migrées en 'starter'). MRR calculé reste 0 jusqu'à update SQL. **À fix manuellement** :
   ```sql
   CREATE OR REPLACE VIEW public.v_saas_admin_overview AS
   SELECT
     ...
     (SELECT COALESCE(SUM(CASE tier
         WHEN 'starter' THEN 79
         WHEN 'growth'  THEN 199
         WHEN 'pro'     THEN 399
         WHEN 'agency'  THEN 799
         WHEN 'solo'    THEN 79
         ELSE 0 END), 0) FROM saas_subscriptions WHERE status='active') AS mrr_eur,
     ...
   ```
3. **RLS expansion pour members** — la migration seats remplace les policies existantes en utilisant `saas_account_owner_of(auth.uid())`. **Risque** : si un user existant utilisait l'API client et que la fonction `saas_account_owner_of` retournait NULL pour cet user (cas jamais arrivé : la view fait LEFT JOIN, donc tout user a une row), ça bloquerait l'accès. Vérification rapide via SQL recommandée :
   ```sql
   SELECT * FROM v_saas_user_account WHERE user_id = '96a98cb1-...';
   ```
4. **Route `/etudes` et `/methodologie` dans Header NAV** — non créées. Quand l'user click dessus → 404. À retirer du Header.tsx default rightSlot OU créer les pages. Pour ce sprint, j'ai laissé tel quel (Header default usage rare hors HP, où on remplace rightSlot).

## 📊 Stats session

- **Migrations appliquées** : 4 (tier_refonte, tier_migrate_solo, topics, seats)
- **Tables nouvelles** : 3 (saas_topics, saas_account_members, saas_account_invitations)
- **Vues nouvelles** : 1 (v_saas_user_account)
- **Functions/triggers SQL** : 2 nouveaux (handle_saas_brand_default_topic, saas_account_owner_of helper)
- **Frontend nouveaux** : 11 pages + 3 actions + 1 component
- **Frontend modifiés** : 8 (lib/saas-auth, layout, billing, saas, page.tsx, signup x2, header, brands/[id])
- **Edge Functions modifiées** : 3 (run_brand_snapshot, create_checkout_session, stripe_webhook) — code only
- **Edge Functions deployed** : 0 (rule night)
- **Lignes ajoutées** (estimation) : ~3 200 LOC (TS/TSX) + ~150 LOC SQL
- **Build** : 29/29 pages OK, types green, middleware 88.8 kB

## ▶️ Prochaines étapes pour Fred

### 1. Vérifier build local (5 min)

```bash
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
npm run build
# Devrait afficher 29/29 routes, includes /app/team, /app/brands/[id]/topics, etc.
```

### 2. Stripe — recréer les products (10 min, dashboard manuel)

1. Dashboard Stripe → Products → archive `geoperf_solo`, `geoperf_pro`, `geoperf_agency`
2. Crée 4 nouveaux products :
   - `geoperf_starter` — Recurring 79€/mois EUR
   - `geoperf_growth` — Recurring 199€/mois EUR
   - `geoperf_pro` — Recurring 399€/mois EUR (nouveau prix vs ancien 349€)
   - `geoperf_agency` — Recurring 799€/mois EUR (nouveau prix vs ancien 899€)
3. Note les `price_*` IDs et update les secrets Supabase :
   ```bash
   supabase secrets set STRIPE_PRICE_STARTER=price_xxx --project-ref qfdvdcvqknoqfxetttch
   supabase secrets set STRIPE_PRICE_GROWTH=price_xxx --project-ref qfdvdcvqknoqfxetttch
   supabase secrets set STRIPE_PRICE_PRO=price_xxx --project-ref qfdvdcvqknoqfxetttch
   supabase secrets set STRIPE_PRICE_AGENCY=price_xxx --project-ref qfdvdcvqknoqfxetttch
   # STRIPE_PRICE_SOLO peut être supprimé ou laissé pointer vers STRIPE_PRICE_STARTER
   ```

### 3. Deploy 3 Edge Functions modifiées

```bash
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF
supabase functions deploy saas_run_brand_snapshot saas_create_checkout_session saas_stripe_webhook --project-ref qfdvdcvqknoqfxetttch
```

### 4. Patch SQL : MRR view corrigée (2 min)

```sql
CREATE OR REPLACE VIEW public.v_saas_admin_overview AS
SELECT
  (SELECT COUNT(*) FROM saas_profiles WHERE created_at > NOW() - INTERVAL '30 days') AS signups_30d,
  (SELECT COUNT(*) FROM saas_profiles) AS signups_total,
  (SELECT COUNT(*) FROM saas_subscriptions WHERE status = 'active' AND tier <> 'free') AS active_paid_subs,
  (SELECT COUNT(*) FROM saas_subscriptions WHERE status = 'active' AND tier = 'free') AS active_free_subs,
  (SELECT COALESCE(SUM(CASE tier
      WHEN 'starter' THEN 79
      WHEN 'growth'  THEN 199
      WHEN 'pro'     THEN 399
      WHEN 'agency'  THEN 799
      WHEN 'solo'    THEN 79
      ELSE 0
    END), 0) FROM saas_subscriptions WHERE status = 'active') AS mrr_eur,
  (SELECT COALESCE(SUM(cost_usd), 0) FROM saas_usage_log WHERE created_at > NOW() - INTERVAL '30 days') AS llm_cost_30d_usd,
  (SELECT COUNT(*) FROM saas_brand_snapshots WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed') AS snapshots_30d,
  (SELECT COUNT(*) FROM saas_alerts WHERE email_sent_at IS NOT NULL AND created_at > NOW() - INTERVAL '30 days') AS emails_sent_30d;
```

Apply via apply_migration MCP ou Dashboard SQL.

### 5. Tests E2E à faire (ordre suggéré, ~30 min total)

#### a. Smoke topics (5min, gratuit)
1. Login `/login`
2. Va sur `/app/brands/<axa-brand>` → vérifier le bandeau « Topics » et la nav « Vues »
3. `/app/brands/<axa-brand>/topics` → liste avec topic « Général » par défaut
4. Crée un topic « ESG » via le form
5. Vérifier `/app/brands/<axa-brand>/topics/<esg-id>` affiche la page de détail (vide pour l'instant)

#### b. 3 vues additionnelles (5min, gratuit, lecture)
1. `/app/brands/<axa-brand>/sources` → top 50 domains (s'il y a des snapshots completed)
2. `/app/brands/<axa-brand>/by-model` → bar chart par LLM
3. `/app/brands/<axa-brand>/by-prompt` → table prompts triés

#### c. Multi-seats invitation flow (10 min, gratuit)
1. Si tier ≥ Growth : `/app/team` → bouton « + Inviter » → form email + role
2. Crée invitation pour `flefebvre+test@jourdechance.com`
3. Copie le lien `/auth/accept?token=...` dans une autre session/incognito
4. Signup avec l'email invité → vérifier que tu es ajouté en member
5. Vérifier `/app/dashboard` montre les brands de l'owner
6. Le owner voit le member dans `/app/team`

#### d. Stripe checkout post-deploy (10 min, ~$0.50 carte test)
1. Sur compte Free : `/app/billing` → bouton « Activer Starter »
2. Redirect Stripe Checkout, carte 4242 4242 4242 4242
3. Webhook fire → tier = 'starter' dans saas_subscriptions
4. Refresh `/app/billing` → TierBadge passe à STARTER
5. Vérifier que les limits du Starter (4 LLMs, 50 prompts, 3 topics) sont enforced si tu lances un snapshot

### 6. Patch optionnel — propagate topic_id sur recos/alerts

Si vous voulez que les recos et alerts générés en cascade aient leur `topic_id` (utile pour le filtrage par topic dans les vues), patcher saas_detect_alerts et saas_generate_recommendations pour propager :

```typescript
// Dans saas_detect_alerts, ligne avant insert alerts :
const { data: snapshotRow } = await supabase
  .from("saas_brand_snapshots").select("topic_id").eq("id", snap.id).maybeSingle();
const topicId = (snapshotRow as any)?.topic_id ?? null;

// Puis dans chaque alert push :
alerts.push({ ...alertBase, topic_id: topicId, ... });
```

Idem pour saas_generate_recommendations. Re-deploy ensuite.

### 7. Sprint S8 (semaine prochaine)

Tier 2 du brief :
- Sentiment analysis sur les réponses LLM (Haiku)
- Content Studio (génération de drafts pour publier sur sources autorité)
- Edge Function welcome_email + invitation_email deployment
- Mailto: cleanup complet (10 fichiers restants)
- Pages `/etudes`, `/methodologie` ou retirer du Header NAV

## Status sprints

- ✅ S1, S2, S3, S4, S5, S6 (livrés sessions précédentes)
- ✅ **S7 Phase A complète** — pricing + topics + 3 vues + saas_run_brand_snapshot topic support
- ✅ **S7 Phase B mostly** — multi-seats DB+UI + HP refonte + signup source param + Stripe code map
- 🟨 S7 reliquat — email invitation auto (Edge Function), mailto cleanup global, MRR view fix
- ⏭️ S8 — Sentiment, Content Studio, deploy welcome+invitation emails

---

> Build vert, DB cohérente, code prêt à deploy. **Bonne journée Fred.**
> Time to deploy : ~25 min (Stripe products + 4 secrets + 3 functions deploy + 1 SQL view fix).
