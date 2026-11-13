# Réflectomètre (OTDR) pédagogique

Niveau : pédagogique simplifié (phase 9, tranche 3). La trace est **calculée**, pas simulée : NetForge ne reproduit ni la rétrodiffusion, ni le bruit, ni une mesure terrain complète.

## Références

Consultées le 2026-11-13 (textes publics de l'UIT-T) :

- UIT-T G.652 (08/2024), tableau 2 :
  - affaiblissement maximal du câble de 0,40 dB/km de 1 310 à 1 625 nm, et de 0,30 dB/km de 1 530 à 1 565 nm ;
  - note 1 : 1,0 dB/km au plus pour un câble intérieur, à 1 310 et 1 550 nm (CEI 60794-2-11).
- UIT-T G.671 (11/2025), §6.6, §6.7 et §6.14 : connecteurs, épissures et coupleurs spécifiés dans les fenêtres de 1 310 et 1 550 nm (mêmes maximums que pour le bilan).

Les longueurs d'onde 1 310 et 1 550 nm sont celles de ces fenêtres. Aucune autre valeur d'instrument (dynamique, largeur d'impulsion, zone morte, réflectance) n'est utilisée : ces valeurs dépendraient d'un appareil précis et ne seraient pas vérifiables ici.

## Comportement pris en charge

| Élément | Comportement |
|---|---|
| Raccordement | Sur un port à connecteur d'un équipement optique. Sens « vers les abonnés » (une branche choisie par son ONT) ou « vers l'OLT » |
| Distance | Somme des longueurs de fibre depuis le point de raccordement. Les événements internes à un équipement sont à la même distance |
| Événements | Connecteur (réfléchissant), épissure, coupleur, perte localisée sur une fibre, fin de fibre inattendue, lecture non représentative, fin de trace (connecteur de l'ONT ou de l'OLT) |
| Pertes | Perte nominale maximale de chaque élément à la longueur d'onde choisie, plus la perte de panne. Événement signalé « au-delà du maximum attendu » si l'écart dépasse 0,05 dB |
| Panne | L'OTDR montre des symptômes (perte, distance, fin de fibre), jamais le nom de la panne, y compris pour le formateur |
| Coupure, courbure | Placées à leur position quand le formateur l'a renseignée (format v15 : distance depuis la première extrémité du lien, ramenée au sens de la trace). Sans position, seule la section de fibre est connue : la trace s'arrête au début de la section, ou la perte est reportée à sa fin, et la section est hachurée |
| Polissages différents (APC/UPC) | Lecture non représentative : la trace s'arrête au connecteur. Aucune pénalité n'est chiffrée (règle de la phase 4) |
| Premier connecteur | Mesuré, comme si une bobine amorce était utilisée |
| Coupleur vers les abonnés | Une seule branche est suivie. Une vraie trace superpose toutes les branches : une note le rappelle |

La courbe donne le niveau relatif en aller simple : chaque événement est une marche, et la pente d'une fibre est son affaiblissement maximal. Le tableau des événements est l'alternative textuelle de la courbe (numéros, distances, pertes, cumul, réflexion).

## Simplifications et limites

- Aucun bruit, aucune dynamique limitée, aucune zone morte ; la largeur d'impulsion n'est pas réglable ; la réflectance n'est pas chiffrée (connecteur indiqué « réfléchissant »).
- Une courbure perd ici autant à 1 310 qu'à 1 550 nm. En réalité, elle perd davantage à 1 550 nm, ce qui permet de la reconnaître.
- Pas de trace superposée des branches d'un coupleur ; pas de mesure bidirectionnelle moyennée.
- Pas de point de raccordement hors d'un chemin OLT → ONT complet (port libre, fibre en attente).
- L'OTDR est un outil de mesure de la vue Optique : il ne modifie pas le projet et n'a pas de commande de console. La position d'une panne se saisit dans le formulaire des pannes (formateur).

## Tests de référence

- `packages/engine/src/otdr.test.ts` :
  - réseau FTTH de référence calculé à la main : 6 954 m, 23,794 dB à 1 550 nm et 24,474 dB à 1 310 nm ;
  - événements aux bonnes distances ; branche choisie ; trace vers l'OLT ;
  - connecteur sale signalé sans être nommé ;
  - coupure à 2 345 m d'ODF1, vue à 2 347 m depuis l'OLT et à 4 607 m depuis l'ONT1 ; sans position, localisée à la section près ;
  - courbure placée ou reportée ; polissages différents ; point hors chemin.
- `packages/project/src/ftth.test.ts` : position d'une panne (bornes, refus, fibre raccourcie, migration v14 → v15).
- `apps/web/e2e/otdr.spec.ts` : trace complète, coupure injectée avec sa position, localisation depuis l'OLT et depuis l'abonné.
