# VLAN IEEE 802.1Q et routage inter-VLAN

Niveau : **pédagogique simplifié**.

Code : [packages/project/src/vlan.ts](../../packages/project/src/vlan.ts) (configuration, listes, sous-interfaces), [packages/engine/src/network.ts](../../packages/engine/src/network.ts) (ports d'exécution), [packages/engine/src/simulation.ts](../../packages/engine/src/simulation.ts) (classement, commutation, étiquetage, remise aux sous-interfaces), [pdu.ts](../../packages/engine/src/pdu.ts) (étiquette et taille).

## Références (consultées le 2026-11-12)

- RFC 7042, *IANA Considerations and IETF Protocol and Documentation Usage for IEEE 802 Parameters* — https://www.rfc-editor.org/rfc/rfc7042.txt : §3 (« the C-Tag (formerly the Q-Tag) [802.1Q]. It provides customer VLAN and priority information for a frame ») et appendice B.2 (Ethertype 0x8100, « IEEE Std 802.1Q - Customer VLAN Tag Type »).
- IEEE 802.1Q (taille de l'étiquette : 4 octets ; VID sur 12 bits, valeurs 0 et 4095 réservées ; VLAN natif, apprentissage par VLAN) : **non consultée directement** ; valeurs usuelles reprises comme paramètres du modèle.

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Port d'accès | Appartient à un VLAN (1 par défaut) ; accepte et émet des trames sans étiquette ; refuse une trame étiquetée | `vlan.tagged-dropped` |
| Trunk | VLAN natif (sans étiquette) et liste de VLAN autorisés (`all` ou liste) ; une trame étiquetée d'un VLAN non autorisé est refusée à l'entrée ; à la sortie, étiquette sauf pour le VLAN natif | `vlan.not-allowed`, `eth.transmit` (paramètre `vlan`) |
| Table MAC | Une table par VLAN : la même adresse peut figurer dans deux VLAN (routeur à sous-interfaces) sans « déplacement » | `switch.learn`, `switch.forward` (paramètre `vlan`) |
| Diffusion et inondation | Limitées aux ports actifs qui transportent le VLAN de la trame | `switch.flood-broadcast`, `switch.flood-unknown` |
| Sous-interface de routeur | `port.vlan` (ex. `ge0.10`) : même MAC et même lien que le port physique ; trames émises étiquetées ; une trame étiquetée est remise à la sous-interface de son VLAN, sinon ignorée | `vlan.no-subinterface` |
| Routage inter-VLAN | Une sous-interface est une interface IP ordinaire : routes connectées, ARP, passerelle des postes du VLAN | `ip.forward` |
| Poste | Ne lit que des trames sans étiquette | `nic.tagged-dropped` |
| Taille | Étiquette de 4 octets comptée dans la taille de la trame | `eth.transmit` |

Avertissements de validation (non bloquants, cas d'étude) : modes différents aux deux extrémités d'un lien entre switches (`vlan.mode-mismatch`), VLAN natifs différents (`vlan.native-mismatch`), sous-interfaces reliées à un port d'accès (`vlan.subinterfaces-on-access-port`).

Configuration équivalente par les formulaires (onglet Interfaces) et par la console :

```
interface ge1
access vlan 10
exit
interface ge24
trunk native 99 allowed 10,20,30-35
end
show vlans
```

Routeur : `interface ge0.10` puis `address 192.168.10.1/24`.

## Simplifications et limites

- Le numéro d'une sous-interface est le VLAN qu'elle encapsule (pas de commande d'encapsulation séparée) ; pas de VLAN natif sur une sous-interface (le port physique sert au trafic sans étiquette).
- Pas de base de VLAN à créer ni de noms de VLAN : un VLAN existe dès qu'un port l'utilise (1 à 4094).
- Le VLAN natif d'un trunk est toujours transporté, même s'il est absent de la liste des VLAN autorisés.
- Seul le VID est modélisé : ni priorité (PCP) ni DEI ; pas de double étiquetage (802.1ad), de VTP, de DTP ni de VLAN voix.
- Une carte de poste ignore toute trame étiquetée.
- Pas de STP par VLAN (STP : tranche suivante de la phase 7).

## Correspondance OSI (pédagogique)

Couche 2 (liaison) : l'étiquette s'insère dans l'en-tête Ethernet, entre l'adresse source et l'EtherType. L'inspecteur l'affiche dans la couche Ethernet (« TPID 0x8100, VID n ») seulement pour une trame étiquetée.

## Tests de référence

- [packages/engine/src/vlan.test.ts](../../packages/engine/src/vlan.test.ts) : même VLAN à travers un trunk (trames étiquetées sur le trunk seulement), isolation de deux VLAN partageant un réseau IP, routage inter-VLAN par sous-interfaces, table MAC par VLAN, VLAN natif sans étiquette, VLAN non autorisé, trame étiquetée sur un port d'accès, poste relié à un trunk, VLAN sans sous-interface, taille de l'étiquette.
- [packages/project/src/vlan.test.ts](../../packages/project/src/vlan.test.ts) : listes de VLAN, sous-interfaces, commandes et avertissements.
- [packages/project/src/cli.test.ts](../../packages/project/src/cli.test.ts) : console équivalente aux formulaires, configuration rejouée à l'identique.
- [apps/web/src/i18n/simulation.test.ts](../../apps/web/src/i18n/simulation.test.ts) : phrases complètes pour chaque décision VLAN réellement émise.
