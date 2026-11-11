# NetForge

Laboratoire web pédagogique de simulation de réseaux pour la formation de techniciens télécom : cuivre, Ethernet/IP, fibre optique, FTTH et réseaux d'entreprise.

> **État actuel : phase 5 terminée, en attente de validation — en ligne sur https://netforge-amber.vercel.app.** Comptes avec validation d'adresse par courrier, connexion, récupération du mot de passe, projets privés enregistrés en base avec révisions, copie volontaire des projets de l'appareil. Phase 4 : Équipements optiques (OLT, tiroir, coupleurs 1:2 à 1:64, PBO, PTO, boîtier d'épissure, ONT), fibres et connectiques, bilan optique par chemin et par sens avec la contribution de chaque élément, photomètre, inspection, pannes simples et interventions, exercice de dépannage. Phase 3 : inspecteur des décisions et des trames, explications débutant et technique, animation des trames, console des équipements, outils PC et un premier exercice guidé (page Parcours). Le laboratoire invité permet de construire et configurer un réseau (PC, switches, routeurs, adressage IPv4, routes statiques), puis de le **simuler** : ping, ARP, commutation, routage, coupure de câble, pas à pas, journal des décisions expliquées en français et tables observables (MAC, ARP, routage). Enregistrement automatique dans le navigateur, export/import `.nfg.json`. Suivi détaillé : [docs/PROGRESS.md](docs/PROGRESS.md).

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

1. **Nouveau projet**, puis ajout d'équipements depuis la palette (réseau IP : PC, Switch S-24, Routeur R-200 ; réseau optique FTTH : OLT-16, tiroir ODF-12, coupleur 1:2 à 1:64, BPE-12, PBO-8, PTO, ONT-1G) : ils apparaissent au centre de la vue et se déplacent à la souris ou aux flèches.
2. **Relier** : outil de liaison (touche L) puis clic sur deux équipements, ou formulaire « Relier un port libre » de l'onglet Interfaces (ou Ports) des propriétés. Un câble relie deux ports de même nature (cuivre ou fibre) ; la fiche d'un lien fibre règle sa longueur, son type et sa catégorie de câble.
3. **Configurer** : adresse IPv4 et masque (`255.255.255.0` ou `24`) par port, passerelle par défaut des PC, **routes statiques** des routeurs (sous-onglet Routes : réseau de destination, masque, prochain saut). Les erreurs bloquent ; les incohérences possibles (adresse en double, passerelle hors réseau, boucle de switches) sont signalées sans bloquer, pour les exercices de dépannage.
4. **Vue Configuration** : plan d'adressage, liens (sélectionnables) et routes statiques en tableaux, utilisables entièrement au clavier.
5. **Vue Simulation** : choisir un PC source et une adresse de destination puis « Lancer le ping » ; observer avec « Événement suivant » (pas à pas), « Lecture » (temps réel, ×10 ou ×100) ou « Terminer les échanges ». Le journal explique chaque décision du moteur (niveau débutant ou technique, filtres) ; cliquer une décision l'ouvre dans l'onglet « Inspection » (contexte, cause, unité de données par couche) ; « Suivre cet échange » isole un écho de bout en bout ; « Pourquoi ? » sur un écho en échec mène à la décision qui l'explique. Les trames sont animées sur les câbles (immobiles si le système demande moins d'animations). L'onglet Console donne la console des équipements ([référence](docs/cli.md)). « Couper le câble » simule une panne sans modifier le projet. Modifier le réseau pendant une simulation demande une réinitialisation.
6. **Vue Optique** : chemins OLT → ONT avec leur état, bilan descendant (1 490 nm) et montant (1 310 nm) selon le profil GPON classe B+, contributions élément par élément, marges et réserve d'ingénierie ([fiche](docs/protocols/ftth-bilan-optique.md)). Onglet Mesures : photomètre et inspection des connecteurs ; onglet Interventions : nettoyer, remplacer une jarretière, refaire une épissure, remplacer une fibre ; onglet Pannes (formateur) : injecter une coupure, une courbure, un connecteur sale, une épissure défectueuse ou un polissage incompatible.
7. **Parcours** : exercices guidés (observer, hypothèse, mesure, correction, nouveau test, explication) ; chaque exercice crée son propre projet, avec un guide en tête du panneau de droite.
8. **Notes** : « Ajouter une note » dans la palette ; glisser un équipement de la palette vers le canevas ; mini-carte en haut à droite du canevas.
9. **Enregistrement** automatique dans ce navigateur (« Enregistré localement »). Ce stockage n'est pas une sauvegarde garantie : exportez vos projets (`.nfg.json`) depuis la barre d'outils ou la page Projets.
10. **Plusieurs onglets** : un seul onglet modifie un projet ; les autres passent en lecture seule et peuvent « Prendre la main ».

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
pnpm mail:local    # boîte de courrier de développement, dans un deuxième terminal
pnpm db:migrate
pnpm dev           # interface + API
```

Copier d'abord `apps/api/.env.example` vers `apps/api/.env` (valeurs de développement, sans secret). Les courriers de validation et de récupération ne sont jamais envoyés en local : ils sont capturés et lisibles sur http://localhost:8025.

| Service | Adresse |
|---|---|
| Interface | http://localhost:5173 |
| API (vivacité du processus) | http://localhost:3000/api/health |
| API (préparation, base comprise) | http://localhost:3000/api/health/ready — 200 si prête, 503 sinon |
| Courrier de développement | http://localhost:8025 (SMTP sur 1025) |

En développement, l'interface relaie `/api` vers l'API (même origine).

## Déploiement (Vercel)

Interface statique et API (fonction unique `api/index.mjs`) sur la même origine ; build `pnpm build:vercel`, qui applique les migrations à la fin. Variables du projet Vercel (Production et Preview) : `DATABASE_URL` et `DATABASE_URL_UNPOOLED` (intégration Neon), `CSRF_SECRET` (secret), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (secret), `MAIL_FROM`, `ENABLE_EXPERIMENTAL_COREPACK=1`. `APP_ORIGIN` est déduite de l'adresse Vercel. Les secrets se saisissent dans Vercel, jamais dans le dépôt.

```bash
vercel link --project netforge   # une fois ; annuler l'ajout de .env* au .gitignore et supprimer .env.local
vercel deploy                    # prévisualisation (protégée, base de production partagée)
vercel deploy --prod             # production
```

Sous PowerShell, si l'exécution de scripts est bloquée : `vercel.cmd`. Choix et limites : [docs/DECISIONS.md](docs/DECISIONS.md) (D-048, D-049).

## Vérifications

```bash
pnpm lint        # ESLint (règles strictes avec types)
pnpm typecheck   # TypeScript strict sur tous les paquets
pnpm test        # Vitest (moteur, contrats, interface, API)
pnpm build       # builds de production
pnpm check       # les quatre à la suite
pnpm test:e2e    # parcours navigateur Playwright (lance le serveur Vite)
pnpm test:e2e:accounts # parcours de compte sur une pile isolée (PostgreSQL, courrier, API, interface)
pnpm test:perf   # mesures de performance dans le navigateur (100 équipements, tempête de diffusion)
pnpm perf:engine # mesure du moteur seul dans Node
```

Pour `pnpm test:e2e` et `pnpm test:perf`, installer Chromium une fois (`pnpm --filter @netforge/web exec playwright install chromium`) **ou** réutiliser un navigateur présent : `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` (ou `chrome`). Les seuils de performance correspondent au poste de référence décrit dans [docs/PROGRESS.md](docs/PROGRESS.md).

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

- Simulation : Ethernet, ARP, IPv4, ICMP et routage statique, à un niveau pédagogique simplifié documenté dans [docs/protocols](docs/protocols/README.md). Pas de traceroute, de VLAN, de STP, de DHCP ni de routage dynamique ; deux exercices embarqués, notés localement (notes vérifiées : phase 6).
- FTTH : bilan optique statique au pire cas ; pas de service PON simulé (enregistrement des ONT, bande passante), d'OTDR ni de modules SFP (phase 9).
- Comptes : pas de changement d'adresse, de suppression de compte ni de second facteur ; les courriers, envoyés depuis une adresse Gmail dédiée, peuvent arriver dans les indésirables. Sécurité : [docs/securite.md](docs/securite.md).
- Éditeur conçu pour un écran d'au moins 1 024 px ; pas d'édition complète sur smartphone.
- Le visuel de connexion attend les fichiers de référence (maquette et photo) : voir [docs/DESIGN.md](docs/DESIGN.md).

## Documentation

[AGENTS.md](AGENTS.md) (règles de développement) · [Console](docs/cli.md) · [Feuille de route](docs/ROADMAP.md) · [Décisions](docs/DECISIONS.md) · [Design](docs/DESIGN.md) · [Protocoles](docs/protocols/README.md)

## Licence

Non choisie. Aucune licence n'est accordée tant qu'elle n'a pas été décidée explicitement (voir la feuille de route, K-04).
