import { expect, test, type Page } from "@playwright/test";
import { addDevice, connectSelectedTo, createProject, propertiesPanel, selectDevice } from "./helpers";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const paths = (page: Page) => page.getByRole("complementary", { name: "Chemins optiques" });
const tools = (page: Page) => page.getByRole("complementary", { name: "Outils optiques" });
const measureLog = (page: Page) => page.getByRole("region", { name: "Journal des mesures" });
const pathButton = (page: Page, ont: string) => paths(page).getByRole("button", { name: new RegExp(`→ ${ont} `) });

async function openTool(page: Page, tab: "Bilan" | "Mesures" | "Interventions" | "Pannes"): Promise<void> {
  await tools(page).getByRole("tab", { name: tab }).click();
}

async function measure(page: Page, device: string, port: string): Promise<void> {
  await openTool(page, "Mesures");
  await tools(page).getByLabel("Équipement à mesurer").selectOption({ label: device });
  await tools(page).getByRole("button", { name: `Mesurer au port ${port} de ${device}` }).click();
}

async function intervene(page: Page, action: string, target: string): Promise<void> {
  await openTool(page, "Interventions");
  await tools(page).getByLabel("Geste").selectOption({ label: action });
  await tools(page).getByLabel("Endroit").selectOption({ label: target });
  await tools(page).getByRole("button", { name: "Effectuer l'intervention" }).click();
}

test("formateur : bilan par chemin, panne injectée, mesure et réparation", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture("ftth.nfg.json"));
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Optique" }).click();

  for (const ont of ["ONT1", "ONT2", "ONT3"]) await expect(pathButton(page, ont)).toContainText("✓ Conforme");

  // Bilan calculé à la main : 24,974 dB de pertes maximales, marge 3,026 dB.
  await pathButton(page, "ONT1").click();
  await expect(tools(page).getByRole("heading", { name: "Bilan du chemin OLT1 pon1 → ONT1" })).toBeVisible();
  const downstream = tools(page).getByRole("region", { name: /^Descendant/ });
  await expect(downstream).toContainText("13,60 à 24,97 dB");
  await expect(downstream).toContainText("3,03 dB (réserve conseillée 3,00 dB)");
  await expect(tools(page).getByRole("table")).toContainText("Coupleur CPL1 1:8");

  // Panne : connecteur sale à la sortie de PTO3.
  await openTool(page, "Pannes");
  await tools(page).getByLabel("Type de panne").selectOption({ label: "Connecteur sale" });
  await tools(page).getByLabel("Élément concerné").selectOption({ label: "PTO3 out" });
  await tools(page).getByLabel("Perte supplémentaire (dB)").fill("4,5");
  await tools(page).getByRole("button", { name: "Injecter la panne" }).click();
  await expect(pathButton(page, "ONT3")).toContainText("▼ Signal trop faible");
  await expect(pathButton(page, "ONT1")).toContainText("✓ Conforme");

  await measure(page, "PTO3", "out");
  await expect(measureLog(page)).toContainText("écart 4,50 dB");

  // Mauvais geste : rien n'est corrigé, et le laboratoire l'explique.
  await intervene(page, "Refaire l'épissure", "PBO1 in3");
  await expect(page.getByText("elle n'a corrigé aucun défaut à cet endroit")).toBeVisible();
  await intervene(page, "Nettoyer le connecteur", "PTO3 out");
  await expect(pathButton(page, "ONT3")).toContainText("✓ Conforme");
  await measure(page, "ONT3", "pon");
  await expect(measureLog(page).getByRole("listitem").first()).toContainText("écart 0,00 dB");
});

test("éditeur : connectiques compatibles, surcharge d'un ONT trop proche et réglage de la fibre", async ({ page }) => {
  await createProject(page, "Atelier FTTH");
  await addDevice(page, "PC");
  await addDevice(page, "ONT-1G");
  await selectDevice(page, "PC1");
  await expect(propertiesPanel(page)).toContainText("Aucun port libre compatible sur les autres équipements.");

  await addDevice(page, "OLT-16");
  await selectDevice(page, "ONT1");
  await connectSelectedTo(page, "OLT1 · pon1");
  await page.getByRole("tab", { name: "Optique" }).click();
  // Sans affaiblissement, l'ONT reçoit plus que sa limite de surcharge.
  await expect(pathButton(page, "ONT1")).toContainText("▲ Surcharge");

  await page.getByRole("tab", { name: "Configuration" }).click();
  await page.getByRole("button", { name: "Sélectionner le lien ONT1 · pon ↔ OLT1 · pon1" }).click();
  const fiber = propertiesPanel(page).getByRole("form", { name: "Fibre" });
  await fiber.getByLabel("Longueur (m)").fill("20000");
  await fiber.getByLabel("Câble").selectOption({ label: "Transport ou distribution" });
  await fiber.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByRole("cell", { name: "Fibre 20 km, G.657.A2" })).toBeVisible();

  // 20 km à 0,4 dB/km : 8 dB de plus ; le minimum reste nul, la surcharge demeure (les minimums non spécifiés valent 0).
  await page.getByRole("tab", { name: "Optique" }).click();
  await expect(pathButton(page, "ONT1")).toContainText("▲ Surcharge");
});

test("exercice « L'abonné sans service » : mesurer, situer, intervenir, remesurer", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/parcours");
  await page.getByRole("article", { name: "L'abonné sans service" }).getByRole("button", { name: "Commencer l'exercice" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await expect(page.getByRole("tab", { name: "Optique" })).toHaveAttribute("aria-selected", "true");

  const guide = page.getByRole("region", { name: "Guide de l'exercice" });
  const verify = guide.getByRole("button", { name: "Vérifier", exact: true });
  await expect(guide).toContainText("Étape 1 sur 6 : Constater le symptôme");
  // L'élève voit le symptôme, jamais la panne : pas d'onglet « Pannes ».
  await expect(pathButton(page, "ONT3")).toContainText("▼ Signal trop faible");
  await expect(tools(page).getByRole("tab", { name: "Pannes" })).toHaveCount(0);

  await verify.click();
  await expect(guide).toContainText("Pas encore constaté");
  await measure(page, "ONT3", "pon");
  await verify.click();
  await expect(guide).toContainText("Étape 2 sur 6 : Situer le défaut");

  await guide.getByRole("radio", { name: /branche propre à ONT3/ }).check();
  await guide.getByRole("button", { name: "Valider" }).click();
  await expect(guide).toContainText("Étape 3 sur 6 : Mesurer de proche en proche");

  await measure(page, "PTO3", "out");
  await guide.getByLabel("Votre réponse").fill("4,5");
  await guide.getByRole("button", { name: "Valider" }).click();
  await expect(guide).toContainText("Étape 4 sur 6 : Intervenir");

  await guide.getByRole("button", { name: "Vérifier la correction" }).click();
  await expect(guide).toContainText("ONT3 : ▼ Signal trop faible");
  await tools(page).getByRole("tab", { name: "Mesures" }).click();
  await tools(page).getByRole("button", { name: "Inspecter le connecteur out de PTO3" }).click();
  await expect(measureLog(page)).toContainText("face sale");
  await intervene(page, "Nettoyer le connecteur", "PTO3 out");
  await guide.getByRole("button", { name: "Vérifier la correction" }).click();
  await expect(guide).toContainText("Étape 5 sur 6 : Remesurer");

  await measure(page, "ONT3", "pon");
  await verify.click();
  await expect(guide).toContainText("Étape 6 sur 6 : À retenir");
  await guide.getByRole("button", { name: "Terminer l'exercice" }).click();
  await expect(guide).toContainText("Exercice terminé : 100 / 100 points.");
});
