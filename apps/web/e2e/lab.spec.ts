import { expect, test } from "@playwright/test";
import { addDevice, configureIpv4, connectSelectedTo, createProject, deviceList, expectSaved, propertiesPanel, selectDevice } from "./helpers";

test("parcours invité : placer, relier, configurer puis retrouver le projet après rechargement", async ({ page }) => {
  await createProject(page, "LAN de base");
  await addDevice(page, "PC");
  await addDevice(page, "PC");
  await addDevice(page, "S-24");

  await selectDevice(page, "PC1");
  await connectSelectedTo(page, "SW1 · ge1");
  await configureIpv4(page, "eth0", "192.168.1.10", "24");

  await selectDevice(page, "PC2");
  await connectSelectedTo(page, "SW1 · ge2");
  await configureIpv4(page, "eth0", "192.168.1.11", "255.255.255.0");
  await expectSaved(page);

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Projets ouverts" }).getByRole("button", { name: "LAN de base", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Configuration" }).click();
  const addressing = page.getByRole("region", { name: "Équipements et adressage" });
  await expect(addressing.getByRole("row", { name: /PC1/ })).toContainText("eth0 192.168.1.10/24");
  await expect(addressing.getByRole("row", { name: /PC2/ })).toContainText("eth0 192.168.1.11/24");
  const links = page.getByRole("region", { name: "Liens" });
  await expect(links.getByRole("row")).toHaveCount(3); // en-tête + 2 liens
});

test("export puis réimport comme copie : configuration identique", async ({ page }) => {
  await createProject(page, "Aller-retour");
  await addDevice(page, "R-200");
  await addDevice(page, "PC");
  await selectDevice(page, "R1");
  await connectSelectedTo(page, "PC1 · eth0");
  await configureIpv4(page, "ge0", "10.0.0.1", "30");
  await expectSaved(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("aller-retour.nfg.json");
  const original = JSON.parse(await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"))) as Record<string, unknown>;

  await page.getByRole("link", { name: "Projets" }).click();
  await page.getByTestId("import-input").setInputFiles({ name: "aller-retour.nfg.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  const dialog = page.getByRole("dialog", { name: "Ce projet existe déjà" });
  await dialog.getByRole("button", { name: "Importer comme copie" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await expect(page.getByRole("navigation", { name: "Projets ouverts" }).getByRole("button", { name: "Aller-retour (copie)", exact: true })).toBeVisible();

  const copyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter" }).click();
  const copy = JSON.parse(await (await (await copyDownload).createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"))) as Record<string, unknown>;
  for (const key of ["topology", "configurations", "layout", "schemaVersion", "models"]) {
    expect(copy[key], key).toEqual(original[key]);
  }
});

test("import invalide : refus expliqué et projet courant conservé", async ({ page }) => {
  await createProject(page, "À conserver");
  await addDevice(page, "PC");
  await expectSaved(page);

  await page.getByRole("link", { name: "Projets" }).click();
  await page.getByTestId("import-input").setInputFiles({
    name: "futur.nfg.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "netforge-project", schemaVersion: 12 })),
  });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Import refusé");
  await expect(alert).toContainText("version 12 du format");
  await expect(page.getByRole("row")).toHaveCount(2); // en-tête + projet existant

  await page.getByRole("link", { name: "Laboratoire", exact: true }).click();
  await expect(deviceList(page).getByRole("button", { name: /^PC1 / })).toBeVisible();
});

test("annuler et rétablir au clavier", async ({ page }) => {
  await createProject(page, "Historique");
  await addDevice(page, "PC");
  const list = deviceList(page);
  await expect(list.getByRole("button", { name: /^PC1 / })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(list.getByText("Aucun équipement pour l'instant.")).toBeVisible();
  await page.keyboard.press("Control+y");
  await expect(list.getByRole("button", { name: /^PC1 / })).toBeVisible();
});

test("la sélection et le projet sont conservés en changeant de vue", async ({ page }) => {
  await createProject(page, "Vues");
  await addDevice(page, "R-200");
  await page.getByRole("tab", { name: "Configuration" }).click();
  await expect(page.getByRole("button", { name: "Sélectionner R1" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Topologie" }).click();
  await expect(propertiesPanel(page).getByRole("heading", { name: /R1/ })).toBeVisible();
});

test("saisie invalide : erreur reliée au champ, aucune modification", async ({ page }) => {
  await createProject(page, "Saisie");
  await addDevice(page, "PC");
  await configureIpv4(page, "eth0", "192.168.1.300", "24");
  const address = propertiesPanel(page).getByLabel("Adresse IPv4");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(propertiesPanel(page)).toContainText("« 192.168.1.300 » n'est pas une adresse IPv4 valide");
  await configureIpv4(page, "eth0", "192.168.1.0", "24");
  await expect(propertiesPanel(page).getByRole("alert")).toContainText("c'est l'adresse du réseau");
});

test("canevas : déplacer un équipement puis relier deux équipements à la souris", async ({ page }) => {
  await createProject(page, "Canevas");
  const canvas = page.getByRole("region", { name: "Topologie" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canevas absent");
  const center = { x: box.x + Math.floor(box.width / 2), y: box.y + Math.floor(box.height / 2) };

  await addDevice(page, "PC"); // placé au centre de la vue
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 100, center.y, { steps: 5 });
  await page.mouse.move(center.x - 200, center.y, { steps: 5 });
  await page.mouse.up();
  await expectSaved(page);

  await addDevice(page, "S-24"); // le centre est de nouveau libre
  await page.getByRole("button", { name: "Relier deux équipements (L)" }).click();
  await page.mouse.click(center.x - 200, center.y);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByText("Lien créé : PC1 eth0 ↔ SW1 ge1.")).toBeVisible();
  await expect(propertiesPanel(page).getByRole("heading", { name: "Lien" })).toBeVisible();
});

test("deux onglets : lecture seule, puis prise de main explicite", async ({ page, context }) => {
  await createProject(page, "Partagé");
  await addDevice(page, "PC");
  await expectSaved(page);

  const second = await context.newPage();
  await second.goto("/projets");
  await second.getByRole("row", { name: /Partagé/ }).getByRole("button", { name: "Ouvrir" }).click();
  await expect(second.getByText("Projet en lecture seule")).toBeVisible();
  await expect(deviceList(second).getByRole("button", { name: /^PC1 / })).toBeVisible();
  await expect(second.getByRole("region", { name: "Ajouter un équipement" }).getByRole("button", { name: /^PC / })).toBeDisabled();

  await second.getByRole("button", { name: "Prendre la main ici" }).click();
  await expect(second.getByText("Projet en lecture seule")).toBeHidden();
  await expect(page.getByText("Projet en lecture seule")).toBeVisible();
});
