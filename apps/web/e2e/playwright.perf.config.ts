import { defineConfig, devices } from "@playwright/test";

/**
 * Mesures de performance (pnpm test:perf) : sur le build de production
 * servi par « vite preview », jamais sur le serveur de développement (React
 * en mode développement fausse les mesures du fil principal). Une seule
 * mesure à la fois, pour que les navigateurs ne se disputent pas le processeur.
 */
const channel = process.env["PLAYWRIGHT_CHANNEL"];

export default defineConfig({
  testDir: ".",
  testMatch: "perf.spec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    locale: "fr-FR",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort",
    cwd: "..",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
