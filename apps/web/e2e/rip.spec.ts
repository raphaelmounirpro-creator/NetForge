import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

const fixture = new URL("./fixtures/rip.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const runtime = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dock = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name, exact: true });
const log = (page: Page) => dock(page).getByRole("log");

async function line(page: Page, command: string): Promise<void> {
  await dock(page).getByRole("textbox").fill(command);
  await dock(page).getByRole("textbox").press("Enter");
}

async function finish(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: "Terminer les échanges", exact: true }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

async function openSimulation(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
}

async function consoleOf(page: Page, device: string): Promise<void> {
  await tab(page, "Console").click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: device });
}

test("RIP : convergence observable, panne, route de secours à l'annonce périodique", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await openSimulation(page);
  await finish(page);

  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  const rip = runtime(page).getByRole("region", { name: "RIP", exact: true });
  await expect(rip).toContainText("10.3.0.0/24 → 10.13.0.2");
  await expect(rip).toContainText("métrique 2 · ge2");
  await consoleOf(page, "R1");
  await line(page, "show routes");
  await expect(log(page)).toContainText("RIP, métrique 2");
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");

  // Coupure du lien direct R1–R3 : retrait immédiat de la route, visible dans le journal.
  await actions(page).getByRole("button", { name: /^Couper le câble (R1 ge2 ↔ R3 ge1|R3 ge1 ↔ R1 ge2)$/ }).click();
  await finish(page);
  await expect(rip).toContainText("inaccessible (métrique 16)");
  await tab(page, "Journal").click();
  const journal = page.getByRole("list", { name: "Journal des décisions du moteur", exact: true });
  await expect(journal).toContainText("R1 marque la route 10.3.0.0/24 par 10.13.0.2 inaccessible (interface hors service)");
  await journal.getByRole("button", { name: /R1 ge1 envoie \d+ route\(s\) RIP vers 224\.0\.0\.9/ }).first().click();
  await expect(runtime(page).getByRole("region", { name: "Message RIP", exact: true })).toContainText("2 (réponse)");
  await page.screenshot({ path: "test-results/rip-inspector-1440.png" });

  // La route de secours par R2 arrive avec l'annonce périodique (30 s simulées) : lecture accélérée.
  await runtime(page).getByRole("tab", { name: "État d'exécution", exact: true }).click();
  await bar(page).getByLabel("Vitesse d'observation").selectOption({ label: "Rapide (×100)" });
  await bar(page).getByRole("button", { name: "Lecture", exact: true }).click();
  await expect(rip).toContainText("10.3.0.0/24 → 10.12.0.2", { timeout: 10_000 });
  await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
  await expect(rip).toContainText("métrique 3 · ge1");
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("TTL 61");
  await page.screenshot({ path: "test-results/rip-runtime-1440.png" });
});

test("RIP : formulaire de l'onglet Routes et console équivalents", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  const section = propertiesPanel(page).getByRole("region", { name: "Routage dynamique RIP", exact: true });
  await expect(section.getByLabel("RIP sur ge0", { exact: true })).toHaveValue("passive");
  await section.getByLabel("RIP sur ge1", { exact: true }).selectOption("off");
  await page.screenshot({ path: "test-results/rip-form-1440.png" });

  // Sans RIP sur ge1, R1 n'apprend plus le réseau de R2 que par R3, en trois sauts.
  await openSimulation(page);
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  await expect(runtime(page).getByRole("region", { name: "RIP", exact: true })).toContainText("10.2.0.0/24 → 10.13.0.2");
  await consoleOf(page, "R1");
  await line(page, "configure");
  await line(page, "interface ge1");
  await line(page, "rip enable");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  await expect(section.getByLabel("RIP sur ge1", { exact: true })).toHaveValue("active");
});
