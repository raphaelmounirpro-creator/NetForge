# NetForge

Laboratoire web pédagogique de simulation de réseaux pour la formation de techniciens télécom : cuivre, Ethernet/IP, fibre optique, FTTH et réseaux d'entreprise.

> **État actuel : phase 0 (socle technique).** Aucune simulation n'est encore disponible. Le dépôt contient le monorepo, une page d'accueil, l'API de santé, la base PostgreSQL locale avec une première migration et l'intégration continue. Suivi détaillé : [docs/PROGRESS.md](docs/PROGRESS.md).

## Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Node.js | 26.x (LTS) | Fichier `.nvmrc` |
| pnpm | 12.18.0 | `npm install -g pnpm@12.18.0` (Node 26 n'inclut plus Corepack) |
| PostgreSQL 18 | facultatif | Docker **ou** base embarquée fournie (voir ci-dessous) |

Aucun compte ni service payant n'est nécessaire.

## Installation

```bash
git clone https://github.com/raphaelmounirpro-creator/NetForge.git
cd NetForge
pnpm install
cp apps/api/.env.example apps/api/.env
```

`pnpm install` n'exécute que le script d'installation du moteur de migration Prisma (liste blanche `allowBuilds` dans `pnpm-workspace.yaml`).

## Laboratoire local sans API ni base

```bash
pnpm dev:web
```

Ouvre http://localhost:5173. L'interface fonctionne sans l'API ni PostgreSQL ; le panneau « État des services locaux » l'indique.

## Base PostgreSQL locale

Deux options équivalentes, toutes deux sur le port 5432 avec les identifiants de `apps/api/.env.example` (développement uniquement) :

- **Docker Compose** : `pnpm db:up` (arrêt : `pnpm db:down`). Image `postgres:18.6-alpine`.
- **Sans Docker ni droits administrateur** : `pnpm db:local` (garder le terminal ouvert, Ctrl+C pour arrêter). Lance un vrai PostgreSQL 18.6 depuis le paquet npm `embedded-postgres` ; données dans `apps/api/.local-db/`.

N'utiliser qu'une option à la fois (même port). Pour changer de port, modifier `DATABASE_URL` dans `apps/api/.env`.

> **Windows** : les binaires PostgreSQL ne gèrent pas les chemins de plus de 260 caractères. Avec `pnpm db:local`, cloner le dépôt dans un chemin court (moins de 80 caractères, par exemple `C:\dev\NetForge`) ; le script avertit sinon.

### Migrations

```bash
pnpm db:migrate                               # applique les migrations existantes
pnpm --filter @netforge/api db:status         # état des migrations
pnpm --filter @netforge/api db:migrate:dev    # crée une migration (développement)
```

## Lancement complet

```bash
pnpm db:local      # ou pnpm db:up, dans un premier terminal
pnpm db:migrate
pnpm dev           # interface + API
```

| Service | Adresse |
|---|---|
| Interface | http://localhost:5173 |
| API (vivacité du processus) | http://localhost:3000/api/health |
| API (préparation, base comprise) | http://localhost:3000/api/health/ready — 200 si prête, 503 sinon |

En développement, l'interface relaie `/api` vers l'API (même origine).

## Vérifications

```bash
pnpm lint        # ESLint (règles strictes avec types)
pnpm typecheck   # TypeScript strict sur tous les paquets
pnpm test        # Vitest (moteur, contrats, interface, API)
pnpm build       # builds de production
pnpm check       # les quatre à la suite
```

## Structure

```
apps/web            Interface React + Vite + Tailwind CSS
apps/api            API REST NestJS + Prisma (PostgreSQL)
packages/engine     Moteur de simulation (sans React, NestJS, DOM ni IndexedDB)
packages/contracts  Schémas Zod partagés (contrats validés à l'exécution)
docs/               Suivi, feuille de route, décisions, design, protocoles
```

## Limites actuelles

- Pas encore d'éditeur de topologie, de simulation, de comptes ni de déploiement.
- Le moteur ne contient que l'unité de temps simulé (nanosecondes entières).
- Le visuel de connexion attend les fichiers de référence (maquette et photo) : voir [docs/DESIGN.md](docs/DESIGN.md).

## Documentation

[AGENTS.md](AGENTS.md) (règles de développement) · [Feuille de route](docs/ROADMAP.md) · [Décisions](docs/DECISIONS.md) · [Design](docs/DESIGN.md) · [Protocoles](docs/protocols/README.md)

## Licence

Non choisie. Aucune licence n'est accordée tant qu'elle n'a pas été décidée explicitement (voir la feuille de route, K-04).
