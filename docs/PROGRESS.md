# Suivi d'avancement

## Phase active : 0 — Socle technique

**État : terminée localement, en attente de validation du propriétaire.** Push GitHub reporté en fin de projet (consigne du propriétaire) : la CI n'a donc pas encore été exécutée sur GitHub.

### Critères de sortie

| Critère | État | Preuve |
|---|---|---|
| Documentation initiale (AGENTS, README, PROGRESS, ROADMAP, DECISIONS, DESIGN, protocols) | atteint | `docs/`, racine |
| Monorepo pnpm (web, api, engine, contracts) | atteint | `pnpm-workspace.yaml` |
| Page React | atteint | `apps/web`, vérifiée dans Edge à 1440/768/360 px, thèmes sombre et clair |
| API `/api/health` (vivacité) distincte de `/api/health/ready` (préparation) | atteint | tests e2e + essais réels : 200/200 base démarrée, 200/503 base arrêtée |
| Configuration PostgreSQL locale | atteint avec limite | `pnpm db:local` testé (PostgreSQL 18.6 embarqué) ; `docker-compose.yml` fourni mais **non testé** (Docker absent du poste) |
| Première migration utile | atteint | `20261110211845_init_project` (table `projects`) appliquée, `db:status` à jour |
| `.env.example` sans secret, lockfile | atteint | `apps/api/.env.example`, `pnpm-lock.yaml` |
| lint / typecheck / test / build | atteint | `pnpm check` : 18 tests réussis |
| CI minimale | atteint avec limite | `.github/workflows/ci.yml` écrit ; **non exécuté** (pas encore poussé) |
| Démarrage depuis un clone propre | à vérifier | voir ci-dessous |
| Front sans base ni API | atteint | `pnpm dev:web` seul : page fonctionnelle, API « Indisponible », base « Non vérifiable » |
| Faisabilité documentaire Vercel/NestJS/PostgreSQL | atteint | `docs/DECISIONS.md` D-012 (rien provisionné ni déployé) |
| Direction visuelle et variables communes | atteint avec limite | `docs/DESIGN.md` ; maquette et photo de référence non disponibles |

### Vérifications exécutées (2026-11-10, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge)

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (moteur 5, contrats 2, interface 5, API 6), `pnpm build` : réussis.
- `prisma migrate dev` puis `prisma migrate status` sur PostgreSQL 18.6 embarqué : réussis.
- API compilée lancée : `/api/health` 200 (`Cache-Control: no-store`, sans `X-Powered-By`), `/api/health/ready` 200 avec base, 503 en 94 ms après arrêt de la base ; journal sans URL de connexion.
- Navigateur (playwright-core + Edge, hors projet) : trois scénarios (sans API, API sans base, tout disponible), aucun débordement horizontal, ordre de focus logique, bouton désactivé pendant la vérification, aucune animation avec mouvement réduit.
- Bundle web : 313 kB (97 kB gzip), aucune variable serveur.

### Blocages et limites

- Docker absent : Docker Compose non testé localement (la CI utilise un service PostgreSQL équivalent).
- Maquette et photo de référence inaccessibles (liens ChatGPT) : à déposer dans le dépôt avant la page de connexion (phase 5).
- Le dépôt GitHub prévu existe et est **public** : tout contenu poussé sera visible. Aucune licence choisie.

### Prochaine action

Validation de la phase 0 par le propriétaire, puis phase 1 (éditeur de topologie et persistance locale).
