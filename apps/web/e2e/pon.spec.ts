import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

/*
 * PON (phase 9, tranche 1) : réseau XGS-PON de référence. ONT1 autorisé et en
 * fonctionnement ; ONT2 au chemin optique conforme mais au numéro de série non
 * autorisé ; ONT3 GPON sur un OLT XGS-PON. Console et formulaires équivalents.
 */
const fixture = new URL("./fixtures/xgs-pon.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const paths = (page: Page) => page.getByRole("complementary", { name: "Chemins optiques" });
const tools = (page: Page) => page.getByRole("complementary", { name: "Outils optiques" });
const pathButton = (page: Page, ont: string) => paths(page).getByRole("button", { name: new RegExp(`→ ${ont} `) });
const dock = (page: Page) => page.getByRole("region", { name: "Résultats de la simulation" });
const log = (page: Page) => dock(page).getByRole("log");

async function load(page: Page): Promise<void> {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
}

async function ponTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Optique", exact: true }).click();
  await tools(page).getByRole("tab", { name: "PON", exact: true }).click();
}

async function line(page: Page, command: string): Promise<void> {
  await dock(page).getByRole("textbox").fill(command);
  await dock(page).getByRole("textbox").press("Enter");
}

test("PON : bilan XGS-PON, chemin conforme distinct d'un ONT enregistré, autorisation à la console", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Optique", exact: true }).click();
  await expect(pathButton(page, "ONT1")).toContainText("XGS-PON");
  await expect(pathButton(page, "ONT2")).toContainText("✓ Conforme");
  await expect(pathButton(page, "ONT3")).toContainText("OLT XGS-PON, ONT GPON");
  await expect(pathButton(page, "ONT3")).toContainText("⊘ Technologies PON incompatibles");

  // Bilan calculé à la main : 25,204 dB à 1 577 nm (marge 3,796 dB), 25,365 dB à 1 270 nm (marge 3,635 dB).
  await pathButton(page, "ONT1").click();
  const downstream = tools(page).getByRole("region", { name: "Descendant : OLT → ONT, 1 577 nm" });
  await expect(downstream).toContainText("Émission (OLT1, OLT XGS-PON classe N1)");
  await expect(downstream).toContainText("29,00 dB (classe N1 : 14 à 29 dB)");
  await expect(downstream).toContainText("16,10 à 25,20 dB");
  await expect(downstream).toContainText("3,80 dB (réserve conseillée 3,00 dB)");
  const upstream = tools(page).getByRole("region", { name: "Montant : ONT → OLT, 1 270 nm" });
  await expect(upstream).toContainText("16,10 à 25,37 dB");
  await expect(upstream).toContainText("3,63 dB (réserve conseillée 3,00 dB)");

  // Onglet PON : autorisés, découvert, étapes de l'ONT2 bloqué à l'attribution de l'identifiant.
  await ponTab(page);
  const port = tools(page).getByRole("region", { name: "OLT1 pon1 · XGS-PON" });
  await expect(port).toContainText("NFGE00000001 · identifiant 0 : ONT1, ✓ O5 · en fonctionnement");
  await expect(port).toContainText("NFGE000000FF · identifiant 5 : aucun ONT raccordé ne porte ce numéro");
  await expect(port).toContainText("NFGE00000002 (ONT2) : numéro de série découvert par l'OLT, mais non autorisé sur ce port");
  await tools(page).getByRole("button", { name: /^ONT2 · XGS-PON · NFGE00000002/ }).click();
  const steps = tools(page).getByRole("region", { name: "Étapes de l'activation de ONT2" });
  await expect(steps.getByRole("listitem").filter({ hasText: "Numéro de série reçu par l'OLT" })).toContainText("✓ franchie");
  await expect(steps.getByRole("listitem").filter({ hasText: "Identifiant attribué : Assign_ONU-ID (O2-3 → O4)" })).toContainText("✕ bloquée");
  await tools(page).getByRole("button", { name: /^ONT3 · GPON/ }).click();
  await expect(tools(page).getByRole("button", { name: /^ONT3 · GPON/ })).toContainText("technologie différente de celle de l'OLT");
  await page.screenshot({ path: "test-results/pon-optics-1440.png" });

  // Console de l'OLT : autoriser ONT2, puis lire l'activation.
  await page.getByRole("tab", { name: "Simulation", exact: true }).click();
  await dock(page).getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name: "Console", exact: true }).click();
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "OLT1" });
  await line(page, "configure");
  await line(page, "ont add pon1 nfge00000002");
  await expect(log(page)).toContainText("Configuration appliquée au projet.");
  await line(page, "end");
  await line(page, "show pon");
  await expect(log(page)).toContainText(/NFGE00000002\s+1\s+ONT2\s+✓ O5 · en fonctionnement/);
  await dock(page).getByLabel("Équipement", { exact: true }).selectOption({ label: "ONT3" });
  await line(page, "show pon");
  await expect(log(page)).toContainText("✕ O1 · état initial");
  await page.screenshot({ path: "test-results/pon-console-1440.png" });

  await ponTab(page);
  await expect(tools(page).getByRole("button", { name: /^ONT2 · XGS-PON/ })).toContainText("✓ O5 · en fonctionnement");
});

test("PON : formulaire de l'OLT et numéro de série de l'ONT équivalents à la console", async ({ page }) => {
  await load(page);
  await selectDevice(page, "OLT1");
  await propertiesPanel(page).getByRole("tab", { name: "PON", exact: true }).click();
  await expect(propertiesPanel(page)).toContainText("pon1 · NFGE00000001 · identifiant 0");
  await propertiesPanel(page).getByLabel("Numéro de série de l'ONT", { exact: true }).fill("nfge00000002");
  await propertiesPanel(page).getByRole("button", { name: "Autoriser l'ONT", exact: true }).click();
  await expect(propertiesPanel(page)).toContainText("pon1 · NFGE00000002 · identifiant 1");
  await propertiesPanel(page).getByLabel("Numéro de série de l'ONT", { exact: true }).fill("NFGE-2");
  await propertiesPanel(page).getByRole("button", { name: "Autoriser l'ONT", exact: true }).click();
  await expect(propertiesPanel(page).getByRole("alert")).toContainText("Numéro de série « NFGE-2 » invalide");
  await page.screenshot({ path: "test-results/pon-form-1440.png" });

  // ONT changé : nouveau numéro de série, l'ancienne autorisation ne le reconnaît plus.
  await selectDevice(page, "ONT1");
  await propertiesPanel(page).getByRole("tab", { name: "Général", exact: true }).click();
  const serial = propertiesPanel(page).getByLabel("Numéro de série", { exact: true });
  await expect(serial).toHaveValue("NFGE00000001");
  await serial.fill("ABCD00000001");
  await propertiesPanel(page).getByRole("button", { name: "Appliquer" }).last().click();
  await ponTab(page);
  await expect(tools(page).getByRole("button", { name: /^ONT1 · XGS-PON · ABCD00000001/ })).toContainText("◌ O2-3 · numéro de série, en attente d'identifiant");
  await expect(tools(page).getByRole("region", { name: "OLT1 pon1 · XGS-PON" })).toContainText("NFGE00000001 · identifiant 0 : aucun ONT raccordé ne porte ce numéro");
});
