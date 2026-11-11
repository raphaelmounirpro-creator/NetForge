import { expect, type Browser, type Page } from "@playwright/test";

/*
 * Outils des parcours de compte sur la pile isolée (boîte de courrier locale
 * sur le port 8026 : aucun courrier réellement envoyé).
 */
export const MAIL = "http://localhost:8026/messages";
export const PASSWORD = "une phrase de passe pour les essais";
let counter = 0;
export const uniqueEmail = (prefix = "eleve") => `${prefix}-${String(Date.now())}-${String((counter += 1))}@exemple.test`;

export async function lastLink(to: string, path: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { messages } = (await (await fetch(MAIL)).json()) as { messages: { to: string; text: string }[] };
    const link = messages.find((mail) => mail.to.includes(to) && mail.text.includes(path))?.text.match(/https?:\/\/\S+#t=[A-Za-z0-9_-]{43}/)?.[0];
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`aucun lien ${path} pour ${to}`);
}

export async function register(page: Page, email: string): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre adresse e-mail" })).toBeVisible();
}

export async function confirm(page: Page, email: string): Promise<void> {
  await page.goto(await lastLink(email, "/confirmer-email"));
  // Le jeton est retiré de l'adresse affichée dès la lecture.
  await expect(page).toHaveURL(/\/confirmer-email$/);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Confirmer mon adresse" }).click();
  await expect(page.getByText("Adresse e-mail validée. Vous pouvez vous connecter.")).toBeVisible();
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("tabpanel").getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/projets$/);
  await expect(page.getByRole("button", { name: `Compte ${email}` })).toBeVisible();
}

/** Compte neuf, adresse validée, connecté. */
export async function newAccount(page: Page, prefix?: string): Promise<string> {
  const email = uniqueEmail(prefix);
  await register(page, email);
  await confirm(page, email);
  await signIn(page, email);
  return email;
}

export async function freshPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } })).newPage();
}
