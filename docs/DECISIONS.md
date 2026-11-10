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
