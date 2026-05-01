# Brief CC CLI — Travail de nuit S5 + S6 + cleanup backlog

> **Contexte** : Fred dort 8h. Tu tournes en autonomie. Au matin, Fred review.
> Lis ce fichier en entier avant de commencer + saas/SPEC.md + saas/STATUS.md (à créer en début de session).

## Règles de la nuit

1. **Aucune décision UX/produit ambiguë → utilise les décisions par défaut listées plus bas.**
2. **Si bloqué techniquement** : skip la feature, documente le blocage dans NIGHT_RECAP.md, passe à la suivante.
3. **Aucun push GitHub** sans validation Fred. `npm run build` localement = OK.
4. **Aucun deploy `supabase functions deploy`** sans validation Fred. `apply_migration` via MCP = OK pour SQL.
5. **Pas de credentials hardcoded.** Tous secrets via env / Vault.
6. **Bash heredoc** pour fichiers >150 lignes (mount Windows truncation).
7. **Préfère** composants existants `components/ui/*` sur shadcn, SVG inline sur Recharts, trigger DB-side sur EdgeRuntime.waitUntil.
8. **Test E2E** via MCP Supabase execute_sql + net.http_post (cf. docs/CLAUDE-backend.md pour pattern).
9. **Cible : avancer le maximum de features ci-dessous, dans l'ordre de priorité.**

## Décisions par défaut (zéro ambiguïté)

- **Style** : BRAND_GUIDE.md, palette navy/amber/cream, font-serif/mono/sans, eyebrow font-mono.
- **Mobile** : responsive obligatoire (md: et lg: breakpoints Tailwind).
- **Auth admin** : `/admin/saas/*` → réutilise le middleware `admin` existant (pas de nouveau scope).
- **Coûts LLM** : sourcer depuis `saas_usage_log.cost_usd` agrégé.
- **MRR** : SUM(price_eur) des subs `tier IN ('solo','pro','agency') AND status='active'` (cf. TIER_LIMITS dans lib/saas-auth.ts).
- **Churn** : count canceled dans les 30 derniers jours / count actives au début de la période.
- **Date filter par défaut** : 30 jours sur les vues admin.
- **Migration filenames** : continuer en `YYYYMMDD_*.sql` simple. Le drift CLI on s'en occupera plus tard.

---

## SPRINT S5 — Admin + Observability (priorité 1, ~3h)

### S5.1 — Vue admin SaaS overview (`/admin/saas`)

Page server component avec KPI cards + charts + tableaux. Source : queries SQL agrégées.

**KPI cards (4 colonnes en grid)** :
- Signups (30j)
- Active subs payantes (Solo+Pro+Agency)
- MRR (€/mois)
- Coût LLM cumulé (30j)

**Sections** :
- Évolution signups + MRR (chart SVG inline) sur 30j
- Top 10 users par cost cumulé
- Distribution tier (donut SVG inline)
- Liste 20 derniers snapshots (status, brand, user, cost, durée)

**Migration utile** :
```sql
CREATE OR REPLACE VIEW public.v_saas_admin_overview AS
SELECT
  (SELECT COUNT(*) FROM saas_profiles WHERE created_at > NOW() - INTERVAL '30 days') AS signups_30d,
  (SELECT COUNT(*) FROM saas_subscriptions WHERE status='active' AND tier <> 'free') AS active_paid_subs,
  (SELECT COALESCE(SUM(CASE tier WHEN 'solo' THEN 149 WHEN 'pro' THEN 349 WHEN 'agency' THEN 899 ELSE 0 END), 0)
   FROM saas_subscriptions WHERE status='active') AS mrr_eur,
  (SELECT COALESCE(SUM(cost_usd), 0) FROM saas_usage_log WHERE created_at > NOW() - INTERVAL '30 days') AS llm_cost_30d_usd;
```

### S5.2 — Vue détail user (`/admin/saas/users/[id]`)

Server component qui charge :
- Profile + subscription history
- Liste brands trackées (active/inactive)
- Snapshots count (last 30d)
- Alertes envoyées count
- Cost cumulé par mois (last 6 months)

### S5.3 — Vue snapshots (`/admin/saas/snapshots`)

Tableau filtable (status, user, brand, date range). Pagination 50 par page.
Click sur une row → modal ou page détail avec error_message si failed.

### S5.4 — Détail snapshot user (`/app/brands/[id]/snapshots/[sid]`)

Reporté de S3. Page qui montre :
- Stats agrégées (visibility/rank/citation/SOV)
- Tableau des 30 responses (LLM, prompt_text, brand_mentioned, brand_rank, competitors, sources)
- Cost réparti par LLM
- Lien retour vers /app/brands/[id]

### S5.5 — Composant CompetitorMatrix (Pro+ tier, reporté de S3)

Component `components/saas/CompetitorMatrix.tsx` :
- Tableau 4 colonnes (LLM) × N lignes (brand + concurrents)
- Cellule : nb de mentions sur les 30 prompts
- Heatmap couleur (low=cream → high=amber → very high=navy)
- Affiché uniquement si tier in ('pro','agency') ; sinon `<UpgradePrompt />`.

Source : agrégation `saas_snapshot_responses.competitors_mentioned` du dernier snapshot completed.

---

## SPRINT S6 (partie 1) — Welcome email + Test email button (priorité 2, ~1h30)

### S6.1 — Welcome email post-signup

**Edge Function** `saas_send_welcome_email` :
- Trigger : POST { user_id }
- Charge profile.email + full_name
- Render template HTML on-brand (BRAND_GUIDE) :
  - Subject : "Bienvenue chez Geoperf — votre monitoring LLM est prêt"
  - Header logo + eyebrow
  - "Bonjour {full_name},"
  - 3 bullets : (1) ajouter votre 1ère marque, (2) cron mensuel automatique, (3) recommandations actionnables
  - CTA navy → /app/brands/new
- POST Resend from `hello@geoperf.com`
- Update saas_profiles avec `welcome_email_sent_at` (à ajouter en migration)

**Migration** `20260430_saas_phase1_welcome_email.sql` :
```sql
ALTER TABLE public.saas_profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.handle_saas_welcome_email_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  service_role_key TEXT;
BEGIN
  IF NEW.welcome_email_sent_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO service_role_key FROM vault.decrypted_secrets
    WHERE name = 'saas_service_role_key' LIMIT 1;
  IF service_role_key IS NULL THEN RETURN NEW; END IF;
  PERFORM net.http_post(
    url := 'https://qfdvdcvqknoqfxetttch.supabase.co/functions/v1/saas_send_welcome_email',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || service_role_key),
    body := jsonb_build_object('user_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER saas_welcome_email_dispatch
  AFTER INSERT ON public.saas_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_saas_welcome_email_dispatch();
```

### S6.2 — Bouton "Test email" dans /app/settings

Server action `sendTestEmail` qui crée une fake alert (citation_gain factice) en DB et déclenche manuellement saas_send_alert_email. Permet de tester deliverability sans attendre un vrai snapshot.

Affichage : bouton secondaire en bas de /app/settings, gated par tier ≥ Solo.

---

## SPRINT S6 (partie 2) — Landing /saas marketing (priorité 3, ~1h30)

### S6.3 — Page `/saas` publique (pas dans /app/*)

Marketing page hero + 3 sections :
1. **Hero** : "Surveillez votre visibilité dans ChatGPT, Claude, Gemini, Perplexity" + CTA "Créer mon compte gratuit"
2. **Comment ça marche** (3 colonnes) : Suivez votre marque / Comparez aux concurrents / Améliorez votre SEO LLM
3. **Pricing** : 4 cartes Free/Solo/Pro/Agency (reprend les TIER_LIMITS, rend FAQ basique)

Routing : Next.js page côté `landing/app/saas/page.tsx`.

### S6.4 — FAQ /saas/faq

Markdown-style FAQ : "Quels LLM testés ? Combien de prompts ? Combien de temps avant les premiers résultats ? RGPD ? Annulation ?"

---

## QUALITY — Backlog cleanup (priorité 4, si temps)

### Q.1 — Visibility score relatif

Dans `/app/brands/[id]` et `/app/dashboard`, afficher 2 scores :
- "Visibilité absolue" : visibility_score actuel (0-100)
- "Performance quand cité" : visibility_score / (citation_rate / 100) * 100, plafonné à 100

Le 2e score normalise par le citation_rate. Aide à expliquer "AXA 25/100 absolu mais 83/100 quand effectivement cité".

### Q.2 — Cron monitoring page admin

`/admin/saas/cron` qui charge `cron.job_run_details` :
- Liste 50 derniers runs du job `saas-run-scheduled-snapshots`
- Status (success/error), duration, last_seen

### Q.3 — Test E2E multi-brand

Crée 2 brands de test (insurance + fintech B2B fictives) en SQL, lance des snapshots manuellement avec test_mode=true, vérifie que tout cascade correctement (recos + alerts + emails skipped en test_mode).

---

## Reporting au matin

Crée un fichier `saas/docs/NIGHT_RECAP_2026-04-30.md` avec :
- ✅ Features livrées (path des fichiers + 1 ligne par feature)
- ⚠️ Features skippées (raison technique, blocage)
- 🐛 Bugs trouvés en route + fix appliqué (ou note pour Fred)
- 📊 Stats : nb fichiers créés/modifiés, lignes ajoutées, migrations appliquées
- ▶️ Prochaines étapes pour Fred au réveil (deploy commands, tests E2E à faire)

## Liste de migrations attendues

Format `YYYYMMDD_*.sql` :
- 20260430_saas_phase1_admin_views.sql (vue v_saas_admin_overview)
- 20260430_saas_phase1_welcome_email.sql (column + trigger)
- (autres au besoin)

## Ressources clés

- `saas/SPEC.md` — spec produit complète, sections 6 (frontend) + 9 (sprints)
- `landing/CLAUDE.md` — conventions frontend
- `docs/CLAUDE-backend.md` — patterns Edge Functions + n8n
- `landing/app/admin/*` — vue d'ensemble admin existant à étendre
- `landing/app/app/brands/[id]/page.tsx` — pattern de page détail à imiter pour snapshots/[sid]
- `BRAND_GUIDE.md` — palette + typo

Bon courage. Au matin, Fred review et on patche les bugs trouvés.
