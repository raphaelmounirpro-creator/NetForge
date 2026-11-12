import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

const fixture = new URL("./fixtures/dns.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
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

/** Vue Simulation ouverte et moteur chargé (sinon une commande de console est refusée). */
async function openSimulation(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Actions de simulation" }).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
}

async function consoleOf(page: Page, device: string): Promise<void> {
  await tab(page, "Console").click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: device });
}

test("DNS : nslookup et ping par nom à la console, question inspectable, service observable", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await openSimulation(page);

  await consoleOf(page, "PC1");
  await line(page, "ipconfig");
  await expect(log(page)).toContainText("Serveur DNS . . . . : 192.168.1.1");
  await line(page, "nslookup srv.lab");
  await finish(page);
  await expect(log(page)).toContainText("Adresse : 10.0.0.10 (TTL 300 s)");
  await line(page, "ping srv.lab -n 1");
  await finish(page);
  await expect(log(page)).toContainText("srv.lab correspond à 10.0.0.10.");
  await expect(log(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");
  await line(page, "ping inconnu.lab -n 1");
  await finish(page);
  await expect(log(page)).toContainText("La requête ping n'a pas trouvé l'hôte inconnu.lab : nom inexistant (NXDOMAIN).");

  // Résultats des pings : adresse obtenue dans le titre, échec de résolution sans écho.
  await tab(page, "Pings").click();
  await expect(dock(page).getByRole("heading", { name: "PC1 → srv.lab [10.0.0.10]", exact: true })).toBeVisible();
  await expect(dock(page).getByRole("list", { name: "Résultats des pings" })).toContainText("✕ La requête ping n'a pas trouvé l'hôte inconnu.lab");

  // Question DNS inspectable avec ses seuls champs modélisés.
  await tab(page, "Journal").click();
  const journal = page.getByRole("list", { name: "Journal des décisions du moteur", exact: true });
  await journal.getByRole("button", { name: /PC1 demande à 192\.168\.1\.1 l'adresse de srv\.lab/ }).first().click();
  const message = runtime(page).getByRole("region", { name: "Message DNS", exact: true });
  await expect(message).toContainText("srv.lab, type A (1), classe IN (1)");
  await expect(message).toContainText("AA=0, RD=1, RA=0");
  await page.screenshot({ path: "test-results/dns-inspector-1440.png" });

  // Service du routeur : noms publiés et réponses calculées par le moteur.
  await runtime(page).getByRole("tab", { name: "État d'exécution", exact: true }).click();
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  const service = runtime(page).getByRole("region", { name: "Service DNS", exact: true });
  await expect(service).toContainText("2 réponse(s) avec adresse · 1 nom(s) inexistant(s)");
  await expect(service).toContainText("srv.lab");
  await consoleOf(page, "R1");
  await line(page, "show dns");
  await expect(log(page)).toContainText("pc1.lab");
  await expect(log(page)).toContainText("10.0.0.10");
});

test("DNS : nom enregistré au formulaire, résolveur saisi au formulaire, console équivalente", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await selectDevice(page, "R1");
  const service = propertiesPanel(page).getByRole("region", { name: "Service DNS", exact: true });
  await service.scrollIntoViewIfNeeded();
  await expect(service.getByLabel("Activer le service DNS", { exact: true })).toBeChecked();
  await service.getByLabel("Nom d'hôte", { exact: true }).fill("Web.Lab");
  await service.getByLabel("Adresse IPv4 associée", { exact: true }).fill("10.0.0.10");
  await service.getByRole("button", { name: "Enregistrer le nom", exact: true }).click();
  await expect(service.getByRole("list", { name: "Noms enregistrés" })).toContainText("web.lab → 10.0.0.10");
  await page.screenshot({ path: "test-results/dns-form-1440.png" });

  await selectDevice(page, "PC2");
  const resolver = propertiesPanel(page).getByLabel("Serveur DNS", { exact: true });
  await expect(resolver).toHaveValue("");
  await resolver.fill("192.168.1.1");
  await resolver.press("Enter");

  await openSimulation(page);
  await consoleOf(page, "PC2");
  await line(page, "ping web.lab -n 1");
  await finish(page);
  await expect(log(page)).toContainText("web.lab correspond à 10.0.0.10.");
  await expect(log(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");

  // La console écrit la même configuration que les formulaires, et la modifie par les mêmes commandes.
  await consoleOf(page, "R1");
  await line(page, "show config");
  await expect(log(page)).toContainText("dns record web.lab 10.0.0.10");
  await line(page, "configure");
  await line(page, "dns delete web.lab");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "R1");
  await expect(service.getByRole("list", { name: "Noms enregistrés" })).not.toContainText("web.lab");
});
