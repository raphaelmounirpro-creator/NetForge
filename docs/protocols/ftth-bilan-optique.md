# Réseau optique FTTH : bilan, mesures et pannes

Niveau : pédagogique simplifié — calcul statique du bilan optique, sans simulation des trames PON (enregistrement des ONT, allocation dynamique de bande et services : phase 9).

## Références

Consultées le 2026-11-11 (textes publics de l'UIT-T, téléchargés depuis itu.int) :

- UIT-T G.984.2 (08/2019), *Gigabit-capable passive optical networks (G-PON): Physical media dependent (PMD) layer specification* :
  - §8.2.5 : longueurs d'onde de fonctionnement, 1 480–1 500 nm en descendant (une seule fibre), 1 260–1 360 nm en montant ;
  - annexe A, tableau A.1 (classe B+) : OLT, puissance moyenne émise +1,5 à +5 dBm, sensibilité −28 dBm, surcharge −8 dBm ; ONU, +0,5 à +5 dBm, sensibilité −27 dBm, surcharge −8 dBm ; pénalité optique 0,5 dB en descendant comme en montant ;
  - annexe A, tableau A.2 : affaiblissement du réseau de distribution de 13 dB au minimum et 28 dB au maximum, à 1 490 nm comme à 1 310 nm.
- UIT-T G.652 (08/2024), tableau 2 (fibre G.652.D) : affaiblissement maximal du câble 0,40 dB/km de 1 310 à 1 625 nm. Note 1 : ces valeurs ne s'appliquent pas aux câbles courts (jarretières, câbles intérieurs, câbles de raccordement) ; à titre d'exemple, la CEI 60794-2 fixe 1,0 dB/km au plus pour un câble intérieur, à 1 310 et 1 550 nm.
- UIT-T G.657 (08/2024) : les fibres de catégorie A (dont A2) sont entièrement conformes à G.652.D.
- UIT-T G.671 (11/2025) :
  - §6.6.1, coupleurs 1×N pour PON, colonne WR1 du tableau des pertes d'insertion (min/max) : 1:2 2,8/3,9 dB ; 1:4 5,4/7,4 ; 1:8 8,2/10,6 ; 1:16 10,8/14,1 ; 1:32 13,3/17,5 ; 1:64 16,1/20,9 ;
  - §6.7.1, connecteur monofibre : 0,5 dB au plus ;
  - §6.14.2, épissure par fusion (alignement actif) : 0,30 dB au plus.

Aucune conformité normative n'est revendiquée : ces valeurs servent de paramètres pédagogiques documentés.

## Comportement pris en charge

### Équipements et ports (catalogue 2)

| Modèle | Rôle | Ports |
|---|---|---|
| OLT-16 | Terminal de ligne optique, profil GPON classe B+ | pon1–pon16, connecteur SC/UPC |
| ODF-12 | Tiroir optique | r1–r12 entrées de câble épissurées, f1–f12 connecteurs SC/APC ; chemin r*n* ↔ f*n* |
| SPL-2 à SPL-64 | Coupleur 1:N | com et o1–o*N*, amorces épissurées ; chemin com ↔ o*n* |
| PBO-8 | Point de branchement optique | in1–in8 et out1–out8, une épissure par abonné |
| PTO | Prise terminale optique | in (câble de raccordement épissuré), out (connecteur SC/APC) |
| BPE-12 | Boîtier d'épissure | a1–a12 ↔ b1–b12 |
| ONT-1G | Terminal d'abonné, profil GPON classe B+ | pon, connecteur SC/APC |

Un câble ne relie que deux ports de même nature (cuivre RJ45 ou fibre) : sinon la commande est refusée (`link.incompatible-media`). Un lien fibre porte sa longueur (0,1 m à 100 km), son type (G.652.D ou G.657.A2) et sa catégorie de câble : « transport ou distribution » (0,40 dB/km) ou « câble court » — jarretière, câble intérieur, raccordement — (1,0 dB/km, valeur d'exemple de la note 1 retenue pour tous les câbles courts). Nouveau lien fibre : jarretière G.657.A2 de 2 m.

Les caractéristiques physiques (ports, fibres), l'état du raccordement (liens, pannes) et le service PON (non simulé en phase 4) sont séparés. Le réseau optique ne transporte aucune trame dans le moteur à événements : il est exclu de la simulation Ethernet et de son empreinte (une modification optique n'impose pas de réinitialiser la simulation).

### Chemins et comptage des pertes

Le moteur (`packages/engine/src/optics.ts`) part de chaque port d'OLT raccordé, traverse la fibre, entre dans l'équipement suivant et suit ses chemins internes, jusqu'à un ONT. Une boucle (retour sur un port déjà traversé) est comptée et ignorée ; 4 096 chemins au plus.

Règle de comptage, sans double comptage possible :

- une **connexion appariée** est comptée une fois par extrémité de câble raccordée à un port à connecteur (une jarretière entre deux connecteurs compte deux connexions, une à chaque bout) ;
- une **épissure** appartient au chemin interne de l'équipement qui l'abrite (une par entrée de câble épissurée ; deux pour un coupleur : amorces d'entrée et de sortie) ;
- une **fibre** compte une fois, sur toute sa longueur ;
- un **coupleur** compte sa perte d'insertion sur chaque chemin entrée → sortie.

### Bilan par sens

Pour chaque chemin : descendant (OLT → ONT, 1 490 nm) et montant (ONT → OLT, 1 310 nm), avec les valeurs de G.984.2 B+.

| Grandeur | Calcul |
|---|---|
| Pertes maximales | somme des maximums nominaux traversés |
| Pertes minimales | somme des minimums : seuls les coupleurs en ont un ; les autres comptent 0 dB (prudent pour la surcharge) |
| Puissance reçue au pire cas | émission minimale − pertes maximales |
| Marge | puissance reçue au pire cas − (sensibilité + pénalité de trajet) |
| Marge avant surcharge | surcharge − (émission maximale − pertes minimales) |
| Budget disponible | émission minimale − sensibilité − pénalité (28 dB dans les deux sens, cohérent avec la classe B+) |

État : coupure, raccordement incompatible, signal trop faible (marge < 0), surcharge, marge faible (marge inférieure à la réserve d'ingénierie), conforme. La **réserve d'ingénierie de 3 dB** est un choix pédagogique, non normatif, réglable dans le moteur. Les valeurs sont conservées en précision complète ; l'affichage arrondit à 0,01 dB (0,001 dB pour les contributions).

### Pannes et mesures

| Panne | Cible | Effet |
|---|---|---|
| Coupure | fibre | plus aucune lumière sur les chemins qui la traversent |
| Courbure | fibre | perte supplémentaire saisie (0,1 à 30 dB) |
| Connecteur sale | port à connecteur | perte supplémentaire saisie |
| Épissure défectueuse | port épissuré | perte supplémentaire saisie |
| Polissage incompatible (APC/UPC) | port à connecteur | raccordement déclaré incompatible ; **aucune pénalité chiffrée n'est inventée** |

La perte de panne reste distincte de la perte nominale (colonnes séparées). Aucune panne n'est placée à une distance arbitraire le long d'une fibre : elle porte sur la fibre entière ou sur un port.

- **Photomètre** : raccordé à la place de la jarretière sur un port à connecteur. Il affiche la puissance au pire cas (émission minimale garantie, pertes maximales, pannes comprises) et la compare au bilan de conception : l'écart est exactement la perte ajoutée par les pannes en amont. Descendant : lumière de l'OLT ; montant : lumière d'un ONT choisi. Une entrée de câble épissurée n'est pas mesurable.
- **Inspection** : face du connecteur (propre ou sale) et polissage de la jarretière raccordée (adapté ou non).
- **Interventions** : nettoyer un connecteur, remplacer une jarretière, refaire une épissure, remplacer une fibre. Une intervention qui ne corrige rien à cet endroit est signalée comme telle.

Le formateur voit et injecte les pannes. Pendant un exercice, l'élève ne voit que les symptômes (état constaté par l'ONT, bilan de conception, mesures et inspections) ; la panne reste présente dans le fichier du projet (entraînement local, D-033).

## Simplifications et limites

- Mesures déterministes au pire cas : aucune valeur « typique » ni dispersion aléatoire n'est inventée.
- Affaiblissement identique à 1 310 et 1 490 nm (la valeur maximale de G.652 couvre 1 310–1 625 nm) ; pas d'effet Raman, de vidéo superposée ni de filtre WDM.
- Épissures par fusion à alignement actif uniquement ; pas d'épissure mécanique.
- Pas de réflectance, d'OTDR, d'atténuateur, ni de numéro de série ou d'enregistrement d'ONT (phase 9).
- Un point éclairé par plusieurs OLT (erreur de câblage) est mesuré depuis le premier dans l'ordre des identifiants.

## Correspondance OSI (pédagogique)

Couche 1 (physique) : puissance optique, affaiblissement, connectique. Aucune unité de données n'est modélisée sur le réseau optique en phase 4.

## Tests de référence

- `packages/engine/src/optics.test.ts` : chemin ONT1 calculé à la main (24,974 dB, marge 3,026 dB dans les deux sens), contributions dans l'ordre de chaque sens, comptage (4 connexions, 7 épissures, 2 coupleurs, 6 fibres), trois branches, réserve, marge faible, ONT non atteint, sensibilité insuffisante (cascade 1:64 + 1:8), surcharge, panne distincte de la perte nominale, courbure, épissure, coupure, incompatibilité, photomètre (deux sens), inspection, cohabitation avec la simulation Ethernet.
- `packages/engine/src/exercise-optics.test.ts` : critère de service optique, réponses en dB, observations du photomètre, format d'exercice v2.
- `packages/project/src/ftth.test.ts` : connectiques, fibre par défaut, raccordement automatique d'une chaîne FTTH, pannes (cibles, pertes, doublons, limites), suppression en cascade, interventions.
- `apps/web/e2e/optics.spec.ts` : bilan, panne injectée, mesure et réparation ; connectique incompatible et surcharge ; exercice de dépannage complet.
