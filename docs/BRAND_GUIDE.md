# GEOPERF — Charte graphique (Editorial / Authority)

> **Direction validée :** Editorial / Authority — 2026-04-27
> **Inspiration :** Bloomberg, Financial Times, McKinsey Quarterly
> **Positionnement :** étude sectorielle de référence, autorité institutionnelle

---

## 1. Logo

### Wordmark
- Police : **Source Serif Pro Medium** (fallback : Times New Roman)
- Caractère distinctif (trade dress) : le **point amber** qui remplace visuellement le « o » de Geoperf, positionné à la place du caractère omis dans le mot « Geperf ».
- Letter-spacing : -1.2 (tightening serré pour un rendu éditorial dense).

### Monogramme
- Carré navy avec **G capital serif** centré, et **point amber** en haut à droite (rappel du trade dress du wordmark).
- Aucun arrondi : les angles droits accentuent le côté institutionnel.

### Tagline
- **« LLM VISIBILITY RESEARCH »** en small caps, letter-spacing 3, sous une fine ligne navy.
- Toujours en anglais (positionnement international du sujet GEO/LLM).

---

## 2. Palette

| Nom | Hex | Usage |
|---|---|---|
| Navy 900 | `#042C53` | Couleur dominante, fond, texte principal |
| Navy 800 | `#0C447C` | Liens, accents secondaires, sub-headlines |
| Amber 200 | `#EF9F27` | Trade dress (le point), CTA, highlights uniquement |
| Cream 50 | `#F1EFE8` | Fond papier du livre blanc, surfaces secondaires |
| White | `#FFFFFF` | Fond pages digitales, texte sur navy |
| Gray 900 | `#2C2C2A` | Texte secondaire sur fond clair |

**Règles d'usage de l'amber :**
- Toujours en accent ponctuel (1-3% de la surface max).
- Jamais comme fond de bloc, jamais en aplat large.
- Réservé : trade dress, CTA principal, highlight d'une donnée critique dans un graphique.

---

## 3. Typographie

| Famille | Usage | Source |
|---|---|---|
| **Source Serif Pro** Medium 500 | Titres, headlines, livre blanc, wordmark | [Google Fonts](https://fonts.google.com/specimen/Source+Serif+Pro) — gratuit |
| **Inter** Regular 400 / Medium 500 | Corps UI, sous-titres, captions, boutons | [Google Fonts](https://fonts.google.com/specimen/Inter) — gratuit |
| **IBM Plex Mono** | Données chiffrées, hex codes, code | [Google Fonts](https://fonts.google.com/specimen/IBM+Plex+Mono) — gratuit |

**Hiérarchie typographique standard :**
```
H1  Source Serif Pro 500  56px / line-height 1.1
H2  Source Serif Pro 500  36px / line-height 1.2
H3  Source Serif Pro 500  24px / line-height 1.3
Body Inter 400            16px / line-height 1.6
Small Inter 400           13px / line-height 1.5
Caps Inter 500 + LS=2.5px 11px (TAGLINE / SECTION LABELS)
```

---

## 4. Variants visuels disponibles

Tous les fichiers vivent dans `assets/` :

| Fichier | Usage | Format |
|---|---|---|
| `logo_primary.svg` | Header landings, cover PDF, signature | SVG vectoriel |
| `logo_primary_white.svg` | Idem mais sur fond sombre | SVG |
| `logo_mark.svg` | Carré 64×64 navy, monogramme G | SVG |
| `logo_mark_outline.svg` | Carré contour pour fond clair | SVG |
| `favicon.svg` | Favicon navigateur 32×32 | SVG |
| `linkedin_avatar.svg` | Photo de profil LinkedIn 400×400 | SVG |
| `linkedin_cover.svg` | Bannière LinkedIn 1584×396 | SVG |

**À générer (PNG) :**
- `linkedin_avatar.png` 400×400 et 200×200 (LinkedIn refuse SVG en avatar)
- `linkedin_cover.png` 1584×396
- `favicon.png` 32×32 et 16×16
- `logo_primary.png` versions transparente / sur cream / sur navy

→ Conversion à faire au moment du déploiement (Sprint 1) avec un simple `rsvg-convert` ou directement depuis Figma. Je peux le faire via bash si besoin.

---

## 5. Signature mail HTML (template)

À utiliser pour `flefebvre@geoperf.com` :

```html
<table cellpadding="0" cellspacing="0" border="0" style="font-family: 'Inter', -apple-system, sans-serif; color: #2C2C2A;">
  <tr>
    <td style="padding-right: 16px; vertical-align: top;">
      <img src="https://geoperf.com/assets/logo_mark.png" width="48" height="48" alt="Geoperf" style="display: block;">
    </td>
    <td style="vertical-align: top; border-left: 0.5px solid #042C53; padding-left: 16px;">
      <div style="font-family: 'Source Serif Pro', serif; font-size: 16px; color: #042C53; font-weight: 500;">Frédéric Lefebvre</div>
      <div style="font-size: 13px; color: #5F5E5A; margin-top: 2px;">Fondateur · Geoperf</div>
      <div style="font-size: 12px; color: #042C53; margin-top: 8px;">
        <a href="https://geoperf.com" style="color: #042C53; text-decoration: none;">geoperf.com</a>
        &nbsp;·&nbsp;
        <a href="https://linkedin.com/company/geoperf" style="color: #042C53; text-decoration: none;">LinkedIn</a>
      </div>
      <div style="font-size: 11px; color: #888780; margin-top: 8px; letter-spacing: 1px;">LLM VISIBILITY RESEARCH</div>
    </td>
  </tr>
</table>
```

---

## 6. Mentions légales (footer mail + LB)

À utiliser systématiquement en footer :

```
Geoperf est un produit de Jourdechance SAS · SIREN 838 114 619 · RCS Nanterre
31 rue Diaz, 92100 Boulogne-Billancourt, France
Vous recevez ce mail dans le cadre de notre programme d'études sectorielles GEO.
Se désinscrire : [LIEN_OPT_OUT] · Politique de confidentialité : geoperf.com/privacy
```

---

## 7. Règles éditoriales

**Ton de voix :**
- Précis, factuel, posé.
- Pas d'exclamations, pas de superlatifs creux.
- Citations chiffrées, sources nommées.
- Une métaphore à la fois max.
- L'écriture doit pouvoir être citée dans un board deck sans sembler « marketing ».

**Anti-patterns à éviter :**
- Emojis dans les titres
- « 🚀 », « 💡 », « ⚡ » dans les corps de mail
- Capitalization de marketing américain (« Get Started », « Learn More »)
- Images stock cheesy de gens en costume serrant la main

**Patterns à privilégier :**
- Citations de directeurs de stratégie
- Tableaux comparatifs
- Graphiques sobres (palette navy + amber accent uniquement)
- Mentions des sources en pied de page de chaque graphe
