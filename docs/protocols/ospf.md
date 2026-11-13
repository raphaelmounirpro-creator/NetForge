# OSPF version 2 en zone unique

Niveau : pédagogique simplifié (phase 8, tranche 2) — routeurs R-200, IPv4, zone 0 seulement, réseaux à diffusion (Ethernet).

## Références

Consultée le 2026-11-13 : [RFC 2328](https://www.rfc-editor.org/rfc/rfc2328) (OSPF version 2) :

- §4.3 : OSPF directement sur IP, protocole 89 ; types de paquets 1 à 5 (Hello, description de base, demande, mise à jour, accusé de réception).
- §9.1 à §9.4 : états d'une interface (Down, Waiting, DR Other, Backup, DR) ; attente de RouterDeadInterval à la mise en service (Wait Timer), fin anticipée par l'événement BackupSeen ; élection du DR et du BDR (étapes 1 à 4).
- §10.1, §10.2, §10.4 à §10.8 : états d'un voisin (Init, 2-Way, ExStart, Exchange, Loading, Full) et ses événements ; adjacence avec le DR et le BDR seulement sur un réseau à diffusion ; contrôles du Hello (masque, HelloInterval, RouterDeadInterval) ; maître = plus grand identifiant, bits I, M et MS, retransmission toutes les RxmtInterval.
- §12.1.1, §12.1.6, §12.4, §12.4.1.2, §12.4.2 : âge 0 à l'origine, numéro de séquence initial 0x80000001 ; nouvelle instance seulement si le contenu change, ou à LSRefreshTime ; liens de transit (identifiant = adresse du DR, donnée = adresse du routeur) ou terminaux ; LSA réseau émis par le DR pleinement adjacent à au moins un routeur.
- §13, §13.1, §13.3, §13.5, §14 : mise à jour acceptée d'un voisin en état Exchange au moins ; instance la plus récente ; règles d'inondation (AllSPFRouters depuis le DR ou le BDR, AllDRouters sinon) ; accusés de réception (non modélisés, voir plus bas) ; retrait à MaxAge.
- §16.1, §16.1.1 : plus court chemin (liens vérifiés dans les deux sens, réseau avant routeur à coût égal, réseaux terminaux en seconde étape) et calcul du prochain saut.
- Annexes A.1, A.3.1 à A.3.5, A.4.1 à A.4.3 : groupes 224.0.0.5 et 224.0.0.6, TTL 1 ; en-tête de 24 octets ; champs des paquets ; en-tête de LSA de 20 octets ; LSA routeur et réseau.
- Annexe B : LSRefreshTime 30 min, MaxAge 1 h, MaxAgeDiff 15 min, MinLSInterval 5 s, InitialSequenceNumber 0x80000001.
- Annexe C.3 : HelloInterval 10 s et RxmtInterval 5 s (valeurs d'exemple d'un réseau local), RouterDeadInterval multiple de HelloInterval (« say 4 ») ; coût d'interface supérieur à 0, priorité 0 = jamais DR. **La RFC ne fixe ni coût ni priorité par défaut.**

La MAC de groupe (01:00:5e + 23 bits de poids faible) suit RFC 1112 §6.4, déjà utilisée par RIP ([rip.md](rip.md)).

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Configuration | Par interface adressée d'un routeur (sous-interface comprise) : mode **actif** (paquets OSPF émis et traités) ou **passif** (réseau décrit, rien n'est émis ni traité), coût 1 à 65535 (**10 par défaut, choix NetForge**), priorité 0 à 255 (**1 par défaut, choix NetForge**) | — |
| Identifiant de routeur | Plus grande adresse IPv4 des interfaces du routeur, fixée au démarrage (choix NetForge, non configurable) | — |
| Hello | Toutes les 10 s vers 224.0.0.5 (TTL 1, MAC 01:00:5e:00:00:05) : masque, intervalles 10 s et 40 s, priorité, DR, BDR, voisins entendus. Hello **déclenché** dès que son contenu change (nouveau voisin, voisin perdu, DR ou BDR élu — choix NetForge) | `ospf.hello-sent`, `ospf.hello-received`, `ospf.hello-mismatch` |
| Voisinage | Init au premier Hello, 2-Way quand le voisin le cite, retour en Init s'il ne le cite plus ; voisin perdu après 40 s sans Hello ou aussitôt si l'interface tombe | `ospf.neighbor-state` |
| Élection | Attente de 40 s à la mise en service (fin anticipée si un voisin annonce déjà un BDR) ; priorité 0 : DR Other directement ; élection en deux temps de RFC 2328 §9.4, sans préemption ; nouvelle élection à chaque changement chez un voisin | `ospf.interface-state` |
| Adjacence | Avec le DR et le BDR seulement (tous les voisins pour le DR et le BDR) ; deux DR Other restent en 2-Way | `ospf.neighbor-state` |
| Échange de base | ExStart : chacun se déclare maître (I, M, MS), le plus grand identifiant l'emporte ; puis une description complète de chaque côté ; Loading : demande des LSA plus récents ; Full. Description du maître restée sans réponse renvoyée toutes les 5 s | `ospf.dd-sent`, `ospf.dd-received`, `ospf.lsr-sent`, `ospf.lsr-received` |
| LSA | LSA routeur (liens de transit vers le DR de chaque réseau pleinement adjacent, terminaux sinon : attente, interface passive, aucun voisin) ; LSA réseau émis par le DR avec les routeurs pleinement adjacents ; nouvelle instance seulement si le contenu change ; rafraîchissement à 30 min ; LSA du DR retiré (âge MaxAge) quand il cesse de l'être ; LSA d'un routeur disparu effacé à MaxAge (1 h) | `ospf.lsa-originated`, `ospf.lsa-installed`, `ospf.lsa-flushed`, `ospf.lsa-expired` |
| Inondation | Vers les voisins en état Exchange au moins, sauf l'émetteur ; jamais en retour vers le DR ou le BDR qui l'a transmis, ni par le BDR sur l'interface de réception ; vers 224.0.0.5 depuis le DR ou le BDR, 224.0.0.6 sinon (seuls DR et BDR écoutent ce groupe) | `ospf.lsu-sent`, `ospf.lsu-received` |
| Calcul | Dijkstra sur la base (RFC 2328 §16.1) dès qu'elle change, une fois par instant ; routes de type « OSPF » avec leur coût, préférées après connecté et statique, avant RIP (préférences NetForge 0, 1, 110, 120) | `ospf.spf`, `ospf.route-added`, `ospf.route-changed`, `ospf.route-removed` |

Démarrage : les interfaces se mettent en service à l'instant 0 ; l'attente de 40 s, l'élection, l'échange de base et l'inondation sont des échanges actifs, donc « Terminer les échanges » calcule la convergence (juste après 40 s simulées). Les Hello périodiques, l'intervalle de mort, le rafraîchissement et l'âge maximal sont des temporisations de fond : lancer la lecture ou avancer le temps pour les observer (par exemple la perte d'un DR derrière un switch, détectée 40 s plus tard).

Configuration équivalente par le formulaire (onglet Routes d'un routeur, section « Routage à état de liens OSPF ») et par la console :

```
configure
interface ge1
ospf enable
ospf cost 30
ospf priority 100
exit
interface ge0
ospf passive
end
show ospf
show ospf database
show routes
```

## Simplifications et limites

- Zone unique 0 ; ni zones multiples, ni LSA de résumé ou externes (types 3 à 5), ni redistribution, ni authentification, ni OSPFv3.
- Réseaux à diffusion uniquement : pas de type point à point ni NBMA ; un câble direct entre deux routeurs élit aussi un DR et un BDR (comportement réel d'une interface Ethernet).
- Pas d'accusés de réception (LSAck) ni de listes de retransmission des LSA : le simulateur ne perd aucun paquet, une perte ne vient que d'une coupure, qui fait tomber l'adjacence. Seule la description de base du maître est renvoyée faute de réponse ; au-delà de trois renvois, ceux-ci deviennent des temporisations de fond.
- Échange de base en une description par côté : la base tient toujours dans un paquet (MTU annoncée 1500, non contrôlée) ; pas de bit M à 1 au-delà de l'amorce.
- Somme de contrôle des LSA, options, InfTransDelay (âge augmenté à chaque saut) et MinLSInterval (5 s entre deux instances) non modélisés : l'âge n'avance qu'avec le temps, et une nouvelle instance part dès que le contenu change.
- Identifiant de routeur non configurable et fixé au démarrage.
- Un seul chemin par destination : à coût égal, le premier trouvé est gardé (pas de partage de charge).
- Pas de retard du calcul SPF : il suit immédiatement chaque changement de la base.
- Un paquet OSPF ne déclenche jamais d'erreur ICMP.

## Correspondance OSI (pédagogique)

Ethernet (2) → IPv4 (3, protocole 89, TTL 1 vers 224.0.0.5 ou 224.0.0.6, ou unicast vers un voisin pendant l'échange de base) → OSPF (3, protocole de routage). L'inspecteur affiche l'en-tête commun (version, type, identifiant du routeur, zone) puis le corps : champs du Hello, bits et numéro de séquence de la description, LSA demandés, LSA transmis avec leurs liens ou leurs routeurs rattachés. Le journal range OSPF dans la catégorie « Routage dynamique » ; les identifiants de routeur y sont suivis du nom de l'équipement.

Le panneau d'exécution d'un routeur montre son identifiant, chaque interface OSPF (état, coût, priorité, DR et BDR élus), chaque voisin (état, rôle, priorité, instant de perte) et la base d'états des liens (séquence, âge, contenu) ; `show ospf`, `show ospf database` et `show routes` affichent les mêmes données dans la console.

## Tests de référence

- `packages/project/src/ospf.test.ts` : bornes du coût et de la priorité, modes et retrait, refus (équipement, port, interface sans adresse, valeurs hors bornes), avertissement après retrait d'une adresse, console équivalente aux formulaires, configuration rejouable sans valeurs par défaut répétées.
- `packages/project/src/migration.test.ts` : migration v8 → v9 sans OSPF, RIP conservé.
- `packages/engine/src/ospf.test.ts` : élection (priorité, identifiant, priorité 0, sans préemption), comparaison d'instances, plus court chemin calculé à la main (lien à sens unique, MaxAge) ; triangle de référence (voisinages pleins, base identique sur les trois routeurs, route de coût 30 par R2 plutôt que 40 en direct, ping TTL 61) ; Hello déclenché puis attente de 40 s et élection en deux temps ; paquets conformes (groupe, TTL, taille, maître) ; coupure (voisin perdu aussitôt, LSA réseau retiré, détour, retour du chemin court après l'attente) ; masques différents ; rafraîchissement à 30 min ; réseau à diffusion (DR par priorité, BDR par identifiant, 2-Way entre DR Other, inondation vers 224.0.0.6 et 224.0.0.5, trafic direct sans passer par le DR) ; perte du DR détectée après 40 s et nouvelle élection ; déterminisme.
- `packages/engine/src/evaluation.test.ts` : OSPF protégé par la fonction « routes » ; ping noté après l'attente et l'échange de base.
- `apps/web/src/i18n/simulation.test.ts` : chaque décision OSPF expliquée aux deux niveaux sur des traces réelles (coupure et rétablissement, perte du DR suivie de l'âge maximal, rafraîchissement, masques différents), phrases attendues, inspecteur.
- `apps/web/e2e/ospf.spec.ts` : convergence, panneau d'exécution, `show routes`, `show ospf`, `show ospf database`, coupure et détour, inspecteur ; élection sur réseau à diffusion ; formulaire de l'onglet Routes et console équivalents.
