# Suivi d'avancement

Push GitHub reporté en fin de projet (consigne du propriétaire) : commits locaux uniquement, CI jamais exécutée sur GitHub.

## Phase 0 — Socle technique : validée par le propriétaire (2026-11-10)

Détail des preuves : commits `6b49de3` à `aff43fc`. Limites restantes : Docker Compose non testé (Docker absent du poste) ; `pnpm db:local` exige un chemin de dépôt court sous Windows.

## Phase 1 — Éditeur et persistance locale : validée par le propriétaire (2026-11-11)

Commit `8ecf05e`. Limites reportées : quota et conflits vérifiés par tests unitaires seulement ; éditeur prévu pour ≥ 1 024 px.

## Phase active : 4 — Premier laboratoire FTTH

**État : terminée localement le 2026-11-11, en attente de validation du propriétaire.**

### Périmètre retenu

- Dépend de : phase 2 (projet, éditeur) ; indépendant du moteur à événements (le bilan optique est un calcul statique).
- Inclus : équipements passifs génériques (OLT-16, ONT-1G, tiroir optique ODF-12, coupleurs 1:2 à 1:64, PBO-8, PTO, boîtier d'épissure BPE-12) à ports explicites ; fibres G.652.D et G.657.A2, câble de transport/distribution ou câble court (jarretière, intérieur, raccordement), longueurs en mètres ; connecteurs SC/LC APC/UPC ; compatibilité des connectiques (cuivre/fibre, E-13) ; chemins OLT → ONT et bilan par direction (1 490 nm descendant, 1 310 nm montant) avec contribution de chaque composant, marges, réserve d'ingénierie et limites du profil GPON classe B+ ; photomètre ; pannes simples (coupure, courbure, connecteur sale, épissure défectueuse, incompatibilité de polissage) et interventions de réparation ; exercice local de dépannage.
- Exclus : enregistrement PON (numéro de série), VLAN de service et partage de bande passante, OTDR, XGS-PON (phase 9) ; exports CSV/PDF des bilans (phase 15).
- Scénarios d'acceptation : chemin calculé à la main retrouvé à 0,01 dB ; cascade de coupleurs ; plusieurs branches ; limites de réception (sensibilité, surcharge) ; fibre coupée ; aucun double comptage d'une connexion ; exercice de dépannage terminé.
- Données : valeurs normatives vérifiées (UIT-T G.984.2 annexe A, G.652, G.657, G.671), consignées dans docs/protocols/ftth-bilan-optique.md.

### Critères de sortie (spécification §12 et §17)

| Critère | État | Preuve |
|---|---|---|
| Calculs manuels de référence | atteint | chemin ONT1 calculé à la main (24,974 dB, marge 3,026 dB dans les deux sens) retrouvé à 10⁻⁹ dB près ; contributions élément par élément dans l'ordre de chaque sens (`optics.test.ts`) ; valeurs affichées vérifiées dans le navigateur (e2e « formateur ») |
| Absence de double comptage | atteint | une connexion par extrémité de câble sur un connecteur, une épissure par équipement : 4 connexions, 7 épissures, 2 coupleurs, 6 fibres, chacun une seule fois (`optics.test.ts`) |
| Marges explicables | atteint | puissance reçue au pire cas, seuil (sensibilité + pénalité), marge, marge avant surcharge, budget disponible, réserve conseillée, contribution de chaque élément ; sensibilité insuffisante, surcharge et marge faible testées |
| Cascade, branches, fibre coupée, limites | atteint | coupleurs 1:8 puis 1:4 et trois branches ; coupure (plus de lumière en aval, lumière normale en amont) ; cascade 1:64 + 1:8 sous la sensibilité ; ONT relié directement à l'OLT en surcharge |
| Pannes simples, symptômes seuls pour l'élève | atteint | coupure, courbure, connecteur sale, épissure défectueuse, polissage APC/UPC (sans pénalité inventée) ; onglet Pannes et pertes de panne masqués en exercice (e2e) |
| Photomètre | atteint avec limite | mesure au pire cas, écart au bilan égal à la perte de panne, descendant et montant ; source lumineuse séparée non modélisée |
| Exercice local de dépannage | atteint | « L'abonné sans service » : mesurer, situer, mesurer de proche en proche, inspecter, nettoyer, remesurer, 100/100 (e2e) |
| Compatibilité des connectiques (E-13) | atteint avec limite | cuivre ↔ fibre refusé avec explication ; ports compatibles seuls proposés ; modules SFP reportés |
| Format et migrations | atteint | format v4 (fibres, pannes, catalogue 2) ; migration v3 → v4 et chaîne v1 → v4 testées ; format d'exercice v2 compatible v1 |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **268 tests** (format 102, moteur 101, interface 57, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **23 parcours réussis** (dont 3 de la phase 4 : formateur, éditeur, exercice).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : seuils respectés (calcul 7 ms pour 100 équipements, aucune tâche longue pendant le calcul ; tempête interrompue sans tâche longue).
- Bilan optique sur un grand PON (456 équipements, 448 chemins) : 7 ms ; mesure au photomètre : 2 ms.
- Inspection visuelle réelle (captures Edge) : vue Optique en exercice (liste des chemins, état sous chaque ONT, bilan, photomètre, inspection, intervention), thèmes sombre et clair, 1440 et 1024 px ; aucun défilement horizontal, aucune erreur console. Défauts trouvés et corrigés : topologie FTTH hors de la zone visible à l'ouverture (ajustement automatique, D-040), bilan illisible dans le panneau étroit (une grandeur par ligne), marge de conception confondue avec l'état réel en exercice (libellé explicite), liste « Équipements du projet » écrasée sous les notes par la palette allongée (sections non compressibles).
- Relecture des références : la note 1 du tableau 2 de G.652 exclut aussi les câbles de raccordement de la valeur 0,40 dB/km ; les catégories de câble ont été corrigées en conséquence et les références recalculées (D-037).

### Limites connues

- Mesures déterministes au pire cas ; affaiblissement identique à 1 310 et 1 490 nm ; épissures par fusion à alignement actif seulement ; ni réflectance, ni OTDR, ni atténuateur.
- Service PON non simulé : un ONT « conforme » a un chemin optique correct, il n'est pas enregistré (phase 9).
- Exercice FTTH : la panne reste lisible dans le fichier exporté (entraînement local, D-038).
- Modules SFP et connectique cuivre détaillée reportés (phases 9 et 12).

## Phase 3 — Observation, CLI et premier exercice : validée par le propriétaire (2026-11-11)

Commits `e868461` et `4860f4c` (rappel quand la simulation est en pause). Détail ci-dessous.

### Périmètre retenu

- Dépend de : phase 2 (moteur, trace structurée, vue Simulation).
- Inclus : inspecteur des décisions et des unités de données (champs modélisés uniquement, correspondance OSI) ; explications à deux niveaux (débutant, technique) produites depuis les faits du moteur ; suivi d'un échange de bout en bout et « Pourquoi ? » sur un écho en échec ; animation des trames issues des événements du moteur (arrêt en pause, rendu statique avec mouvement réduit) ; console d'équipement originale (modes, aide, historique, complétion, erreurs pédagogiques) utilisant les mêmes commandes métier que les formulaires ; outils PC minimaux (ping, configuration IP, table ARP) ; effacement des tables ARP/MAC ; premier exercice local guidé (observer, hypothèse, mesure, correction, nouveau test, explication) dans une page Parcours ; annotations libres (format v3) ; mini-carte et glisser-déposer depuis la palette (reportés de la phase 2).
- Exclus : traceroute et autres outils PC (phase 14) ; éditeur d'exercices et notes vérifiées côté serveur (phase 6) ; comptes (phase 5).
- Scénarios d'acceptation : suivre un écho de bout en bout (journal filtré, inspecteur, animation) ; expliquer l'échec d'un ping au niveau débutant et technique ; configurer une adresse et une route par la console puis par le formulaire et obtenir le même projet ; terminer l'exercice guidé avec plusieurs corrections valides acceptées.
- Données : exercice embarqué validé à l'exécution (Zod), progression locale à l'appareil.

### Critères de sortie (spécification §10, §13, §15.5 et §17)

| Critère | État | Preuve |
|---|---|---|
| Suivre un échange de bout en bout | atteint | « Suivre cet échange » : journal filtré, chemin en cyan sur le canevas, inspecteur, cause remontable ; e2e « suivre un échange » |
| Expliquer un échec | atteint | « Pourquoi ? » mène à la décision fautive ; deux niveaux d'explication pour chaque code ; e2e « expliquer un échec » ; `simulation.test.ts` (toutes les phrases sur des traces réelles) |
| Même comportement par CLI et formulaire | atteint | `cli.test.ts` : documents identiques (adresse, route, configuration PC), mêmes refus ; e2e « console » (adresse saisie à la console visible dans le formulaire) |
| Terminer un exercice local guidé | atteint | « Le retour manquant » : observer, hypothèse, mesure, correction par la console, nouveau test, explication, score 80/100 ; progression conservée au rechargement (e2e) ; corrections multiples acceptées (`exercise.test.ts`) |
| Inspecteur limité aux champs modélisés, couches OSI | atteint | couches Ethernet, ARP, IPv4, ICMP, datagramme recopié ; [docs/protocols](protocols/README.md) |
| Animer uniquement les échanges réels, arrêt en pause, mouvement réduit | atteint | une animation par décision `eth.transmit`, croix sur abandon (`animation.test.ts`) ; arrêt en pause ; rendu immobile avec `prefers-reduced-motion` (D-032) |
| CLI originale à modes, aide, historique, complétion, erreurs pédagogiques | atteint | [docs/cli.md](cli.md) ; 18 tests de l'interpréteur ; e2e |
| Outils PC minimaux | atteint avec limite | `ping`, `ipconfig`, `arp -a`/`-d` ; traceroute reporté |
| Annotations (E-11), mini-carte et glisser-déposer (E-12) | atteint | format v3 (`annotations.test.ts`, migrations) ; e2e « notes libres » et « glisser-déposer » |
| Interface fluide | atteint | mesures inchangées : aucune tâche longue pendant le calcul (100 équipements et tempête) |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **215 tests** (format 85, moteur 76, interface 46, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **19 parcours réussis** (phase 1 : 8, phase 2 : 5, phase 3 : 6).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : seuils respectés, 3 essais (calcul 4–7 ms, aucune tâche longue pendant le calcul ; import : une tâche de 65–95 ms).
- Inspection visuelle réelle (captures Edge) : inspecteur, niveau technique, échange suivi, animation en cours de saut, « Pourquoi ? », console, page Parcours, guide d'exercice, notes et mini-carte ; thèmes sombre et clair ; 1440 et 1024 px ; aucun défilement horizontal, aucune erreur console. Défauts corrigés : guide d'exercice qui écrasait le canevas (déplacé dans le panneau droit), mini-carte trop envahissante sur un canevas étroit (masquée sous 640 px), invite de console non annoncée (désormais dans le nom accessible du champ).

### Limites connues

- Un seul exercice embarqué ; correction locale, non vérifiée par un serveur (phase 6).
- Pas de traceroute ni de ping depuis un routeur ; console disponible seulement dans la vue Simulation.
- Une note ajoutée au centre de la vue peut recouvrir un équipement (déplaçable à la souris ou aux flèches).
- Bundle web : 908 kB (274 kB gzip) + Worker 145 kB ; la correction des exercices embarque le moteur côté interface. Avertissement Vite conservé.
- Docker Compose toujours non testé ; CI jamais exécutée (pas de push).

### Prochaine action

Validation de la phase 3 par le propriétaire, puis phase 4 (premier laboratoire FTTH : bilan optique, photomètre, pannes simples, exercice de dépannage).

## Phase 2 — Moteur LAN puis routage statique : validée par le propriétaire (2026-11-11)

Commits `5332c15` et `b599f4b` (pertes et erreurs en rouge, demandé pendant la validation). Détail ci-dessous.

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
| Pertes et erreurs mises en évidence (demande du propriétaire, 2026-11-11) | atteint | journal et bilans de ping en rouge avec symbole « ✕ » et texte, filtre « Pertes et erreurs uniquement » ; `simulation.test.ts` (classement sur des traces réelles), e2e « routage statique » |
| Caches et tables observables | atteint | panneau « État d'exécution » (interfaces, table MAC, cache ARP, résolutions en cours, table de routage avec routes inactives) ; e2e |
| Trace structurée | atteint | événement, cause, instant, équipement, port, échange, code stable, paramètres, unité de données ; phrase française pour chaque code (`simulation.test.ts` de l'interface, sur des traces réelles) |
| Limites d'exécution | atteint | interruption propre et expliquée (événements en attente, total, temps simulé) ; budget de calcul de « Terminer » ; journal affiché limité avec compteur |
| Absence de blocage de l'interface | atteint | moteur dans un Web Worker ; aucune tâche longue (> 50 ms) du fil principal pendant le calcul, sur le build de production (mesures ci-dessous) |
| Deux sous-étapes : LAN puis deux sous-réseaux via routeur | atteint | scénarios `lanScenario`, `routedScenario`, `twoRoutersScenario` (packages/engine/src/scenarios.ts) |
| Modification pendant la simulation : arrêt et réinitialisation | atteint | D-022 ; e2e « routage statique » (bannière, commandes bloquées, réinitialisation avec la nouvelle configuration) |
| Une seule simulation active | atteint | D-027 ; test unitaire de mise en pause au changement de projet |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157.0.4341.42)

- `pnpm check` : lint, typecheck, **173 tests** (format 61, moteur 63, interface 41, contrats 2, API 6) et builds réussis.
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
