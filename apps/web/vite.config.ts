import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";
import securityHeaders from "./security-headers.json" with { type: "json" };

// Les paquets du monorepo exposent leurs sources TypeScript sous la condition
// « source » : l'interface et ses tests les consomment sans build préalable.
const SOURCE_CONDITION = "source";

/** API relayée sous /api (même origine) ; autre cible pour la pile isolée des parcours de compte. */
const API_ORIGIN = process.env["NETFORGE_API_ORIGIN"] ?? "http://localhost:3000";
const proxy = { "/api": API_ORIGIN };

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
  // Moteur de simulation exécuté dans un Web Worker module (import ESM).
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    strictPort: true,
    // Même origine en développement : /api est relayé vers l'API NestJS locale.
    proxy,
  },
  // Aperçu du build de production avec les en-têtes de sécurité du déploiement (vercel.json) :
  // les parcours de performance s'exécutent donc sous la même politique de contenu.
  preview: { proxy, headers: securityHeaders },
  test: {
    environment: "node",
    // Les parcours navigateur (e2e/) relèvent de Playwright.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
