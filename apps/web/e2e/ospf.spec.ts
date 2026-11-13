import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * OSPF (phase 8, tranche 2) : triangle à coûts inégaux (chemin le moins
 * coûteux par R2 plutôt que le lien direct), coupure et reconvergence ;
 * élection du DR sur un réseau à diffusion ; formulaire et console équivalents.
 */
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
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

async function load(page: Page, name: string): Promise<void> {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture(name));
  await expect(page).toHaveURL(/\/laboratoire$/);
}

test("OSPF : voisinages, base d'états des liens, chemin de plus faible coût, coupure et reconvergence", async ({ page }) => {
  await load(page, "ospf.nfg.json");
  await openSimulation(page);
  await finish(page);

  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  const ospf = runtime(page).getByRole("region", { name: "OSPF", exact: true });
  await expect(ospf).toContainText("Identifiant 10.13.0.1");
  await expect(ospf).toContainText("ge1 · BDR · coût 10 · priorité 1");
  await expect(ospf).toContainText("DR 10.23.0.1 (R2) · BDR 10.13.0.1 (R1)");
  await expect(ospf).toContainText("ge1 → 10.23.0.1 (R2) · 10.12.0.2");
  await expect(ospf.getByText("● Full · DR · priorité 1", { exact: false }).first()).toBeVisible();
  const lsdb = runtime(page).getByRole("region", { name: "Base d'états des liens OSPF", exact: true });
  await expect(lsdb.getByRole("listitem")).toHaveCount(6);
  await page.screenshot({ path: "test-results/ospf-runtime-1440.png" });

  // Le chemin le moins coûteux vers PC3 passe par R2 (coût 30), pas par le lien direct (coût 40).
  await consoleOf(page, "R1");
  await line(page, "show routes");
  await expect(log(page)).toContainText("OSPF, métrique 30");
  await line(page, "show ospf");
  await expect(log(page)).toContainText(/10\.23\.0\.1\s+10\.12\.0\.2\s+ge1\s+1\s+Full\s+DR/);
  await line(page, "show ospf database");
  await expect(log(page)).toContainText(/réseau\s+10\.12\.0\.2\s+10\.23\.0\.1\s+0x80000001/);
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("TTL 61");

  // Coupure de R1–R2 : voisin perdu aussitôt, détour par le lien direct.
  await actions(page).getByRole("button", { name: /^Couper le câble (R1 ge1 ↔ R2 ge1|R2 ge1 ↔ R1 ge1)$/ }).click();
  await finish(page);
  await tab(page, "Journal").click();
  const journal = page.getByRole("list", { name: "Journal des décisions du moteur", exact: true });
  await expect(journal).toContainText("R1 : le voisin 10.23.0.1 (R2) passe de l'état Full à Down (interface hors service).");
  await expect(journal).toContainText("R1 change la route OSPF 10.3.0.0/24 : par 10.13.0.2, coût 40 (avant : coût 30 par 10.12.0.2).");
  await journal.getByRole("button", { name: /R1 ge2 envoie \d+ LSA vers 224\.0\.0\.[56] \(inondation\)/ }).first().click();
  await expect(runtime(page).getByRole("region", { name: "Paquet OSPF", exact: true })).toContainText("4 (mise à jour d'états des liens)");
  await page.screenshot({ path: "test-results/ospf-inspector-1440.png" });
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("TTL 62");
});

test("OSPF : élection du DR et du BDR sur un réseau à diffusion", async ({ page }) => {
  await load(page, "ospf-lan.nfg.json");
  await openSimulation(page);
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  const ospf = runtime(page).getByRole("region", { name: "OSPF", exact: true });
  await expect(ospf).toContainText("ge0 · DR Other · coût 10 · priorité 1");
  await expect(ospf).toContainText("DR 10.2.0.1 (R2) · BDR 10.4.0.1 (R4)");
  // Deux DR Other restent en 2-Way : l'adjacence complète ne se forme qu'avec le DR et le BDR.
  await expect(ospf).toContainText("ge0 → 10.3.0.1 (R3) · 10.0.0.3");
  await expect(ospf.getByText("● 2-Way · DR Other · priorité 0", { exact: false })).toBeVisible();
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");
});

test("OSPF : formulaire de l'onglet Routes et console équivalents", async ({ page }) => {
  await load(page, "ospf.nfg.json");
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  const section = propertiesPanel(page).getByRole("region", { name: "Routage à état de liens OSPF", exact: true });
  await expect(section.getByLabel("OSPF sur ge0", { exact: true })).toHaveValue("passive");
  await expect(section.getByLabel("Coût de ge2", { exact: true })).toHaveValue("30");
  await section.getByLabel("Coût de ge2", { exact: true }).fill("5");
  await section.getByRole("button", { name: "Appliquer le coût et la priorité de ge2", exact: true }).click();
  await page.screenshot({ path: "test-results/ospf-form-1440.png" });

  // Lien direct devenu le moins coûteux : 5 + 10 vers le réseau de PC3.
  await openSimulation(page);
  await finish(page);
  await consoleOf(page, "R1");
  await line(page, "show routes");
  await expect(log(page)).toContainText("OSPF, métrique 15");
  await line(page, "configure");
  await line(page, "interface ge2");
  await line(page, "ospf cost 30");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  await expect(section.getByLabel("Coût de ge2", { exact: true })).toHaveValue("30");
});
