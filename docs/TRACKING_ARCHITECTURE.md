# GEOPERF — Architecture du tracking prospects

> **Décidée le 2026-04-27.** Source de vérité = Supabase, miroir commercial = Attio.

---

## 1. Le problème à résoudre

Fred veut, pour chaque prospect :
- Date de chaque contact
- Levier utilisé (LinkedIn / Mail M1 / Mail M2 / Mail M3 / Mail X1 / X2 / X3)
- Réponse ? (oui / non, sentiment)
- Statut courant dans le funnel
- Tout ce qui s'est passé chronologiquement

Et au niveau agrégé :
- Taux de transformation par sous-catégorie
- Quel levier convertit le mieux par sous-catégorie
- Où insister (DL rate ≥ X%) vs où passer son chemin

---

## 2. Le choix d'architecture

### Supabase = source de vérité (write-once, never lose)

**Toutes les écritures vont d'abord ici.** n8n écrit chaque event au moment où il se produit (envoi mail, ouverture, clic, download, etc.). Aucune dépendance externe pour les opérations critiques (séquences qui doivent envoyer un mail dans 3 jours).

Avantages :
- Performance et latence : SQL direct, pas d'API rate-limit
- Coût : gratuit jusqu'à plusieurs millions de rows
- Analytique : SQL natif → calcul des taux de transfo par sous-cat = 1 requête
- Indépendance : si on quitte Attio (pour HubSpot, Pipedrive, etc.), toute la donnée reste

### Attio = miroir commercial (Fred's daily view)

Attio reflète l'état Supabase en quasi-temps réel. Fred y voit :
- Sa pipeline visuelle (kanban par stage)
- Ses tâches manuelles (notes de call, follow-ups custom)
- Recherche rapide d'un prospect

**Sync depuis Supabase vers Attio** :
- Push immédiat sur événements clés via n8n (download_completed, calendly_booked, opt_out)
- Push agrégé toutes les heures pour les autres updates (mail envoyé, ouvert, cliqué)
- Pas de write-back Attio → Supabase pour les événements automatisés (sinon boucle)
- Exception : les notes manuelles que Fred ajoute dans Attio peuvent être pulled vers Supabase via un job nocturne (table `prospect_events` avec `created_by='attio_sync'`)

```
              ┌──────────────┐
n8n ─writes─► │   Supabase   │ ─analytics─► Dashboard interne
              │ (truth)      │
              └──────┬───────┘
                     │ push (n8n sync workflow)
                     ▼
              ┌──────────────┐
              │    Attio     │ ◄── Fred (daily commercial view)
              │ (mirror)     │
              └──────────────┘
                     │
                     │ pull notes manuelles (job nocturne)
                     ▼
              Retour Supabase
```

---

## 3. Mapping Supabase ↔ Attio

| Supabase table | Attio object | Sync strategy |
|---|---|---|
| `prospects` | `People` | Bidirectional. Push tous changements de status, pull les notes manuelles. |
| `companies` | `Companies` | Push à création + à enrichment update. |
| `prospect_events` | `Activities` (ou Tasks pour les call back) | Push events visibles pour Fred (download, response, calendly), skip les events purement techniques (email_opened pour 200 prospects → bruit). |
| `reports` | (custom object `White papers`) | Push à `status='ready'`, pour pouvoir associer un prospect à son LB d'origine. |

---

## 4. Stratégie analytique

Les questions de Fred ("où insister, où passer son chemin") se résolvent en SQL côté Supabase. Trois vues principales :

### `funnel_by_subcategory`
Une ligne par sous-catégorie : nb prospects, nb contactés, nb DL, nb call booké, nb call fait, nb converti, taux de chaque étape, revenue total.

### `funnel_by_lever`
Une ligne par sous-catégorie × levier (M1, M2, M3, X1, X2, X3) : combien de prospects convertis à chaque étape. Permet de répondre : "Le M3 est-il rentable, ou faut-il s'arrêter à M2 ?".

### `prospect_timeline`
Une vue par prospect avec sa timeline chronologique d'events. Utile pour debug et pour Fred quand il prépare un call.

→ Ces vues seront créées dans la migration Phase 2 ci-dessous.

---

## 5. Pourquoi pas Attio en source de vérité

3 raisons fortes :

1. **API limits** : Attio limite les writes à ~5 req/sec. Avec 200 prospects × 7 events potentiels = 1400 writes par campagne. n8n s'étoufferait sur les bursts.
2. **Coût au scale** : Attio facture par "record actif". À 5000 prospects et 50k events, on est à plusieurs milliers d'€/an. Supabase free tier supporte ça sans broncher.
3. **Verrouillage** : si on pivote Attio → autre CRM, on perdrait toute la donnée historique. En Supabase, c'est notre table.

→ Attio reste excellent pour la **vue commerciale humaine**, pas pour le moteur de tracking.

---

## 6. Action immédiate

1. ✅ Schéma Supabase Phase 2 appliqué (tables prospects, sequences, prospect_events + vues funnel)
2. 🟠 **À faire par Fred :** connecter le MCP Attio (carte Connect proposée en chat)
3. ⚪ **Plus tard (Sprint 2) :** workflow n8n `sync_supabase_to_attio` qui écoute les changements et pousse vers Attio
