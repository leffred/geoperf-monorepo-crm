# GEOPERF — Décisions à arbitrer

> Backlog des choix qui doivent être faits par Fred avant de débloquer les sprints.
> Au fur et à mesure des arbitrages, je déplace les lignes vers `DEVELOPMENT_HISTORY.md` et je nettoie ce fichier.

> ✅ **19 décisions tranchées le 2026-04-27** — détail dans `DEVELOPMENT_HISTORY.md` sessions 2, 3 et 4.

---

## 🟢 Tranchées le 2026-04-28 (session 8)

### D-024 — Auth admin : Supabase Auth (email/password) plutôt que token URL
- **Décision :** migration de `/admin?t=<TOKEN>` vers `/admin/login` avec form email/mdp + session cookie httpOnly via Supabase Auth.
- **Raisons :** (1) plus de token qui traîne dans l'URL, (2) multi-user possible quand on aura un dev externe, (3) reset password natif, (4) coût $0 (Supabase Auth inclus).
- **Trade-off accepté :** ~30 min d'implem vs 5 min pour HTTP Basic Auth.
- **Compat conservée :** `/api/admin/trigger` accepte session OU Bearer token, donc cron jobs externes / GitHub Actions peuvent toujours appeler avec le token.

### D-025 — Apollo Basic plan suffit (pas d'upgrade requis)
- **Vérification :** master API key + endpoint `/api/v1/mixed_people/api_search` (gratuit, 0 crédit) + `/api/v1/people/bulk_match` (1 crédit/lead). Quota Basic 2560 crédits/mois suffit largement (cible : 600 enrichments/trim).
- **Décision :** rester sur le plan Basic 59€/mois. Pas d'upgrade Pro ni de switch vers Dropcontact/Hunter.io.

---

## 🟡 À régler quand pratique (pas Sprint-bloquant)

### D-017 — Rotation de la clé OpenRouter
- **Status :** Reportée. Fred a choisi de garder la clé actuelle pour le moment.
- **Recommandation :** Faire la rotation avant de partager des accès à des tiers (collaborateurs, n8n cloud, etc.). Procédure dans `docs/SECRETS_VAULT.md`.

---

## 🟢 À voir plus tard (Sprint 2+)

### D-020 — Stratégie de pricing des prestations payantes
- À documenter quand on aura les premiers calls et qu'on aura compris le willingness-to-pay.

### D-021 — Création de la structure dédiée GEOPERF
- À déclencher quand le pilote validera le PMF.

### D-022 — Internationalisation
- Démarrage français (Jourdechance est française). Anglais pour LB suivants ?

### D-023 — Programme partenaire / agences
- Si on génère beaucoup de LB, des agences pourraient être intéressées pour les revendre à leurs clients.

---

## Notes de méthode

- **Format de décision** : énoncé de la question, l'impact, ma reco. Tu réponds (brève) → je trace dans `DEVELOPMENT_HISTORY.md` → je supprime de ce fichier.
- **Les recos ici ne sont pas des décisions** : tu peux choisir autre chose, je m'aligne.
- Si tu as une décision à ajouter qui n'est pas dans cette liste, dis-le moi et je l'inscris.
