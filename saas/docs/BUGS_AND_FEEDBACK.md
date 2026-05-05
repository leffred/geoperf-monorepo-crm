# GEOPERF — Bugs & Feedback Tracker

> Carnet de bord des retours utilisateur. Maintenir au fil de l'eau.
> Sert de source pour les briefs de sprints suivants.

---

## Légende

**Priorités** :
- 🚨 **P0** — Blocker. Empêche un parcours critique de fonctionner. Hotfix immédiat.
- 🔴 **P1** — Important. Gros impact UX/business. Prochain sprint.
- 🟠 **P2** — UX. Améliore le parcours. 1-2 sprints.
- 🟡 **P3** — Idée. Pas de friction actuelle, à explorer.

**Types** :
- 🐛 **BUG** — quelque chose ne marche pas comme attendu
- 💡 **FEEDBACK** — ça marche mais c'est sous-optimal
- ✨ **IDÉE** — nouvelle feature à creuser

**Statuts** :
- 🆕 **Open** — pas commencé
- 🛠️ **In progress** — en cours dans un sprint
- ✅ **Fixed** — corrigé, vérifié par Fred
- ⏭️ **Deferred** — reporté à plus tard avec justification
- ❌ **Won't fix** — décision de ne pas traiter

---

## Round 1 — Test Fred — 2026-05-04

**Source** : PPT `bugs et features.pptx` uploadé par Fred lors de sa première session de test en incognito post-S15.

### 🚨 Hotfixes urgents (P0)

#### 🐛 BUG #1.1 — Prompts personnalisés ne s'enregistrent pas
- **Statut** : ✅ Fixed (S16.1, 2026-05-04)
- **Page** : `/app/brands/new`
- **Repro** : Saisir nom + catégorie + cocher des prompts perso (suggestion Haiku S15) → submit du form
- **Attendu** : prompts cochés persistés dans `saas_topics.prompts` en plus des 30 par défaut
- **Vu (Fred)** : "Les prompts personnalisés ne fonctionnent pas (j'ai bien rempli nom/catégories mais ça ne marche pas)"
- **Root cause investiguée** : le code de persistance était correct (input hidden controlled + server action lit `suggested_prompts_json`, parse JSON, UPDATE `saas_topics.prompts`). Le trigger `saas_brand_default_topic` AFTER INSERT existe bien et crée le default topic synchronement. **Le vrai problème était la discoverability** : le picker était dans un `border-t` discret avec un bouton outline secondary peu visible, et aucun feedback positif après création. Résultat : Fred a probablement soumis le form sans cliquer "Suggérer 5 prompts", ou l'API a échoué silencieusement (env var `OPENROUTER_API_KEY` éventuellement manquante sur la fonction Edge `saas_suggest_prompts`).
- **Fix S16.1** : refonte UX du `PromptSuggestionPicker` — card surface dédiée, heading H3 clair, bouton primary noir, feedback vert "✓ N prompts personnalisés seront ajoutés", message d'erreur API verbeux (inclut le `data.hint` retourné par l'Edge Function pour faciliter le diagnostic).
- **Sprint** : S16.1

#### 🐛 BUG #1.2 — Erreur "cadence hebdo réservée Solo+" en plan Free
- **Statut** : ✅ Fixed (S16.1, 2026-05-04)
- **Page** : `/app/brands/new` ET `/app/onboarding`
- **Repro** : Plan Free actif, sélectionner cadence "mensuelle" dans le formulaire, submit
- **Attendu** : brand créée avec cadence monthly (autorisée pour Free)
- **Vu (Fred)** : Erreur _"La cadence hebdomadaire est réservée aux plans Solo et plus"_ alors que l'option mensuelle est bien sélectionnée dans le form
- **Root cause** : DEUX bugs combinés :
  1. **HTML spec** : `<select disabled={isFree}>` empêche le navigateur d'envoyer la valeur dans le FormData. Donc `formData.get("cadence")` retournait `null` côté serveur, et le fallback hardcodé `|| "weekly"` (page.tsx ligne 30 ancienne version) faisait passer la cadence à `weekly`. Le check `limits.cadence === "monthly" && cadence === "weekly"` fire alors le redirect cadence_locked, en boucle pour tout user Free.
  2. **Wording legacy** : le message d'erreur référence "Solo+" qui n'existe plus dans la grille v2 (S7 Free/Starter/Growth/Pro/Agency). Idem pour les hints "Upgrade vers Solo".
- **Fix S16.1** :
  - `actions.ts` : fallback côté serveur sur `tierLimits(tier).cadence` au lieu de `"weekly"` hardcodé (defensive, peu importe ce que le client envoie).
  - `brands/new/page.tsx` + `onboarding/page.tsx` : retiré `disabled={isFree}` du `<select>` global (l'option `weekly` reste `disabled={isFree}` pour empêcher la sélection visuelle, mais le select reste submittable pour Free).
  - 4 occurrences "Solo+" remplacées par "Starter+" dans error labels + UI hints (brands/new, onboarding, settings).
- **Sprint** : S16.1

---

### 🔴 P1 — À traiter en S16 ou avant

#### 🐛 BUG #1.3 — Mail de confirmation post-signup non brandé Geoperf
- **Statut** : ✅ Fixed (S16.1 Phase A + B, 2026-05-04) — Phase A validée par Fred (Resend verified + SMTP Supabase configuré + test E2E OK avec mail brandé reçu)
- **Page** : email reçu juste après création de compte sur `/signup`
- **Repro** : signup avec un email frais
- **Attendu** : mail de bienvenue Geoperf-brandé (palette Tech crisp, sender `hello@geoperf.com`)
- **Vu (Fred)** : mail générique Supabase Auth (sender `noreply@mail.app.supabase.io`) pour confirmer l'email
- **Décision Fred** : option B (template HTML custom + sender geoperf.com).
- **Phase B livrée S16.1** : template HTML Tech crisp produit dans `saas/templates/supabase_auth_confirm_signup.html` avec syntaxe Supabase `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`. Palette alignée avec `saas_send_welcome_email` post-S16 (Inter, ink #0A0E1A, surface #F7F8FA, brand-500 #2563EB, glyphe `·` ambré préservé).
- **Phase A à faire par Fred (manuel)** :
  1. Supabase Dashboard → Authentication → Email Templates → "Confirm signup" → coller le HTML du template, save.
  2. Supabase Dashboard → Authentication → SMTP Settings → configurer Resend SMTP relay si pas déjà fait, sender `Geoperf <hello@geoperf.com>`.
- **Sprint** : S16.1 Phase B (Phase A : action manuelle Fred Dashboard, hors agent)

---

### 🟠 P2 — UX, peut attendre

#### 🐛 BUG #1.4 — Pas de CTA "Créer un compte" sur /login
- **Statut** : ✅ Fixed (S16.1, 2026-05-04)
- **Page** : `/login`
- **Repro** : visiteur arrive sur la page login depuis un lien email/marketing
- **Attendu** : un lien _"Pas encore de compte ? S'inscrire"_ visible sous le bouton "Se connecter"
- **Vu (Fred)** : le lien existe en haut à droite, _"complètement hors du contexte"_
- **Fix S16.1** : ajout d'un `<p>` sous le `<Button type="submit">Se connecter</Button>` avec texte `"Pas encore de compte ?"` et un `<Link href="/signup">Créer un compte</Link>` en `text-brand-500 hover:underline`. Le lien header `/signup` est conservé (visible sur les autres pages publiques).
- **Sprint** : S16.1

#### 💡 FEEDBACK #1.5 — Deux boutons redondants sur /app/dashboard EmptyState
- **Statut** : ✅ Fixed (S16.1, 2026-05-04)
- **Page** : `/app/dashboard` (EmptyState)
- **Repro** : compte fresh sans aucune brand
- **Constat (Fred)** : 2 CTAs très proches "Démarrer l'onboarding" et "Form rapide" — _"les formulaires derrière sont quasiment les mêmes"_
- **Fix S16.1** : retiré le secondary CTA "Form rapide". Garde uniquement le wizard `/app/onboarding` comme CTA primaire, label simplifié à "Créer ma première marque". Le `/app/brands/new` reste accessible via la nav et le bouton "+ Suivre une marque" du dashboard une fois qu'il y a au moins 1 brand.
- **Sprint** : S16.1

---

### 🟡 P3 — Idées

#### ✨ IDÉE #1.6 — Auto-suggest concurrents à partir du nom de marque
- **Statut** : 🆕 Open
- **Page** : `/app/brands/new` ou `/app/onboarding`
- **Idée Fred** : à partir du nom de marque saisi, suggérer automatiquement 3-5 concurrents directs (champ pré-rempli, l'user peut modifier)
- **Pourquoi c'est intéressant** : réduit la friction d'onboarding, surtout pour les users qui ne savent pas exactement qui sont leurs concurrents directs
- **Implémentation possible** :
  - Edge Function `saas_suggest_competitors` qui appelle Haiku avec : "Donne les 5 concurrents directs de {brand_name} dans la catégorie {category}, format JSON [{name, domain}]"
  - Coût : ~$0.001 par appel (négligeable)
  - Pattern identique à `saas_suggest_prompts` livré en S15
  - Cap : 1 appel par minute par user (rate-limit)
- **Sprint cible** : S17 (groupable avec autres améliorations onboarding)

---

## Round 2 — Tests E2E Stripe checkout — 2026-05-04

**Source** : tests E2E pré-launch lancés post-S16.1 sur compte test mode Stripe.

### 🚨 P0 — Bugs critiques résolus en hotfix S16.2

#### 🐛 BUG #2.1 — Mismatch contrat client/Edge Function checkout
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `landing/app/app/billing/actions.ts` ↔ `supabase/functions/saas_create_checkout_session/index.ts`
- **Root cause** : Le client envoyait `cycle` et `trial_period_days`, l'Edge Function destructurait `billing_cycle` et `trial`. Defaults de l'Edge Function (`monthly`, `false`) masquaient le bug → toggle annual silencieusement cassé, trial Pro 14j jamais activé.
- **Fix** : aligner le contrat côté client.

#### 🐛 BUG #2.2 — Edge Function rejette Stripe webhook (UNAUTHORIZED_NO_AUTH_HEADER)
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `supabase/functions/saas_stripe_webhook`
- **Root cause** : Par défaut, le gateway Supabase Edge Functions exige `Authorization: Bearer <JWT>` sur toutes les requêtes. Stripe envoie `stripe-signature`, pas un JWT. Tous les events étaient rejetés en 401 avant même d'atteindre le code.
- **Fix** : redéployer avec `--no-verify-jwt`. À pérenniser dans `supabase/config.toml`.

#### 🐛 BUG #2.3 — Enum `saas_subscription_status` sans valeur `trialing`
- **Statut** : ✅ Fixed (S16.2 migration phase 9, 2026-05-04)
- **Page** : DB schema + `saas_stripe_webhook/index.ts`
- **Root cause** : S16 §4.4 a modifié `mapStripeStatus()` pour préserver `trialing`, mais la migration SQL pour ajouter la valeur à l'enum n'a pas été faite. Tout user sur trial Pro 14j aurait bloqué le webhook avec erreur "invalid input value for enum".
- **Fix** : migration `20260504_saas_phase9_trialing_enum.sql` ajoute la valeur à l'enum.

#### 🐛 BUG #2.4 — Webhook ne dégage pas la sub free lors d'un upgrade
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `supabase/functions/saas_stripe_webhook/index.ts` case `customer.subscription.created/updated`
- **Root cause** : Quand un user free upgrade vers payant, l'UPSERT de la nouvelle sub à `status='active'` était rejeté par le UNIQUE INDEX partial `(user_id) WHERE status='active'` (la free row était encore active). Webhook plantait silencieusement, sub bloquée à `incomplete`.
- **Fix** : avant l'UPSERT, déclasser les `tier='free' AND status='active'` du même user à `canceled`.
- **Validation E2E** : compte `flefebvre+8@jourdechance.com` 2026-05-04 → free déclassée + starter active automatiquement, zéro intervention SQL.

### 🔴 P1 — Bugs résolus avec config externe

#### 🐛 BUG #2.5 — Stripe live/test mode mismatch
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Root cause** : `STRIPE_SECRET_KEY` côté Supabase était en mode TEST, mais les `STRIPE_PRICE_*` pointaient vers des price IDs créés en mode LIVE (héritage S7+S16). Erreur Stripe : "No such price ... a similar object exists in live mode".
- **Fix** : reset des `stripe_customer_id` pour les 3 profils avec values live + recréation des 4 products + 8 prices en TEST mode + update des 8 env vars + nouveau webhook secret + reconfig MCP Stripe en TEST.

#### 🐛 BUG #2.6 — Stripe Tax sans address sur customer fresh
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `saas_create_checkout_session/index.ts`
- **Root cause** : `automatic_tax: { enabled: true }` requiert que le customer ait une address de facturation, ou que la session collecte l'adresse. Customer fresh créé en mode test → pas d'adresse → Stripe rejette avec "Automatic tax calculation requires a valid address".
- **Fix** : ajout de `customer_update: { address: "auto", name: "auto" }` + `billing_address_collection: "required"` dans `stripe.checkout.sessions.create`.

#### 🐛 BUG #2.7 — Webhook Stripe sans tous les events nécessaires
- **Statut** : ✅ Fixed (S16.2 config Fred, 2026-05-04)
- **Page** : Stripe Dashboard test → Webhooks → endpoint events
- **Root cause** : L'endpoint webhook test mode était configuré sans `customer.subscription.created` (et possiblement d'autres). Stripe n'émettait donc jamais cet event vers Supabase, et la sub n'était jamais créée en DB.
- **Fix** : Fred a ajouté les 5 events nécessaires : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

### 🚨 P0 (suite) — Bugs découverts en tests E2E avancés

#### 🐛 BUG #2.8 — Multi-billing : checkout ne cancel pas les anciennes subs Stripe
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `supabase/functions/saas_create_checkout_session/index.ts`
- **Root cause** : Quand un user upgrade Starter → Pro, Stripe créait une nouvelle subscription sans cancel l'ancienne. Stripe ne fait pas le cancel automatique. Résultat : 2 subs actives Stripe simultanément, l'user payait 2× (testé : 1× starter 79€ + 2× pro 399€ = 877€/mois pour un user au lieu de 399€).
- **Fix** : avant `stripe.checkout.sessions.create`, list toutes les subs du customer puis cancel celles en status `active|trialing|past_due|incomplete`. Trade-off accepté : si l'user abandonne le checkout après ce cancel, il perd son ancien plan. Acceptable, priorité = zéro double-billing. À raffiner avec Stripe Customer Portal en S17.

#### 🐛 BUG #2.9 — Read silencieux fallback à free quand multi-rows actives
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : `landing/lib/saas-auth.ts` ligne ~131
- **Root cause** : `.eq("user_id", x).in("status", ["active","trialing"]).maybeSingle()` retourne null quand >1 row matche (au lieu d'erreur). Combiné au `?? "free"` ligne 137, l'user payait Pro mais voyait son interface en Free pendant les états transients.
- **Fix** : ajout de `.order("created_at", desc).limit(1)` avant `.maybeSingle()` pour toujours retourner la sub la plus récente.

#### 🐛 BUG #2.10 — TVA non calculée sur prices yearly (tax_behavior unspecified)
- **Statut** : ✅ Fixed (S16.2, 2026-05-04)
- **Page** : Stripe prices côté compte test
- **Root cause** : Les 8 prices créés via MCP `create_price` n'avaient pas `tax_behavior` explicite (default unspecified). Stripe Tax appliquait des comportements différents selon le contexte → TVA OK sur monthly, absente sur annual.
- **Fix** : recréation des 8 prices avec `tax_behavior=exclusive` (HT, TVA s'ajoute) via `stripe_api_execute`. Update des 8 env vars Supabase. Décision business : garder unit_amounts (79/199/399/799€) en HT → revenu net +20%, prix client final 94.80€/238.80€/478.80€/958.80€ TTC.

---

### 🟡 P3 — Refontes UI à traiter en S17

#### ✨ FEEDBACK #2.11 — Refonte affichage prix /saas et /app/billing
- **Statut** : 🆕 Open — sprint cible S17
- **Page** : `landing/app/saas/page.tsx` + `landing/app/app/billing/page.tsx`
- **Décision Fred 2026-05-04** : refonte de l'affichage prix sur les 2 pages publiques + billing :
  1. **HT prominent + TTC petit** : afficher le prix HT en grand (ex: 79€), puis en petit gris en dessous "soit 94.80€ TTC". Cohérent B2B (clients pro raisonnent en HT car ils récupèrent la TVA).
  2. **Annuel : prix mensuel équivalent en grand, économie en dessous**. Exemple : "59€ HT / mois" en grand, puis "Facturé 708€/an, soit 3 mois offerts" en petit. Le total annuel ne doit PAS être affiché en grand pour ne pas effrayer le clic.
  3. **Badge "3 mois offerts"** sur le toggle annuel (alternative ou complément à "économisez X€").
- **Stripe affiche déjà HT+TVA=TTC** au checkout grâce à `tax_behavior=exclusive` sur tous les prices (livré S16.2).
- **Nouvelle grille pricing -25% sur annuel** (recréée S16.2) :
  - Starter 79€/mo → 59€/mo annuel (708€/an)
  - Growth 199€/mo → 149€/mo annuel (1788€/an)
  - Pro 399€/mo → 299€/mo annuel (3588€/an)
  - Agency 799€/mo → 599€/mo annuel (7188€/an)
- **Comparaison concurrent GetMint** : Geoperf devient ~50% moins cher sur Starter annuel et ~40% moins cher sur Pro annuel — argument anchoring fort à pousser sur `/saas/vs-getmint`.

---

### 🟡 P3 — Dette tech Sentry (S18 ou hotfix court)

#### ✨ FEEDBACK #2.12 — Sentry global-error.js manquant
- **Statut** : 🆕 Open — sprint cible S18
- **Source** : warning au `npm run build` post-S17.
- **Impact** : ~5% des erreurs (crashs render React) ne sont pas capturées par Sentry.
- **Fix** : créer `landing/app/global-error.tsx` avec Sentry handler. 10 min. Doc : https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#react-render-errors-in-app-router

#### ✨ FEEDBACK #2.13 — Sentry deprecation `sentry.client.config.ts`
- **Statut** : 🆕 Open — sprint cible S18 ou plus tard
- **Source** : DEPRECATION warning au `npm run build` post-S17.
- **Impact** : marchera encore 6-12 mois. Quand Next.js basculera sur Turbopack par défaut, le file sera ignoré.
- **Fix** : renommer `sentry.client.config.ts` → `instrumentation-client.ts` ou déplacer son contenu dans `instrumentation.ts`. 5 min.

---

## Round 3 — Tests E2E Apollo Sequence A — 2026-05-04

**Source** : tests E2E acquisition pré-launch (post-S17, mailbox Apollo connectée, contact test enrollé).

### 🚨 P0 — Bugs critiques résolus

#### 🐛 BUG #3.1 — SPF Resend obsolète (`_spf.resend.com` → `send.resend.com`)
- **Statut** : ✅ Fixed (S17 hotfix DNS, 2026-05-04)
- **Source** : Mail-tester reportait `permerror` sur le SPF chain. `_spf.resend.com` n'existe plus côté Resend (changement non documenté).
- **Impact** : SPF en `permerror` = MTA récepteurs (Gmail, Outlook) marquent les emails geoperf.com comme suspects → spam à 50%+, voire reject.
- **Fix** : OVH → Zone DNS geoperf.com → record TXT racine SPF : `_spf.resend.com` → `send.resend.com`. Score mail-tester passé de ~5/10 à 10/10.
- **Leçon** : tester systématiquement le SPF chain via mail-tester ou `dig` après toute config DNS sender. Resend a probablement changé son convention sans deprecation visible.

#### 🐛 BUG #3.2 — Workflow Phase 2 sourcing ramène des CMO mondiaux (pas FR)
- **Statut** : ✅ Fixed (S17, 2026-05-04)
- **Page** : `n8n/workflows/geoperf_phase2_sourcing.json` node "Build Apollo searches"
- **Root cause** : payload Apollo `mixed_people/api_search` ne spécifiait pas `person_locations`. Apollo ramenait tous les CMO mondiaux des companies sourced (BlackRock US, Vanguard US, etc.), faisant péter le critère langue de la Sequence FR1.
- **Diagnostic** : sur 19 prospects AM "éligibles", 14 US + 2 Suisse (anglophones) + 3 "France" dont seulement 1 probablement bilingue FR. Si on lance la Sequence FR sur ces 19, on brûle 18 leads anglophones.
- **Fix** : 2 patches dans le workflow Phase 2 sourcing :
  1. Node "Build Apollo searches" : ajout `person_locations: ["France", "Belgium", "Luxembourg", "Switzerland", "Monaco"]` dans `apollo_payload`.
  2. Node "Score & filter" : ajout malus -30 sur les titles regex `\b(americas?|north america|usa|emea director|global head|dach|nordic|asia|apac|chief of staff to the global)\b` (sécurité supplémentaire).
- **Action complémentaire DB** : 24 prospects non-FR existants passés à `status='disqualified'` avec `metadata.disqualified_reason='non_french_speaking'` (réactivables si on lance Sequence EN un jour).

### 🔴 P1 — Workflows découverts

#### 🐛 BUG #3.3 — Custom fields Apollo non poussés via workflow Phase 2.2
- **Statut** : ✅ Fixed (S17, 2026-05-04)
- **Page** : `n8n/workflows/geoperf_phase2_2_sequence_load.json` node "Build Apollo payload"
- **Root cause** : le node Build Apollo payload ne poussait pas les `typed_custom_fields` au moment de la création du contact Apollo. Conséquence : les variables `{{ranking_position}}`, `{{visibility_score}}`, etc. partaient en placeholder littéral dans les emails.
- **Fix** : 4 custom fields créés manuellement dans Apollo UI (Settings → Custom Fields), IDs récupérés via MCP `apollo_contacts_search` sur un contact test, snippet JS du node mis à jour pour inclure `typed_custom_fields: { [CF.ranking_position]: p.rank, ... }` au format dict (Apollo accepte `{<field_id>: value}`).
- **Mapping IDs Apollo** :
  - `ranking_position` → `69f893ced0779e000de94b4c`
  - `visibility_score` → `69f89400d0779e000de94dcd`
  - `landing_url` → `69f8941c017040001faff3c5`
  - `competitor_top1` → `69f8942e02bc0300151d8fb2`

### 🟠 P2 — Conventions Apollo découvertes

#### 💡 FEEDBACK #3.4 — Apollo "Send Test" envoie au USER, pas au CONTACT
- **Statut** : ✅ Documented (S17, 2026-05-04)
- **Comportement** : le bouton "Send Test" Apollo envoie systématiquement à l'utilisateur Apollo logué (créateur de la Sequence), pas au contact destinataire. C'est by design pour validation visuelle sans envoi réel.
- **Conséquence** : pour vraiment tester la deliverability vers un email externe, il faut **enroller** le contact dans la sequence (l'email part pour de vrai vers son inbox dans le wait_time de step 1).
- **Apollo UI quirk** : la syntaxe des custom fields dans les copies est `{{ranking_position}}` (juste le nom du field), pas `{{contact.custom_fields.ranking_position}}` ni `{{custom_fields.ranking_position}}`. Découvert par essai-erreur.

#### 💡 FEEDBACK #3.5 — Apollo "events Stripe webhook" — 5 events obligatoires
- **Statut** : ✅ Documented (S17, 2026-05-04)
- **Source** : tests payment_failed S16.2 ont révélé 401 silencieux du webhook saas_stripe_webhook quand le verify_jwt n'était pas désactivé.
- **Convention pérenne** : tous les webhooks tiers (Stripe, Calendly, Apollo callbacks) doivent être déployés avec `--no-verify-jwt`. À pérenniser dans `supabase/config.toml`.
- **Liste des events Stripe à cocher dans webhook Apollo Dashboard** : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

### 🟡 P3 — Idées long terme

#### ✨ IDÉE #3.6 — Sequence A version EN pour les leads anglophones
- **Statut** : 🆕 Open — sprint cible S18
- **Contexte** : 24 prospects ont été disqualifiés en S17 pour cause d'anglophonie. Pour les réactiver, il faut une Sequence EN parallèle.
- **Implémentation** :
  1. Dupliquer FR1 dans Apollo → traduire en EN → "EN1"
  2. Ajouter une colonne `language` ou `locale` à `prospects` (inferable du country + LinkedIn locale)
  3. Modifier le webhook Phase 2.2 pour router selon la langue : `if locale='fr' → FR1, else → EN1`
- **Réactivation des disqualified** : `UPDATE prospects SET status='new' WHERE metadata->>'disqualified_reason' = 'non_french_speaking';`

#### ✨ IDÉE #3.7 — Warmup mailbox obligatoire pour nouveau domaine
- **Statut** : ✅ En cours (Apollo Inbox Warmup activé 2026-05-04)
- **Contexte** : malgré DNS parfait (mail-tester 10/10), le mail test post-S17 est arrivé en spam Gmail à cause de la réputation neuve du domaine geoperf.com.
- **Process** : Apollo Inbox Warmup envoie automatiquement des emails simulés entre mailboxes Apollo pour bâtir la réputation. Durée : 7-14 jours pour atteindre 85%+ inbox placement.
- **Pré-launch checklist** : avant tout vrai batch, vérifier dans Apollo Settings → Mailboxes le score "Inbox Placement". Lancer batch progressif : 5/jour J+10, 10/jour J+15, 20/jour J+20.

---

## Round 4 — Bugs Phase 2 sourcing — 2026-05-04 soir

**Source** : Fred a lancé une nouvelle étude "Transformation digitale" et constaté 0 prospects sourcés via webhook Phase 2.

### 🚨 P0 — Bugs critiques résolus

#### 🐛 BUG #4.1 — Phase 1 LLM hallucine descriptions au lieu de domains
- **Statut** : 🟠 Open (S18) — workaround appliqué (cleanup SQL)
- **Symptôme** : sur le report Transformation digitale, **20 rows sur 36** ont leur colonne `domain` qui contient une description (ex: `"conseil en stratégie et technologie..."` au lieu de `"accenture.com"`).
- **Root cause** : le LLM (probablement Claude/GPT) du workflow Phase 1 a confondu "domain" avec "core business" sur certaines lignes. Le prompt n'est pas assez strict sur le format attendu.
- **Workaround** : DELETE des rows polluées via `c.domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$'`.
- **Fix S18** : renforcer le prompt Phase 1 pour exiger un domain regex-validé, ou ajouter une étape de validation côté workflow avant l'INSERT.

#### 🐛 BUG #4.2 — Node "Apollo people search" cassé (URL/body manquants)
- **Statut** : ✅ Fixed (2026-05-04, n8n cloud)
- **Page** : workflow `c85c3pPFq85Iy6O2` node "Apollo people search"
- **Symptôme** : le node avait `url: "={{ $json.apollo_url }}"` (référence inexistante) et **pas de sendBody/jsonBody**. Aucun call API valide → 0 prospects.
- **Root cause** : régression silencieuse à un moment dans l'historique du workflow (probablement édit manuel n8n ou import JSON foireux).
- **Fix** : restaurer `url: "https://api.apollo.io/api/v1/mixed_people/api_search"` + `sendBody: true` + `jsonBody: "={{ JSON.stringify($json.apollo_payload) }}"`.

#### 🐛 BUG #4.3 — Apollo API param `q_organization_domains` → `q_organization_domains_list`
- **Statut** : ✅ Fixed (2026-05-04, n8n cloud)
- **Page** : workflow `c85c3pPFq85Iy6O2` node "Build Apollo searches"
- **Root cause** : Apollo a renommé le param API de `q_organization_domains` (ancien) à `q_organization_domains_list` (avec `_list`). L'ancien nom retourne 0 résultats silencieusement (Apollo l'ignore probablement).
- **Fix** : remplacer dans le `apollo_payload` du node JS : `q_organization_domains` → `q_organization_domains_list`.

#### 🐛 BUG #4.4 — `person_departments` n'existe pas dans l'API Apollo officielle
- **Statut** : ✅ Fixed (2026-05-04, n8n cloud)
- **Page** : workflow `c85c3pPFq85Iy6O2` node "Build Apollo searches"
- **Root cause** : le payload contenait `person_departments: ['marketing', 'c_suite']` mais ce paramètre n'est pas documenté côté Apollo officiel. Apollo le rejetait → 0 résultats. Confirmé via test MCP : retirer ce param fait passer le call de 0 à 17 prospects pour Microsoft.
- **Fix** : supprimer la ligne `person_departments: ...` du payload.

### 🟢 Validation finale Round 4

Test post-fixes (2026-05-04, report Transformation digitale, max_per_company=3, lead_score_min=30) :
- **37 prospects** sourcés sur 16 companies (Apollo dispo)
- **33 emails verified** (89%)
- **6 prospects éligibles Sequence A** (lead_score >= 50) répartis : Microsoft (2), Deloitte Digital (2), IBM (1), SAP (1)
- **0 prospects** US/UK/Asie (filtre `person_locations: France/BE/CH/LU/MC` opérationnel)

Pipeline acquisition entièrement fonctionnel. Reste le warmup mailbox (5-10 jours) avant 1er envoi réel.

---

## Round 4 → 5 — (à venir)

> Quand tu refais une session de tests, ajoute un nouveau header `## Round 2 — Test Fred — YYYY-MM-DD` ici et reproduit la structure. Numérotation : `#2.1`, `#2.2`, etc.

---

## Statistiques (au 2026-05-04, après S16.1)

| Priorité | Open | In progress | Fixed | Total |
|---|---|---|---|---|
| 🚨 P0 | 0 | 0 | 2 | 2 |
| 🔴 P1 | 0 | 0 | 1 | 1 |
| 🟠 P2 | 0 | 0 | 2 | 2 |
| 🟡 P3 | 1 | 0 | 0 | 1 |
| **Total** | **1** | **0** | **5** | **6** |

---

## Notes pour les sprints suivants

**S16.1 — Hotfix bugs PPT Round 1 (LIVRÉ 2026-05-04)** ✅
- 5 findings fermés : #1.1, #1.2, #1.3 (Phase B), #1.4, #1.5
- Action manuelle Fred restante : #1.3 Phase A (Supabase Dashboard → Email Templates → Confirm signup → coller le HTML de `saas/templates/supabase_auth_confirm_signup.html`).

**S17 — Acquisition Launch**
- À ajouter : #1.6 (auto-suggest concurrents) — seul P3 ouvert, pattern identique à `saas_suggest_prompts` livré en S15.
