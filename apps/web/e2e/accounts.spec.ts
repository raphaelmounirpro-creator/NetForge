import { expect, test, type Browser, type Page } from "@playwright/test";

/*
 * Parcours de compte sur une pile réelle isolée : interface, API, PostgreSQL,
 * boîte de courrier locale (aucun courrier réellement envoyé).
 */
const MAIL = "http://localhost:8026/messages";
const PASSWORD = "une phrase de passe pour les essais";
const NEW_PASSWORD = "une toute nouvelle phrase de passe";
let counter = 0;
const uniqueEmail = () => `eleve-${String(Date.now())}-${String((counter += 1))}@exemple.test`;

async function lastLink(to: string, path: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { messages } = (await (await fetch(MAIL)).json()) as { messages: { to: string; text: string }[] };
    const link = messages.find((mail) => mail.to.includes(to) && mail.text.includes(path))?.text.match(/https?:\/\/\S+#t=[A-Za-z0-9_-]{43}/)?.[0];
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`aucun lien ${path} pour ${to}`);
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre adresse e-mail" })).toBeVisible();
}

async function confirm(page: Page, email: string): Promise<void> {
  await page.goto(await lastLink(email, "/confirmer-email"));
  // Le jeton est retiré de l'adresse affichée dès la lecture.
  await expect(page).toHaveURL(/\/confirmer-email$/);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Confirmer mon adresse" }).click();
  await expect(page.getByText("Adresse e-mail validée. Vous pouvez vous connecter.")).toBeVisible();
}

async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("tabpanel").getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/projets$/);
  await expect(page.getByRole("button", { name: `Compte ${email}` })).toBeVisible();
}

async function freshPage(browser: Browser): Promise<Page> {
  return (await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 } })).newPage();
}

test("inscription, validation par courrier, connexion, projet du compte relu depuis un autre navigateur", async ({ page, browser }) => {
  const email = uniqueEmail();
  await register(page, email);
  // Avant validation : aucune session, message explicite.
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("tabpanel").getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("alert")).toContainText("Adresse e-mail non validée");

  await confirm(page, email);
  await signIn(page, email);

  // Projet de l'appareil, puis copie volontaire dans le compte.
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.getByRole("dialog", { name: "Nouveau projet" }).getByLabel("Nom du projet").fill("Atelier du compte");
  await page.getByRole("dialog", { name: "Nouveau projet" }).getByRole("button", { name: "Créer" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("link", { name: "Projets" }).click();
  await page.getByRole("button", { name: "Enregistrer une copie de Atelier du compte dans mon compte" }).click();
  await expect(page.getByText("Copie de « Atelier du compte » enregistrée dans votre compte.")).toBeVisible();
  const accountTable = page.getByRole("region", { name: "Projets de mon compte" });
  await expect(accountTable.getByRole("rowheader", { name: "Atelier du compte" })).toBeVisible();

  // Ouverture et modification : enregistrement dans le compte (révision suivante côté serveur).
  await accountTable.getByRole("button", { name: "Ouvrir" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("region", { name: "Ajouter un équipement" }).getByRole("button", { name: /^PC / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Enregistré dans le compte" })).toBeVisible();

  // Autre navigateur, aucun stockage local : la donnée vient du serveur.
  const other = await freshPage(browser);
  await signIn(other, email);
  const otherTable = other.getByRole("region", { name: "Projets de mon compte" });
  await expect(otherTable.getByRole("row", { name: /Atelier du compte 1 0/ })).toBeVisible();
  await expect(other.getByRole("region", { name: "Projets de cet appareil" })).toContainText("Aucun projet");
  await other.close();
});

test("mot de passe oublié : nouveau mot de passe, sessions fermées, ancien mot de passe refusé", async ({ page, browser }) => {
  const email = uniqueEmail();
  await register(page, email);
  await confirm(page, email);
  await signIn(page, email);

  const visitor = await freshPage(browser);
  await visitor.goto("/connexion");
  await visitor.getByRole("link", { name: "Mot de passe oublié ?" }).click();
  await visitor.getByLabel("Adresse e-mail").fill(email);
  await visitor.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(visitor.getByRole("status")).toContainText("Si cette adresse correspond à un compte");
  await visitor.goto(await lastLink(email, "/reinitialiser-mot-de-passe"));
  await visitor.getByLabel("Nouveau mot de passe").fill(NEW_PASSWORD);
  await visitor.getByLabel("Confirmer le mot de passe").fill(NEW_PASSWORD);
  await visitor.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }).click();
  await expect(visitor.getByRole("status")).toContainText("Mot de passe modifié");

  // L'ancienne session est révoquée côté serveur : au rechargement, plus de compte.
  await page.reload();
  await expect(page.getByRole("banner").getByRole("link", { name: "Se connecter" })).toBeVisible();
  await visitor.goto("/connexion");
  await visitor.getByLabel("Adresse e-mail").fill(email);
  await visitor.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await visitor.getByRole("tabpanel").getByRole("button", { name: "Se connecter" }).click();
  await expect(visitor.getByRole("alert")).toContainText("Adresse e-mail ou mot de passe incorrect.");
  await signIn(visitor, email, NEW_PASSWORD);
  await visitor.close();
});

test("connexion à 360 px, entièrement au clavier, erreurs annoncées, accès invité", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "fr-FR", viewport: { width: 360, height: 780 } })).newPage();
  await page.goto("/connexion");
  await expect(page.getByRole("tab", { name: "Connexion" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.getByLabel("Adresse e-mail").focus();
  await page.keyboard.type("inconnu@exemple.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type("une phrase de passe inconnue");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Afficher le mot de passe" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveAttribute("type", "text");
  await page.getByLabel("Mot de passe", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("Adresse e-mail ou mot de passe incorrect.");
  // La saisie est conservée après l'erreur.
  await expect(page.getByLabel("Adresse e-mail")).toHaveValue("inconnu@exemple.test");

  await page.getByRole("link", { name: "Explorer sans compte" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.close();
});

test("déconnexion : les projets du compte se ferment, ceux de l'appareil restent", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await confirm(page, email);
  await signIn(page, email);
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.getByRole("dialog", { name: "Nouveau projet" }).getByLabel("Nom du projet").fill("Projet local");
  await page.getByRole("dialog", { name: "Nouveau projet" }).getByRole("button", { name: "Créer" }).click();
  await page.getByRole("link", { name: "Projets" }).click();
  await page.getByRole("button", { name: "Enregistrer une copie de Projet local dans mon compte" }).click();
  await page.getByRole("region", { name: "Projets de mon compte" }).getByRole("button", { name: "Ouvrir" }).click();
  await expect(page.getByRole("navigation", { name: "Projets ouverts" })).toContainText("Projet local");

  await page.getByRole("button", { name: `Compte ${email}` }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("status")).toContainText("Vous êtes déconnecté.");
  await page.getByRole("link", { name: "Laboratoire", exact: true }).click();
  // Il reste un seul onglet « Projet local » : celui de l'appareil (la copie du compte est fermée).
  await expect(page.getByRole("navigation", { name: "Projets ouverts" }).getByRole("button", { name: "Projet local", exact: true })).toHaveCount(1);
  await page.getByRole("link", { name: "Projets" }).click();
  await expect(page.getByRole("region", { name: "Projets de mon compte" })).toHaveCount(0);
  await expect(page.getByRole("rowheader", { name: "Projet local" })).toBeVisible();
});
