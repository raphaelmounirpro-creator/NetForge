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
- Pas de bibliothèque d'une phase lointaine (Konva, Zustand, xterm.js, Recharts, Playwright arrivent avec leur phase).

## Architecture

| Paquet | Rôle | Règles |
|---|---|---|
| `packages/engine` | Moteur à événements discrets | Aucune dépendance à React, NestJS, DOM, IndexedDB. Pas de `Date.now()` ni `Math.random()` dans la logique simulée. Temps en nanosecondes entières (`SimTime`). |
| `packages/contracts` | Schémas Zod partagés | Source unique des contrats validés à l'exécution (API, imports, messages Worker). |
| `apps/web` | Client React/Vite | Exprime des intentions et affiche les résultats du moteur ; ne décide jamais d'un résultat réseau. |
| `apps/api` | NestJS + Prisma | Logique métier dans les services, jamais dans les contrôleurs. Configuration validée au démarrage (`loadConfig`). |

- Les paquets exposent `src` sous la condition d'export `source` (Vite, Vitest, TypeScript de l'interface) et `dist` par défaut (exécution Node de l'API). L'API compile donc contre `dist` : `pnpm typecheck` et `pnpm dev` construisent les paquets d'abord.
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

## Conventions

- TypeScript strict (`tsconfig.base.json`) ; ESLint `strictTypeChecked` + règles React Hooks.
- Tests Vitest à côté du code (`*.test.ts`) : comportements observables, cas limites, références calculées indépendamment. Pas de test qui recopie l'implémentation.
- Commentaires en français, uniquement pour expliquer une décision utile.
- Toute simplification pédagogique est documentée dans `docs/protocols/`.
- Décisions structurantes : `docs/DECISIONS.md`. Identité visuelle : `docs/DESIGN.md` (jetons uniquement, palette Tailwind par défaut désactivée).
- Dépendances : versions exactes ; pnpm applique un délai minimal de publication — ne pas l'exempter, choisir une version plus ancienne. Scripts d'installation autorisés un par un dans `allowBuilds` après lecture.
- Couleur jamais seule porteuse d'information ; `prefers-reduced-motion` respecté ; focus visible.

## Skills

Aucun skill facultatif (UI UX Pro Max, Design Taste Frontend, GPT Taste, Humanizer, Impeccable, Stop Design Slop, Graphify) n'a été installé ni utilisé à ce jour. Leur absence ne bloque aucune phase.
