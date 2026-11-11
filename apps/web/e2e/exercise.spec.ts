import { expect, test, type Page } from "@playwright/test";

const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });

async function pingPc2(page: Page): Promise<void> {
  await actions(page).getByLabel("Adresse de destination").fill("10.0.2.10");
  await actions(page).getByLabel("Nombre d'échos").fill("1");
  await actions(page).getByRole("button", { name: "Lancer le ping" }).click();
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

test("exercice guidé « Le retour manquant » : du symptôme à l'explication", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/parcours");
  await expect(page.getByRole("heading", { name: "Le retour manquant" })).toBeVisible();
  await page.getByRole("article", { name: "Le retour manquant" }).getByRole("button", { name: "Commencer l'exercice" }).click();
  await expect(page).toHaveURL(/\/laboratoire$/);

  const guide = page.getByRole("region", { name: "Guide de l'exercice" });
  const verify = guide.getByRole("button", { name: "Vérifier", exact: true });
  const validate = guide.getByRole("button", { name: "Valider" });
  await expect(guide).toContainText("Étape 1 sur 6 : Observer le symptôme");
  await expect(guide).toContainText("Score : 0 / 100");

  // 1. Observer : la vérification exige un ping réellement calculé par le moteur.
  await verify.click();
  await expect(guide).toContainText("Pas encore constaté");
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
  await pingPc2(page);
  await verify.click();
  await expect(guide).toContainText("Étape 2 sur 6 : Formuler une hypothèse");

  // 2. Hypothèse : une mauvaise réponse est expliquée, la bonne rapporte moins après un essai.
  await guide.getByLabel("Le câble entre R1 et R2 est coupé.").check();
  await validate.click();
  await expect(guide).toContainText("Pas tout à fait : La demande d'écho a traversé R1 puis R2");
  await guide.getByLabel("R2 ne sait pas joindre le réseau de PC1 : la réponse ne peut pas revenir.").check();
  await validate.click();
  await expect(guide).toContainText("Bonne réponse (+15 points)");
  await expect(guide).toContainText("Étape 3 sur 6 : Mesurer");

  // 3. Mesurer : toute notation du bon réseau est acceptée.
  await guide.getByLabel("Votre réponse").fill("10.0.2.0/24");
  await validate.click();
  await expect(guide).toContainText("Pas tout à fait");
  await guide.getByLabel("Votre réponse").fill("10.0.1.0 255.255.255.0");
  await validate.click();
  await expect(guide).toContainText("Étape 4 sur 6 : Corriger");

  // 4. Corriger : vérification comportementale par le moteur, correction faite à la console.
  await guide.getByRole("button", { name: "Vérifier la correction" }).click();
  await expect(guide).toContainText("Le moteur constate encore un problème");
  await expect(guide).toContainText("ping de PC1 vers 10.0.2.10 : 0/2 réponse(s)");
  await page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name: "Console" }).click();
  const dock = page.getByRole("region", { name: "Résultats de la simulation" });
  await dock.getByLabel("Équipement").selectOption({ label: "R2" });
  for (const line of ["configure", "route add 0.0.0.0/0 via 10.0.12.1", "end"]) {
    await dock.getByRole("textbox").fill(line);
    await dock.getByRole("textbox").press("Enter");
  }
  await guide.getByRole("button", { name: "Vérifier la correction" }).click();
  await expect(guide).toContainText("Correction validée par le moteur (+30 points)");

  // 5. Retester : il faut réinitialiser la simulation pour qu'elle tienne compte de la correction.
  await verify.click();
  await expect(guide).toContainText("réinitialisez la simulation après la correction");
  await page.getByRole("button", { name: "Réinitialiser avec la nouvelle configuration" }).click();
  await pingPc2(page);
  await guide.getByRole("button", { name: "Afficher un indice (−5 points)" }).click();
  await expect(guide).toContainText("Indice 1 :");
  await verify.click();
  await expect(guide).toContainText("Étape 6 sur 6 : À retenir");

  // 6. Explication, score final : 10 + 15 + 20 + 30 + 10 − 5 (indice).
  await guide.getByRole("button", { name: "Terminer l'exercice" }).click();
  await expect(guide).toContainText("Exercice terminé : 80 / 100 points.");

  // La progression est conservée après rechargement.
  await page.reload();
  await expect(page.getByRole("region", { name: "Guide de l'exercice" })).toContainText("Score : 80 / 100");
});
