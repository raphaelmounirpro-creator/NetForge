import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * VRRP (phase 8, tranche 3) : R1 (priorité 110) maître de la passerelle
 * virtuelle 192.168.1.1, R2 (100) en secours ; R1 tombe, R2 prend le relais
 * et PC1 garde sa passerelle ; R1 revient et reprend la main (préemption).
 */
const fixture = new URL("./fixtures/vrrp.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const runtime = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dock = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name, exact: true });
const log = (page: Page) => dock(page).getByRole("log");
const vrrp = (page: Page) => runtime(page).getByRole("region", { name: "VRRP", exact: true });

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

async function inspect(page: Page, device: string): Promise<void> {
  await runtime(page).getByRole("tab", { name: "État d'exécution", exact: true }).click();
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: device });
}

test("VRRP : maître élu, bascule sur le secours quand il tombe, retour par préemption", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await openSimulation(page);
  await finish(page);

  await inspect(page, "R1");
  await expect(vrrp(page)).toContainText("ge0 · VRID 1 · 192.168.1.1");
  await expect(vrrp(page)).toContainText("maître · priorité 110 · MAC 00:00:5e:00:01:01");
  await inspect(page, "R2");
  await expect(vrrp(page)).toContainText("secours · priorité 100");
  await expect(vrrp(page)).toContainText("Maître : 192.168.1.2");
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page)).toContainText("1 envoyé(s), 1 reçu(s), 0 perdu(s)");

  // R1 perd son lien vers le switch : R2 ne reçoit plus d'annonce et prend le relais après Master_Down_Interval.
  await actions(page).getByRole("button", { name: /^Couper le câble (SW1 ge2 ↔ R1 ge0|R1 ge0 ↔ SW1 ge2)$/ }).click();
  await finish(page);
  await inspect(page, "R2");
  await bar(page).getByLabel("Vitesse d'observation").selectOption({ label: "Accéléré (×10)" });
  await bar(page).getByRole("button", { name: "Lecture", exact: true }).click();
  await expect(vrrp(page)).toContainText("maître · priorité 100", { timeout: 10_000 });
  await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
  await page.screenshot({ path: "test-results/vrrp-failover-1440.png" });
  // Journal filtré sur R2 : environ une décision par seconde simulée, la bascule reste parmi les 100 dernières
  // même si la pause intervient tard (machine chargée).
  await tab(page, "Journal").click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "R2" });
  await expect(page.getByRole("list", { name: "Journal des décisions du moteur", exact: true })).toContainText(
    "R2 ge0 devient maître du groupe VRRP 1 (aucune annonce du maître pendant Master_Down_Interval) : il répond désormais pour 192.168.1.1.",
  );
  // PC1 garde la même passerelle et la même MAC virtuelle : le trafic passe par R2.
  await consoleOf(page, "PC1");
  await line(page, "ping 10.3.0.10 -n 1");
  await finish(page);
  await expect(log(page).getByText(/1 envoyé\(s\), 1 reçu\(s\), 0 perdu\(s\)/)).toHaveCount(2);
  await line(page, "arp -a");
  await expect(log(page)).toContainText(/192\.168\.1\.1\s+00:00:5e:00:01:01/);

  // Retour de R1 : plus prioritaire, il écarte les annonces de R2 et reprend la main.
  await actions(page).getByRole("button", { name: /^Rétablir le câble (SW1 ge2 ↔ R1 ge0|R1 ge0 ↔ SW1 ge2)$/ }).click();
  await finish(page);
  await inspect(page, "R1");
  await expect(vrrp(page)).toContainText("maître · priorité 110");
  await consoleOf(page, "R2");
  await line(page, "show vrrp");
  await expect(log(page)).toContainText(/ge0\s+1\s+192\.168\.1\.1\s+00:00:5e:00:01:01\s+100\s+oui\s+secours\s+192\.168\.1\.2/);
});

test("VRRP : formulaire de l'onglet Routes et console équivalents", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  const section = propertiesPanel(page).getByRole("region", { name: "Passerelle redondante VRRP", exact: true });
  await expect(section).toContainText("ge0 · VRID 1 · 192.168.1.1 · priorité 110");
  await expect(section.getByLabel("Adresse virtuelle", { exact: true })).toHaveValue("192.168.1.1");
  await section.getByLabel("Priorité (1 à 254)", { exact: true }).fill("90");
  await section.getByRole("button", { name: "Enregistrer le groupe", exact: true }).click();
  await expect(section).toContainText("ge0 · VRID 1 · 192.168.1.1 · priorité 90");
  await page.screenshot({ path: "test-results/vrrp-form-1440.png" });

  // Moins prioritaire que R2 : R2 devient maître.
  await openSimulation(page);
  await finish(page);
  await inspect(page, "R2");
  await expect(vrrp(page)).toContainText("maître · priorité 100");
  await consoleOf(page, "R1");
  await line(page, "configure");
  await line(page, "interface ge0");
  await line(page, "vrrp 1 192.168.1.1 priority 120");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "R1");
  await propertiesPanel(page).getByRole("tab", { name: "Routes", exact: true }).click();
  await expect(section).toContainText("ge0 · VRID 1 · 192.168.1.1 · priorité 120");
});
