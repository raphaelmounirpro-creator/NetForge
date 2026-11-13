# Protocoles et modèles physiques

Le moteur simule Ethernet, ARP, IPv4 et ICMP (phase 2), VLAN, STP, DHCP et DNS (phase 7), RIP, OSPF, BGP et VRRP (phase 8) et calcule le bilan optique d'un réseau FTTH (phase 4). Chaque fiche indique le niveau de modélisation, les références publiques effectivement consultées, les simplifications et les tests qui vérifient le comportement.

| Fiche | Niveau |
|---|---|
| [Moteur : temps, événements, déterminisme, limites](moteur.md) | Socle d'exécution |
| [Ethernet et commutation](ethernet-commutation.md) | Pédagogique simplifié |
| [VLAN 802.1Q et routage inter-VLAN](vlan.md) | Pédagogique simplifié |
| [Spanning Tree (IEEE 802.1D)](stp.md) | Pédagogique simplifié — arbre calculé, sans BPDU simulés |
| [ARP](arp.md) | Pédagogique simplifié |
| [DHCP sur IPv4](dhcp.md) | Pédagogique simplifié — serveur sur routeur, clients PC |
| [DNS minimal sur IPv4](dns.md) | Pédagogique simplifié — enregistrements A sur routeur, résolution par les PC |
| [Adressage IPv4 (configuration)](ipv4-adressage.md) | Pédagogique simplifié — configuration et validation |
| [IPv4 : acheminement et routage statique](ipv4-routage.md) | Pédagogique simplifié |
| [RIP version 2](rip.md) | Pédagogique simplifié — routeurs, interfaces actives ou passives |
| [OSPF version 2](ospf.md) | Pédagogique simplifié — zones multiples par la dorsale, réseaux à diffusion, sans accusés de réception |
| [BGP-4 simplifié et TCP réduit](bgp.md) | Pédagogique simplifié — eBGP à un saut, AS_PATH et NEXT_HOP, TCP sans perte |
| [VRRP version 3 (IPv4)](vrrp.md) | Pédagogique simplifié — un groupe par interface, Accept_Mode faux |
| [ICMP et ping](icmp-ping.md) | Pédagogique simplifié (sous-ensemble) |
| [Réseau optique FTTH : bilan, mesures et pannes](ftth-bilan-optique.md) | Pédagogique simplifié — calcul statique |

Chaque protocole ou modèle ajouté reçoit un fichier `docs/protocols/<nom>.md` selon ce gabarit :

```markdown
# <Protocole>

Niveau : absent | pédagogique simplifié | sous-ensemble détaillé

## Références
- <document public> — <lien> — <section>

## Comportement pris en charge
## Simplifications et limites
## Correspondance OSI (pédagogique)
## Tests de référence
- <fichier de test> : <scénario vérifié>
```

Règles : ne citer que des références publiques effectivement consultées ; ne jamais revendiquer une conformité normative non vérifiée ; HTTPS, IPsec et assimilés simulés ne sont jamais présentés comme une cryptographie réelle.

## Unités de données réellement modélisées et couches OSI

Correspondance pédagogique utilisée par l'inspecteur de la vue Simulation (`pduLayers` dans apps/web/src/i18n/simulation.ts).

La trace (et l'inspecteur prévu en phase 3) n'affiche que ces champs ; aucun octet n'est inventé.

| Unité | Couche OSI (pédagogique) | Champs | Transporte |
|---|---|---|---|
| Trame Ethernet | 2 · liaison | MAC source, MAC destination, étiquette 802.1Q (VID) si présente (EtherType déduit du contenu ; taille calculée) | ARP ou IPv4 |
| ARP | entre 2 et 3 · résolution d'adresse | opération, MAC et IP de l'émetteur, MAC et IP de la cible | — |
| IPv4 | 3 · réseau | source, destination, TTL, identification (protocole transporté : ICMP, TCP, UDP, OSPF ou VRRP) | ICMP, TCP, UDP, OSPF ou VRRP |
| UDP | 4 · transport | ports source et destination | DHCP, DNS ou RIP |
| DHCP | 7 · application | type, xid, BROADCAST, ciaddr, yiaddr, chaddr, options présentes | — |
| DNS | 7 · application | identifiant, QR, AA, RD, RA, RCODE, question (nom, type A, classe IN), réponses A (nom, adresse, TTL) | — |
| RIP | 7 · application (routage) | commande, version, entrées (famille, étiquette, réseau, masque, prochain saut, métrique) | — |
| TCP | 4 · transport | ports, numéros de séquence et d'acquittement, bits SYN, ACK et RST | BGP |
| BGP | 7 · application (routage entre AS) | type ; OPEN : version, AS, Hold Time, identifiant ; UPDATE : réseaux retirés, ORIGIN, AS_PATH, NEXT_HOP, réseaux annoncés ; NOTIFICATION : erreur | — |
| VRRP | 3 · réseau (protocole 112, redondance) | version, type, VRID, priorité, intervalle maximal, adresses virtuelles | — |
| OSPF | 3 · réseau (protocole 89, routage) | version, type, identifiant du routeur, zone ; Hello (masque, intervalles, priorité, DR, BDR, voisins) ; description de base (MTU, bits I/M/MS, séquence, en-têtes de LSA) ; demande (LSA demandés) ; mise à jour (LSA routeur : bit B, liens ; LSA réseau : masque, routeurs rattachés ; LSA de résumé : masque, coût) | — |
| ICMP écho | 3 · contrôle et diagnostic | type, identifiant, séquence, longueur des données | — |
| ICMP erreur | 3 · contrôle et diagnostic | type, code, en-tête IP et identifiant/séquence de l'écho d'origine | — |
