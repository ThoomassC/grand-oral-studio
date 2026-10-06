# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Grand Oral Studio
**Generated:** 2026-10-06 13:00:03
**Category:** Productivity Tool
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 5/10 (Standard)

---

## Global Rules

### Direction : la fiche bristol

Grand Oral Studio sert à préparer un oral sous contrainte de temps : on écrit une trame, des notes, des sujets, comme sur les fiches bristol qu'on garde en main devant le jury. La direction reprend ce support : papier froid, encre marine, réglure bleue, marge rouge.

- **Un seul élément marquant : la fiche.** Les blocs que l'étudiant écrit (lignes de trame, notes des sujets, cartes de projet) portent une marge rouge à gauche, et les champs de texte long une réglure discrète. Tout le reste est calme.
- **La typographie porte la hiérarchie.** Titres en Schibsted Grotesk, texte en Atkinson Hyperlegible Next ; casse de phrase, aucun surtitre, chiffres tabulaires (jamais de police à chasse fixe pour les données).
- **Géométrie nette.** Arrondis faibles (4 à 8 px), filets fins ; pas de pilules, pas de halos d'ombre.
- **Mouvement seulement en réponse à une action** (ouvrir, déplier, confirmer) ; aucune apparition au défilement.

Écarts assumés avec la proposition générée (« Flat Design », sarcelle + orange, Plus Jakarta Sans) : la structure (à plat, outil de productivité, accessibilité) est gardée ; la palette et la police, réglages par défaut d'un SaaS, sont remplacées par celles du sujet. Le fond crème chaud d'Opale (#f7f4ef) est abandonné.

### Color Palette

Contrastes mesurés (WCAG) : texte ≥ 5,8:1 partout ; filets décoratifs non porteurs de sens ; contours de champs ≥ 3:1.

| Rôle | Clair | Sombre (« ardoise ») | Jeton |
|------|-------|----------------------|-------|
| Papier (fond de page) | `#F5F6F8` | `#141A24` | `--fiche-paper` |
| Carte (surface) | `#FFFFFF` | `#1C2431` | `--fiche-card` |
| Encre (texte) | `#14213D` | `#E6EAF2` | `--fiche-ink` |
| Graphite (texte secondaire) | `#55607A` | `#A3ADC2` | `--fiche-graphite` |
| Réglure (primaire, liens, actions) | `#2A4DB3` | `#8FAEFF` | `--fiche-rule` |
| Sur primaire | `#FFFFFF` | `#0E1626` | `--fiche-on-rule` |
| Marge (accent du motif seulement) | `#C8372D` | `#FF8A7A` | `--fiche-margin` |
| Filet | `#DCE1EA` | `#2C3647` | `--fiche-line` |

Ratios : encre/papier 14,8 ; graphite/papier 5,8 ; blanc/réglure 7,5 ; réglure/carte 7,5 ; marge/carte 5,2 ; craie/ardoise 14,5 ; graphite/surface sombre 6,9 ; bleu sombre/surface 7,2 ; encre/bleu sombre 8,3.

### Typography

- **Titres :** Schibsted Grotesk (600–800), grotesque éditoriale au ton de prise de parole.
- **Texte :** Atkinson Hyperlegible Next (400–700), conçue pour la lisibilité ; lignes de 80 caractères au plus.
- **Données :** même police que le texte, `font-variant-numeric: tabular-nums`.
- Chargées par `next/font/google` (auto-hébergées, pas de requête vers Google au runtime).

### Spacing Variables

*Density: 5/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Niveau | Valeur | Usage |
|--------|--------|-------|
| Filet | `0 0 0 1px var(--fiche-line)` | Cartes, champs (pas d'ombre portée) |
| En-tête | filet 1px + `0 3px 8px -2px` | En-tête collant |
| Flottant | `0 8px 24px -8px` | Menus, panneaux « i », modales |

-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #EA580C;
  color: #000000;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #134E4A;
  border: 2px solid #0D9488;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F0FDFA;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #0D9488;
  outline: none;
  box-shadow: 0 0 0 3px #0D948820;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Flat Design

**Keywords:** 2D, minimalist, bold colors, no shadows, clean lines, simple shapes, typography-focused, modern, icon-heavy

**Best For:** Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate

**Key Effects:** No gradients/shadows, simple hover (color/opacity shift), fast loading, clean transitions (150-200ms ease), minimal icons

---

## Motion

Seulement en réponse à une action : ouverture d'un panneau, déroulé d'une étape, confirmation. 150–250 ms, `ease-out`. Aucune apparition au défilement. `prefers-reduced-motion` et le réglage « Réduire les animations » coupent tout.

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Surtitres en capitales espacées au-dessus des titres** — retirés en v1.1.0, ne pas les réintroduire
- ❌ **Police à chasse fixe pour les petites données** — chiffres tabulaires dans la police du texte
- ❌ **Fond crème chaud, cartes identiques à ombre grise douce** — clichés écartés par cette direction
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
