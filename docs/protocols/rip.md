# RIP version 2

Niveau : pédagogique simplifié (phase 8, tranche 1) — routeurs R-200, IPv4.

## Références

Consultées le 2026-11-12 :

- [RFC 2453](https://www.rfc-editor.org/rfc/rfc2453) : §3.4.3 (horizon partagé obligatoire, empoisonnement inverse recommandé), §3.4.4 et §3.10.1 (mises à jour déclenchées, attente de 1 à 5 s), §3.5 (métrique d'un réseau directement connecté = coût, 1), §3.6 (UDP 520, commandes, 1 à 25 entrées, métrique 16 = infini), §3.8 (annonce toutes les 30 s, expiration à 180 s, suppression après 120 s), §3.9.1 (demande de table complète au démarrage), §3.9.2 (contrôles d'une réponse, métrique + coût plafonnée à 16, remplacement d'une route), §4 et §4.4 (entrée de version 2, prochain saut 0.0.0.0), §4.5 (groupe 224.0.0.9).
- [RFC 1112](https://www.rfc-editor.org/rfc/rfc1112), §6.1 (TTL 1 par défaut en multidiffusion) et §6.4 (MAC 01:00:5e + 23 bits de poids faible).
- [RFC 5771](https://www.rfc-editor.org/rfc/rfc5771), §4 : le bloc 224.0.0.0/24 sert au trafic de contrôle qui ne quitte pas le lien.

## Comportement pris en charge

- **Configuration** : chaque interface adressée d'un routeur (sous-interface 802.1Q comprise) participe à RIP en mode **actif** (émission et traitement des messages) ou **passif** (réseau annoncé, aucun message RIP émis ni traité : réseau de postes).
- **Démarrage** : chaque routeur demande la table complète de ses voisins sur ses interfaces actives (une entrée de famille 0 et de métrique 16). Les réponses unicast et les mises à jour déclenchées font converger le réseau sans attendre l'annonce périodique : « Terminer les échanges » calcule cette convergence.
- **Annonces** : toutes les 30 s, sur chaque interface active, réponse multidiffusée vers 224.0.0.9:520 (TTL 1, MAC 01:00:5e:00:00:09), 25 entrées au plus par message. Horizon partagé simple : une route n'est jamais annoncée sur l'interface par laquelle elle passe.
- **Apprentissage** : une réponse n'est acceptée que depuis le port 520, d'un émetteur situé sur le réseau de l'interface d'arrivée, et pas du routeur lui-même. Métrique reçue + 1, plafonnée à 16 ; nouvelle route si la métrique est inférieure à 16, remplacement par une métrique plus faible, ou toute nouvelle valeur annoncée par le voisin déjà utilisé.
- **Pannes** : une interface hors service rend aussitôt inaccessibles son réseau et les routes qui passent par elle. Une route sans annonce pendant 180 s expire. Une route annoncée en métrique 16 par le voisin utilisé est retirée. Dans tous les cas : métrique 16, mise à jour déclenchée, suppression définitive 120 s plus tard. Une interface rétablie retrouve son réseau et redemande la table de ses voisins (choix NetForge).
- **Mises à jour déclenchées** : envoyées dès qu'une route change, avec les seules routes changées, puis espacées d'une attente tirée entre 1 et 5 s par le générateur à graine.
- **Table de routage** : les routes RIP utilisables y figurent (type « RIP » et métrique), après les routes connectées et statiques à préfixe égal (préférence : connecté, statique, RIP — choix NetForge, sans notion normalisée de distance administrative).

## Simplifications et limites

- Horizon partagé simple, sans empoisonnement inverse (recommandé par la RFC, non modélisé) ; pas de bascule entre routes de même métrique.
- Annonces périodiques à 30 s exactes, sans décalage aléatoire : l'horloge virtuelle n'est pas affectée par la charge (premier cas prévu par RFC 2453 §3.8), mais tous les routeurs annoncent aux mêmes instants.
- Toute demande reçue est traitée comme une demande de table complète. Ni authentification, ni compatibilité RIP version 1, ni étiquette de route utilisée, ni redistribution de routes statiques ou de routes par défaut, ni RIPng.
- Un réseau connecté actif du routeur n'est jamais appris par RIP ; un réseau d'interface tombée peut l'être par un autre chemin.
- Le mode passif ignore aussi les messages reçus (certains équipements les traitent).
- Encodage binaire non produit : la taille est calculée à partir des champs (en-tête de 4 octets, 20 octets par entrée).
- Le délai de convergence après une panne lointaine dépend des temporisations réelles (30 s, 180 s) : avancer la simulation (lecture accélérée) pour l'observer.

## Correspondance OSI (pédagogique)

Ethernet (2) → IPv4 (3, protocole 17, TTL 1 vers 224.0.0.9) → UDP (4, port 520) → RIP (7, protocole de routage). L'inspecteur affiche la commande, la version et chaque entrée (réseau, préfixe, métrique, prochain saut). Le journal range RIP dans la catégorie « Routage dynamique » ; un switch répète la trame de groupe comme une diffusion (aucun suivi IGMP), une carte qui n'écoute pas le groupe la filtre.

Le panneau d'exécution d'un routeur montre ses interfaces RIP, la prochaine annonce périodique et sa table RIP (réseau local, route valide avec expiration, route en suppression) ; `show rip` et `show routes` affichent les mêmes données dans la console.

## Tests de référence

- `packages/project/src/rip.test.ts` : modes d'interface, refus (équipement, port, interface sans adresse), avertissement après retrait d'une adresse, console équivalente aux formulaires, configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v7 → v8 sans RIP.
- `packages/engine/src/rip.test.ts` : convergence du triangle de référence (métriques, prochains sauts, pings, TTL), convergence sans annonce périodique, champs des messages (groupe, TTL, ports, demande de table complète, taille), horizon partagé et interface passive, coupure puis route de secours à l'annonce suivante, retour du lien, expiration à 180 s et suppression à 300 s derrière un switch, diamètre de 15 sauts, voisin passif, voisin d'un autre réseau, déterminisme.
- `packages/engine/src/evaluation.test.ts` : RIP protégé par la fonction « routes » ; ping noté après la convergence initiale.
- `apps/web/src/i18n/simulation.test.ts` : explications sur traces réelles aux deux niveaux, catégorie, inspecteur RIP.
- `apps/web/e2e/rip.spec.ts` : convergence, table RIP, coupure, route de secours après lecture accélérée, inspecteur, formulaire de l'onglet Routes et console équivalents.
