import { expect, test, type Page } from "@playwright/test";
import { freshPage, newAccount } from "./accountHelpers";

/*
 * Phase 6 sur la pile isolée : un auteur crée un exercice dans l'éditeur,
 * l'essaie en entraînement, le publie ; un élève le passe et reçoit une note
 * calculée par le serveur. Aucun critère ni bonne réponse dans la page de
 * l'élève avant la note.
 */

async function consoleOn(page: Page, device: string, lines: readonly string[]): Promise<void> {
  await page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name: "Console" }).click();
  const dock = page.getByRole("region", { name: "Résultats de la simulation" });
  await dock.getByLabel("Équipement").selectOption({ label: device });
  for (const line of lines) {
    await dock.getByRole("textbox").fill(line);
    await dock.getByRole("textbox").press("Enter");
  }
}

test("exercice créé dans l'éditeur, essayé, publié, puis passé et noté par le serveur", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Auteur : topologie de départ prise dans l'exercice embarqué « Le retour manquant ».
  await newAccount(page, "auteur");
  await page.goto("/parcours");
  await page.getByRole("article", { name: "Le retour manquant" }).getByRole("button", { name: "Commencer l'exercice" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);

  await page.goto("/parcours");
  await page.getByRole("link", { name: "Mes exercices" }).click();
  await page.getByRole("button", { name: "Nouvel exercice à partir du projet ouvert" }).click();
  await expect(page).toHaveURL(/\/exercices\/[0-9a-f-]{36}$/);

  // Rédaction : titre, une hypothèse, une correction comportementale, un indice.
  await page.getByLabel("Titre", { exact: true }).fill("Route de retour (évaluée)");
  await page.getByLabel("Type d'étape").selectOption({ label: "Hypothèse" });
  await page.getByRole("button", { name: "Ajouter une étape" }).click();
  const hypothesis = page.getByRole("article", { name: "Étape 2 · Hypothèse" });
  await hypothesis.getByLabel("Question").fill("Pourquoi PC1 n'obtient-il aucune réponse ?");
  await hypothesis.getByLabel("Proposition 1", { exact: true }).fill("Il manque à R2 la route de retour vers le réseau de PC1.");
  await hypothesis.getByLabel("Proposition 2", { exact: true }).fill("Le câble entre R1 et R2 est coupé.");
  await page.getByLabel("Type d'étape").selectOption({ label: "Correction" });
  await page.getByRole("button", { name: "Ajouter une étape" }).click();
  const fix = page.getByRole("article", { name: "Étape 3 · Correction" });
  await fix.getByLabel("Depuis").selectOption({ label: "PC1" });
  await fix.getByLabel("Vers (adresse IPv4)").fill("10.0.2.10");
  await page.getByRole("button", { name: "Ajouter un indice" }).click();
  await page.getByLabel("Indice 1", { exact: true }).fill("Affichez la table de routage de R2.");
  await expect(page.getByText("Barème : 30 points en entraînement, 30 points en évaluation")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Enregistré : révision 2.").first()).toBeVisible();
  const editorUrl = page.url();

  // Essai en entraînement : le guide local s'ouvre dans le laboratoire.
  await page.getByRole("button", { name: "Essayer en entraînement" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);
  await expect(page.getByRole("heading", { name: "Exercice : Route de retour (évaluée)" })).toBeVisible();

  // Publication : une tentative, lien à transmettre.
  await page.goto(editorUrl);
  await page.getByLabel("Tentatives par élève").fill("1");
  await page.getByRole("button", { name: "Publier la révision 2" }).click();
  await expect(page.getByText("Évaluation publiée : transmettez le lien ci-dessous.")).toBeVisible();
  const link = await page.getByLabel("Lien de l'évaluation (révision 2)").inputValue();
  expect(link).toMatch(/\/evaluation\/[a-z2-7]{12}$/);

  // Élève : autre navigateur, autre compte.
  const student = await freshPage(browser);
  await newAccount(student, "eleve");
  await student.goto(link);
  await expect(student.getByRole("heading", { name: "Évaluation : Route de retour (évaluée)" })).toBeVisible();
  await expect(student.getByText("30 points · pénalité de 0 point(s) par indice · 1 tentative(s) au plus.", { exact: false })).toBeVisible();
  await student.getByRole("button", { name: "Commencer l'évaluation" }).click();
  await expect(student).toHaveURL(/\/laboratoire$/);
  const panel = student.getByRole("region", { name: "Évaluation en cours" });
  await expect(panel.getByRole("heading", { name: "Évaluation : Route de retour (évaluée)" })).toBeVisible();
  // Partie publique seulement : ni bonne réponse marquée, ni critère.
  await expect(panel.getByText("Bonne réponse")).toHaveCount(0);
  await expect(panel.getByText("10.0.2.10")).toHaveCount(0);

  await panel.getByRole("button", { name: "Demander un indice (−0 point(s))" }).click();
  await expect(panel.getByText("Affichez la table de routage de R2.")).toBeVisible();
  await panel.getByLabel("Il manque à R2 la route de retour vers le réseau de PC1.").check();
  await consoleOn(student, "R2", ["configure", "route add 10.0.1.0/24 via 10.0.12.1", "end"]);

  await panel.getByRole("button", { name: "Soumettre pour correction" }).click();
  const dialog = student.getByRole("dialog", { name: "Soumettre la tentative ?" });
  await dialog.getByRole("button", { name: "Soumettre" }).click();
  await expect(panel.getByText("Note : 30 / 30")).toBeVisible();
  await expect(panel.getByText(/Nouvelle étape : 20 \/ 20 \(obtenu\)/)).toBeVisible();
  await expect(panel.getByText(/correcteur version 10/)).toBeVisible();

  // Tentatives épuisées ; résultat consultable depuis la page de l'évaluation.
  await student.goto(link);
  await expect(student.getByText("Vous avez utilisé toutes vos tentatives.")).toBeVisible();
  await student.getByRole("button", { name: "Voir le résultat" }).click();
  await expect(student.getByText("Note : 30 / 30").last()).toBeVisible();

  // Auteur : la publication compte une tentative.
  await page.goto(editorUrl);
  await expect(page.getByText(/Révision 2 · 1 tentative\(s\) commencée\(s\)/)).toBeVisible();
});
