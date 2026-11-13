# Console des équipements

Console originale de NetForge (vue Simulation, onglet « Console »). Elle n'imite aucun produit existant ; seules les commandes usuelles des outils PC (`ping`, `ipconfig`, `arp`) gardent leur nom habituel.

Code : [packages/project/src/cli.ts](../packages/project/src/cli.ts) (interpréteur pur, testé dans `cli.test.ts`), [apps/web/src/features/simulation/consoleActions.ts](../apps/web/src/features/simulation/consoleActions.ts) (exécution), textes dans [apps/web/src/i18n/fr.ts](../apps/web/src/i18n/fr.ts) (`console`).

## Principe

- L'interpréteur analyse la ligne et renvoie une intention ; il ne produit aucun texte.
- Une modification de configuration utilise **la même commande métier que le formulaire** (`setInterfaceIpv4`, `addStaticRoute`, `renameDevice`…), avec les mêmes validations, l'historique annuler/rétablir et l'enregistrement automatique. Les tests vérifient que console et formulaire donnent un document identique.
- Une demande d'exécution (ping, effacement d'une table) est transmise au moteur. L'affichage d'une table (`show …`, `arp -a`) montre l'état calculé par le moteur, jamais une déduction de l'interface.
- Modifier la configuration pendant une simulation demande une réinitialisation, comme depuis les formulaires.

## Aide à la saisie

- `help` ou `?` liste les commandes du mode courant ; `show ?` liste celles qui commencent par `show`.
- Mots-clés abrégeables s'il n'y a pas d'ambiguïté : `sh int` = `show interfaces`, `conf` = `configure`.
- Tab complète le mot en cours (ligne non vide) ou affiche les possibilités ; ↑ et ↓ parcourent l'historique.
- Les erreurs indiquent la cause : commande inconnue (avec suggestion), abréviation ambiguë, commande d'un autre mode, argument manquant (avec la syntaxe), valeur invalide (messages de validation des formulaires).

## Routeur R-200 et switch S-24

| Mode (invite) | Commande | Effet |
|---|---|---|
| Exploitation (`R1>`) | `show interfaces` | État des ports : MAC, IPv4, actif ou non |
| | `show routes` (routeur) | Table de routage calculée (routes inactives comprises) |
| | `show arp` (routeur) / `show mac` (switch) | Cache ARP / table MAC (par VLAN) |
| | `show vlans` (switch) | Ports d'accès par VLAN, puis trunks (VLAN natif, VLAN autorisés) |
| | `show spanning-tree` (switch) | Racine élue, port racine, puis rôle, état et coût de chaque port |
| | `show dhcp` (routeur) | Plages et baux calculés par le moteur |
| | `show dns` (routeur) | Noms enregistrés et réponses données par le service DNS (calculés par le moteur) |
| | `show rip` (routeur) | Interfaces RIP, prochaine annonce et table RIP (métrique, prochain saut, expiration) calculées par le moteur |
| | `show ospf` (routeur) | Identifiant OSPF, état des interfaces (coût, priorité, DR, BDR) et voisins (état, rôle, instant de perte) |
| | `show bgp` (routeur) | AS et identifiant, voisins (AS, état, réseaux reçus), table BGP (chemin d'AS, prochain saut, retenu ou de secours) |
| | `show bandwidth` (OLT) | Débits de chaque port PON à l'heure de pointe : débit de ligne, garanties, demande, contention et chaque flux (VLAN, garanti, maximum, pointe) |
| | `show pon` (OLT, ONT) | Activation PON calculée par le moteur (sans simulation chargée) : sur l'OLT, ONT autorisés et découverts par port ; sur l'ONT, état et étapes franchies |
| | `show vrrp` (routeur) | Groupes VRRP : VRID, adresse et MAC virtuelles, priorité, préemption, état, maître connu, échéance |
| | `show ospf database` (routeur) | Base d'états des liens : type, identifiant, annonceur, séquence, âge et contenu de chaque LSA |
| | `show config` | Configuration réécrite en commandes (rejouable) |
| | `clear arp` (routeur) / `clear mac` (switch) | Vide la table apprise |
| | `configure` | Passe en mode configuration |
| Configuration (`R1(config)>`) | `hostname <nom>` | Renomme l'équipement |
| | `interface <port>` | Passe en mode interface (`R1(config ge0)>`, `SW1(config ge1)>`) |
| | `interface <port>.<vlan>` (routeur) | Sous-interface 802.1Q (`R1(config ge0.10)>`) : son numéro est le VLAN encapsulé |
| | `route add <réseau>/<préfixe> via <prochain-saut>` | Ajoute une route statique (masque décimal accepté) |
| | `route delete <réseau>/<préfixe>` | Retire une route statique |
| | `spanning-tree enable` / `spanning-tree disable` (switch) | Active / désactive le Spanning Tree |
| | `spanning-tree priority <priorité>` (switch) | Priorité du pont : multiple de 4096 entre 0 et 61440 (la plus petite devient racine) |
| | `dns enable` / `dns disable` (routeur) | Active le service DNS / le désactive (ses noms sont retirés ; annulable) |
| | `dns record <nom> <adresse>` (routeur) | Enregistre ou remplace un nom (enregistrement A) ; active le service |
| | `dns delete <nom>` (routeur) | Retire un nom enregistré |
| Interface (`R1(config ge0)>`) | `address <adresse>/<préfixe>` ou `address <adresse> <masque>` | Adresse IPv4 du port |
| | `address clear` | Retire l'adresse |
| | `dhcp pool <début> <fin> [gateway <passerelle>] [lease <durée>]` (routeur) | Plage de l'interface ; défauts : adresse de l'interface, bail de 1 jour |
| | `dhcp clear` (routeur) | Retire la plage de l'interface |
| | `rip enable` / `rip passive` / `rip disable` (routeur) | Interface active dans RIP / réseau annoncé sans message RIP / retirée de RIP (interface adressée) |
| | `ospf enable` / `ospf passive` / `ospf disable` (routeur) | Interface active dans OSPF, zone 0 / réseau décrit sans paquet OSPF / retirée d'OSPF (interface adressée ; coût et priorité conservés) |
| | `vrrp <vrid> <adresse> [priority <priorité>] [preempt on\|off]` / `vrrp clear` (routeur) | Groupe VRRP de l'interface : VRID 1 à 255, adresse virtuelle du réseau de l'interface, priorité 1 à 254 (100 par défaut), préemption (activée par défaut) / retrait |
| | `bgp as <as>` / `bgp disable` (routeur, mode configuration) | Active BGP avec cet AS (1 à 65535) ou le désactive |
| | `bgp neighbor <adresse> remote-as <as>` / `bgp neighbor <adresse> delete` | Déclare un voisin externe directement connecté, ou le retire |
| | `bgp network <réseau>/<préfixe> [delete]` | Annonce un réseau présent dans la table de routage, ou cesse de l'annoncer |
| | `ont add <port> <numéro-de-série> [onu-id <identifiant>]` / `ont delete <port> <numéro-de-série>` (OLT, mode configuration) | Autorise un ONT sur un port PON (identifiant d'ONU : le plus petit libre par défaut, 0 à 253 en GPON, 0 à 1 020 en XGS-PON), ou retire l'autorisation |
| | `service <internet\|voip\|iptv> vlan <vlan> down <garanti>/<max> [up <garanti>/<max>]` / `service <service> delete` (OLT) | Profil d'un service : VLAN et débits en Mbit/s (virgule ou point, trois décimales) ; pas de sens montant pour l'IPTV |
| | `ont services <port> <numéro-de-série> <internet,voip,iptv\|none>` (OLT) | Offre d'un ONT autorisé (services souscrits) |
| | `serial-number <numéro-de-série>` (ONT, mode configuration) | Remplace le numéro de série (quatre lettres puis huit chiffres hexadécimaux) |
| | `ospf area <zone>` (routeur) | Zone de l'interface OSPF : décimal (« 1 ») ou notation pointée (« 0.0.0.1 ») ; 0 = dorsale (défaut) |
| | `ospf cost <coût>` / `ospf priority <priorité>` (routeur) | Coût de 1 à 65535 (10 par défaut) / priorité de 0 à 255 pour l'élection du DR (1 par défaut) ; interface déjà dans OSPF |
| Interface d'un switch (`SW1(config ge1)>`) | `access vlan <vlan>` | Port d'accès dans le VLAN (1 à 4094 ; `access vlan 1` revient au défaut) |
| | `trunk [native <vlan>] [allowed <liste>\|all]` | Trunk 802.1Q ; par défaut VLAN natif 1 et tous les VLAN autorisés ; liste : `10,20,30-35` |
| Configuration et interface | `exit` / `end` | Remonte d'un niveau / revient en exploitation |

`show …`, `help` et `cls` sont disponibles dans tous les modes.

## PC (outils)

| Commande | Effet |
|---|---|
| `ipconfig` | Adresse MAC, adresse IPv4, masque et passerelle |
| `ipconfig set <adresse> <masque> [passerelle]` | Configure l'interface (et la passerelle) |
| `ipconfig clear` | Retire l'adresse et la passerelle |
| `ipconfig dhcp` | Active l'adressage automatique (adresse obtenue pendant la simulation) |
| `ipconfig renew` / `ipconfig release` | Demande ou renouvelle / libère le bail DHCP |
| `ipconfig dns <serveur>` / `ipconfig dns clear` | Définit / retire le serveur DNS interrogé (y compris en DHCP) |
| `nslookup <nom>` | Résout un nom par le serveur DNS du poste : serveur, nom, adresse et TTL, ou cause de l'échec |
| `ping <adresse\|nom> [-n <nombre>]` | Échos ICMP (4 par défaut, 20 au plus) ; un nom est d'abord résolu par DNS ; réponses affichées au fil du calcul |
| `arp -a` / `arp -d` | Affiche / vide le cache ARP |

## Limites

- Pas de ping ni de résolution de noms depuis un routeur, ni de traceroute (prévus avec les outils de supervision).
- `ipconfig d` est ambigu (`dhcp` ou `dns`), comme `show d` sur un routeur.
- Pas de description de port ni d'arrêt administratif d'interface ; pas de base de VLAN ni de noms de VLAN ([protocols/vlan.md](protocols/vlan.md)).
- La console n'est disponible que dans la vue Simulation.
