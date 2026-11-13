import { expect, type Page } from "@playwright/test";

/** Ouvre le laboratoire et crée un projet invité nommé. */
export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nouveau projet" });
  await dialog.getByLabel("Nom du projet").fill(name);
  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByRole("navigation", { name: "Projets ouverts" }).getByRole("button", { name, exact: true })).toBeVisible();
}

const PALETTE_LABELS = { PC: "PC", "S-24": "Switch S-24", "R-200": "Routeur R-200", "OLT-16": "OLT-16", "OLT-XGS-8": "OLT-XGS-8", "ONT-1G": "ONT-1G", "ONT-10G": "ONT-10G" } as const;

export async function addDevice(page: Page, model: keyof typeof PALETTE_LABELS): Promise<void> {
  await page.getByRole("region", { name: "Ajouter un équipement" }).getByRole("button", { name: new RegExp(`^${PALETTE_LABELS[model]} `) }).click();
}

/** Sélectionne un équipement via la liste structurée (alternative au canevas). */
export async function selectDevice(page: Page, name: string): Promise<void> {
  await deviceList(page).getByRole("button", { name: new RegExp(`^${name} `) }).click();
}

/** Liste structurée des équipements du projet. */
export function deviceList(page: Page) {
  return page.getByRole("region", { name: "Équipements du projet" });
}

export function propertiesPanel(page: Page) {
  return page.getByRole("complementary", { name: "Propriétés" });
}

/** Relie le premier port libre de l'équipement sélectionné au port distant choisi. */
export async function connectSelectedTo(page: Page, remote: string): Promise<void> {
  const panel = propertiesPanel(page);
  await panel.getByLabel("Port distant").selectOption({ label: remote });
  await panel.getByRole("button", { name: "Relier", exact: true }).click();
}

export async function configureIpv4(page: Page, port: string, address: string, mask: string): Promise<void> {
  const group = propertiesPanel(page).getByRole("group", { name: `Port ${port}` });
  await group.getByLabel("Adresse IPv4").fill(address);
  await group.getByLabel("Masque").fill(mask);
  await group.getByRole("button", { name: "Appliquer" }).click();
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: "Enregistré localement" })).toBeVisible();
}
