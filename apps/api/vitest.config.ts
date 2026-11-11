import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Condition « source » : les tests consomment les paquets du monorepo sans build.
const conditions = ["source", ...defaultServerConditions];

export default defineConfig({
  // NestJS s'appuie sur les métadonnées de décorateurs (injection de dépendances).
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: true },
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
    // Tests du code source seulement : jamais les données PostgreSQL locales (.local-db), verrouillées par la base.
    dir: "src",
    include: ["**/*.test.ts"],
    // PostgreSQL embarqué de test, démarré une fois pour toute l'exécution.
    globalSetup: ["./src/test-support/global-setup.ts"],
    // Une seule base partagée : les fichiers de test s'exécutent l'un après l'autre.
    fileParallelism: false,
    // Argon2id (19 Mio) et démarrage de l'application : marge sur les machines lentes.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
