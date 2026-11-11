// Migrations au déploiement Vercel (dernière étape de pnpm build:vercel).
// Utilise la connexion directe de Neon (DATABASE_URL_UNPOOLED) si elle existe, sinon DATABASE_URL.
// Hors Vercel, ne fait rien : en local, pnpm db:migrate reste la commande explicite.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VERCEL !== "1") {
  console.log("Migrations : hors Vercel, aucune action (utiliser pnpm db:migrate).");
  process.exit(0);
}
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Migrations : DATABASE_URL absente. Connectez la base Neon au projet Vercel avant de déployer.");
  process.exit(1);
}
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
console.log(`Migrations : application sur l'environnement « ${process.env.VERCEL_ENV ?? "inconnu"} »…`);
// L'URL (secrète) passe par l'environnement du processus enfant, jamais par la ligne de commande ni les journaux.
execFileSync(process.execPath, [join(apiRoot, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
  cwd: apiRoot,
  env: { ...process.env, DATABASE_URL: url },
  stdio: "inherit",
});
