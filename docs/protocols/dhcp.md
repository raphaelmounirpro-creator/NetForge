# DHCP sur IPv4

Niveau : pédagogique simplifié (phase 7, tranche 3).

## Références

Consultées le 2026-11-12 :

- [RFC 2131](https://www.rfc-editor.org/rfc/rfc2131), §3.1, §4.1, §4.3 et §4.4 : attribution, ports UDP 67/68, diffusion initiale, renouvellement et expiration.
- [RFC 2132](https://www.rfc-editor.org/rfc/rfc2132), §3.3, §3.5 et §9 : options masque, passerelle, adresse demandée, durée, type et identifiant du serveur.

## Comportement pris en charge

Le poste démarre sans adresse, cherche un serveur (DISCOVER), retient la première offre (OFFER), demande le bail (REQUEST) et applique la confirmation (ACK). Le routeur choisit la plus petite adresse libre de sa plage, hors de ses propres adresses. Les messages traversent réellement les liens et les switches : coupures, VLAN et STP s'appliquent.

La passerelle et l'adresse obtenues restent dans l'état du moteur ; elles ne remplacent pas la configuration persistante. Chaque interface de routeur adressée peut porter une plage, y compris une sous-interface 802.1Q.

Un bail dure de 60 secondes à 7 jours (limites NetForge). T1 vaut 50 % et T2 87,5 % de sa durée : renouvellement unicast à T1, demande diffusée à T2 si nécessaire. Sans confirmation à l'expiration, le client retire adresse et passerelle et recommence. RELEASE rend l'adresse au serveur. Les temporisations de baux ne prolongent pas seules « Terminer les échanges » ; avancer l'horloge les déclenche.

## Simplifications et limites

- Ni relais DHCP, ni DHCPv6, ni DNS distribué, réservations, DECLINE, INFORM, INIT-REBOOT ou sauvegarde des baux entre simulations.
- Première offre reçue retenue sans fenêtre de collecte. MAC du client comme identité, aucune option Client Identifier. Aucun contrôle de conflit par sonde ARP : les plages recouvrant une adresse statique produisent un avertissement.
- Retransmission initiale déterministe : 0, 4, 12, 28 secondes ; abandon à 60 secondes, sans jitter. Une demande à T1, une à T2 ; aucune retransmission intermédiaire de renouvellement. Durée calculée depuis la réception de l'ACK, sans correction du délai de transit.
- Réservation d'une offre sans REQUEST : 60 secondes, choix NetForge. Le routeur ne reprend à T2 que ses propres baux, sans reprise d'un bail d'un autre serveur.
- BOOTP, options et tailles sont des structures typées ; aucun encodage binaire, checksum ni bourrage minimal DHCP. UDP transporte seulement DHCP ; les erreurs ICMP sur UDP ne sont pas modélisées.
- Aucune connexion au réseau du poste réel, aucun serveur DHCP réel lancé.

## Correspondance OSI et observation

Ethernet (2) → IPv4 (3, protocole 17) → UDP (4, ports 67 et 68) → DHCP (7). L'inspecteur affiche les champs réellement présents : transaction, BROADCAST, ciaddr, yiaddr, chaddr et options 1, 3, 50, 51, 54. Le type correspond à l'option 53.

Le journal relie les décisions d'une transaction `dhcp-N`. Le panneau d'exécution expose phase du client, adresse, passerelle, serveur, T1, T2 et expiration ; sur le routeur, plages et réservations. Une plage épuisée produit un diagnostic explicite.

## Tests de référence

- `packages/project/src/dhcp.test.ts` : saisies, validation, mêmes commandes par formulaire et console, configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v5 → v6 sans activation de DHCP.
- `packages/engine/src/dhcp.test.ts` : DORA, deux clients, routage avec passerelle reçue, épuisement, libération, T1/T2/expiration, VLAN, déterminisme.
- `packages/engine/src/evaluation.test.ts` : changements DHCP interdits sans fonction « addressing ».
- `apps/web/src/i18n/simulation.test.ts` : explications sur traces réelles et couches UDP/DHCP.
- `apps/web/e2e/dhcp.spec.ts` : formulaires, console, baux, inspecteur, ping distant et épuisement.
