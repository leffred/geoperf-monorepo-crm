# GEOPERF — Gestion des secrets via Supabase Vault

> **Pourquoi :** centraliser toutes les API keys dans Supabase Vault (chiffré au repos par `pgsodium`), accessibles uniquement avec la `service_role` key. Évite de les coller en clair dans n8n / Vercel / GitHub.

---

## 1. Comment fonctionne Supabase Vault

Supabase Vault est une extension Postgres qui :
- Stocke des secrets chiffrés **AES-256** au repos via `pgsodium`.
- Les expose via une vue protégée `vault.decrypted_secrets`, accessible uniquement avec un rôle privilégié (typiquement `service_role`).
- Aucun secret n'apparaît jamais en clair dans tes logs / dumps SQL.

Tu n'as **rien à activer** : Vault est dispo par défaut sur tous les projets Supabase depuis 2023.

---

## 2. Procédure de création des secrets (à faire une seule fois en Sprint 0)

### 2.1 Via l'interface Supabase (le plus simple)

1. Va sur https://supabase.com/dashboard → projet GEOPERF → **Settings → Vault → Secrets**
2. Clique **"New secret"**
3. Pour chaque secret :
   - **Name** : nom court en snake_case (voir tableau §3)
   - **Description** : à quoi il sert
   - **Secret** : la valeur brute

Répète pour chaque clé du tableau §3.

### 2.2 Via SQL (si tu préfères le code)

```sql
-- Une fois par secret
SELECT vault.create_secret(
  'sk-or-v1-xxxxxxxxxxxxxxxxxxxx',  -- la valeur du secret
  'openrouter_api_key',              -- le nom (unique)
  'Clé API OpenRouter pour orchestration LLM Phase 1'
);
```

**Mise à jour d'un secret :**
```sql
SELECT vault.update_secret(
  '<secret_id>',
  'nouvelle-valeur',
  'openrouter_api_key',
  'Description'
);
```

### 2.3 Via le MCP Supabase (depuis chat avec moi)

Je peux exécuter le SQL ci-dessus pour toi via `mcp__supabase__execute_sql` — tu me donnes la valeur en chat (qui ne sera pas mémorisée), je la passe directement à Vault. **Cette méthode est OK** : la valeur transite seulement le temps de l'exécution, ne reste pas dans nos fichiers.

---

## 3. Liste des secrets à stocker pour GEOPERF

| Nom Vault | Service | Quand on l'ajoute | Format |
|---|---|---|---|
| `openrouter_api_key` | OpenRouter (LLM gateway) | Sprint 0 | `sk-or-v1-...` |
| `apollo_api_key` | Apollo.io | Sprint 2 | `xxx` (UUID 32 chars) |
| `vercel_deploy_token` | Vercel CLI/API | Sprint 1 | `xxx` |
| `github_pat` | GitHub Personal Access Token | Sprint 1 | `ghp_...` ou fine-grained `github_pat_...` |
| `n8n_api_key` | n8n Cloud REST API | Sprint 0 | JWT |
| `ovh_dns_api_key` | OVH DNS API *(optionnel, pour automatiser sous-domaines)* | Sprint 1 | `xxx` |
| `smtp_password` | SMTP de geoperf.com (OVH ou autre) | Sprint 0 | `xxx` |
| `phantombuster_api_key` | PhantomBuster *(si retenu)* | Sprint 4 | `xxx` |
| `calendly_token` | Calendly OAuth ou PAT | Sprint 2 | `xxx` |

---

## 4. Comment les secrets sont consommés

### 4.1 Depuis n8n Cloud

n8n a son propre **gestionnaire de credentials** chiffré. Pour éviter une double couche :
- **Option A (recommandée pour démarrage)** : copier les secrets de Vault vers n8n Credentials manuellement (UI n8n → Credentials → New). C'est suffisamment sécurisé pour le pilote.
- **Option B (production)** : créer un workflow n8n "fetch_secrets" qui lit Vault au démarrage de chaque exécution via une requête `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'xxx'` avec la `service_role` key. Plus DRY mais ajoute de la latence.

Recommandation : **A pour Sprint 0/1, basculer vers B si on multiplie les workflows.**

### 4.2 Depuis Vercel (landings + PDF generation)

Pour les Edge Functions / Serverless Functions Vercel :
- **Vercel Environment Variables** (chiffrées, fournies au runtime).
- Les ajouter via Vercel Dashboard → Project → Settings → Environment Variables.
- Sources de vérité : Vault Supabase. On copie manuellement vers Vercel à chaque rotation.

### 4.3 Depuis ma session Cowork

Quand j'ai besoin d'une clé en cours de travail (ex : tester un appel OpenRouter en bash) :
```sql
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'openrouter_api_key';
```
J'exécute via le MCP Supabase, j'utilise la valeur dans la commande, elle disparaît à la fin de la session (je ne la persiste nulle part).

---

## 5. Politique de rotation

| Secret | Rotation recommandée | Trigger immédiat |
|---|---|---|
| `openrouter_api_key` | 6 mois | Si fuite suspectée, ou départ collaborateur |
| `apollo_api_key` | 6 mois | Idem |
| `github_pat` | 90 jours (fine-grained tokens) | Idem |
| `vercel_deploy_token` | 6 mois | Idem |
| `smtp_password` | 12 mois | Suspicion de spoofing |

Procédure de rotation : générer une nouvelle clé côté service → `vault.update_secret()` → mettre à jour les copies dans n8n Credentials et Vercel Env → tester un workflow → révoquer l'ancienne clé côté service.

---

## 6. Sécurité — checklist

- [ ] Le projet Supabase a la 2FA activée sur le compte owner.
- [ ] La `service_role` key n'est jamais commitée sur GitHub (vérifier `.gitignore` côté repo Next.js).
- [ ] La `anon` key (publique côté navigateur) n'a accès qu'aux tables avec policies RLS appropriées.
- [ ] Aucune table accessible en `anon` ne JOIN sur `vault.decrypted_secrets`.
- [ ] Logs Supabase activés sur les requêtes Vault (audit trail).

---

## 7. Que faire si une clé fuit

1. **Révoquer immédiatement** la clé côté service (OpenRouter, Apollo, etc.) — UI ou API.
2. **Générer une nouvelle clé**.
3. **Update Vault** : `SELECT vault.update_secret(...)`.
4. **Re-déployer** les services qui consomment la clé (n8n Credentials + Vercel Env).
5. **Audit** : vérifier les usages anormaux côté facturation OpenRouter / Apollo.
6. **Tracer** dans `DEVELOPMENT_HISTORY.md`.

---

## TL;DR pour Fred

1. Sprint 0 : crée le projet Supabase `geoperf` (si pas déjà), va dans **Settings → Vault → Secrets**.
2. Ajoute `openrouter_api_key` (la valeur que tu as générée sur openrouter.ai).
3. Plus tard, ajoute les autres secrets au fil des sprints.
4. **Tu n'as plus jamais à coller une clé en clair** dans nos discussions ou dans nos fichiers.
