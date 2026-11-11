# Suivi d'avancement

Push GitHub reporté en fin de projet (consigne du propriétaire) : commits locaux uniquement, CI jamais exécutée sur GitHub.

## Phase 0 — Socle technique : validée par le propriétaire (2026-11-10)

Détail des preuves : commits `6b49de3` à `aff43fc`. Limites restantes : Docker Compose non testé (Docker absent du poste) ; `pnpm db:local` exige un chemin de dépôt court sous Windows.

## Phase 1 — Éditeur et persistance locale : validée par le propriétaire (2026-11-11)

Commit `8ecf05e`. Limites reportées : quota et conflits vérifiés par tests unitaires seulement ; éditeur prévu pour ≥ 1 024 px.

## Phase active : 2 — Moteur LAN puis routage statique

**État : terminée localement, en attente de validation du propriétaire.**

### Périmètre retenu

- Inclus : moteur à événements discrets (horloge virtuelle, file stable, générateur à graine, limites) ; Ethernet, commutation (apprentissage, vieillissement, inondation), ARP, IPv4, ICMP (écho, inaccessible, temps dépassé), routage statique ; ping ; coupure de câble injectée ; adaptateur Web Worker ; vue Simulation (barre, journal, pings, tables) ; routes statiques dans l'éditeur (format v2) ; avertissement de boucle de commutation ; scénario de performance de 100 équipements.
- Exclus (phases ultérieures) : animations des paquets, inspecteur de trames, explications à deux niveaux, CLI, outils PC, exercice (phase 3) ; mini-carte et glisser-déposer (reportés en phase 3, D-028) ; VLAN, STP, DHCP, DNS (phase 7) ; routage dynamique (phase 8).

### Critères de sortie (spécification §9 et §17)

| Critère | État | Preuve |
|---|---|---|
| Même sous-réseau, caches vides : ARP puis ICMP | atteint | `lan.test.ts` (ordre des décisions) ; e2e « premier parcours » (LAN construit à la main) |
| Nouveau ping avant expiration : entrée ARP réutilisée | atteint | `lan.test.ts` ; e2e « premier parcours » |
| Destination distante : route et prochain saut appropriés | atteint | `routing.test.ts` (passerelle, deux routeurs, plus long préfixe) ; e2e « routage statique » |
| Destination distante sans route ni passerelle : échec expliqué | atteint | `routing.test.ts` (PC sans passerelle, passerelle hors réseau, routeur sans route + ICMP) ; e2e « panne de câble » |
| Aller possible, retour impossible : cause identifiable | atteint | `routing.test.ts` (chez la destination et chez un routeur) ; e2e : « R2 abandonne le paquet : aucune route ne correspond à 10.0.1.10… » |
| Lien déconnecté : aucune transmission | atteint | `lan.test.ts` (câble absent, coupé, trame perdue en transit) ; e2e « panne de câble » |
| Réinitialisation puis scénario identique : même trace | atteint | `determinism.test.ts` (même graine, rejeu du journal des commandes, ordre du document) ; `host.test.ts` (réinitialisation) |
| Apprentissage et vieillissement MAC, destination inconnue, expiration ARP, TTL, sélection des routes | atteint | fiches [docs/protocols](protocols/README.md) et tests associés ; expirations testées en temps virtuel |
| Caches et tables observables | atteint | panneau « État d'exécution » (interfaces, table MAC, cache ARP, résolutions en cours, table de routage avec routes inactives) ; e2e |
| Trace structurée | atteint | événement, cause, instant, équipement, port, échange, code stable, paramètres, unité de données ; phrase française pour chaque code (`simulation.test.ts` de l'interface, sur des traces réelles) |
| Limites d'exécution | atteint | interruption propre et expliquée (événements en attente, total, temps simulé) ; budget de calcul de « Terminer » ; journal affiché limité avec compteur |
| Absence de blocage de l'interface | atteint | moteur dans un Web Worker ; aucune tâche longue (> 50 ms) du fil principal pendant le calcul, sur le build de production (mesures ci-dessous) |
| Deux sous-étapes : LAN puis deux sous-réseaux via routeur | atteint | scénarios `lanScenario`, `routedScenario`, `twoRoutersScenario` (packages/engine/src/scenarios.ts) |
| Modification pendant la simulation : arrêt et réinitialisation | atteint | D-022 ; e2e « routage statique » (bannière, commandes bloquées, réinitialisation avec la nouvelle configuration) |
| Une seule simulation active | atteint | D-027 ; test unitaire de mise en pause au changement de projet |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157.0.4341.42)

- `pnpm check` : lint, typecheck, **169 tests** (format 61, moteur 63, interface 37, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **13 parcours réussis** (8 de la phase 1, 5 de simulation).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : 2 mesures réussies, répétées 5 fois à la suite (seuils ci-dessous).
- Inspection visuelle réelle (captures Edge) de la vue Simulation : thèmes sombre et clair, 1440 et 1024 px, aucun défilement horizontal, aucune erreur console. Défauts trouvés et corrigés : tables trop larges pour le panneau, libellés de câbles tronqués, message « ping programmé » persistant, zoom absent de la barre d'outils, coupure de câble sans effet visible en pause (D-025), journal à colonnes trop étroites à 1024 px.
- Sources des fiches protocoles vérifiées en ligne le 2026-11-11 (RFC 826, 792, 894, 1122, 1812, 2644, 4188, 7042 ; documentation Microsoft de `ping` ; code de référence xoshiro128**).

### Mesures de performance (M-11) — première mesure et seuils

Poste de référence : AMD Ryzen 5 5600X (12 fils), 16 Go, Windows 11, Edge 157 (Playwright, sans interface), Node 26.13.0. Mesures sur le **build de production** servi par `vite preview`, une à la fois. Scénario versionné `performanceScenario` : 100 équipements (1 switch de cœur, 9 switches d'accès, 90 PC), 99 liens, un réseau /24. Tâche longue = tâche du fil principal de plus de 50 ms (API Long Tasks).

| Mesure | Charge | Mesuré (5 essais) | Seuil retenu |
|---|---|---|---|
| Calcul du moteur dans le Worker | 8 pings × 4 échos, caches vides (1 112 événements) | 4–6 ms | < 100 ms |
| Durée réelle de « Terminer les échanges » | idem | 0,12–0,14 s | < 1 s |
| Tâche longue du fil principal pendant le calcul | idem | aucune | < 100 ms |
| Intégration d'un lot dans l'interface | idem | ≤ 1 ms | — |
| Import du projet et chargement de la vue Simulation | une fois par chargement | ≤ 0,46 s ; une tâche de 74–109 ms à l'import | < 2 s ; < 300 ms |
| Tempête de diffusion jusqu'à la limite | boucle de 3 câbles, 92 711 événements | calcul 0,19–0,21 s ; durée 0,34–0,45 s ; aucune tâche longue | < 2 s ; < 3 s ; < 100 ms |
| Moteur seul (Node, `pnpm perf:engine`, médiane de 5) | 8 pings × 4 / 90 pings × 4 (12 510 événements) / tempête | 4,9 ms / 19,9 ms / 232 ms | indicatif |

Démarche : les premières mesures, faites sur le serveur de développement, relevaient des tâches de 392 ms (100 équipements) et 531 ms (tempête). Masquer le journal les faisait disparaître : rendu du journal à chaque lot, index des noms recalculé, canevas redessiné (corrigés, D-026). Un profil CPU a ensuite montré que le reste venait du mode développement de React : les seuils sont donc mesurés sur le build de production. Tris par nom et formatage des nombres utilisent désormais des comparateurs et formateurs partagés.

### Limites connues

- Import d'un projet de 100 équipements : une tâche d'environ 0,1 s (rendu initial du canevas), une seule fois par chargement ; plus lent en mode développement.
- Journal : 2 000 décisions conservées, 100 rendues d'emblée (bouton pour en afficher plus) ; le moteur calcule toujours tout.
- Durées de vie ARP fixes (PC 60 s, routeur 4 h) et délais forfaitaires documentés ; pas de STP, VLAN, DHCP ni routage dynamique.
- Le prochain saut d'une route statique doit être directement connecté (pas de résolution récursive) ; une route par destination.
- Les mesures de performance dépendent du poste : elles ne font pas partie de la CI.
- Docker Compose toujours non testé ; CI jamais exécutée (pas de push).
- Bundle web : 801 kB (243 kB gzip) + Worker 143 kB, avertissement Vite conservé.

### Prochaine action

Validation de la phase 2 par le propriétaire, puis phase 3 (observation : animations issues des événements, inspecteur, explications débutant/technique, CLI, outils PC, premier exercice ; mini-carte).
