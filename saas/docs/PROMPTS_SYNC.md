# Prompts — Source of truth & sync workflow

## Source canonique

**Le fichier source unique est :**

```
saas/prompts/brand_monitoring/prompts.json
```

C'est ce fichier qui doit être édité quand on ajoute / modifie / supprime un prompt.

Les fichiers `.md` dans le même dossier sont **purement documentaires** (lecture humaine,
revue éditoriale). Ils ne sont chargés nulle part dans le code.

## Sync vers les Edge Functions

L'Edge Function `saas_run_brand_snapshot` charge les prompts via un import JSON Deno :

```typescript
import promptsConfigData from "./prompts.json" with { type: "json" };
```

Comme Supabase Edge Functions bundle uniquement les fichiers présents dans le dossier
de la function, on doit **copier** `prompts.json` dans le dossier de la function avant
chaque deploy.

## Workflow de modification

Quand tu changes un prompt :

```bash
# 1. Édite la source canonique
vim saas/prompts/brand_monitoring/prompts.json

# 2. (Optionnel) Mets à jour les .md correspondants pour la doc humaine
vim saas/prompts/brand_monitoring/01_direct_search.md  # etc.

# 3. Copie vers le dossier de l'Edge Function
cp saas/prompts/brand_monitoring/prompts.json supabase/functions/saas_run_brand_snapshot/prompts.json

# 4. Deploy
supabase functions deploy saas_run_brand_snapshot
```

## Vérification de sync

Pour vérifier que les deux copies sont identiques :

```bash
diff saas/prompts/brand_monitoring/prompts.json supabase/functions/saas_run_brand_snapshot/prompts.json
# Pas de sortie = synced. Sortie = drift à corriger.
```

## Pourquoi pas symlink ?

Les symlinks ne sont pas fiables sur Windows mounts (problème connu cf. CLAUDE.md
anti-pattern #4) et le bundle Supabase ne les suit pas systématiquement. Une simple
copie reste la solution la plus robuste, à condition de respecter le workflow ci-dessus.

## Future amélioration

Quand le projet aura un build script Node/Vite côté monorepo, on pourra automatiser
le `cp` via un hook pre-deploy ou un script `npm run sync-prompts`. Tant que ce n'est
pas le cas, **le `cp` manuel reste obligatoire avant chaque deploy** de la function.
