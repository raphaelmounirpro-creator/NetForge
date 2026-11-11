# Moteur : temps, événements, déterminisme et limites

Niveau : socle d'exécution (pas un protocole réseau).

Code : [packages/engine/src](../../packages/engine/src) — `time.ts`, `queue.ts`, `prng.ts`, `simulation.ts`, `parameters.ts`, `host.ts` (adaptateur), `protocol.ts` (messages du Worker).

## Références (consultées le 2026-11-11)

- D. Blackman et S. Vigna, code de référence de xoshiro128** (2018) — https://prng.di.unimi.it/xoshiro128starstar.c : fonction `next()` (sortie `rotl(s[1] * 5, 7) * 9`, puis mise à jour de l'état). L'implémentation 32 bits du moteur est comparée dans les tests à une transcription indépendante en entiers BigInt.

## Fonctionnement

- **Temps virtuel** en nanosecondes entières (D-008), indépendant de l'horloge réelle. Une expiration de 4 h se teste en quelques millisecondes.
- **File d'événements** ordonnée par instant puis par numéro d'ordre attribué à la programmation : deux événements simultanés sont toujours traités dans le même ordre. Chaque décision de la trace porte le numéro de son événement et celui de l'événement qui l'a causé.
- **Déterminisme** : même document, mêmes paramètres, même graine et mêmes commandes aux mêmes instants donnent la même trace (vérifié, y compris en rejouant le journal des commandes et en mélangeant l'ordre des équipements du document). La seule source d'aléa est le générateur à graine (identifiants ICMP et IP) ; aucun `Date.now()` ni `Math.random()`.
- **Commandes** (ping, coupure de câble) : validées à la réception, puis appliquées à l'instant simulé courant ; l'adaptateur traite aussitôt les événements de cet instant.
- **Exécution par lots** : `run` jusqu'à un horizon, un budget d'événements ou l'inactivité ; `step` jusqu'à la prochaine décision observable. Le découpage ne change pas le résultat (vérifié).
- **Réinitialisation** : nouveau moteur à partir de la configuration actuelle du projet ; paquets, événements, caches, tables apprises et compteurs sont vidés ; topologie, configuration et disposition sont conservées.

## Limites d'exécution

| Limite | Valeur par défaut | Effet |
|---|---|---|
| Événements en attente | 100 000 | Interruption propre (`limit.pending-events`) |
| Événements traités | 2 000 000 | Interruption propre (`limit.events`) |
| Temps simulé | ≈ 104 jours | Interruption propre (`limit.time`) |
| Pings simultanés | 16 | Commande refusée |
| Calcul de « Terminer les échanges » | 10 s réelles | Pause expliquée, calcul reprenable |

Une interruption termine l'événement en cours, n'en calcule aucun autre et explique la limite atteinte et le nombre d'événements restés non calculés. Aucun résultat n'est modifié silencieusement.

## Exécution dans le navigateur

Le moteur tourne dans un Web Worker ([simulation.worker.ts](../../apps/web/src/features/simulation/simulation.worker.ts)). Les messages sont versionnés (`PROTOCOL_VERSION`), validés par Zod à la réception, corrélés par identifiant et suivis d'un accusé ou d'une erreur. Les mises à jour sont envoyées par lots : décisions nouvelles et seules tables modifiées. Pendant un calcul intensif, au plus une mise à jour par 100 ms. Le journal affiché est limité (2 000 décisions conservées, 100 rendues d'emblée), avec le nombre de décisions masquées. Le moteur, lui, calcule tout.

La vitesse d'observation (×1, ×10, ×100) ne fait que choisir jusqu'où calculer à chaque intervalle réel : elle ne ralentit pas le moteur et ne change aucun résultat.

## Tests de référence

- [determinism.test.ts](../../packages/engine/src/determinism.test.ts) : même trace, rejeu du journal, graine, ordre du document, causalité, limites, lots, pas à pas.
- [host.test.ts](../../packages/engine/src/host.test.ts) : protocole, accusés dans l'ordre, équivalence avec l'appel direct, lecture et pause, regroupement sans perte, budget de calcul.
- [core.test.ts](../../packages/engine/src/core.test.ts) : générateur (référence BigInt), file d'événements (tri stable de référence).
