# ARP

Niveau : **pédagogique simplifié**.

Code : [packages/engine/src/simulation.ts](../../packages/engine/src/simulation.ts) (`onArp`, `resolveAndSend`, `onArpRetry`, `onArpExpiry`).

## Références (consultées le 2026-11-11)

- RFC 826, *An Ethernet Address Resolution Protocol*, partie « Packet Reception » — https://www.rfc-editor.org/rfc/rfc826.txt : mise à jour d'une entrée existante de l'émetteur (« Merge_flag »), ajout seulement si l'on est l'adresse cible, réponse à une requête en échangeant les champs.
- RFC 1122, *Requirements for Internet Hosts*, §2.3.2.2 — https://www.rfc-editor.org/rfc/rfc1122.txt : la couche liaison devrait conserver au moins un paquet en attente de résolution et l'émettre une fois l'adresse résolue.

## Comportement pris en charge

| Étape | Comportement | Code de trace |
|---|---|---|
| Recherche | Cache consulté avant chaque émission vers le prochain saut | `arp.cache-hit`, `arp.cache-miss` |
| Requête | Diffusée sur le port de sortie ; jusqu'à 3 essais espacés de 1 s | `arp.request-sent` |
| Attente | Jusqu'à 3 paquets conservés par adresse en cours de résolution ; au-delà, abandon | `arp.queued`, `arp.queue-full` |
| Réception (RFC 826) | Entrée existante de l'émetteur mise à jour même si la requête vise un autre hôte ; ajout seulement si l'on est la cible ; réponse directe (unicast) à une requête | `arp.request-received`, `arp.not-target`, `arp.entry-added`, `arp.entry-updated`, `arp.reply-sent`, `arp.reply-received` |
| Résolution | Les paquets en attente repartent | `arp.resolved` |
| Échec | Après 3 requêtes sans réponse : paquets abandonnés ; un routeur prévient la source (ICMP « hôte inaccessible »), un PC signale l'échec au ping | `arp.failed` |
| Expiration | Entrée retirée 60 s (PC) ou 4 h (routeur) après sa dernière mise à jour, en temps virtuel | `arp.entry-expired` |

## Simplifications et limites

- Durées de vie fixes et choisies pour la pédagogie (PC 60 s, routeur 4 h) : les systèmes réels varient, certains avec une part d'aléa et des états intermédiaires (vérification d'accessibilité) non modélisés.
- Seuls les messages ARP rafraîchissent une entrée (pas de confirmation par le trafic IP).
- Pas d'ARP gratuit, de détection d'adresse en double ni de proxy ARP. Une adresse IP en double reste un avertissement de l'éditeur ; son effet dépend de l'ordre des réponses.
- Un port sans adresse IP ignore les messages ARP (`arp.no-address`).

## Correspondance OSI (pédagogique)

Entre la couche 3 (adresse IP du prochain saut) et la couche 2 (adresse MAC de la trame).

## Tests de référence

- [lan.test.ts](../../packages/engine/src/lan.test.ts) : résolution ARP avant l'écho ICMP (ordre des décisions), réutilisation avant expiration, expiration à 60 s puis nouvelle résolution, abandon après 3 requêtes vers un PC non câblé.
- [routing.test.ts](../../packages/engine/src/routing.test.ts) : résolution du prochain saut (la passerelle, pas la destination), « hôte inaccessible » renvoyé par le routeur.
