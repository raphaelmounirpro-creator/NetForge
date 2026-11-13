import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

/*
 * Exports des bilans (phase 9, tranche 5) : fichiers réellement téléchargés
 * depuis la vue Optique, relus et comparés au bilan affiché (24,974 dB de
 * pertes maximales et 3,026 dB de marge sur le chemin ONT1).
 */
const fixture = new URL("./fixtures/ftth.nfg.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("exports des bilans : CSV pour un tableur et PDF, cohérents avec le bilan affiché", async ({ page }, testInfo) => {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture);
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Optique", exact: true }).click();
  const exports = page.getByRole("region", { name: "Exporter les bilans" });
  await exports.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/exports-1440.png" });

  const [csvDownload] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name: "Bilans en CSV" }).click()]);
  expect(csvDownload.suggestedFilename()).toBe("reseau-ftth-bilans.csv");
  const csvPath = testInfo.outputPath("bilans.csv");
  await csvDownload.saveAs(csvPath);
  const csv = await readFile(csvPath, "utf8");
  expect(csv.startsWith("﻿Chemin;OLT;Port OLT;ONT;")).toBe(true);
  expect(csv).toContain("OLT1 pon1 → ONT1;OLT1;pon1;ONT1;GPON;GPON;descendant;1490;");
  expect(csv).toMatch(/OLT1 pon1 → ONT1;[^\r\n]*;13,600;24,974;0,000;-23,474;3,026;[^\r\n]*;Conforme\r\n/);

  const [pdfDownload] = await Promise.all([page.waitForEvent("download"), exports.getByRole("button", { name: "Bilans en PDF" }).click()]);
  expect(pdfDownload.suggestedFilename()).toBe("reseau-ftth-bilans.pdf");
  const pdfPath = testInfo.outputPath("bilans.pdf");
  await pdfDownload.saveAs(pdfPath);
  const pdf = (await readFile(pdfPath)).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdf.endsWith("%%EOF\n")).toBe(true);
  expect(pdf).toContain("(Chemin OLT1 pon1 -> ONT1 \\267 GPON \\267 \\351tat : OK Conforme) Tj");
  // Parenthèses du texte échappées dans la chaîne PDF : « \( » et « \) ».
  expect(pdf).toMatch(/\(\s+Connexion ONT1 pon \\\(SC\/APC\\\)\s+0,500\s+24,974\) Tj/);
});
