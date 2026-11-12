import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

const fixture = new URL("./fixtures/dhcp.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const runtime = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dock = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name, exact: true });

async function line(page: Page, command: string): Promise<void> {
  await dock(page).getByRole("textbox").fill(command);
  await dock(page).getByRole("textbox").press("Enter");
}

async function finish(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: "Terminer les échanges", exact: true }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

test("DHCP : DORA inspectable, baux, routage, libération et renouvellement par formulaire et console", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "PC1" });
  const client = runtime(page).getByRole("region", { name: "Client DHCP", exact: true });
  await expect(client).toContainText("192.168.1.100/24");
  await expect(client).toContainText("bail actif");
  await tab(page, "Journal").click();
  const journal = page.getByRole("list", { name: "Journal des décisions du moteur", exact: true });
  await journal.getByRole("button", { name: /PC1 eth0 émet une trame/ }).first().click();
  await expect(runtime(page).getByRole("region", { name: "Datagramme UDP", exact: true })).toContainText("68");
  await expect(runtime(page).getByRole("region", { name: "Message DHCP", exact: true })).toContainText("DHCPDISCOVER");

  await tab(page, "Console").click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "PC1" });
  await line(page, "ipconfig");
  await expect(dock(page).getByRole("log")).toContainText("192.168.1.100");
  await line(page, "ping 10.0.0.2 -n 1");
  await finish(page);
  await expect(dock(page).getByRole("log")).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "R1" });
  await line(page, "show dhcp");
  await expect(dock(page).getByRole("log")).toContainText("192.168.1.101");

  // Les boutons et la console passent tous deux par la commande DHCP du moteur.
  await runtime(page).getByRole("tab", { name: "État d'exécution", exact: true }).click();
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "PC1" });
  await runtime(page).getByRole("button", { name: "Libérer le bail", exact: true }).click();
  await finish(page);
  await expect(client).toContainText("bail libéré");
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "PC1" });
  await line(page, "ipconfig renew");
  await finish(page);
  await expect(client).toContainText("bail actif");
  await page.screenshot({ path: "test-results/dhcp-runtime-1440.png" });

  // Mode d'adressage persistant ; l'adresse du bail reste un état de simulation.
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "PC1");
  await expect(propertiesPanel(page).getByLabel("Adressage du poste", { exact: true })).toHaveValue("dhcp");
  await expect(propertiesPanel(page).getByLabel("Adresse IPv4", { exact: true })).toHaveCount(0);
  await propertiesPanel(page).getByLabel("Adressage du poste", { exact: true }).selectOption("manual");
  await expect(propertiesPanel(page).getByLabel("Adresse IPv4", { exact: true })).toHaveValue("");
});

test("DHCP : plage modifiée au formulaire, console équivalente et épuisement observable", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await selectDevice(page, "R1");
  const pools = propertiesPanel(page).getByRole("region", { name: "Serveur DHCP", exact: true });
  await pools.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/dhcp-pool-1440.png" });
  await pools.getByLabel("Dernière adresse", { exact: true }).fill("192.168.1.100");
  await pools.getByRole("button", { name: "Appliquer la plage DHCP", exact: true }).click();
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await finish(page);
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "PC2" });
  await expect(runtime(page).getByRole("region", { name: "Client DHCP", exact: true })).toContainText("aucune attribution");
  await tab(page, "Journal").click();
  await expect(page.getByRole("list", { name: "Journal des décisions du moteur", exact: true })).toContainText("plage 192.168.1.100 – 192.168.1.100 épuisée");
  await tab(page, "Console").click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "R1" });
  await line(page, "show config");
  await expect(dock(page).getByRole("log")).toContainText("dhcp pool 192.168.1.100 192.168.1.100 gateway 192.168.1.1 lease 2m");
});
