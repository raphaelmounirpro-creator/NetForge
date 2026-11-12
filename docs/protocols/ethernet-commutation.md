# Ethernet et commutation

Niveau : **pédagogique simplifié**.

Code : [packages/engine/src/simulation.ts](../../packages/engine/src/simulation.ts) (transmission, commutation), [pdu.ts](../../packages/engine/src/pdu.ts) (trames et tailles), [mac.ts](../../packages/engine/src/mac.ts) (adresses).

## Références (consultées le 2026-11-11)

- RFC 7042, *IANA Considerations and IETF Protocol and Documentation Usage for IEEE 802 Parameters*, §2.1 — https://www.rfc-editor.org/rfc/rfc7042.txt : bit « Group » (01) et bit « Local » (02) du premier octet d'une adresse EUI-48 ; bit Local à 1 = identifiant local.
- RFC 894, *A Standard for the Transmission of IP Datagrams over Ethernet Networks* — https://www.rfc-editor.org/rfc/rfc894.txt : champ de données d'au moins 46 octets ; type 0800 (hexadécimal) pour IP.
- RFC 4188, *Definitions of Managed Objects for Bridges*, objet `dot1dTpAgingTime` — https://www.rfc-editor.org/rfc/rfc4188.txt : « 802.1D-1998 recommends a default of 300 seconds » (référence IEEE 802.1D-1998, clause 14.7.1.1.3).
- IEEE 802.3 (préambule de 7 octets, délimiteur de 1 octet, intervalle minimal de 96 bits entre trames) : norme payante, **non consultée directement** ; valeurs usuelles reprises comme paramètre du modèle.

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Adresse MAC | Une adresse par port, administrée localement (`02:…`), dérivée de l'identifiant équipement/port : stable d'une session à l'autre ; collisions résolues de façon déterministe | — |
| Trame | Source, destination et contenu (ARP ou IPv4) ; EtherType déduit du contenu (0x0806 ARP, 0x0800 IPv4) | — |
| Taille | En-tête 14 + contenu + FCS 4, complétée à 64 octets (ARP : 64 ; écho ICMP de 32 octets de données : 78) | `eth.transmit` |
| Émission | Sérialisation à la vitesse du lien (`(octets + 20) × 8` ns à 1 Gb/s), trames émises une à une par port, puis propagation forfaitaire de 0,5 µs | `eth.transmit` |
| Port sans câble / câble coupé | Aucune émission | `eth.no-link`, `eth.link-down` |
| Coupure pendant l'émission | Trame perdue à l'arrivée | `eth.lost-in-transit` |
| Filtrage par la carte | Un PC ou un routeur ignore une trame qui n'est adressée ni à sa MAC ni à la diffusion | `nic.filtered` |
| Apprentissage | Le switch associe la MAC source au port d'arrivée ; déplacement signalé | `switch.learn`, `switch.move` |
| Vieillissement | Entrée oubliée 300 s après la dernière trame reçue de cette adresse (temps virtuel) | `switch.expire` |
| Diffusion | Répétée sur tous les autres ports actifs | `switch.flood-broadcast` |
| Destination inconnue | Inondée sur tous les autres ports actifs | `switch.flood-unknown` |
| Destination connue | Transmise sur le seul port appris ; filtrée si c'est le port d'arrivée | `switch.forward`, `switch.filter` |
| Lien qui tombe | Le switch efface les adresses apprises sur ce port | `switch.flush` |

## Simplifications et limites

- Liaisons en duplex intégral, sans collision ni file d'attente bornée (aucune perte par congestion).
- Délais forfaitaires et documentés (paramètres du moteur) : traitement 2 µs par switch, 10 µs par PC ou routeur ; longueur de câble non modélisée.
- VLAN : voir [vlan.md](vlan.md) (tables MAC et diffusion par VLAN) ; Spanning Tree : voir [stp.md](stp.md). Pas d'agrégation ni de sécurité de port. Sans STP sur tous les switches d'une boucle, une boucle de commutation provoque une tempête de diffusion : l'éditeur la signale (`topology.switch-loop`) et le moteur s'interrompt à la limite d'événements en attente, avec une explication.
- Pas de FCS calculé ni d'octets affichés : seuls les champs ci-dessus existent.

## Correspondance OSI (pédagogique)

Couche 1 (physique) : sérialisation et propagation sur le câble. Couche 2 (liaison) : adresses MAC, trame, commutation.

## Tests de référence

- [lan.test.ts](../../packages/engine/src/lan.test.ts) : inondation de la requête ARP, apprentissage, transmission ciblée, vieillissement MAC à 300 s, destination inconnue inondée et filtrée par les autres cartes, câble absent ou coupé, trame perdue en transit, aller-retour calculé à la main.
- [core.test.ts](../../packages/engine/src/core.test.ts) : unicité et stabilité des adresses MAC, tailles de trame.
- [determinism.test.ts](../../packages/engine/src/determinism.test.ts) : tempête de diffusion interrompue proprement.
