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

## Composants communs

| Composant | Fichier | Règles |
|---|---|---|
| `Button` | `components/ui/Button.tsx` | Variantes `primary` (ambre), `secondary`, `ghost`, `danger` ; tailles `md` (≥ 40 px) et `sm` ; `busy` désactive et pose `aria-busy` ; transition couleur/bordure 150 ms sans déplacement. |
| `IconButton` | `components/ui/Button.tsx` | Nom accessible obligatoire (`aria-label` + infobulle) ; état `aria-pressed` pour les outils et bascules. |
| `TextField` | `components/ui/TextField.tsx` | Libellé persistant, police à chasse fixe pour les valeurs techniques, bordure `border-strong` ; aide et erreur reliées (`aria-describedby`, `aria-invalid`). Pas d’exemple grisé pouvant passer pour une valeur. |
| `Tabs` | `components/ui/Tabs.tsx` | Onglets WAI-ARIA (tablist/tab/tabpanel), focus itinérant, flèches, Début/Fin ; zone d’outils facultative à droite. Indicateur ambre. |
| `Dialog` | `components/ui/Dialog.tsx` | `<dialog>` natif modal : piège du focus, Échap, restitution du focus. |
| `Notice` | `components/ui/Notice.tsx` | Message persistant : symbole + texte + filet coloré ; tonalités info, succès, avertissement, danger. |
| `LogoMark` | `components/brand/Logo.tsx` | Signe original : deux nœuds reliés par une liaison courbe ambre, point de signal cyan. Décoratif, nom toujours écrit à côté. |
| `ThemeToggle` | `features/theme/ThemeToggle.tsx` | Bouton nommé selon l’action (« Passer au thème clair »). |

Menus et confirmations complexes : à créer avec leur besoin.

## Laboratoire (phase 1)

- En-tête : signe, navigation principale (Projets, Laboratoire ; lien courant souligné en ambre et `aria-current`), bascule de thème. Parcours et Ressources apparaîtront avec leur contenu.
- Barre des projets ouverts (liste de boutons + fermeture), puis onglets de vue (Topologie, Configuration) avec la barre d’outils à droite : palette, sélection/liaison, annuler/rétablir, zoom, état d’enregistrement, export, raccourcis, propriétés.
- Colonnes : palette (240 px, ajout + liste structurée des équipements), centre (canevas ou tableaux), propriétés (352 px). Sous 1 024 px, palette et propriétés sont repliées par défaut et un message signale que l’édition est prévue pour un écran plus large.
- Canevas Konva : fond `canvas` avec grille de points suivant le zoom ; équipements 56 px (cadre `surface`, pictogramme original au trait, nom et première adresse en dessous) ; liens `border-strong`, sélection ambre (épaisseur et couleur), source du mode liaison en pointillés ambre ; noms de ports à 56 px du centre. Couleurs lues depuis les jetons (y compris `light-dark()`) via une sonde CSS.
- Vue Simulation (phase 2) : palette remplacée par « Actions de simulation » (ping, pannes de câble), propriétés remplacées par « État d’exécution » (sélecteur d’équipement, listes compactes sur deux lignes), barre de simulation sous le canevas puis volet Journal / Pings (16 rem). États toujours doublés d’un symbole et d’un texte : « ● Actif » / « ✕ Inactif », « ● en service » / « ✕ coupé » ; câble coupé en pointillé rouge avec libellé « ✕ coupé » sur le canevas. Catégories du journal en étiquettes texte (Ethernet, Commutation, ARP, IP, ICMP et ping, Commandes).

## Mouvement

| Jeton | Valeur | Usage |
|---|---|---|
| `--duration-fast` | 150 ms | Survol, activation, état d’enregistrement |
| `--duration-base` | 200 ms | Indicateur d’onglet, changement de vue |
| `--duration-panel` | 220 ms | Ouverture des panneaux latéraux (`animate-panel-in-left/right`) |
| `view-in` | 180 ms | Apparition du contenu d’une vue (`animate-view-in`, opacité seule) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Courbe commune |

CSS uniquement, aucune bibliothèque d’animation. `prefers-reduced-motion: reduce` neutralise transitions et animations (l’indicateur « Enregistrement… » ne tourne qu’en `motion-safe`). Les animations ne retardent ni l’enregistrement ni les commandes. Les paquets animés (phase 3) refléteront uniquement des événements du moteur et s’arrêteront en pause.

## Mise en page

- Connexion (phase 5) : 58 % visuel / 42 % formulaire sur ordinateur ; formulaire prioritaire sur mobile.
- Vérifications réelles : phase 0 à 1440, 768 et 360 px ; phase 1 (laboratoire) à 1440 et 1024 px en thèmes sombre et clair, sans défilement horizontal. L’éditeur complet sur smartphone n’est pas promis.
