import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 ne charge plus .env automatiquement : chargement local facultatif,
// sans dépendance (Node ≥ 20.12). En CI ou en production, les variables
// d'environnement sont fournies directement.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const databaseUrl = process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // « prisma generate » n'a pas besoin de la base : l'URL n'est exigée que
  // par les commandes de migration, qui échouent alors avec un message clair.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
