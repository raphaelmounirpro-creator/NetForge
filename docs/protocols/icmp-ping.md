# ICMP et ping

Niveau : **pédagogique simplifié** (sous-ensemble : écho, destination inaccessible codes 0 et 1, temps dépassé code 0).

Code : [packages/engine/src/simulation.ts](../../packages/engine/src/simulation.ts) (`deliverLocal`, `sendIcmpError`, application ping), [pdu.ts](../../packages/engine/src/pdu.ts).

## Références (consultées le 2026-11-11)

- RFC 792, *Internet Control Message Protocol* — https://www.rfc-editor.org/rfc/rfc792.txt : écho (type 8) et réponse (type 0) avec identifiant et numéro de séquence « to aid in matching echos and replies » ; destination inaccessible (type 3) code 0 réseau, code 1 hôte ; temps dépassé (type 11) code 0 « time to live exceeded in transit » ; l'erreur recopie l'en-tête IP et les 64 premiers bits du datagramme d'origine.
- RFC 1122, *Requirements for Internet Hosts*, §3.2.2 — https://www.rfc-editor.org/rfc/rfc1122.txt : « An ICMP error message MUST NOT be sent as the result of receiving: an ICMP error message » (ni pour un datagramme destiné à une diffusion).
- Microsoft Learn, commande `ping` — https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ping : 4 échos, 32 octets de données et délai d'attente de 4 000 ms par défaut.

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Lancement | Depuis un PC : 1 à 20 échos (4 par défaut), un toutes les secondes simulées, 32 octets de données ; identifiant ICMP tiré du générateur à graine | `command.ping`, `ping.send` |
| Destination refusée | Adresse mal écrite, 0.0.0.0/8, multicast, réservée, 255.255.255.255 ou diffusion de son propre réseau | erreur de commande |
| Réponse | La cible répond avec le même identifiant et la même séquence ; aller-retour mesuré en temps simulé | `icmp.echo-request`, `icmp.echo-reply`, `ping.reply` |
| Délai d'attente | 4 s simulées sans réponse | `ping.timeout` |
| Erreur reçue | Associée au ping par l'identifiant et la séquence recopiés dans l'erreur | `icmp.error-received`, `ping.error` |
| Échec local | Pas d'adresse, pas de route, pas de réponse ARP, file ARP pleine | `ping.failed` |
| Erreurs ICMP émises | Routeur : réseau inaccessible (pas de route), hôte inaccessible (échec ARP), temps dépassé (TTL) | `icmp.error-sent` |
| Pas d'erreur sur une erreur | Une erreur ICMP impossible à acheminer est abandonnée sans en produire une autre | `icmp.error-suppressed` |
| Bilan | Envoyés, reçus, perdus ; aller-retour minimal, moyen et maximal | `ping.done` |

## Simplifications et limites

- Le contenu des données d'écho n'est pas modélisé (seule sa longueur compte).
- Pas de ping vers une adresse de diffusion, pas de traceroute (outils PC, phase 3).
- Un PC ne génère pas d'erreur ICMP ; un routeur ne limite pas son débit d'erreurs ICMP.

## Correspondance OSI (pédagogique)

ICMP est transporté par IPv4 (couche 3) et sert au diagnostic de la couche réseau ; ping est un outil applicatif qui l'utilise.

## Tests de référence

- [lan.test.ts](../../packages/engine/src/lan.test.ts) : écho et réponse, aller-retour exact, ping local (127.0.0.1 et adresse propre), PC sans adresse.
- [routing.test.ts](../../packages/engine/src/routing.test.ts) : réseau inaccessible, hôte inaccessible, temps dépassé, non-émission d'une erreur au sujet d'une erreur.
- [commands.test.ts](../../packages/engine/src/commands.test.ts) : destinations et nombres d'échos refusés.
