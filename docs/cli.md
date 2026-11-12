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
| Interface (`R1(config ge0)>`) | `address <adresse>/<préfixe>` ou `address <adresse> <masque>` | Adresse IPv4 du port |
| | `address clear` | Retire l'adresse |
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
| `ping <adresse> [-n <nombre>]` | Échos ICMP (4 par défaut, 20 au plus) ; réponses affichées au fil du calcul |
| `arp -a` / `arp -d` | Affiche / vide le cache ARP |

## Limites

- Pas de ping depuis un routeur ni de traceroute (prévus avec les outils de supervision).
- Pas de description de port ni d'arrêt administratif d'interface ; pas de base de VLAN ni de noms de VLAN ([protocols/vlan.md](protocols/vlan.md)).
- La console n'est disponible que dans la vue Simulation.
