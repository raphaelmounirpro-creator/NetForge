import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * BGP (phase 8, tranche 4) : trois systèmes autonomes en triangle ; sessions
 * établies, chemin d'AS le plus court retenu, détour après une coupure ;
 * formulaire de l'onglet Routes et console équivalents.
 */
const fixture = new URL("./fixtures/bgp.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
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

async function load(page: Page): Promise<void> {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
}

test("BGP : sessions établies, chemin d'AS le plus court, détour par un autre AS après une coupure", async ({ page }) => {
  await load(page);
  await openSimulation(page);
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  const bgp = runtime(page).getByRole("region", { name: "BGP", exact: true });
  await expect(bgp).toContainText("AS 65001 · identifiant 10.13.0.1");
  await expect(bgp).toContainText("10.13.0.2 · AS 65003");
  await expect(bgp.getByText("● Established · attend la connexion · 2 réseau(x) reçu(s)").first()).toBeVisible();
  const table = runtime(page).getByRole("region", { name: "Table BGP", exact: true });
  await expect(table).toContainText("10.3.0.0/24 · 65003");
  await expect(table).toContainText("10.3.0.0/24 · 65002 65003");
  await page.screenshot({ path: "test-results/bgp-runtime-1440.png" });

  await consoleOf(page, "R1");
  await line(page, "show bgp");
  await expect(log(page)).toContainText(/10\.3\.0\.0\/24\s+65003\s+10\.13\.0\.2\s+retenu/);
  await line(page, "show routes");
  await expect(log(page)).toContainText("BGP, 1 AS traversé(s)");
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("TTL 62");

  // Coupure du lien R1–R3 : session fermée aussitôt, détour par l'AS 65002.
  await actions(page).getByRole("button", { name: /^Couper le câble (R1 ge2 ↔ R3 ge1|R3 ge1 ↔ R1 ge2)$/ }).click();
  await finish(page);
  await tab(page, "Journal").click();
  const journal = page.getByRole("list", { name: "Journal des décisions du moteur", exact: true });
  await expect(journal).toContainText("R1 retient pour 10.3.0.0/24 le chemin 65002 65003 par 10.12.0.2");
  // Nouveau chemin de R1 annoncé à R2 (qui le rejettera : son AS y figure).
  await journal.getByRole("button", { name: /R1 annonce \d+ réseau\(x\) à 10\.12\.0\.2 avec le chemin d'AS 65001 65002 65003/ }).first().click();
  await expect(runtime(page).getByRole("region", { name: "Message BGP", exact: true })).toContainText("2 (UPDATE)");
  await page.screenshot({ path: "test-results/bgp-inspector-1440.png" });
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("TTL 61");
});

test("BGP : formulaire de l'onglet Routes et console équivalents", async ({ page }) => {
  await load(page);
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  const section = propertiesPanel(page).getByRole("region", { name: "Routage entre systèmes autonomes BGP", exact: true });
  await expect(section.getByLabel("Numéro d'AS (1 à 65535)", { exact: true })).toHaveValue("65001");
  await expect(section).toContainText("10.12.0.2 · AS 65002");
  await section.getByRole("button", { name: "Retirer le voisin 10.12.0.2", exact: true }).click();
  await expect(section).not.toContainText("10.12.0.2 · AS 65002");
  await page.screenshot({ path: "test-results/bgp-form-1440.png" });

  // Sans session vers R2, R1 n'apprend le réseau de R2 que par R3.
  await openSimulation(page);
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  await expect(runtime(page).getByRole("region", { name: "Table BGP", exact: true })).toContainText("10.2.0.0/24 · 65003 65002");
  await consoleOf(page, "R1");
  await line(page, "configure");
  await line(page, "bgp neighbor 10.12.0.2 remote-as 65002");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  await expect(section).toContainText("10.12.0.2 · AS 65002");
});
