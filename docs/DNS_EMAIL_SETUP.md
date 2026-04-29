# GEOPERF — Setup DNS, MX et SMTP pour geoperf.com (OVH)

> **Domaine :** `geoperf.com` enregistré chez **OVH**
> **Objectif :** rendre opérationnel `flefebvre@geoperf.com` avec une excellente délivrabilité (pas spam) AVANT le premier envoi de séquence.
> **Délai estimé :** 1 à 24h (propagation DNS).

---

## 1. Ce qu'il faut absolument configurer

Trois enregistrements DNS critiques + un MX + une boîte mail :

| Élément | Rôle | Sans ça | Où |
|---|---|---|---|
| **MX** | Recevoir des mails | Pas de réception | OVH zone DNS |
| **SPF** (TXT) | Autoriser les serveurs à envoyer en ton nom | Mails marqués spam | OVH zone DNS |
| **DKIM** (TXT) | Signature cryptographique des mails | Mails marqués spam | OVH zone DNS |
| **DMARC** (TXT) | Politique anti-spoofing + reporting | Pas critique mais améliore réputation | OVH zone DNS |
| **Boîte mail** | L'inbox flefebvre@geoperf.com | Pas de mail | OVH Email |

---

## 2. Choix de l'infrastructure mail

Tu as 3 options. Recommandation forte : **option B**.

### Option A — OVH MX Plan (basique)
- Inclus avec ton domaine OVH (gratuit jusqu'à 5 GB / 5 alias).
- IMAP/SMTP standard.
- Délivrabilité correcte mais **non optimisée pour cold email**.
- ✅ Suffisant pour recevoir les réponses.
- ⚠️ À éviter pour envoyer 200+ emails par jour.

### Option B (recommandée) — OVH MX pour réception + Apollo pour envoi cold
- OVH MX gratuit pour recevoir sur `flefebvre@geoperf.com`.
- **Apollo Sequences envoie les emails depuis ses propres serveurs** mais avec ton domaine d'expédition (config SPF/DKIM via DNS) → délivrabilité optimisée par Apollo (warm-up, monitoring spam, etc.).
- Avantage : tu as toute la stack pro sans payer un Google Workspace.
- ✅ **C'est le setup standard pour cold outreach 2026.**

### Option C — Google Workspace
- 6€/mois/utilisateur.
- Excellente délivrabilité native.
- Overkill pour 1 utilisateur, mais à considérer si tu veux du Google Drive partagé etc.

---

## 3. Procédure pas-à-pas (Option B recommandée)

### Étape 1 — Activer la boîte mail OVH

1. Va sur https://www.ovh.com/manager/ → **Web Cloud → Emails**
2. Sélectionne `geoperf.com`
3. Si tu vois **"Activer MX Plan"** : clique. C'est gratuit avec ton domaine.
4. Crée un compte mail :
   - Adresse : `flefebvre@geoperf.com`
   - Mot de passe fort (à stocker dans Supabase Vault sous `smtp_password`).
5. Note les paramètres SMTP/IMAP :
   - **SMTP sortant** : `ssl0.ovh.net` port `465` (SSL) ou `587` (STARTTLS)
   - **IMAP entrant** : `ssl0.ovh.net` port `993` (SSL)

### Étape 2 — Vérifier les MX (normalement auto-config par OVH)

OVH ajoute automatiquement les MX records à l'activation. Va dans **Domaines → geoperf.com → Zone DNS** et vérifie la présence de :

```
geoperf.com.   3600   IN   MX   1   mx1.mail.ovh.net.
geoperf.com.   3600   IN   MX   5   mx2.mail.ovh.net.
geoperf.com.   3600   IN   MX   100 mx3.mail.ovh.net.
```

### Étape 3 — Configurer SPF (autoriser OVH + Apollo à envoyer)

Dans **Zone DNS**, ajouter (ou éditer si existe déjà) un enregistrement TXT à la racine :

```
geoperf.com.   3600   IN   TXT   "v=spf1 include:mx.ovh.com include:_spf.apollo.io ~all"
```

⚠️ **Important :** `_spf.apollo.io` est l'inclusion SPF d'Apollo (à confirmer dans la doc Apollo lors de la config sender). Si Apollo te donne une autre directive (ex: `include:spf.smtp.apollo.io`), utilise celle-là.

### Étape 4 — Configurer DKIM côté OVH (réception)

OVH génère automatiquement un DKIM pour les mails qui passent par ses serveurs. Pour vérifier :

1. **Domaines → geoperf.com → Zone DNS**
2. Chercher un enregistrement TXT avec un nom du type `mail._domainkey.geoperf.com.`
3. Si absent : OVH a parfois un bouton **"Activer DKIM"** dans **Email → Configuration**.

### Étape 5 — Configurer DKIM côté Apollo (envoi)

Côté Apollo :
1. Settings → Email → Mailbox Configuration → Add Sender (`flefebvre@geoperf.com`).
2. Apollo te donne **un selector + une clé publique DKIM** à ajouter dans ta zone DNS OVH.
3. Format typique :
   ```
   apollo._domainkey.geoperf.com.   3600   IN   TXT   "v=DKIM1; k=rsa; p=MIGfMA0GCSq..."
   ```
4. Une fois ajouté, retour Apollo → bouton **Verify** → ✅.

### Étape 6 — Configurer DMARC (politique)

Ajouter à la zone DNS :

```
_dmarc.geoperf.com.   3600   IN   TXT   "v=DMARC1; p=quarantine; rua=mailto:dmarc@geoperf.com; ruf=mailto:dmarc@geoperf.com; fo=1; aspf=r; adkim=r"
```

Politique recommandée pour démarrage :
- `p=quarantine` : si SPF/DKIM échouent → spam (pas bloqué).
- Une fois stable (2-4 semaines) → passer à `p=reject` pour bloquer le spoofing.

Crée aussi l'alias `dmarc@geoperf.com` côté OVH pour recevoir les rapports.

### Étape 7 — Tester

**Outil 1 :** https://mxtoolbox.com/SuperTool.aspx → entrer `geoperf.com` → onglets MX, SPF, DKIM, DMARC : tout doit être ✅ vert.

**Outil 2 :** https://www.mail-tester.com/
1. Va sur le site, copie l'adresse temporaire qu'il te donne.
2. Envoie un mail depuis Apollo (ou depuis Apple Mail / Outlook configuré sur `flefebvre@geoperf.com`) à cette adresse.
3. Reviens sur le site → cliquer "Then check your score" → score sur 10.
4. **Cible : 9/10 ou 10/10.** En dessous, lire les recommandations.

---

## 4. Warm-up de la boîte (avant gros volume)

⚠️ Une boîte neuve qui envoie 200 mails dès J1 = bannie ou en spam direct.

**Procédure de warm-up** (avant le Sprint 3) :
- **Semaine 1** : 5 mails/jour, manuels, à des contacts perso ou collègues qui répondent.
- **Semaine 2** : 15 mails/jour, mix manuel + Apollo.
- **Semaine 3** : 30 mails/jour, avec Apollo.
- **Semaine 4** : 50-100 mails/jour.
- **Sprint 3** (semaine 5+) : volume cible (200/jour OK si réponses > 5%).

Apollo a une fonction **Email Warmup intégrée** (à activer dans Settings → Email Health). Coût souvent inclus dans le plan.

---

## 5. Configuration côté Apollo Sequences

Une fois les DNS verts (étapes 1-7) :

1. Apollo → Sequences → Settings → **Mailboxes**
2. Add mailbox → choisir **Custom SMTP** (pas Gmail/Outlook).
3. Renseigner :
   - SMTP host : `ssl0.ovh.net`
   - Port : `465` SSL
   - Username : `flefebvre@geoperf.com`
   - Password : celui défini en étape 1 (récupéré depuis Vault)
4. Tester l'envoi (Apollo envoie un mail test à toi-même).
5. Activer **Email Warmup**.

---

## 6. Limites OVH MX Plan à connaître

| Limite | Valeur | Mitigation |
|---|---|---|
| Boîtes mail | 5 (gratuit) | Suffisant pour démarrage |
| Quota par boîte | 5 GB | OK |
| Envoi via SMTP OVH | ~500 mails/jour | **C'est pour ça qu'on envoie via Apollo, pas OVH SMTP direct** |
| Spam outgoing | Strict (1% bounce → blocage) | Apollo gère ça |

---

## 7. Check-list à valider avant Sprint 3 (premier envoi)

```
[ ] Boîte mail flefebvre@geoperf.com créée chez OVH
[ ] Mot de passe SMTP stocké dans Supabase Vault (smtp_password)
[ ] MX OVH visibles dans DNS (mxtoolbox vert)
[ ] SPF avec OVH + Apollo (mxtoolbox vert)
[ ] DKIM OVH activé
[ ] DKIM Apollo (apollo._domainkey) ajouté + vérifié dans Apollo
[ ] DMARC en p=quarantine
[ ] Alias dmarc@geoperf.com créé pour recevoir les rapports
[ ] mail-tester.com → score ≥ 9/10
[ ] Apollo mailbox configurée + Warmup activé
[ ] Warm-up commencé depuis 3-4 semaines avant Sprint 3
```

---

## TL;DR

1. Active OVH MX Plan (gratuit) + crée la boîte `flefebvre@geoperf.com`.
2. Vérifie/ajoute MX, SPF, DKIM, DMARC dans la zone DNS OVH.
3. Configure Apollo pour envoyer en ton nom (DKIM Apollo à ajouter aux DNS).
4. Test mail-tester.com.
5. Démarre warm-up dès maintenant (parallèle aux autres sprints) pour être prêt en Sprint 3.

**Si tu veux, je peux générer les commandes/snippets DNS exacts à coller dans OVH une fois que tu auras créé la boîte mail.**
