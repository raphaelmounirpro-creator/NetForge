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
  },
});
