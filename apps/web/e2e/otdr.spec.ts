import { expect, test, type Page } from "@playwright/test";

/*
 * OTDR (phase 9, tranche 3) : réseau FTTH de référence. Trace complète
 * calculée à la main (6,954 km, 23,794 dB à 1 550 nm), puis coupure placée
 * par le formateur à 2 345 m d'ODF1 et localisée depuis l'OLT et depuis l'ONT1.
 */
const fixture = new URL("./fixtures/ftth.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const tools = (page: Page) => page.getByRole("complementary", { name: "Outils optiques" });

async function acquire(page: Page, point: string, direction: "Vers les abonnés" | "Vers l'OLT"): Promise<void> {
  await tools(page).getByRole("tab", { name: "OTDR", exact: true }).click();
  await tools(page).getByLabel("Point de raccordement").selectOption({ label: point });
  await tools(page).getByRole("radio", { name: direction }).check();
  await tools(page).getByRole("button", { name: "Lancer l'acquisition" }).click();
}

test("OTDR : événements positionnés, perte cumulée, coupure localisée des deux côtés", async ({ page }) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Optique", exact: true }).click();

  await acquire(page, "OLT1 pon1", "Vers les abonnés");
  const status = tools(page).getByRole("status");
  await expect(status).toHaveText("Trace de OLT1 pon1 vers ONT1 pon à 1 550 nm : 6,954 km, 23,79 dB jusqu'au connecteur final.");
  await expect(tools(page).getByText("NetForge ne montre que la branche vers ONT1")).toBeVisible();
  await expect(tools(page).getByRole("row", { name: /Coupleur CPL1 1:8/ })).toContainText("5,002 km");
  await expect(tools(page).getByRole("img", { name: /Trace OTDR/ })).toBeVisible();

  // Formateur : coupure à 2 345 m d'ODF1 sur le câble de transport.
  await tools(page).getByRole("tab", { name: "Pannes", exact: true }).click();
  await tools(page).getByLabel("Type de panne").selectOption({ label: "Coupure" });
  await tools(page).getByLabel("Élément concerné").selectOption({ label: "fibre ODF1 r1 ↔ CPL1 com" });
  await tools(page).getByLabel("Position depuis ODF1 (m, facultatif)").fill("2345");
  await tools(page).getByRole("button", { name: "Injecter la panne" }).click();
  await expect(tools(page)).toContainText("à 2,345 km de ODF1");

  await acquire(page, "OLT1 pon1", "Vers les abonnés");
  await expect(status).toContainText("fin de fibre inattendue à 2,347 km");
  await expect(tools(page).getByRole("row", { name: /Fin de fibre inattendue sur ODF1 r1 ↔ CPL1 com/ })).toBeVisible();
  await page.screenshot({ path: "test-results/otdr-1440.png" });
  // Depuis l'abonné : 1 952 m jusqu'au coupleur CPL1, puis 5 000 − 2 345 = 2 655 m.
  await acquire(page, "ONT1 pon", "Vers l'OLT");
  await expect(status).toContainText("fin de fibre inattendue à 4,607 km");
});
