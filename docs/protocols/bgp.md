# BGP-4 simplifié (et TCP réduit)

Niveau : pédagogique simplifié (phase 8, tranche 4) — routeurs R-200, IPv4, voisins externes directement connectés (eBGP à un saut).

## Références

Consultées le 2026-11-13 :

- [RFC 4271](https://www.rfc-editor.org/rfc/rfc4271) (BGP-4) : §3 (écoute sur le port TCP 179) ; §4.1 (en-tête : marqueur de 16 octets, longueur de 19 à 4096, type ; 1 OPEN, 2 UPDATE, 3 NOTIFICATION, 4 KEEPALIVE) ; §4.2 (OPEN : version 4, My Autonomous System sur 2 octets, Hold Time, identifiant BGP) ; §4.3 et §5 (UPDATE : réseaux retirés, attributs, NLRI ; ORIGIN type 1, AS_PATH type 2, NEXT_HOP type 3) ; §4.4 (au plus un tiers du Hold Time entre deux KEEPALIVE) ; §5.1.2 et §5.1.3 (vers un voisin externe : son AS en tête de l'AS_PATH, NEXT_HOP = adresse de l'interface utilisée pour la connexion) ; §8.2.2 (automate Idle, Connect, Active, OpenSent, OpenConfirm, Established ; NOTIFICATION à l'expiration du Hold Timer) ; §9.1.2 (chemin avec boucle d'AS exclu, NEXT_HOP non joignable exclu) ; §9.1.2.2 (ordre de choix : AS_PATH le plus court, ORIGIN, MED, eBGP avant iBGP, coût interne, plus petit identifiant, plus petite adresse) ; §10 (ConnectRetryTime 120 s, HoldTime 90 s, KeepaliveTime 1/3, MinRouteAdvertisementInterval eBGP 30 s).
- [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293) (TCP) : §3.1 (en-tête, 20 octets sans option, bits de contrôle), §3.4 (le SYN occupe un numéro de séquence), §3.5 (poignée de main en trois temps), §3.5.2 (réinitialisation d'un segment sans connexion).

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Configuration | Un AS par routeur (1 à 65535), voisins externes (adresse, AS distant), réseaux annoncés (CIDR) ; identifiant BGP = plus grande adresse IPv4 du routeur (choix NetForge) | — |
| TCP | Le routeur dont l'adresse sur le lien est la plus grande ouvre la connexion (SYN depuis un port éphémère vers 179, TTL 1), l'autre l'attend (état Active) et répond SYN,ACK ; ACK final ; un segment sans voisin déclaré reçoit un RST | `tcp.syn-sent`, `tcp.syn-received`, `tcp.established`, `tcp.reset` |
| Session | OPEN de chaque côté (AS vérifié, Hold Time = le plus petit des deux), KEEPALIVE, Established ; KEEPALIVE toutes les 30 s ; NOTIFICATION et fin de session si l'AS diffère ou si aucun message n'arrive pendant 90 s ; nouvelle tentative après 120 s | `bgp.state`, `bgp.open-sent`, `bgp.open-received`, `bgp.keepalive-sent`, `bgp.keepalive-received`, `bgp.notification-sent`, `bgp.notification-received` |
| Annonces | À l'établissement, toute la table ; ensuite, seuls les changements (un UPDATE par ensemble d'attributs, retraits groupés) ; ORIGIN IGP, AS_PATH précédé de son AS, NEXT_HOP = son adresse sur le lien | `bgp.update-sent`, `bgp.update-received` |
| Réseaux locaux | Un réseau configuré n'est annoncé que s'il figure dans la table de routage hors BGP (connecté, statique, OSPF ou RIP) | `bgp.best-path` |
| Boucle d'AS | Un chemin qui contient déjà son AS est rejeté | `bgp.loop-rejected` |
| Décision | Réseau local d'abord, puis AS_PATH le plus court, puis plus petit identifiant BGP, puis plus petite adresse du voisin ; NEXT_HOP joignable sur un réseau connecté ; route « BGP » installée (préférence NetForge 20 : avant OSPF et RIP) ; tous les chemins connus restent visibles (secours) | `bgp.best-path`, `bgp.route-removed` |
| Coupure | L'interface vers un voisin tombe : session fermée aussitôt, chemins de ce voisin oubliés, nouvelle décision ; retour de l'interface : nouvelle session (choix NetForge) ; un voisin muet derrière un switch est détecté par le Hold Time | `bgp.state` |

« Terminer les échanges » calcule l'établissement des sessions et la convergence (événements actifs) ; KEEPALIVE, Hold Time et ConnectRetryTime sont des temporisations de fond, observées en lecture.

Configuration équivalente par le formulaire (onglet Routes d'un routeur, section « Routage entre systèmes autonomes BGP ») et par la console :

```
configure
bgp as 65001
bgp neighbor 10.12.0.2 remote-as 65002
bgp network 10.1.0.0/24
bgp network 10.1.0.0/24 delete
bgp neighbor 10.12.0.2 delete
bgp disable
end
show bgp
show routes
```

## Simplifications et limites

- eBGP seulement, entre voisins directement connectés (TTL 1) : ni iBGP, ni réflecteurs de routes, ni sessions multi-sauts.
- Attributs : ORIGIN (toujours IGP), AS_PATH (séquence) et NEXT_HOP ; ni LOCAL_PREF, ni MED, ni communautés, ni agrégation ; numéros d'AS sur 2 octets.
- Décision réduite aux critères ci-dessus (pas de MED, pas de coût interne) ; pas de partage de charge.
- Pas de MinRouteAdvertisementInterval (30 s en eBGP) : les changements partent aussitôt, pour que la convergence se calcule.
- Pas de redistribution de BGP dans OSPF ou RIP ; aucune politique d'import ou d'export : tout chemin retenu est annoncé à tous les voisins (y compris celui dont il vient, qui le rejette par boucle d'AS).
- Collision de connexions évitée par construction (un seul côté ouvre) au lieu de la résolution de RFC 4271 §6.8.
- TCP réduit : poignée de main, numéros de séquence et d'acquittement, RST ; pas de fenêtre, d'options, de retransmission, d'acquittement séparé des données (aucune perte hors coupure), ni de fermeture par FIN (une session fermée abandonne la connexion).
- Un segment TCP ne déclenche jamais d'erreur ICMP.

## Correspondance OSI (pédagogique)

Ethernet (2) → IPv4 (3, protocole 6, TTL 1) → TCP (4, port 179) → BGP (7, routage entre AS). L'inspecteur affiche le segment TCP (ports, séquence, acquittement, bits SYN, ACK, RST) puis le message BGP (type ; OPEN : version, AS, Hold Time, identifiant ; UPDATE : réseaux retirés, ORIGIN, AS_PATH, NEXT_HOP, réseaux annoncés ; NOTIFICATION : erreur). Le journal range BGP et TCP dans la catégorie « Routage dynamique ».

Le panneau d'exécution d'un routeur montre son AS et son identifiant, chaque voisin (état, rôle dans l'ouverture de la connexion, réseaux reçus) et la table BGP (chemin retenu ou de secours, local ou reçu) ; `show bgp` et `show routes` affichent les mêmes données dans la console.

## Tests de référence

- `packages/project/src/bgp.test.ts` : bornes de l'AS, configuration et retraits, refus (équipement, voisin interne, réseau mal formé ou en double), avertissement d'un voisin non connecté, console équivalente aux formulaires, configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v11 → v12 sans BGP.
- `packages/engine/src/bgp.test.ts` : sessions (qui ouvre, SYN vers 179 en TTL 1, OPEN et KEEPALIVE avec leurs tailles, automate), annonces (AS_PATH, NEXT_HOP), boucle d'AS rejetée, chemin le plus court et chemin de secours, ping (TTL 62), coupure puis détour (TTL 61) et retour, AS inattendu (NOTIFICATION), voisin non configuré (RST puis nouvelle tentative à 120 s), Hold Time expiré derrière un switch, absence de BGP, déterminisme.
- `packages/engine/src/evaluation.test.ts` : BGP protégé par la fonction « routes » ; ping noté après l'établissement des sessions.
- `apps/web/src/i18n/simulation.test.ts` : chaque décision BGP et TCP expliquée aux deux niveaux sur des traces réelles, phrases attendues, inspecteur d'un UPDATE.
- `apps/web/e2e/bgp.spec.ts` : sessions et table BGP, `show bgp`, `show routes`, ping, coupure et détour, inspecteur ; formulaire de l'onglet Routes et console équivalents.
