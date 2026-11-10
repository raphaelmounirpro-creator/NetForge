# Adressage IPv4 (configuration)

Niveau : **pédagogique simplifié — configuration et validation uniquement**. Aucun échange IPv4 n'est simulé avant la phase 2 (moteur ARP/IPv4/ICMP).

Code : [packages/project/src/ipv4.ts](../../packages/project/src/ipv4.ts), [validation.ts](../../packages/project/src/validation.ts).

## Références (consultées le 2026-11-10)

- RFC 6890, *Special-Purpose IP Address Registries*, §2.2.2 — https://www.rfc-editor.org/rfc/rfc6890.html : 0.0.0.0/8 « This host on this network » (RFC 1122 §3.2.1.3), 127.0.0.0/8 « Loopback », 240.0.0.0/4 « Reserved » (RFC 1112 §4).
- RFC 5771, *IANA Guidelines for IPv4 Multicast Address Assignments*, §3 — https://www.rfc-editor.org/rfc/rfc5771.html : blocs multicast de 224.0.0.0 à 239.255.255.255.
- RFC 3021, *Using 31-Bit Prefixes on IPv4 Point-to-Point Links*, §2.1 et §2.2.1 — https://www.rfc-editor.org/rfc/rfc3021.html : avec un préfixe /31, les deux adresses sont des adresses d'hôte ; pas de diffusion dirigée.

## Comportement pris en charge

| Règle | Gravité | Code |
|---|---|---|
| Notation décimale pointée stricte (zéros non significatifs refusés : « 010 ») | erreur de saisie | `ipv4.invalid-address` |
| Masque décimal contigu ou longueur de préfixe 0–32 | erreur de saisie | `ipv4.invalid-mask` |
| Adresse dans 0/8, 127/8, 224/4 ou 240/4 non attribuable à une interface | erreur | `ipv4.unassignable` |
| Adresse de réseau ou de diffusion non attribuable pour un préfixe ≤ /30 ; /31 et /32 acceptés | erreur | `ipv4.unassignable` |
| Deux interfaces d'un même routeur dans des réseaux qui se chevauchent | erreur | `ipv4.overlap` |
| Même adresse sur deux équipements | avertissement | `ipv4.duplicate-address` |
| Passerelle hors du réseau du PC, sans adresse locale, ou égale à sa propre adresse | avertissement | `gateway.*` |
| Passerelle dans une plage non attribuable | erreur | `gateway.unassignable` |

Les avertissements ne bloquent pas : un laboratoire de dépannage doit pouvoir contenir une adresse en double ou une passerelle erronée, dont la simulation (phase 2) montrera les effets.

## Simplifications et limites

- Une seule adresse IPv4 par interface ; pas d'adresses secondaires.
- La plage 169.254.0.0/16 (lien local) est acceptée sans traitement particulier.
- Pas d'interface de bouclage logique ni de configuration DHCP (phase 7).
- Les commutateurs S-24 sont de niveau 2 : aucune adresse IP de gestion en phase 1.

## Correspondance OSI (pédagogique)

Couche 3 (réseau) : adresse, masque et passerelle par défaut d'un hôte.

## Tests de référence

- `packages/project/src/ipv4.test.ts` : analyse stricte, masques, réseau et diffusion de 172.16.37.200/20 calculés à la main, chevauchement, plages non attribuables, /31.
- `packages/project/src/commands.test.ts` : refus d'une adresse de réseau, d'un chevauchement sur routeur, d'une IP sur un switch ; avertissements d'adresse en double et de passerelle hors réseau.
