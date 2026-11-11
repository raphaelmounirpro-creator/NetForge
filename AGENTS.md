# AGENTS.md — règles durables de NetForge

Spécification produit complète : prompt « NetForge — Prompt Codex complet et corrigé » fourni par le propriétaire du projet. Ce fichier n'en retient que les règles d'exécution.

## Reprise du travail

1. Inspecter le dépôt, la branche et les modifications locales ; lire ce fichier.
2. Lire [docs/PROGRESS.md](docs/PROGRESS.md), puis le confronter au code et aux tests.
3. Reprendre au premier critère incomplet de la phase active. Ne pas revenir à la phase 0.
4. Attendre la validation du propriétaire **entre les phases**. À l'intérieur d'une phase, avancer de façon autonome.
5. Git : commit local explicite à chaque phase terminée ; **push sur GitHub uniquement en fin de projet** (consigne du propriétaire). Jamais de push forcé ni de réinitialisation destructive.

## Contraintes non négociables

- Solutions gratuites et locales. Aucun achat, abonnement, facturation ou API d'IA payante.
- Aucun service externe provisionné sans validation (conditions gratuites vérifiées et datées).
- Ne jamais inventer une installation, une source, un test réussi, une sauvegarde distante ou un déploiement.
- Aucun secret dans le code, Git, les exports ou les journaux. `.env` réels ignorés ; `.env.example` sans secret.
- Interface et documentation en français ; textes de l'interface regroupés dans `apps/web/src/i18n/`.
- Pas de bibliothèque d'une phase lointaine (xterm.js en phase 3 ; Recharts seulement quand un graphique est nécessaire).

## Architecture

| Paquet | Rôle | Règles |
|---|---|---|
| `packages/engine` | Moteur à événements discrets, protocoles, adaptateur Worker ; bilan optique statique (`optics.ts`) | Dépend de `@netforge/project` et de Zod uniquement. Aucune dépendance à React, NestJS, DOM, IndexedDB. Pas de `Date.now()` ni `Math.random()` dans la logique simulée (générateur `Prng` à graine). Temps en nanosecondes entières (`SimTime`). Décisions = codes stables (`trace.ts`) + paramètres, sans texte. L'adaptateur (`host.ts`) reçoit l'horloge réelle en paramètre et ne s'en sert que pour découper le calcul. |
| `packages/project` | Format `.nfg.json`, catalogue, IPv4, validation, commandes d'édition, interpréteur de la console | Fonctions pures. Toute modification d'un projet passe par une commande (formulaires et console : mêmes commandes, équivalence testée). Problèmes = codes stables + paramètres ; texte dans `apps/web/src/i18n`. Nouvelle version du format = migration explicite testée. |
| `packages/contracts` | Schémas Zod des contrats d'API | Source unique des contrats HTTP validés à l'exécution. |
| `apps/web` | Client React/Vite | Exprime des intentions et affiche les résultats du moteur ; ne décide jamais d'un résultat réseau. Zustand (`features/lab/store.ts`) : document du projet + état de session (sélection, vue, zoom, historique). Simulation : `features/simulation` (Worker, client corrélé, projection des lots du moteur, une seule simulation active). Stockage : `features/storage` (IndexedDB, révisions, verrou d'onglet). Optique : `features/optics` (bilan du moteur, photomètre, pannes ; pannes masquées en exercice). |
| `apps/api` | NestJS + Prisma | Logique métier dans les services, jamais dans les contrôleurs. Configuration validée au démarrage (`loadConfig`). |

- Les paquets exposent `src` sous la condition d'export `source` (Vite, Vitest, typage et lint) et `dist` par défaut (exécution Node). Seuls le build de l'API (`tsconfig.build.json`) et `pnpm dev` utilisent `dist` : ils construisent les paquets d'abord.
- API en ESM (NestJS 12) : imports relatifs suffixés `.js`.
- Prisma 7 : client généré dans `apps/api/src/generated/prisma` (ignoré par Git), URL fournie par `prisma.config.ts`.
- `/api/health` = vivacité du processus ; `/api/health/ready` = préparation (base comprise, 503 sinon).

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev:web` | Interface seule (aucune dépendance à l'API ou la base) |
| `pnpm dev` | Construit les paquets puis lance interface + API |
| `pnpm db:local` / `pnpm db:up` | PostgreSQL local sans Docker / via Docker Compose |
| `pnpm db:migrate` | Applique les migrations |
| `pnpm check` | lint + typecheck + test + build |
| `pnpm test:e2e` | Parcours Playwright (`PLAYWRIGHT_CHANNEL=msedge` en local, sans téléchargement de navigateur) |
| `pnpm test:perf` / `pnpm perf:engine` | Mesures de performance (navigateur / moteur seul), hors CI |

## Conventions

- TypeScript strict (`tsconfig.base.json`) ; ESLint `strictTypeChecked` + règles React Hooks.
- Tests Vitest à côté du code (`*.test.ts`) : comportements observables, cas limites, références calculées indépendamment. Pas de test qui recopie l'implémentation. Parcours navigateur : `apps/web/e2e` (sélecteurs par rôle et nom accessible exact).
- Textes d'interface uniquement dans `apps/web/src/i18n/fr.ts` ; aucun `dangerouslySetInnerHTML`.
- Commentaires en français, uniquement pour expliquer une décision utile.
- Toute simplification pédagogique est documentée dans `docs/protocols/` ; tout nouveau code de trace reçoit un gabarit dans `apps/web/src/i18n/fr.ts` (vérifié par `i18n/simulation.test.ts` sur des traces réelles).
- Exercices : format et critères dans `packages/engine/src/exercise.ts` (validés au chargement) ; contenu pédagogique dans `apps/web/src/features/exercises/catalog` (données, pas textes d'interface).
- Optique : valeurs de référence (pertes maximales, profils GPON) uniquement depuis des sources vérifiées et datées dans `docs/protocols/ftth-bilan-optique.md` ; mesures au pire cas, jamais de valeur « typique » inventée ; une connexion appariée comptée une fois par extrémité de câble, une épissure par équipement. Pendant un exercice, l'élève ne voit que les symptômes, jamais les pannes.
- Scénarios de référence : `packages/engine/src/scenarios.ts`. Les projets des parcours navigateur (`apps/web/e2e/fixtures`) en sont générés (`node apps/web/e2e/fixtures/generate.mjs`) ; `src/fixtures.test.ts` vérifie leur synchronisation.
- Décisions structurantes : `docs/DECISIONS.md`. Identité visuelle : `docs/DESIGN.md` (jetons uniquement, palette Tailwind par défaut désactivée).
- Dépendances : versions exactes ; pnpm applique un délai minimal de publication — ne pas l'exempter, choisir une version plus ancienne. Scripts d'installation autorisés un par un dans `allowBuilds` après lecture.
- Couleur jamais seule porteuse d'information ; `prefers-reduced-motion` respecté ; focus visible.

## Skills

Aucun skill facultatif (UI UX Pro Max, Design Taste Frontend, GPT Taste, Humanizer, Impeccable, Stop Design Slop, Graphify) n'a été installé ni utilisé à ce jour. Leur absence ne bloque aucune phase.
