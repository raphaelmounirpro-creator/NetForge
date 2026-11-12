import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * VLAN (phase 7, tranche 1) : routage inter-VLAN par sous-interfaces,
 * étiquette 802.1Q dans l'inspecteur, port de switch reconfiguré par le
 * formulaire et vérifié à la console, effet sur la simulation.
 */
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const journal = (page: Page) => page.getByRole("list", { name: "Journal des décisions du moteur" });
const side = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dockTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name });
const pings = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });

async function ping(page: Page, destination: string): Promise<void> {
  await actions(page).getByLabel("Adresse de destination").fill(destination);
  await actions(page).getByLabel("Nombre d'échos").fill("1");
  await actions(page).getByRole("button", { name: "Lancer le ping" }).click();
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

test("VLAN : routage inter-VLAN, étiquette 802.1Q, port reconfiguré par formulaire et vérifié à la console", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture("vlan.nfg.json"));
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();

  // PC1 (VLAN 10) joint PC2 (VLAN 20) par les sous-interfaces de R1.
  await ping(page, "192.168.20.12");
  await dockTab(page, "Pings").click();
  await expect(pings(page).getByText("✓ 1 envoyé(s), 1 reçu(s), 0 perdu(s) (0 % de perte)")).toBeVisible();

  // Trame étiquetée sur le trunk vers le routeur : l'inspecteur montre l'étiquette.
  await dockTab(page, "Journal").click();
  await journal(page).getByRole("button", { name: /SW1 ge23 émet une trame étiquetée VLAN 10/ }).first().click();
  await expect(side(page).getByRole("region", { name: "Trame Ethernet" })).toContainText("TPID 0x8100, VID 10");

  // PC1 passe dans le VLAN 20 par le formulaire du port ge1 de SW1.
  await page.getByRole("tab", { name: "Topologie" }).click();
  await selectDevice(page, "SW1");
  const panel = propertiesPanel(page);
  await panel.getByRole("tab", { name: "Interfaces" }).click();
  const port = panel.getByRole("group", { name: "Port ge1", exact: true });
  await expect(port.getByLabel("Mode du port ge1", { exact: true })).toHaveValue("access");
  await port.getByLabel("VLAN", { exact: true }).fill("20");
  await port.getByRole("button", { name: "Appliquer" }).click();

  // La console décrit la nouvelle répartition.
  await page.getByRole("tab", { name: "Simulation" }).click();
  await page.getByRole("button", { name: "Réinitialiser avec la nouvelle configuration" }).click();
  await dockTab(page, "Console").click();
  const dock = page.getByRole("region", { name: "Résultats de la simulation" });
  await dock.getByLabel("Équipement").selectOption({ label: "SW1" });
  await dock.getByRole("textbox").fill("show vlans");
  await dock.getByRole("textbox").press("Enter");
  await expect(dock.getByRole("log")).toContainText(/20\s+ge1, ge2/);
  await expect(dock.getByRole("log")).toContainText(/ge24\s+1\s+10,20/);

  // Adressé dans le réseau du VLAN 10 mais placé dans le VLAN 20 : PC1 ne joint plus sa passerelle.
  await ping(page, "192.168.20.12");
  await dockTab(page, "Pings").click();
  await expect(pings(page).getByText("✕ 1 envoyé(s), 0 reçu(s), 1 perdu(s) (100 % de perte)")).toBeVisible();
});
