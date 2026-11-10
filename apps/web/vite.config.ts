import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Les paquets du monorepo exposent leurs sources TypeScript sous la condition
// « source » : l'interface et ses tests les consomment sans build préalable.
const SOURCE_CONDITION = "source";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: [SOURCE_CONDITION, ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Même origine en développement : /api est relayé vers l'API NestJS locale.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  test: {
    environment: "node",
    // Les parcours navigateur (e2e/) relèvent de Playwright.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
