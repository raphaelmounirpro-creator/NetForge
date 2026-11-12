# Spanning Tree (IEEE 802.1D)

Niveau : **pédagogique simplifié** (sous-ensemble de 802.1D, sans échange de BPDU trame par trame).

Code : [packages/engine/src/stp.ts](../../packages/engine/src/stp.ts) (calcul de l'arbre), [packages/engine/src/simulation.ts](../../packages/engine/src/simulation.ts) (états des ports, écarts, reconvergence), [packages/project/src/stp.ts](../../packages/project/src/stp.ts) (priorités).

## Références (consultées le 2026-11-12)

- RFC 4188, *Definitions of Managed Objects for Bridges* — https://www.rfc-editor.org/rfc/rfc4188.txt : `dot1dStpPriority` (« On bridges supporting IEEE 802.1t or IEEE 802.1w, permissible values are 0-61440, in steps of 4096 ») ; `dot1dStpPortState` (`disabled`, `blocking`, `listening`, `learning`, `forwarding`, `broken`) ; `dot1dStpPortPathCost` (« 802.1D-1998 recommends that the default value of this parameter be in inverse proportion to » la vitesse du réseau) ; plages des temporisations (`dot1dStpBridgeForwardDelay` de 4 à 30 s).
- IEEE 802.1D (algorithme d'élection, comparaison des vecteurs de priorité, priorité par défaut 32768, Hello Time 2 s, Max Age 20 s, Forward Delay 15 s, table de coûts 1 Gb/s → 4) : **non consultée directement** ; valeurs usuelles reprises comme paramètres du modèle.

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Identifiant de pont | Priorité (0 à 61440 par pas de 4096, 32768 par défaut) puis plus petite adresse MAC des ports du switch | — |
| Racine | Plus petit identifiant de pont de chaque ensemble de switches reliés (STP activé) | `stp.topology-change` |
| Port racine | Coût de chemin le plus faible vers la racine ; à égalité, plus petit pont émetteur, puis plus petit port émetteur, puis plus petit port local | `stp.topology-change` |
| Coût | 1 Gb/s → 4, 100 Mb/s → 19, 10 Mb/s → 100, 10 Gb/s → 2 (table courte de 802.1D-1998) | — |
| Port désigné | Par segment, l'extrémité au meilleur coût vers la racine, puis au plus petit pont, puis au plus petit port ; tous les ports de la racine ; tout port relié à un poste, un routeur ou un switch sans STP | — |
| Port alternatif | Ni racine ni désigné : état « bloqué », trames de données écartées | `stp.discarded` |
| Écoute, apprentissage | Un port qui doit se mettre à transmettre passe 15 s en écoute (rien n'est appris ni transmis), puis 15 s en apprentissage (adresses apprises, rien transmis) | `stp.port-state`, `stp.discarded` |
| Blocage | Un port qui doit cesser de transmettre bloque immédiatement | `stp.port-state` |
| Changement de topologie | Coupure ou rétablissement d'un lien : nouvel arbre ; si la racine, un port racine ou un coût change, les switches participants vident leur table MAC | `stp.topology-change` |
| Switch sans STP | Ne participe pas : tous ses ports transmettent (une boucle qui le traverse peut provoquer une tempête) | — |

Démarrage : le réseau démarre **convergé** (états stables calculés à l'instant 0), comme des switches allumés depuis longtemps.

Valeurs par défaut : un switch ajouté dans l'éditeur a STP activé (priorité 32768) ; un switch d'un projet antérieur au format 5 a STP désactivé (comportement conservé, une boucle reste un cas d'étude de tempête).

Configuration équivalente par le formulaire (onglet Général d'un switch) et par la console :

```
configure
spanning-tree priority 4096
spanning-tree disable
spanning-tree enable
end
show spanning-tree
```

## Simplifications et limites

- Les BPDU ne sont pas simulés trame par trame : l'arbre est calculé avec les comparaisons de 802.1D (même résultat qu'un échange de BPDU jusqu'à stabilité). L'inspecteur n'affiche donc pas de BPDU.
- Démarrage convergé ; pas de Max Age (20 s) : une coupure est prise en compte immédiatement (comme une panne détectée directement sur le port), puis Forward Delay de 15 s pour l'écoute et pour l'apprentissage.
- Changement de topologie : table MAC vidée au lieu du vieillissement accéléré de 802.1D.
- Un seul arbre pour tous les VLAN (pas de PVST, MSTP ni RSTP) ; pas de PortFast, BPDU Guard ni Root Guard ; priorité de port fixe (128) ; coût de port non configurable.
- Les ports reliés à des postes passent aussi par l'écoute et l'apprentissage quand leur lien revient (30 s sans transmission).

## Correspondance OSI (pédagogique)

Couche 2 (liaison) : protocole de contrôle entre ponts ; il n'ajoute aucun champ aux trames de données, il décide quels ports les transmettent.

## Tests de référence

- [packages/engine/src/stp.test.ts](../../packages/engine/src/stp.test.ts) : élection de la racine, ports racine et désignés, câbles parallèles, tempête évitée (comparée à la même boucle sans STP), trafic détourné par la racine, switch sans STP, reconvergence après coupure (écoute à 0 s, apprentissage à 15 s, transmission à 30 s), trafic écarté pendant l'écoute, blocage immédiat au retour du lien.
- [packages/project/src/stp.test.ts](../../packages/project/src/stp.test.ts) : priorités, valeurs par défaut, console équivalente au formulaire, configuration rejouée.
- [apps/web/e2e/stp.spec.ts](../../apps/web/e2e/stp.spec.ts) : port bloqué observable, coupure du lien racine, reconvergence, `show spanning-tree`.
