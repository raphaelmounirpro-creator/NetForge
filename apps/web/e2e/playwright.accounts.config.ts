import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours des comptes (pnpm test:e2e:accounts) : pile complète isolée,
 * démarrée par accounts.setup.ts (PostgreSQL embarqué, boîte de courrier,
 * API construite), interface relayant /api vers cette API. Ports dédiés :
 * l'environnement de développement (5173, 3000, 5432) n'est pas touché.
 */
const channel = process.env["PLAYWRIGHT_CHANNEL"];
const isCi = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: ".",
  testMatch: ["accounts.spec.ts", "evaluations.spec.ts"],
  timeout: 60_000,
  workers: 1,
  retries: isCi ? 1 : 0,
  reporter: isCi ? "github" : "list",
  globalSetup: "./accounts.setup.ts",
  use: {
    baseURL: "http://localhost:4174",
    locale: "fr-FR",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: "pnpm exec vite --port 4174 --strictPort",
    cwd: "..",
    url: "http://localhost:4174",
    env: { NETFORGE_API_ORIGIN: "http://localhost:3100" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
