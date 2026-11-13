import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * Vue arborescente et implantation (phase 9, tranche 4) : réseau FTTH de
 * référence, état de chaque branche lisible sans couleur, implantation par
 * rue et immeuble, formulaire d'implantation.
 */
const fixture = new URL("./fixtures/ftth.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const left = (page: Page) => page.getByRole("complementary", { name: "Chemins optiques" });
const tools = (page: Page) => page.getByRole("complementary", { name: "Outils optiques" });

test("arbre du réseau et implantation : états par branche, panne visible, adresse modifiée", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Optique", exact: true }).click();

  await left(page).getByRole("tab", { name: "Arbre", exact: true }).click();
  const tree = left(page).getByRole("region", { name: "Arbre du réseau" });
  await expect(tree).toContainText("OLT1 pon1 · GPON");
  await expect(tree).toContainText("PBO1 (PBO-8) · entrée in1, in2, in3");
  await expect(tree.getByText("ONT1 : ✓ Conforme · ✓ O5 · en fonctionnement")).toBeVisible();
  await expect(tree.getByText("✓ 3 ONT en service").first()).toBeVisible();

  // Connecteur sale à la sortie de PTO3 : la branche de l'ONT3 passe hors service.
  await tools(page).getByRole("tab", { name: "Pannes", exact: true }).click();
  await tools(page).getByLabel("Type de panne").selectOption({ label: "Connecteur sale" });
  await tools(page).getByLabel("Élément concerné").selectOption({ label: "PTO3 out" });
  await tools(page).getByLabel("Perte supplémentaire (dB)").fill("4,5");
  await tools(page).getByRole("button", { name: "Injecter la panne" }).click();
  await expect(tree.getByText("✕ 1 ONT hors service sur 3").first()).toBeVisible();
  await expect(tree.getByText("ONT3 : ▼ Signal trop faible · ✕ O1 · état initial")).toBeVisible();
  await page.screenshot({ path: "test-results/tree-1440.png" });

  await left(page).getByRole("tab", { name: "Implantation", exact: true }).click();
  const sites = left(page).getByRole("region", { name: "Implantation" });
  await expect(sites).toContainText("Avenue des Tilleuls");
  await expect(sites).toContainText("Central optique");
  await expect(sites.getByRole("listitem").filter({ hasText: /^PTO1 \(Prise terminale optique \(PTO\)\) · Appartement 11$/ })).toBeVisible();
  await expect(sites.getByRole("listitem").filter({ hasText: /^ONT3 .*Appartement 21 · ✕ O1/ })).toBeVisible();

  // Implantation modifiée par le formulaire de l'équipement.
  await page.getByRole("tab", { name: "Topologie", exact: true }).click();
  await selectDevice(page, "PBO1");
  await propertiesPanel(page).getByRole("tab", { name: "Général", exact: true }).click();
  await expect(propertiesPanel(page).getByLabel("Rue", { exact: true })).toHaveValue("Rue des Lilas");
  await propertiesPanel(page).getByLabel("Logement, étage ou local", { exact: true }).fill("Local vélos");
  await propertiesPanel(page).getByRole("button", { name: "Enregistrer l'implantation" }).click();
  await page.screenshot({ path: "test-results/location-form-1440.png" });
  await page.getByRole("tab", { name: "Optique", exact: true }).click();
  await left(page).getByRole("tab", { name: "Implantation", exact: true }).click();
  await expect(sites.getByRole("listitem").filter({ hasText: /^PBO1 .*· Local vélos$/ })).toBeVisible();
});
