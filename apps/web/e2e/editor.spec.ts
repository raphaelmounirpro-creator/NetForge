import { expect, test } from "@playwright/test";
import { createProject, deviceList, expectSaved, propertiesPanel } from "./helpers";

test("notes libres : rédaction, liste, export/réimport, sans effet sur la simulation", async ({ page }) => {
  await createProject(page, "Plan annoté");
  await page.getByRole("region", { name: "Ajouter un équipement" }).getByRole("button", { name: /^PC / }).click();
  await page.getByRole("button", { name: /^Ajouter une note/ }).click();
  const panel = propertiesPanel(page);
  await expect(panel.getByRole("heading", { name: "Note" })).toBeVisible();
  await panel.getByLabel("Texte de la note").fill("Baie B2 <b>salle 3</b>");
  await panel.getByRole("button", { name: "Appliquer" }).click();
  const notes = page.getByRole("region", { name: "Notes du projet" });
  await expect(notes.getByRole("button", { name: "Baie B2 <b>salle 3</b>" })).toBeVisible();
  await expectSaved(page);

  // Une note n'est pas une modification du réseau simulé.
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(page.getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
  await page.getByRole("tab", { name: "Topologie" }).click();
  await notes.getByRole("button", { name: "Baie B2 <b>salle 3</b>" }).click();
  await panel.getByLabel("Texte de la note").fill("Baie B2");
  await panel.getByRole("button", { name: "Appliquer" }).click();
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(page.getByText("Configuration modifiée")).toBeHidden();
  await page.getByRole("tab", { name: "Topologie" }).click();

  // Export puis réimport : la note est conservée telle quelle.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter" }).click();
  const text = await (await (await download).createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  const exported = JSON.parse(text) as { schemaVersion: number; layout: { annotations: Array<{ text: string }> } };
  expect(exported.schemaVersion).toBe(15);
  expect(exported.layout.annotations.map((note) => note.text)).toEqual(["Baie B2"]);
  await page.getByRole("link", { name: "Projets" }).click();
  await page.getByTestId("import-input").setInputFiles({ name: "plan.nfg.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await page.getByRole("dialog", { name: "Ce projet existe déjà" }).getByRole("button", { name: "Importer comme copie" }).click();
  await expect(page.getByRole("region", { name: "Notes du projet" }).getByRole("button", { name: "Baie B2" })).toBeVisible();

  // Suppression au clavier comme un équipement.
  await page.getByRole("region", { name: "Notes du projet" }).getByRole("button", { name: "Baie B2" }).click();
  await propertiesPanel(page).getByRole("button", { name: "Supprimer la note" }).click();
  await expect(page.getByRole("region", { name: "Notes du projet" })).toContainText("Aucune note.");
});

test("glisser-déposer un équipement depuis la palette, mini-carte de navigation", async ({ page }) => {
  await createProject(page, "Glisser");
  const canvas = page.getByRole("region", { name: "Topologie", exact: true });
  const router = page.getByRole("region", { name: "Ajouter un équipement" }).getByRole("button", { name: /^Routeur R-200 / });
  await router.dragTo(canvas, { targetPosition: { x: 200, y: 150 } });
  await expect(deviceList(page).getByRole("button", { name: /^R1 / })).toBeVisible();
  await expectSaved(page);

  const minimap = page.getByTitle("Mini-carte : cliquez pour recentrer la vue");
  await expect(minimap).toBeVisible();
  const before = await canvas.evaluate((element) => (element as HTMLElement).style.backgroundPosition);
  await minimap.click({ position: { x: 170, y: 110 } });
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLElement).style.backgroundPosition)).not.toBe(before);
});
