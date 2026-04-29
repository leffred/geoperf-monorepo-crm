# CLAUDE.md — GEOPERF

> Auto-lu chaque session. Format compact, navigation vers sub-CLAUDE selon le sujet.

---

## TL;DR

**Geoperf** = lead-magnet B2B de **Jourdechance SAS** (FR). Études sectorielles trimestrielles sur la perception des marques par les LLM (ChatGPT, Gemini, Claude, Perplexity). Distribué gratuitement aux décideurs marketing → conversion en audit GEO payant.

**Owner** : Frederic Lefebvre · `flefebvre@jourdechance.com`
**Pilote actif** : Asset Management.

---

## Stack

| Layer | Tech |
|---|---|
| Reporting | n8n + OpenRouter (4 LLM) + Supabase Edge Functions |
| Storage | Supabase project `qfdvdcvqknoqfxetttch` (Frankfurt EU) |
| Frontend | Next.js 15 + Tailwind 3 + Vercel `geoperf.com` |
| Outreach | Apollo Basic 59€ (sourcing + sequences) |
| CRM mirror | Attio (à brancher Phase 4) |
| Calendar | Calendly (webhook actif) |

---

## Navigation par sujet

**Sujet backend** (LB / contacts / sequences / CRM / cron) → lire **`docs/CLAUDE-backend.md`**
**Sujet frontend** (admin / portal / landings / profile SEO) → lire **`landing/CLAUDE.md`**
**Audit complet** : `STATE_OF_PROJECT.md`
**État courant** : memory `active_sprint.md` (auto-chargé)

---

## Sous-projets

| Nom | Couvert par | Scope |
|---|---|---|
| `reporting-engine` | `docs/CLAUDE-backend.md` étape 1 | Production des LB |
| `outreach-engine` | `docs/CLAUDE-backend.md` étapes 2-3 | Sourcing + sequences |
| `frontend` | `landing/CLAUDE.md` | Sites publics + admin + portal |
| `infrastructure` | inline | Supabase + Vercel + DNS + secrets |

---

## Anti-patterns critiques

1. **Pas d'envoi mail tant que test_mode actif** (sequence Apollo reste paused)
2. **Pas de credentials hardcoded** (env vars uniquement)
3. **Migrations SQL toujours sauvées** dans `supabase/migrations/` avant `apply_migration`
4. **Fichiers >150 lignes** : bash heredoc obligatoire (Write tool tronque sur mount Windows)
5. **Pas de push GitHub** sans `npm run build` validé localement

---

## Brief format

```
[backend|frontend|infra] : ce sur quoi on bosse
[Objectif] : ce que tu veux
[Contraintes] : pas plus de N min, etc.
```

Tags : `[CODE]` (skip narratif) · `[BLOCKING]` (urgent) · `[RESEARCH]` (web search). Détail dans `COLLABORATION_BEST_PRACTICES.md`.

---

## Push frontend

```powershell
cd C:\Users\lefeb\Documents\Claude\Projects\GEOPERF\landing
powershell -ExecutionPolicy Bypass -File .\push_update.ps1
```
Vercel auto-redeploy en 1-2 min.

Pour lancer un nouveau LB : UI `/admin` bouton "Lancer extraction" (logué Supabase Auth).
