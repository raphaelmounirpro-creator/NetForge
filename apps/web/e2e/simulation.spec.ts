import { expect, test, type Page } from "@playwright/test";
import { addDevice, configureIpv4, connectSelectedTo, createProject, propertiesPanel, selectDevice } from "./helpers";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const runtime = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const journal = (page: Page) => page.getByRole("list", { name: "Journal des décisions du moteur" });
const pings = (page: Page) => page.getByRole("list", { name: "Résultats des pings" });

async function importFixture(page: Page, name: string): Promise<void> {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture(name));
  await expect(page).toHaveURL(/\/laboratoire$/);
}

async function openSimulation(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
}

async function ping(page: Page, destination: string, count: string, source?: string): Promise<void> {
  const panel = actions(page);
  if (source) await panel.getByLabel("Depuis").selectOption({ label: new RegExp(`^${source} `).source.slice(1) });
  await panel.getByLabel("Adresse de destination").fill(destination);
  await panel.getByLabel("Nombre d'échos").fill(count);
  await panel.getByRole("button", { name: "Lancer le ping" }).click();
}

async function finish(page: Page): Promise<void> {
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

async function showDock(page: Page, tab: "Journal" | "Pings"): Promise<void> {
  await page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name: tab }).click();
}

test("premier parcours : LAN construit à la main, ARP puis ICMP, pas à pas, tables observables", async ({ page }) => {
  test.setTimeout(60_000);
  await createProject(page, "LAN simulé");
  await addDevice(page, "PC");
  await addDevice(page, "PC");
  await addDevice(page, "S-24");
  await selectDevice(page, "PC1");
  await connectSelectedTo(page, "SW1 · ge1");
  await configureIpv4(page, "eth0", "192.168.1.10", "24");
  await selectDevice(page, "PC2");
  await connectSelectedTo(page, "SW1 · ge2");
  await configureIpv4(page, "eth0", "192.168.1.11", "255.255.255.0");

  await openSimulation(page);
  await ping(page, "192.168.1.11", "1");
  // La commande est appliquée à l'instant courant : le ping part, la résolution ARP commence.
  await expect(actions(page)).toContainText("Ping lancé. La simulation est en pause");
  await expect(journal(page)).toContainText("PC1 lance un ping vers 192.168.1.11");
  await expect(journal(page)).toContainText("PC1 diffuse une requête ARP sur eth0 : « Qui a l'adresse 192.168.1.11 ? »");

  // Pas à pas : chaque clic montre au moins une nouvelle décision du moteur.
  const step = bar(page).getByRole("button", { name: "Événement suivant" });
  await step.click();
  await expect(journal(page)).toContainText("SW1 apprend que");
  await step.click();
  await expect(journal(page)).toContainText("PC2 reçoit la requête ARP de 192.168.1.10");

  await finish(page);
  const texts = await journal(page).getByRole("listitem").allTextContents();
  const arpReply = texts.findIndex((text) => text.includes("PC1 reçoit la réponse ARP"));
  const echo = texts.findIndex((text) => text.includes("PC2 reçoit une demande d'écho de 192.168.1.10"));
  expect(arpReply).toBeGreaterThan(-1);
  expect(echo).toBeGreaterThan(arpReply);

  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "SW1" });
  await expect(runtime(page).getByRole("heading", { name: "Table MAC" })).toBeVisible();
  await expect(runtime(page)).toContainText("(PC1 eth0)");
  await expect(runtime(page)).toContainText("(PC2 eth0)");
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "PC1" });
  await expect(runtime(page)).toContainText("192.168.1.11 → 02:");

  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("Réponse de 192.168.1.11 : séquence 1, TTL 64");
  await expect(pings(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s) (0 % de perte)");

  // Nouveau ping avant expiration : l'entrée ARP est réutilisée, sans nouvelle requête.
  await showDock(page, "Journal");
  await ping(page, "192.168.1.11", "1");
  await finish(page);
  await expect(journal(page).getByRole("listitem").last()).toContainText("Ping de PC1 vers 192.168.1.11 terminé : 1 envoyé(s), 1 reçu(s)");
  await expect(journal(page)).toContainText("PC1 trouve 192.168.1.11 dans son cache ARP");
});

test("routage statique : retour manquant identifié, correction puis réinitialisation", async ({ page }) => {
  test.setTimeout(60_000);
  await importFixture(page, "two-routers-no-return.nfg.json");
  await openSimulation(page);
  await ping(page, "10.0.2.10", "1");
  await finish(page);
  const drop = journal(page).getByRole("listitem").filter({ hasText: "R2 abandonne le paquet : aucune route ne correspond à 10.0.1.10" });
  await expect(drop).toHaveAttribute("data-severity", "error");
  await expect(drop).toContainText("Perte ou erreur :");
  // Filtre « Pertes et erreurs uniquement » : seules les lignes signalées restent.
  await page.getByRole("button", { name: "✕ Pertes et erreurs uniquement" }).click();
  const rows = journal(page).getByRole("listitem");
  await expect(rows.first()).toHaveAttribute("data-severity", "error");
  expect(await rows.evaluateAll((items) => items.every((item) => item.getAttribute("data-severity") === "error"))).toBe(true);
  await page.getByRole("button", { name: "✕ Pertes et erreurs uniquement" }).click();
  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("Séquence 1 : délai d'attente dépassé");
  await expect(pings(page).getByText("✕ 1 envoyé(s), 0 reçu(s), 1 perdu(s) (100 % de perte)")).toBeVisible();

  // Correction dans l'éditeur : route de retour sur R2.
  await page.getByRole("tab", { name: "Topologie" }).click();
  await selectDevice(page, "R2");
  const panel = propertiesPanel(page);
  await panel.getByRole("tab", { name: "Routes" }).click();
  await panel.getByLabel("Réseau de destination").fill("10.0.1.0");
  await panel.getByLabel("Masque").fill("24");
  await panel.getByLabel("Prochain saut").fill("10.0.12.1");
  await panel.getByRole("button", { name: "Ajouter la route" }).click();
  await expect(panel).toContainText("10.0.1.0/24 via 10.0.12.1");

  // La simulation demande une réinitialisation avant de simuler la nouvelle configuration.
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(page.getByText("Configuration modifiée")).toBeVisible();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeDisabled();
  await page.getByRole("button", { name: "Réinitialiser avec la nouvelle configuration" }).click();
  await expect(page.getByText("Configuration modifiée")).toBeHidden();
  await ping(page, "10.0.2.10", "2");
  await finish(page);
  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("Réponse de 10.0.2.10 : séquence 2, TTL 62");
  await expect(pings(page).getByText("✓ 2 envoyé(s), 2 reçu(s), 0 perdu(s) (0 % de perte)")).toBeVisible();
});

test("ping en attente : la pause est expliquée et la suite se calcule depuis les résultats", async ({ page }) => {
  await importFixture(page, "routed.nfg.json");
  await openSimulation(page);
  await ping(page, "192.168.2.10", "1");
  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("Séquence 1 : en attente de réponse");
  await expect(bar(page)).toContainText("En pause · des échanges attendent d'être calculés");
  const dock = page.getByRole("region", { name: "Résultats de la simulation" });
  await expect(dock.getByRole("status")).toContainText("La simulation est en pause : la suite des échanges n'est pas encore calculée.");
  await dock.getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(pings(page)).toContainText("Réponse de 192.168.2.10 : séquence 1");
  await expect(dock.getByText("La simulation est en pause : la suite des échanges")).toBeHidden();
});

test("panne de câble : aucune transmission sur le câble coupé, échec expliqué", async ({ page }) => {
  await importFixture(page, "routed.nfg.json");
  await openSimulation(page);
  await actions(page).getByRole("button", { name: "Couper le câble R1 ge1 ↔ SW2 ge24" }).click();
  await expect(actions(page)).toContainText("✕ coupé");
  await ping(page, "192.168.2.10", "1");
  await finish(page);
  await expect(journal(page)).toContainText("Panne injectée : le câble R1 ge1 ↔ SW2 ge24 est coupé.");
  await expect(journal(page)).toContainText("R1 abandonne le paquet : aucune route ne correspond à 192.168.2.10");
  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("Séquence 1 : réseau de destination inaccessible (signalé par 192.168.1.1)");
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "R1" });
  await expect(runtime(page)).toContainText("Inactive (interface inactive)");
});

test("lecture continue au rythme choisi, pause, puis réinitialisation", async ({ page }) => {
  await importFixture(page, "routed.nfg.json");
  await openSimulation(page);
  await ping(page, "192.168.2.10", "3");
  await bar(page).getByLabel("Vitesse d'observation").selectOption({ label: "Accéléré (×10)" });
  await bar(page).getByRole("button", { name: "Lecture" }).click();
  await expect(bar(page)).toContainText("En lecture");
  await showDock(page, "Pings");
  await expect(pings(page)).toContainText("3 envoyé(s), 3 reçu(s), 0 perdu(s)", { timeout: 10_000 });

  await bar(page).getByRole("button", { name: "Pause" }).click();
  await expect(bar(page)).toContainText("En pause");
  const clock = bar(page).getByRole("timer", { name: "Temps simulé" });
  const paused = await clock.textContent();
  await page.waitForTimeout(400);
  expect(await clock.textContent()).toBe(paused);

  await bar(page).getByRole("button", { name: "Réinitialiser" }).click();
  await expect(clock).toHaveText("0,000000 s");
  await expect(page.getByText("Aucun ping lancé.")).toBeVisible();
});

test("boucle de commutation : avertissement dans l'éditeur, interruption expliquée par le moteur", async ({ page }) => {
  await importFixture(page, "switch-loop.nfg.json");
  await page.getByRole("tab", { name: "Configuration" }).click();
  await expect(page.getByRole("cell", { name: /avertissement/ }).first()).toBeVisible();
  await openSimulation(page);
  await ping(page, "192.168.1.11", "1");
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(page.getByText("Simulation interrompue", { exact: true })).toBeVisible();
  // Séparateur de milliers français : espace insécable fine.
  await expect(page.getByRole("main").getByText(/^plus de 100.000 événements en attente : une boucle de commutation provoque probablement une tempête de diffusion/)).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Lecture" })).toBeDisabled();
  await expect(page.getByText(/décision\(s\) plus ancienne\(s\) ne sont plus affichées/)).toBeVisible();
});
