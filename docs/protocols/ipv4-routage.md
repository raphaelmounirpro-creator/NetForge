# IPv4 : acheminement et routage statique

Niveau : **pédagogique simplifié**. La configuration et la validation des adresses sont décrites dans [ipv4-adressage.md](ipv4-adressage.md).

Code : [packages/engine/src/routing.ts](../../packages/engine/src/routing.ts) (table et recherche), [simulation.ts](../../packages/engine/src/simulation.ts) (`onIpv4`, `sendLocal`) ; routes statiques : [packages/project/src/validation.ts](../../packages/project/src/validation.ts), [commands.ts](../../packages/project/src/commands.ts).

## Références (consultées le 2026-11-11)

- RFC 1812, *Requirements for IP Version 4 Routers*, §5.3.1 — https://www.rfc-editor.org/rfc/rfc1812.txt : « When a router forwards a packet, it MUST reduce the TTL by at least one » ; TTL réduit à zéro : paquet abandonné et ICMP Time Exceeded, code 0, envoyé à la source.
- RFC 2644, *Changing the Default for Directed Broadcasts in Routers*, §5.3.5.2 (remplacement) — https://www.rfc-editor.org/rfc/rfc2644.txt : les routeurs bloquent par défaut la réception et le relais des diffusions dirigées.

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Table d'un PC | Réseau connecté de son interface + route par défaut vers la passerelle | — |
| Table d'un routeur | Réseaux connectés (interfaces adressées et actives) + routes statiques | — |
| Route active | Connectée : interface câblée et lien en service. Statique ou passerelle : prochain saut dans un réseau connecté actif | (vue « Table de routage ») |
| Sélection | Plus long préfixe parmi les routes actives ; à longueur égale, la route connectée l'emporte, puis la route statique, puis la route RIP ([rip.md](rip.md)) | `ip.route`, `ip.forward` |
| Livraison locale | Paquet destiné à une adresse de l'équipement | `ip.local` |
| Bouclage | 127.0.0.0/8 et adresse propre traités en interne, sans trame | `ip.loopback` |
| PC destinataire d'un paquet d'autrui | Abandon (un PC ne relaie pas) | `ip.not-for-host` |
| TTL | PC : 64 au départ ; routeur : 255 pour ses propres messages. Un routeur qui reçoit TTL ≤ 1 abandonne et renvoie « temps dépassé » ; sinon il relaie avec TTL − 1 | `ip.ttl-expired`, `ip.forward` |
| Absence de route | PC : échec local expliqué (pas de passerelle, passerelle injoignable, pas d'adresse, interfaces inactives). Routeur : abandon et ICMP « réseau inaccessible » | `ip.no-route` |
| Diffusion dirigée | Un routeur ne relaie pas un paquet vers l'adresse de diffusion d'un réseau connecté (RFC 2644) ni vers 255.255.255.255 | `ip.broadcast-dropped` |

Routes statiques (format `.nfg.json` v2) : destination (adresse de réseau obligatoire, ex. 10.0.2.0/24), masque, prochain saut. Validation : destination non réseau, doublon, prochain saut non attribuable ou égal à une adresse du routeur = erreurs ; prochain saut hors des réseaux connectés = avertissement (route inactive).

## Simplifications et limites

- Le prochain saut d'une route doit être dans un réseau directement connecté : pas de résolution récursive, pas de route vers une interface sans prochain saut.
- Une seule route par destination et préfixe : pas de partage de charge ni de route flottante (distance administrative fixe : connectée 0, statique 1, RIP 120 — valeurs NetForge).
- Pas de fragmentation (aucune MTU dépassée avec les échos modélisés), d'options IP, d'ICMP Redirect ni de routage dynamique (phase 8).
- Le champ « identification » est un compteur par équipement, au départ tiré du générateur à graine.

## Correspondance OSI (pédagogique)

Couche 3 (réseau) : adresses, table de routage, TTL.

## Tests de référence

- [routing.test.ts](../../packages/engine/src/routing.test.ts) : passerelle et prochain saut, deux routeurs avec routes statiques, plus long préfixe, PC sans passerelle, passerelle hors réseau, routeur sans route, retour manquant (chez la destination et chez un routeur), boucle de routage et TTL, diffusion dirigée.
- [routes.test.ts](../../packages/project/src/routes.test.ts) : règles de validation et commandes des routes statiques.
