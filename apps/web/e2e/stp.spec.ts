import { expect, test, type Page } from "@playwright/test";

/*
 * Spanning Tree (phase 7, tranche 2) : triangle de switches, port bloqué
 * observable, coupure du lien racine de SW3 puis reconvergence (écoute,
 * apprentissage, transmission), état consulté à la console.
 */
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const runtime = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dockTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name });
const dock = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });

async function ping(page: Page): Promise<void> {
  await actions(page).getByLabel("Adresse de destination").fill("192.168.1.11");
  await actions(page).getByLabel("Nombre d'échos").fill("1");
  await actions(page).getByRole("button", { name: "Lancer le ping" }).click();
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

test("Spanning Tree : port bloqué, coupure du lien racine, reconvergence en 30 s, état à la console", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture("stp-triangle.nfg.json"));
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();

  // Réseau convergé : SW3 bloque son port ge2 (segment SW2–SW3) ; le ping passe par la racine SW1.
  await runtime(page).getByLabel("Équipement inspecté").selectOption({ label: "SW3" });
  const stp = runtime(page).getByRole("region", { name: "Spanning Tree" });
  await expect(stp).toContainText("Racine : SW1");
  await expect(stp).toContainText("par le port racine ge1");
  await expect(stp.getByText("⊘ alternatif · bloqué · coût 4")).toBeVisible();
  await ping(page);
  await dockTab(page, "Pings").click();
  await expect(dock(page).getByText("✓ 1 envoyé(s), 1 reçu(s), 0 perdu(s) (0 % de perte)")).toBeVisible();

  // Coupure du lien racine de SW3 : ge2 devient port racine et passe en écoute.
  await actions(page).getByRole("button", { name: /^Couper le câble (SW3 ge1 ↔ SW1 ge2|SW1 ge2 ↔ SW3 ge1)$/ }).click();
  await expect(stp).toContainText("par le port racine ge2");
  await expect(stp.getByText("⊘ racine · écoute · coût 4")).toBeVisible();

  // Le ping lancé pendant l'écoute échoue ; une fois la convergence calculée, le suivant réussit.
  await ping(page);
  await expect(dock(page).getByText("✕ 1 envoyé(s), 0 reçu(s), 1 perdu(s) (100 % de perte)")).toBeVisible();
  await expect(stp.getByText("● racine · transmission · coût 4")).toBeVisible();
  await ping(page);
  await expect(dock(page).getByText("✓ 1 envoyé(s), 1 reçu(s), 0 perdu(s) (0 % de perte)").last()).toBeVisible();

  await dockTab(page, "Console").click();
  await dock(page).getByLabel("Équipement").selectOption({ label: "SW3" });
  await dock(page).getByRole("textbox").fill("show spanning-tree");
  await dock(page).getByRole("textbox").press("Enter");
  await expect(dock(page).getByRole("log")).toContainText("Racine : SW1");
  await expect(dock(page).getByRole("log")).toContainText(/ge2\s+racine\s+transmission\s+4/);
});
