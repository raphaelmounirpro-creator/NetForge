# DNS minimal sur IPv4

Niveau : pédagogique simplifié (phase 7, tranche 4) — service sur routeur, résolution par les PC.

## Références

Consultées le 2026-11-12 :

- [RFC 1035](https://www.rfc-editor.org/rfc/rfc1035), §2.3.1 et §2.3.4 (syntaxe et tailles des noms), §3.2.2 et §3.2.4 (type A = 1, classe IN = 1), §4.1.1 à §4.1.4 (en-tête, question, enregistrement, compression), §4.2.1 (UDP, port 53), §7.1 et §7.3 (limite de retransmissions, reconnaissance d'une réponse par identifiant puis question).
- [RFC 1123](https://www.rfc-editor.org/rfc/rfc1123), §2.1 (premier caractère d'un label : lettre ou chiffre ; un nom n'a jamais la forme d'une adresse), §6.1.3.1 (résolveur « stub »), §6.1.3.3 (retransmission bornée, recul exponentiel, 5 s au moins par défaut, abandon obligatoire).
- [RFC 6335](https://www.rfc-editor.org/rfc/rfc6335), §6 : ports dynamiques (éphémères) 49152 à 65535.

## Comportement pris en charge

- **Service** : un routeur dont le service DNS est activé répond aux questions reçues sur UDP 53 à l'une de ses adresses, à partir de ses seuls enregistrements A (nom → adresse IPv4). Il répond avec autorité (AA = 1), sans récursion (RA = 0) : l'adresse si le nom est enregistré, NXDOMAIN (RCODE 3) sinon. La réponse part de l'adresse interrogée vers l'adresse et le port source du client. Service désactivé : le datagramme reste sans service (`udp.no-service`).
- **Résolveur** : un PC interroge le serveur DNS saisi dans sa configuration (y compris en adressage automatique). Question A unicast, récursion demandée (RD = 1), identifiant sur 16 bits et port source éphémère tirés par le générateur à graine. La réponse n'est acceptée que si port, identifiant, serveur et question correspondent ; sinon elle est ignorée et tracée (`dns.ignored`).
- **Retransmission** : attente de 5 s, doublée à chaque essai ; deux émissions (à 0 puis 5 s), abandon à 15 s (`dns.gave-up`). Un nom inexistant met fin à la résolution sans retransmettre.
- **Échecs immédiats** : aucun serveur configuré (`dns.no-server`, rien n'est émis) ; question impossible à émettre faute d'adresse ou de route (`dns.send-failed`). Une question perdue en route (câble coupé, ARP sans réponse) attend la retransmission.
- **Utilisation** : `nslookup <nom>` affiche serveur, nom et adresse (ou la cause de l'échec) ; `ping <nom>` résout d'abord le nom, puis envoie ses échos vers l'adresse obtenue. Sans adresse, le ping se termine sans écho (`ping.unresolved`). Les formulaires d'action de la vue Simulation acceptent aussi un nom.
- **Noms** : ASCII, casse ignorée, point final accepté ; labels de 1 à 63 caractères (lettres, chiffres, tiret ni en tête ni en fin, premier caractère chiffre admis), 253 caractères au plus en notation texte ; le dernier label contient une lettre. Au plus 100 enregistrements par routeur.

## Simplifications et limites

- Ni récursion, ni délégation, ni zone ou SOA, ni enregistrements autres que A (pas de PTR, CNAME, MX, AAAA), ni transfert de zone, ni DNSSEC, ni DNS sur TCP. Les sections d'autorité et additionnelles ne sont pas modélisées.
- Un seul serveur par poste, saisi manuellement : DHCP ne distribue pas de serveur DNS (option 6 non modélisée).
- Aucun cache côté poste : chaque résolution émet une question ; le TTL annoncé (300 s, choix NetForge) est affiché mais non exploité. Ni fichier hosts ni résolution locale de `localhost`.
- Le service répond avec autorité pour tout nom, enregistré ou non : il n'existe pas de notion de zone dont il serait responsable.
- Pas d'erreur ICMP « port inaccessible » quand le service est absent : le poste attend la fin des retransmissions.
- Retransmission à valeurs fixes (5 s puis 10 s), sans statistiques de temps de réponse ni serveur de secours.
- Encodage binaire non produit : la taille est calculée à partir des champs (en-tête 12 octets, nom encodé, type et classe ; réponse A de 16 octets avec pointeur de compression).
- Résolution réservée aux PC ; routeurs et switches ne résolvent pas de noms.

## Correspondance OSI (pédagogique)

Ethernet (2) → IPv4 (3, protocole 17) → UDP (4, port 53 côté serveur, port éphémère côté client) → DNS (7). L'inspecteur affiche identifiant, QR, drapeaux AA, RD et RA, RCODE, la question (nom, type A, classe IN) et chaque réponse (nom, adresse, TTL).

Le journal relie les décisions d'une résolution `dns-N` (catégorie DNS). Le panneau d'exécution d'un routeur montre ses enregistrements et le nombre de réponses données (avec adresse, nom inexistant) ; `show dns` affiche les mêmes données dans la console.

## Tests de référence

- `packages/project/src/dns.test.ts` : syntaxe des noms, adresses admises, commandes du résolveur et du service, validation à l'import, console équivalente aux formulaires, configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v6 → v7 sans résolveur ni service activé.
- `packages/engine/src/dns.test.ts` : question et réponse sur le câble (ports, identifiant, drapeaux), taille comptée à la main, ping par nom, autre réseau, poste en DHCP, NXDOMAIN, absence de serveur, service désactivé (5 s, 15 s), absence de route ou d'adresse, câble coupé, limites de commande, déterminisme et rejeu.
- `packages/engine/src/evaluation.test.ts` : résolveur et service protégés par la fonction « addressing ».
- `apps/web/src/i18n/simulation.test.ts` : explications sur traces réelles aux deux niveaux, couches de l'inspecteur, sorties de nslookup et des pings par nom.
- `apps/web/e2e/dns.spec.ts` : console (nslookup, ping par nom, NXDOMAIN, `show dns`), inspecteur, panneau d'exécution, formulaires du service et du résolveur, console équivalente.
