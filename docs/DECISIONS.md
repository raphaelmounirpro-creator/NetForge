# Décisions structurantes

Format : contexte → décision → conséquences. Les informations évolutives sont datées.

## D-001 — Node 26 LTS et pnpm 12 (2026-11-10)

Node 26.13 (LTS « Lithium ») est installé sur le poste de référence. Node 26 ne fournit plus Corepack : pnpm 12.18.0 est installé globalement via npm et épinglé par `packageManager`. `engines` impose Node 26 et pnpm 12.

## D-002 — TypeScript 6.0, pas 7.0 (2026-11-10)

TypeScript 7.0.2 (portage natif) est publié, mais `typescript-eslint` 8.72 exige `typescript <6.1`. TypeScript 6.0.3 est retenu pour conserver le lint avec information de type. À réévaluer quand `typescript-eslint` prendra en charge la 7.

## D-003 — NestJS 12 en modules ES

NestJS 12 est publié en ESM (`"type": "module"`). L'API est donc en ESM (`module: NodeNext`, imports suffixés `.js`). Build et surveillance via la CLI Nest (compilateur `tsc`).

## D-004 — Prisma 7 avec adaptateur `pg`

Prisma 7.10.1 (stable ; la 8.0 est encore en version candidate). Générateur `prisma-client` (ESM), adaptateur `@prisma/adapter-pg`, URL fournie par `prisma.config.ts`. Prisma 7 ne lit plus `.env` : chargement local facultatif par `process.loadEnvFile` (Node natif), sans dépendance `dotenv`. La connexion est paresseuse : l'API démarre sans base.

## D-005 — Zod, mécanisme unique de validation à l'exécution

Zod 4 valide la configuration de l'API et les contrats partagés (`packages/contracts`), consommés par l'API et l'interface. Les futurs imports `.nfg.json`, DTO et messages Worker utiliseront le même mécanisme, sans définitions parallèles (pas de `class-validator`).

## D-006 — Condition d'export `source` pour les paquets internes

Les paquets exposent `src/*.ts` sous la condition `source` et `dist/*.js` par défaut. Vite, Vitest et le typage de l'interface consomment les sources sans build ; Node (API) exécute `dist`. Évite un build préalable pour l'interface et les tests, sans exposer de TypeScript à Node.

## D-007 — PostgreSQL local : Docker Compose et alternative embarquée

Docker est requis par la spécification mais absent du poste de référence (pas de droits d'installation garantis). Deux options équivalentes :
- `docker-compose.yml` (`postgres:18.6-alpine`) ;
- `pnpm db:local` : vrai PostgreSQL 18.6 issu du paquet npm `embedded-postgres` (licence MIT, binaires officiels empaquetés), sans Docker ni administrateur.

Même port, mêmes identifiants. La CI utilise un service `postgres:18.6-alpine`. Divergence assumée : l'option embarquée est un confort de développement, jamais un hébergement.

## D-008 — Temps simulé en nanosecondes entières

Unité interne unique : la nanoseconde, dans un `number` entier sûr. Représente les délais de sérialisation (64 octets à 1 Gb/s = 512 ns) et de propagation. Plage : 0 à `Number.MAX_SAFE_INTEGER` ns ≈ 104 jours simulés, suffisant pour les temporisations pédagogiques (ARP, MAC, baux DHCP de plusieurs jours). Toute conversion arrondit à la nanoseconde et refuse les valeurs hors plage (`RangeError`). Alternative écartée : microsecondes (plage plus large mais délais sub-microseconde perdus).

## D-009 — Vivacité et préparation distinctes

`GET /api/health` ne dépend d'aucun service (200). `GET /api/health/ready` interroge PostgreSQL (`SELECT 1`, connexion ≤ 2 s, requête ≤ 3 s) : 200 `ready` ou 503 `not_ready`. Réponses `Cache-Control: no-store`. Les journaux ne contiennent ni URL de connexion ni pile.

## D-010 — Vitest partout, métadonnées de décorateurs par Oxc

Vitest 5 (sur Vite 8) teste moteur, contrats, interface et API. Le transformeur Oxc de Vite 8 émet les métadonnées de décorateurs nécessaires à l'injection NestJS (`oxc.decorator.legacy` + `emitDecoratorMetadata`) : pas de SWC ni de Jest.

## D-011 — Chaîne d'approvisionnement des dépendances

pnpm 12 refuse les versions publiées depuis moins d'un jour et bloque les scripts d'installation. Politique : versions exactes ; une version trop récente est remplacée par une version plus ancienne, sans exemption ; scripts autorisés un par un après lecture (`allowBuilds`). Seul `@prisma/engines` est autorisé (téléchargement du moteur de migration officiel). Actions GitHub épinglées par SHA.

## D-012 — Faisabilité Vercel / NestJS / PostgreSQL (vérification documentaire du 2026-11-10)

Rien n'a été provisionné ni déployé. Constats :

- **NestJS sur Vercel** : prise en charge sans configuration ; l'application devient une seule Vercel Function sur Fluid compute ; point d'entrée détecté `src/main.ts` ; taille de bundle limitée à 250 Mo ([doc NestJS, mise à jour 2026-08-10](https://vercel.com/docs/frameworks/backend/nestjs)).
- **Offre Hobby** ([limites, mise à jour 2026-09-16](https://vercel.com/docs/limits)) : durée maximale d'une fonction 300 s (défaut et plafond), 2 Go / 1 vCPU, journaux d'exécution conservés 1 h ; un projet Hobby ne peut pas être relié à un dépôt appartenant à une organisation Git (le dépôt prévu est sous un compte personnel). L'offre Hobby est destinée à un usage personnel non commercial : à confirmer dans les conditions Vercel avant publication.
- **PostgreSQL** : Vercel ne fournit plus de base directement ; passage par la Marketplace (Neon notamment). Offre gratuite Neon ([FAQ, mise à jour 2026-11-03](https://neon.com/faqs/free-plan-limits-and-quotas)) : 1 Go par projet, 100 CU-heures par projet et par mois, mise en veille après 5 min d'inactivité (non désactivable), 5 Go de transfert public par mois ; pas de facturation de dépassement — écritures refusées ou calcul suspendu jusqu'au mois suivant. Un compte créé via la Marketplace Vercel peut relever d'une offre historique différente : vérifier au provisionnement.
- **Conséquences pour la phase 5** : interface statique et API dans deux projets Vercel du même dépôt avec réécriture `/api` (même origine pour les cookies) ou projet unique — à trancher et tester ; chaîne de connexion poolée pour les fonctions ; migrations hors fonctions (`prisma migrate deploy`) ; compteurs anti-abus partagés en PostgreSQL ; envoi de courriel attendu avant réponse (pas de tâche en mémoire après réponse) ; mise en veille Neon = latence au premier appel.
- **Projet Vercel existant** : https://netforge-amber.vercel.app (constaté le 2026-11-10) sert une page statique provisoire publiée hors de ce dépôt (« Projet en préparation »), sans API (`/api/health` → 404). À réutiliser lors de la publication, sans créer de doublon ; sa liaison au dépôt GitHub reste à vérifier dans le compte Vercel.
- **Obstacle structurel** : aucun identifié pour conserver la stack. Points à vérifier avant la phase 5 : réécriture vers un autre projet et cookies `__Host-`, fenêtre de 300 s pour l'évaluation serveur bornée (phase 6).

## D-013 — Thème sombre par défaut, jetons `light-dark()`

Le bleu nuit est l'identité ; le thème clair est proposé par un bouton et mémorisé localement (`localStorage`, préférence d'affichage seulement). Chaque couleur est définie une fois avec `light-dark()` et basculée par `color-scheme`. La palette Tailwind par défaut est désactivée pour imposer les jetons sémantiques.

## D-014 — Table `projects` préparée sans exposition

La première migration crée `projects` (UUID, nom, version de schéma, contenu JSONB, révision, horodatages). Aucune route ne l'expose avant les comptes et contrôles d'accès (phase 5), qui ajouteront le propriétaire par migration.

## D-015 — Paquet `@netforge/project` : modèle et commandes partagés (phase 1)

Le format `.nfg.json` (schéma Zod, limites, intégrité, migrations), le catalogue d'équipements, l'IPv4 et les commandes d'édition vivent dans un paquet sans React ni stockage. Les formulaires l'utilisent dès maintenant ; la CLI (phase 3), le moteur (phase 2) et le serveur (validation des imports, phase 5) l'utiliseront. Chaque commande est pure, renvoie un nouveau document ou des erreurs, et valide le document produit : une erreur nouvelle refuse la commande, ce qui garantit qu'un document en mémoire n'a jamais d'erreur d'intégrité. Les problèmes sont des codes stables avec paramètres ; le texte français est produit par l'interface (i18n).

## D-016 — Format `.nfg.json` v1

Sections séparées : `metadata`, `topology` (équipements, liens), `configurations` (par équipement et par port), `layout` (positions). Les ports ne sont pas stockés : ils découlent du modèle (`models.catalog` versionne le catalogue). Objets stricts (champ inconnu refusé), identifiants restreints à `[A-Za-z0-9_-]`, clés `__proto__`/`constructor`/`prototype` refusées partout, 5 Mo, profondeur 16, 200 000 nœuds, 500 équipements, 1 000 liens. Version future refusée explicitement ; les migrations sont une table explicite (vide tant que seule la v1 existe ; la graine de simulation de la phase 2 en sera la première). Exclus : état d'exécution, sélection, zoom, historique d'édition.

## D-017 — Persistance locale : révisions, verrou d'onglet, enregistrement différé

IndexedDB (bibliothèque `idb`) ; chaque enregistrement porte une révision vérifiée dans la même transaction que l'écriture : une version enregistrée ailleurs n'est jamais écrasée (conflit explicite : copie, export ou rechargement). Un verrou Web Locks par projet donne un seul onglet éditeur ; les autres sont en lecture seule avec « Prendre la main ». Enregistrement automatique 400 ms après la dernière modification, immédiat quand l'onglet est masqué ; avertissement du navigateur avant de quitter avec des modifications en attente. Les données relues depuis IndexedDB repassent par la validation (donnée externe). Les onglets ouverts sont mémorisés dans `localStorage` (confort) pour la récupération après fermeture.

## D-018 — Annuler/rétablir par instantanés

Historique d'édition par projet : pile des documents précédents (100 au plus), en mémoire de session. Les documents sont immuables, donc le coût mémoire est partagé entre instantanés. Distinct de l'historique de simulation (phase 2+).

## D-019 — Navigation sans bibliothèque de routage

Deux pages (`/laboratoire`, `/projets`) : un routeur de 40 lignes sur l'API History suffit (liens natifs conservés). `/` ouvre directement le laboratoire (accès invité). À reconsidérer si les pages se multiplient (comptes, parcours).

## D-020 — Compatibilité des connectiques reportée

Avec une seule connectique (RJ45), la règle « même connectique » était toujours vraie (signalé par le lint). Elle est retirée plutôt que conservée comme abstraction anticipée ; les règles de liaison actuelles sont : ports existants, libres, sur deux équipements distincts. La compatibilité reviendra avec la fibre (phase 4, F-01).

## D-021 — Tests navigateur Playwright

Playwright 1.64 (`apps/web/e2e`). En CI : Chromium installé par Playwright. En local, `PLAYWRIGHT_CHANNEL=msedge` (ou `chrome`) réutilise un navigateur déjà installé, sans téléchargement.

## D-022 — Modification du projet pendant la simulation : réinitialisation demandée

La vue Simulation compare l'empreinte du réseau chargé dans le moteur (topologie et configurations, clés triées) à celle du projet. Déplacer un symbole, zoomer ou renommer le projet ne la change pas. Toute autre modification met la simulation en pause, bloque ses commandes et demande « Réinitialiser avec la nouvelle configuration » : le moteur n'est jamais modifié en cours d'exécution et aucun événement devenu invalide n'est repris. La réinitialisation recharge la configuration actuelle (même graine).

## D-023 — Moteur fondé sur `@netforge/project`, adresses MAC dérivées

Le moteur lit le format et le catalogue du paquet `project` (une seule définition des ports, de l'IPv4 et de la validation) ; il refuse un document comportant des erreurs. Le projet ne stocke pas d'adresse MAC : chaque port reçoit une adresse administrée localement dérivée de son identifiant (stable d'une session à l'autre ; collisions résolues dans un ordre trié). La graine de simulation n'est pas enregistrée dans le projet (contrairement à ce qu'envisageait D-016) : elle est fixe dans l'interface (1) et affichée ; elle reste un paramètre du moteur pour les tests et les futures évaluations.

## D-024 — Format `.nfg.json` v2 : routes statiques

Première migration réelle : la v2 ajoute `staticRoutes` (destination, préfixe, prochain saut ; 64 au plus) à chaque configuration. Les fichiers v1 sont migrés à l'import comme à la lecture d'IndexedDB (liste vide), sans modifier la valeur d'origine ; une version 2 sans la liste est refusée. Les routes ne se configurent que sur un routeur ; le prochain saut hors des réseaux connectés est un avertissement (route inactive), pas une erreur, pour permettre les exercices de dépannage.

## D-025 — Commandes appliquées à l'instant courant

Une commande (ping, coupure de câble) est validée puis programmée à l'instant simulé courant ; l'adaptateur traite aussitôt les événements de cet instant. Le clic a donc un effet visible même en pause (sans cela, couper un câble en pause semblait sans effet), tout en restant une frontière d'événements définie : le journal des commandes (instant + commande) permet de rejouer exactement une session.

## D-026 — Adaptateur Web Worker et projection côté interface

Le moteur s'exécute dans un Web Worker ; l'adaptateur (`packages/engine/src/host.ts`) est testé sans navigateur avec une horloge et des minuteurs simulés. Messages versionnés et validés (Zod) ; chaque requête reçoit un accusé ou une erreur corrélés. Les mises à jour ne contiennent que les décisions nouvelles et les tables modifiées ; pendant un calcul intensif, une seule par 100 ms, sans perte (le tampon part avec la mise à jour suivante, quelle qu'elle soit). L'interface conserve une projection (Zustand) qui garde ses références quand rien ne change, construit l'index des noms une fois par chargement et diffère le rendu du journal (`useDeferredValue`, 100 lignes rendues d'emblée, `content-visibility`) : mesuré, ce rendu était la cause principale de blocage du fil principal.

## D-027 — Une seule simulation active

Le moteur est rattaché à un projet ouvert. Changer de projet actif met sa simulation en pause avec un message ; la vue Simulation d'un autre projet propose explicitement de la remplacer. Fermer le projet simulé arrête le Worker. Les sessions de simulation ne sont pas enregistrées (état d'exécution, D-016).

## D-028 — Mini-carte et glisser-déposer reportés en phase 3

E-12 était prévue en phase 2 « pour le scénario de 100 équipements ». La mesure montre que ce scénario s'affiche et se simule sans difficulté avec le zoom et « Ajuster à la topologie » ; la mini-carte sera plus utile avec les animations de la phase 3, qui l'accompagne. Report explicite, inscrit dans la feuille de route.

## D-029 — Mesures de performance séparées des parcours fonctionnels

`pnpm test:perf` (Playwright, configuration `e2e/playwright.perf.config.ts`, build de production servi par `vite preview`, une mesure à la fois) mesure séparément le calcul du moteur dans le Worker, l'intégration des lots et les tâches longues du fil principal (rendu compris) sur le scénario de 100 équipements et sur une tempête de diffusion ; `pnpm perf:engine` mesure le moteur seul dans Node. Les seuils, tirés d'une première mesure sur le poste de référence avec une marge, sont consignés dans `docs/PROGRESS.md`. Ces mesures dépendent de la machine : elles ne font pas partie de `pnpm test:e2e` ni de la CI.

## D-030 — Explications à deux niveaux produites depuis les faits du moteur

Chaque code de trace a deux gabarits français : débutant (ce qui se passe) et technique (mécanisme, valeurs, référence RFC vérifiée). Les deux sont remplis avec les mêmes paramètres du moteur ; aucune IA ni aucun texte libre n'intervient. « Pourquoi ? » sur un écho en échec suit son échange et inspecte la première perte ou erreur rencontrée, à défaut le constat du ping.

## D-031 — Console : interpréteur pur et composant React plutôt que xterm.js

L'interpréteur (`packages/project/src/cli.ts`) est pur et renvoie des intentions : les modifications passent par les commandes métier des formulaires (équivalence testée), les demandes d'exécution par le moteur. L'affichage est un composant React (journal `role="log"`, champ natif) : accessible aux lecteurs d'écran, sans dépendance de 300 ko. xterm.js, envisagé dans la feuille de route, n'est pas nécessaire tant que la console ne gère ni couleurs ANSI ni plein écran. Tab ne complète que sur une ligne non vide, pour ne pas piéger le focus.

## D-032 — Animations : couche visuelle indépendante du temps simulé

Les trames sont animées à partir des seules décisions `eth.transmit` reçues, un « saut » visuel (500 ms) par événement moteur, les copies d'une inondation partant ensemble. Si l'affichage prend plus de 2,5 s de retard, les animations non commencées sont abandonnées : le moteur n'est jamais ralenti et le journal reste complet. En pause, le mouvement s'arrête (un pas à pas anime seulement son propre lot) ; avec `prefers-reduced-motion`, les trames du dernier lot sont affichées immobiles, avec leur sens.

## D-033 — Exercices : format validé, critères comportementaux, progression locale

Format `netforge-exercise` v1 (Zod, `packages/engine/src/exercise.ts`) : énoncé, objectif, topologie initiale (validée comme un `.nfg.json`), étapes (observer, hypothèse, mesure, correction, nouveau test, explication), indices et pénalité. La correction rejoue des critères comportementaux dans des simulations neuves (graine fixe, événements bornés) : toute configuration qui produit le comportement attendu est acceptée. La progression est enregistrée sur l'appareil et relue comme une donnée externe. Entraînement local seulement : le score n'est pas une note vérifiée (phase 6). Le contenu pédagogique des exercices vit avec eux (`apps/web/src/features/exercises/catalog`), pas dans les textes d'interface.

## D-034 — Format `.nfg.json` v3 : annotations

`layout.annotations` (identifiant, texte de 280 caractères au plus, position ; 200 au plus). Migration v2 → v3 (liste vide), testée avec la chaîne v1 → v3. Les annotations font partie de la disposition : l'empreinte du réseau simulé (D-022) les ignore, donc les modifier ne demande jamais de réinitialisation. Texte rendu par Konva comme du texte, jamais interprété.

## D-035 — Format `.nfg.json` v4 : fibres, pannes, catalogue 2

Un lien porte `fiber` : longueur en mètres, type (G.652.D, G.657.A2) et catégorie de câble, ou `null` pour un câble cuivre. Le projet porte `faults` (100 au plus). Le catalogue 2 ajoute les équipements FTTH sans modifier un modèle existant. Migration v3 → v4 explicite et testée (chaîne v1 → v4) : catalogue 2, `fiber: null` sur tous les liens existants, liste de pannes vide. La validation refuse un câble entre ports de natures différentes, une fibre sur un câble cuivre (ou l'inverse) et une panne sur une cible inadaptée.

## D-036 — Réseau optique : calcul statique, hors du moteur à événements

Le bilan optique (`packages/engine/src/optics.ts`) est une fonction pure du document : chemins, contributions, marges, mesures et inspections. Les équipements optiques et les fibres sont exclus du réseau Ethernet simulé (traces identiques avec ou sans eux, testé) et de l'empreinte de simulation : régler une fibre ou injecter une panne optique ne demande jamais de réinitialiser la simulation. Le calcul tourne dans le fil principal : 7 ms pour 448 chemins (456 équipements) sur le poste de référence. Le service PON (enregistrement, bande passante) viendra en phase 9.

## D-037 — Valeurs maximales normatives, mesures au pire cas

Les pertes nominales sont les maximums vérifiés (G.652, G.657, G.671) et les profils d'émission et de réception ceux de G.984.2 annexe A, classe B+ (fiche `docs/protocols/ftth-bilan-optique.md`). Les minimums non spécifiés valent 0 dB, ce qui rend la vérification de surcharge prudente. Le photomètre affiche le pire cas (émission minimale garantie, pertes maximales, pannes comprises) : aucune valeur « typique » ni aléa n'est inventé, et l'écart au bilan de conception égale exactement la perte ajoutée par les pannes en amont. Câbles : la note 1 du tableau 2 de G.652 exclut jarretières, câbles intérieurs et câbles de raccordement de la valeur 0,40 dB/km ; ils forment la catégorie « câble court » à 1,0 dB/km (exemple cité par la note pour un câble intérieur), choix pédagogique documenté. Réserve d'ingénierie : 3 dB, choix pédagogique non normatif. Un polissage incompatible (APC/UPC) est signalé sans pénalité chiffrée.

## D-038 — Pannes : le formateur les voit, l'élève n'en voit que les symptômes

Les pannes sont des données du projet (D-035), injectées et retirées par des commandes. Les interventions de l'élève (nettoyer, remplacer une jarretière, refaire une épissure, remplacer une fibre) sont aussi des commandes : elles retirent la panne correspondante à l'endroit choisi, ou sont refusées avec l'explication « rien corrigé à cet endroit ». Pendant un exercice, l'interface masque l'onglet Pannes et la colonne des pertes de panne : l'élève voit l'état constaté par l'ONT, le bilan de conception, ses mesures et ses inspections. La panne reste lisible dans le fichier exporté : entraînement local, comme D-033.

## D-039 — Format d'exercice v2 : mesures optiques

`netforge-exercise` version 2 ajoute une observation « mesure au photomètre » (port, sens, conforme ou en écart), une réponse en dB avec tolérance (virgule ou point, unité facultative) et le critère « service optique » (tous les chemins vers l'ONT dans les limites de réception, pannes comprises). Un exercice version 1 reste valide sans changement. Le journal des mesures est un état de session, jamais exporté.

## D-040 — Ajustement de la vue à la première ouverture, liens sélectionnables au clavier

À la première ouverture d'un projet dans la session, si la vue n'a jamais été déplacée et qu'un équipement sort de la zone visible, le canevas s'ajuste à la topologie (comme « Ajuster à la topologie »). La vue Configuration permet de sélectionner un lien, donc d'ouvrir sa fiche (fibre comprise) sans le canevas ; la vue Optique propose la liste « Équipement à mesurer » comme alternative au clic sur le canevas.
