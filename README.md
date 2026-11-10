# NetForge

Laboratoire web pédagogique de simulation de réseaux pour la formation de techniciens télécom : cuivre, Ethernet/IP, fibre optique, FTTH et réseaux d'entreprise.

> **État actuel : phase 1 (éditeur et persistance locale).** Le laboratoire invité permet de placer des PC, switches et routeurs, de les relier, de configurer l'adressage IPv4, d'annuler/rétablir, d'enregistrer automatiquement dans le navigateur et d'exporter/importer des fichiers `.nfg.json`. **Aucune simulation n'est encore disponible** (moteur : phase 2). Suivi détaillé : [docs/PROGRESS.md](docs/PROGRESS.md).

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

Ouvre http://localhost:5173 (redirigé vers `/laboratoire`). Aucun compte, aucune API ni base n'est nécessaire.

### Utilisation

1. **Nouveau projet**, puis ajout d'équipements depuis la palette (PC, Switch S-24, Routeur R-200) : ils apparaissent au centre de la vue et se déplacent à la souris ou aux flèches.
2. **Relier** : outil de liaison (touche L) puis clic sur deux équipements, ou formulaire « Relier un port libre » de l'onglet Interfaces des propriétés.
3. **Configurer** : adresse IPv4 et masque (`255.255.255.0` ou `24`) par port, passerelle par défaut des PC. Les erreurs bloquent ; les incohérences possibles (adresse en double, passerelle hors réseau) sont signalées sans bloquer, pour les exercices de dépannage.
4. **Vue Configuration** : plan d'adressage et liens en tableaux, utilisables entièrement au clavier.
5. **Enregistrement** automatique dans ce navigateur (« Enregistré localement »). Ce stockage n'est pas une sauvegarde garantie : exportez vos projets (`.nfg.json`) depuis la barre d'outils ou la page Projets.
6. **Plusieurs onglets** : un seul onglet modifie un projet ; les autres passent en lecture seule et peuvent « Prendre la main ».

Raccourcis : Ctrl+Z / Ctrl+Y, V (sélection), L (liaison), Suppr, flèches (déplacement), + / − / 0 (zoom), Échap. Liste complète : bouton « Raccourcis clavier » du laboratoire.

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
pnpm test:e2e    # parcours navigateur Playwright (lance le serveur Vite)
```

Pour `pnpm test:e2e`, installer Chromium une fois (`pnpm --filter @netforge/web exec playwright install chromium`) **ou** réutiliser un navigateur présent : `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` (ou `chrome`).

## Structure

```
apps/web            Interface React + Vite + Tailwind CSS
apps/api            API REST NestJS + Prisma (PostgreSQL)
packages/engine     Moteur de simulation (sans React, NestJS, DOM ni IndexedDB)
packages/project    Format .nfg.json, catalogue, IPv4, validation et commandes d'édition
packages/contracts  Schémas Zod des contrats d'API
docs/               Suivi, feuille de route, décisions, design, protocoles
```

## Limites actuelles

- Pas encore de simulation (ping, ARP…), de CLI, de comptes ni de déploiement.
- Éditeur conçu pour un écran d'au moins 1 024 px ; pas d'édition complète sur smartphone.
- Une seule connectique (cuivre RJ45) ; pas encore d'annotations ni de mini-carte.
- Le moteur ne contient que l'unité de temps simulé (nanosecondes entières).
- Le visuel de connexion attend les fichiers de référence (maquette et photo) : voir [docs/DESIGN.md](docs/DESIGN.md).

## Documentation

[AGENTS.md](AGENTS.md) (règles de développement) · [Feuille de route](docs/ROADMAP.md) · [Décisions](docs/DECISIONS.md) · [Design](docs/DESIGN.md) · [Protocoles](docs/protocols/README.md)

## Licence

Non choisie. Aucune licence n'est accordée tant qu'elle n'a pas été décidée explicitement (voir la feuille de route, K-04).
