import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Condition « source » : les tests consomment les paquets du monorepo sans build.
const conditions = ["source", ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
  },
});
