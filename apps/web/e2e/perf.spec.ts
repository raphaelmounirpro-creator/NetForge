import { expect, test, type Page } from "@playwright/test";

/**
 * Mesure de référence (critère M-11) : scénario versionné de 100 équipements.
 * Trois mesures séparées : calcul du moteur dans le Worker (computeMs des
 * lots), intégration des lots côté interface (mesures « nf:update-apply ») et
 * blocages du fil principal (tâches longues, rendu compris). Les seuils sont
 * dérivés d'une première mesure (docs/PROGRESS.md) avec une large marge.
 */
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

interface Metrics {
  wallMs: number;
  updates: number;
  applyTotalMs: number;
  applyMaxMs: number;
  longTasks: number[];
  computeMs: number;
}

declare global {
  interface Window {
    __netforgeLongTasks: Array<{ start: number; duration: number }>;
  }
}

async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__netforgeLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__netforgeLongTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  });
}

async function measure(page: Page, action: () => Promise<void>): Promise<Metrics> {
  const start = await page.evaluate(() => performance.now());
  await action();
  return page.evaluate((from) => {
    const applies = performance.getEntriesByName("nf:update-apply").filter((entry) => entry.startTime >= from);
    const computes = performance.getEntriesByName("nf:engine-compute").filter((entry) => entry.startTime >= from) as PerformanceMark[];
    return {
      wallMs: Math.round(performance.now() - from),
      updates: applies.length,
      applyTotalMs: Math.round(applies.reduce((sum, entry) => sum + entry.duration, 0)),
      applyMaxMs: Math.round(Math.max(0, ...applies.map((entry) => entry.duration))),
      longTasks: window.__netforgeLongTasks.filter((task) => task.start >= from).map((task) => Math.round(task.duration)),
      computeMs: Math.round(computes.reduce((sum, entry) => sum + Number(entry.detail), 0)),
    };
  }, start);
}

const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });

test("performance : 100 équipements simulés dans le Worker sans bloquer l'interface", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installObservers(page);
  await page.goto("/projets");

  const importMetrics = await measure(page, async () => {
    await page.getByTestId("import-input").setInputFiles(fixture("perf-100.nfg.json"));
    await expect(page.getByRole("region", { name: "Équipements du projet" }).getByRole("button", { name: /^SW9 / })).toBeVisible();
  });

  const loadMetrics = await measure(page, async () => {
    await page.getByRole("tab", { name: "Simulation" }).click();
    await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
  });

  // Charge : 8 pings de 4 échos entre switches d'accès différents (caches vides).
  for (let n = 1; n <= 71; n += 10) {
    await actions(page).getByLabel("Depuis").selectOption({ label: `PC${String(n)} (10.10.0.${String(n)}/24)` });
    await actions(page).getByLabel("Destination (adresse ou nom)").fill(`10.10.0.${String(n + 19)}`);
    await actions(page).getByRole("button", { name: "Lancer le ping" }).click();
  }

  const runMetrics = await measure(page, async () => {
    await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
    await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés", { timeout: 60_000 });
  });
  await page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name: "Pings" }).click();
  await expect(page.getByRole("list", { name: "Résultats des pings" }).getByText("4 envoyé(s), 4 reçu(s), 0 perdu(s) (0 % de perte)")).toHaveCount(8);

  const counters = await bar(page).textContent();
  const results = { import: importMetrics, load: loadMetrics, run: runMetrics, counters };
  await testInfo.attach("mesures-100-equipements.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(results));

  // Seuils : première mesure sur le build de production (Edge, poste de référence,
  // docs/PROGRESS.md), avec marge. Calcul 4–6 ms → 100 ms ; durée 0,12–0,14 s → 1 s ;
  // aucune tâche longue mesurée → 100 ms au plus.
  expect(runMetrics.computeMs).toBeLessThan(100);
  expect(runMetrics.wallMs).toBeLessThan(1_000);
  expect(Math.max(0, ...runMetrics.longTasks)).toBeLessThan(100);
  // Premier affichage (une fois par chargement) : ≤ 0,46 s et une tâche ≤ 109 ms → 2 s et 300 ms.
  expect(loadMetrics.wallMs).toBeLessThan(2_000);
  expect(Math.max(0, ...importMetrics.longTasks, ...loadMetrics.longTasks)).toBeLessThan(300);
});

test("performance : tempête de diffusion interrompue sans figer l'interface", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installObservers(page);
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture("switch-loop.nfg.json"));
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
  await actions(page).getByLabel("Destination (adresse ou nom)").fill("192.168.1.11");
  await actions(page).getByRole("button", { name: "Lancer le ping" }).click();

  const stormMetrics = await measure(page, async () => {
    await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
    await expect(page.getByText("Simulation interrompue", { exact: true })).toBeVisible({ timeout: 60_000 });
  });
  const counters = await bar(page).textContent();
  const results = { storm: stormMetrics, counters };
  await testInfo.attach("mesures-tempete.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(results));

  // Calcul 0,19–0,21 s → 2 s ; durée 0,34–0,45 s → 3 s ; aucune tâche longue mesurée → 100 ms au plus.
  expect(stormMetrics.computeMs).toBeLessThan(2_000);
  expect(stormMetrics.wallMs).toBeLessThan(3_000);
  expect(Math.max(0, ...stormMetrics.longTasks)).toBeLessThan(100);
});
