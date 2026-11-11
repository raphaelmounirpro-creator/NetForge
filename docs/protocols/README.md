# Protocoles et modèles physiques

Le moteur simule Ethernet, ARP, IPv4 et ICMP (phase 2). Chaque fiche indique le niveau de modélisation, les références publiques effectivement consultées, les simplifications et les tests qui vérifient le comportement.

| Fiche | Niveau |
|---|---|
| [Moteur : temps, événements, déterminisme, limites](moteur.md) | Socle d'exécution |
| [Ethernet et commutation](ethernet-commutation.md) | Pédagogique simplifié |
| [ARP](arp.md) | Pédagogique simplifié |
| [Adressage IPv4 (configuration)](ipv4-adressage.md) | Pédagogique simplifié — configuration et validation |
| [IPv4 : acheminement et routage statique](ipv4-routage.md) | Pédagogique simplifié |
| [ICMP et ping](icmp-ping.md) | Pédagogique simplifié (sous-ensemble) |

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

## Unités de données réellement modélisées

La trace (et l'inspecteur prévu en phase 3) n'affiche que ces champs ; aucun octet n'est inventé.

| Unité | Champs | Transporte |
|---|---|---|
| Trame Ethernet | MAC source, MAC destination (EtherType déduit du contenu ; taille calculée) | ARP ou IPv4 |
| ARP | opération, MAC et IP de l'émetteur, MAC et IP de la cible | — |
| IPv4 | source, destination, TTL, identification | ICMP |
| ICMP écho | type, identifiant, séquence, longueur des données | — |
| ICMP erreur | type, code, en-tête IP et identifiant/séquence de l'écho d'origine | — |
