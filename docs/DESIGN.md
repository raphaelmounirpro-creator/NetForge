# Design NetForge

Direction : contraste entre une salle réseau et la lumière chaude d'un coucher de soleil — **bleu nuit, ambre/cuivre, cyan discret**. Identité originale ; aucune reprise d'interface, de logo ou de marque existants.

Source des jetons : [apps/web/src/styles/index.css](../apps/web/src/styles/index.css) (`@theme`). Les composants n'utilisent que ces jetons (palette Tailwind par défaut désactivée).

## Références visuelles

| Référence | État |
|---|---|
| Maquette « NetForge : laboratoire réseau et fibre.png » | **Non disponible** dans le dépôt (lien ChatGPT inaccessible). Consignes écrites appliquées. |
| Photo « home-sunset.57ad0c3af150497b.jpg » | **Non disponible**. Remplacement visuel restant à faire pour l'accueil/connexion (phase 5) : déposer le fichier dans `apps/web/src/assets/` en retirant toute marque tierce. |

## Couleurs (contrastes mesurés WCAG 2.x)

| Jeton | Sombre | Clair | Usage |
|---|---|---|---|
| `canvas` | `#101923` | `#F4F1EA` | Fond principal |
| `surface` | `#172330` | `#FFFFFF` | Panneaux opaques |
| `surface-raised` | `#1D2B3A` | `#FBF9F4` | Éléments surélevés, fond du signe |
| `border` | `#2C3B4B` | `#CFC8BA` | Séparateurs décoratifs |
| `border-strong` | `#6B7D90` (3,8:1 sur surface) | `#8A8172` (3,4:1 sur fond) | Bordures porteuses d'information (champs, boutons) — ≥ 3:1 |
| `text` | `#F5F2EA` (15,8:1 sur fond) | `#15212C` (14,5:1) | Texte principal |
| `text-muted` | `#AAB6C2` (7,7:1 sur surface) | `#4A5868` (6,5:1) | Texte secondaire |
| `accent` | `#FFB34D` | `#FFB34D` | Action dominante, sélection (remplissage) |
| `on-accent` | `#101923` (10,0:1 sur ambre) | idem | Texte sur bouton ambre |
| `accent-text` | `#FFB34D` (9,0:1 sur surface) | `#9A5300` (5,2:1) | Ambre utilisé comme texte ou indicateur |
| `signal` | `#48C9C1` (7,9:1 sur surface) | `#16716C` (5,2:1) | Trafic réseau, indications techniques |
| `success` | `#6CD49A` | `#1E7A46` (4,7:1) | État favorable |
| `warning` | `#F2D06B` | `#7D5A00` (5,6:1) | Avertissement |
| `danger` | `#FF8A80` | `#B3261E` (5,8:1) | Erreur, indisponibilité |
| `focus` | `#8EC5FF` | `#1B5FD1` | Anneau de focus (2 px, décalage 2 px) |

Tous les couples texte/fond utilisés dépassent 4,5:1. Règles : l'ambre sert à l'action et à la sélection, le cyan au trafic ; un état réseau ou de service n'est jamais signalé par la couleur seule (symbole + texte). Avertissement et ambre sont proches : l'avertissement porte toujours une icône et un libellé.

## Typographie, espacement, formes

- Pile système sans empattement (`system-ui`, Segoe UI, Roboto…), aucune police téléchargée. Monospace : `ui-monospace`, Cascadia Mono, Consolas.
- Échelle : 12 / 14 / 16 / 18 / 30 / 36 px (`text-xs` à `text-4xl`). Libellés de rubrique en capitales espacées (0,16 em).
- Grille 4/8 px (échelle d'espacement Tailwind). Rayons : 8 (`sm`), 10 (`md`), 12 px (`lg`).
- Icônes : famille unique Lucide (licence ISC), trait 2 px, 18–20 px, `aria-hidden` avec texte visible associé.

## Composants communs (phase 0)

| Composant | Fichier | Règles |
|---|---|---|
| `Button` | `components/ui/Button.tsx` | Variantes `primary` (ambre), `secondary`, `ghost` ; hauteur ≥ 40 px ; `busy` désactive et pose `aria-busy` (pas de double soumission) ; transition couleur/bordure 150 ms sans déplacement. |
| `Panel` | `components/ui/Panel.tsx` | Section opaque nommée par son titre (`aria-labelledby`), sans carte imbriquée. |
| `StatusBadge` | `components/ui/StatusBadge.tsx` | Symbole + libellé ; tonalités succès, danger, neutre, en cours. |
| `LogoMark` | `components/brand/Logo.tsx` | Signe original : deux nœuds reliés par une liaison courbe ambre, point de signal cyan. Décoratif, nom toujours écrit à côté. Favicon équivalent. |
| `ThemeToggle` | `features/theme/ThemeToggle.tsx` | Bouton nommé selon l'action (« Passer au thème clair »). |

À venir avec leur phase : champs (libellés persistants, bordure `border-strong`, erreurs reliées), onglets (rôles ARIA, flèches clavier), menus, messages, confirmations.

## Mouvement

| Jeton | Valeur | Usage |
|---|---|---|
| `--duration-fast` | 150 ms | Survol, activation, confirmation de sauvegarde |
| `--duration-base` | 200 ms | Onglets connexion/inscription, changement de vue |
| `--duration-panel` | 220 ms | Ouverture d'un panneau de propriétés |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Courbe commune |

CSS uniquement, aucune bibliothèque d'animation. `prefers-reduced-motion: reduce` neutralise transitions et animations (l'indicateur de vérification ne tourne qu'en `motion-safe`). Les paquets animés (phase 3) refléteront uniquement des événements du moteur et s'arrêteront en pause.

## Mise en page

- Laboratoire (phase 1) : navigation latérale, palette d'équipements, canevas central, propriétés à droite, barre de simulation en bas ; panneaux repliables sur largeur limitée.
- Connexion (phase 5) : 58 % visuel / 42 % formulaire sur ordinateur ; formulaire prioritaire sur mobile.
- Largeurs vérifiées en phase 0 : 1440, 768 et 360 px, sans défilement horizontal.
