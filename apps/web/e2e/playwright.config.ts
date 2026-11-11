import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours navigateur essentiels. En CI : Chromium installé par Playwright.
 * En local sans téléchargement de navigateur : PLAYWRIGHT_CHANNEL=msedge
 * (ou chrome) utilise le navigateur déjà installé.
 */
const channel = process.env["PLAYWRIGHT_CHANNEL"];
const isCi = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: isCi ? 1 : 0,
  reporter: isCi ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  // Mesures de performance et parcours de compte : configurations dédiées (perf, accounts).
  testIgnore: ["**/perf.spec.ts", "**/accounts.spec.ts"],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: "pnpm dev",
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: !isCi,
    timeout: 60_000,
  },
});
