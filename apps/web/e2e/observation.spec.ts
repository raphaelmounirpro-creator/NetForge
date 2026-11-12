import { expect, test, type Page } from "@playwright/test";
import { propertiesPanel, selectDevice } from "./helpers";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const actions = (page: Page) => page.getByRole("complementary", { name: "Actions de simulation" });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Commandes de la simulation" });
const journal = (page: Page) => page.getByRole("list", { name: "Journal des décisions du moteur" });
const side = (page: Page) => page.getByRole("complementary", { name: "État d'exécution" });
const dockTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Résultats de la simulation" }).getByRole("tab", { name });

async function simulate(page: Page, name: string, destination: string): Promise<void> {
  await page.goto("/projets");
  await page.getByTestId("import-input").setInputFiles(fixture(name));
  await expect(page).toHaveURL(/\/laboratoire$/);
  await page.getByRole("tab", { name: "Simulation" }).click();
  await expect(actions(page).getByRole("button", { name: "Lancer le ping" })).toBeEnabled();
  await actions(page).getByLabel("Destination (adresse ou nom)").fill(destination);
  await actions(page).getByLabel("Nombre d'échos").fill("1");
  await actions(page).getByRole("button", { name: "Lancer le ping" }).click();
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(bar(page)).toContainText("Tous les échanges en cours sont calculés");
}

test("suivre un échange de bout en bout : inspecteur, couches, deux niveaux d'explication", async ({ page }) => {
  await simulate(page, "routed.nfg.json", "192.168.2.10");
  await journal(page).getByRole("button", { name: /^IP R1 relaie le paquet vers 192\.168\.2\.10/ }).click();

  const panel = side(page);
  await expect(panel.getByRole("tab", { name: "Inspection" })).toHaveAttribute("aria-selected", "true");
  const ipv4 = panel.getByRole("region", { name: "Paquet IPv4" });
  await expect(ipv4).toContainText("Couche 3 · réseau");
  await expect(ipv4).toContainText("TTL63");
  await expect(panel.getByRole("region", { name: "Message ICMP" })).toContainText("8 (demande d'écho)");
  await expect(panel).toContainText("Seuls les champs modélisés par le moteur sont affichés");

  // Deux niveaux d'explication, produits à partir des mêmes faits.
  await expect(panel).toContainText("R1 relaie le paquet vers 192.168.2.10 directement sur ge1");
  await panel.getByRole("group", { name: "Niveau d'explication" }).getByRole("button", { name: "Technique" }).click();
  await expect(panel).toContainText("TTL décrémenté à 63 (RFC 1812 §5.3.1)");

  // Suivre l'échange : le journal ne montre plus que cet écho, de l'émission à la réponse.
  await panel.getByRole("button", { name: "Suivre cet échange" }).click();
  await expect(page.getByText(/Échange suivi : écho n° 1 du ping 1/)).toBeVisible();
  await page.getByRole("group", { name: "Niveau d'explication" }).first().getByRole("button", { name: "Débutant" }).click();
  const rows = journal(page).getByRole("listitem");
  await expect(rows.first()).toContainText("PC1 envoie la demande d'écho n° 1 vers 192.168.2.10");
  await expect(rows.last()).toContainText("PC1 : réponse de 192.168.2.10");
  await expect(journal(page)).not.toContainText("lance un ping");

  // Remonter à la cause d'une décision.
  await journal(page).getByRole("button", { name: /PC2 reçoit une demande d'écho/ }).click();
  await panel.getByRole("button", { name: "Inspecter la cause" }).click();
  await expect(panel).toContainText(/SW2|PC2/);
  await page.getByRole("button", { name: "Ne plus suivre" }).click();
  await expect(journal(page)).toContainText("lance un ping");
});

test("expliquer un échec : « Pourquoi ? » mène à la décision qui l'explique", async ({ page }) => {
  await simulate(page, "two-routers-no-return.nfg.json", "10.0.2.10");
  await dockTab(page, "Pings").click();
  await page.getByRole("button", { name: "Pourquoi la séquence 1 a-t-elle échoué ?" }).click();
  const panel = side(page);
  await expect(panel).toContainText("✕ Perte ou erreur");
  await expect(panel).toContainText("R2 abandonne le paquet : aucune route ne correspond à 10.0.1.10 et aucune route par défaut n'est configurée.");
  await expect(panel).toContainText("R2 · ge0");
  await expect(dockTab(page, "Journal")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Échange suivi : écho n° 1 du ping 1/)).toBeVisible();
});

test("console d'équipement : modes, consultation, configuration et ping", async ({ page }) => {
  await simulate(page, "routed.nfg.json", "192.168.2.10");
  await dockTab(page, "Console").click();
  const dock = page.getByRole("region", { name: "Résultats de la simulation" });
  await dock.getByLabel("Équipement").selectOption({ label: "R1" });
  const input = dock.getByRole("textbox");
  const output = dock.getByRole("log");
  const run = async (line: string) => {
    await input.fill(line);
    await input.press("Enter");
  };

  await run("sh routes");
  await expect(output).toContainText("192.168.2.0/24");
  await run("shwo arp");
  await expect(output).toContainText("Commande inconnue « shwo ».");
  await expect(output).toContainText("Vouliez-vous dire « show » ?");
  await input.fill("sh i");
  await input.press("Tab");
  await expect(input).toHaveValue("sh interfaces ");

  // Configuration par la console : même commande métier que le formulaire.
  await run("configure");
  await run("interface ge2");
  // L'invite indique le mode ; elle fait partie du nom accessible du champ de saisie.
  await expect(dock.getByRole("textbox", { name: "Commande pour R1 R1(config ge2)>" })).toBeVisible();
  await run("address 172.16.0.1/24");
  await expect(output).toContainText("Configuration appliquée au projet. La simulation demandera une réinitialisation");
  await run("end");
  await page.getByRole("tab", { name: "Topologie" }).click();
  await selectDevice(page, "R1");
  await expect(propertiesPanel(page).getByRole("group", { name: "Port ge2" }).getByLabel("Adresse IPv4")).toHaveValue("172.16.0.1");

  // Outils PC : ipconfig et ping, réponses affichées au fil du calcul.
  await page.getByRole("tab", { name: "Simulation" }).click();
  await page.getByRole("button", { name: "Réinitialiser avec la nouvelle configuration" }).click();
  await dockTab(page, "Console").click();
  await dock.getByLabel("Équipement").selectOption({ label: "PC1" });
  await run("ipconfig");
  await expect(output).toContainText("Adresse IPv4 . . . : 192.168.1.10");
  await run("ping 192.168.2.10 -n 2");
  await bar(page).getByRole("button", { name: "Terminer les échanges" }).click();
  await expect(output).toContainText("2 envoyé(s), 2 reçu(s), 0 perdu(s)");
  await run("arp -a");
  await expect(output).toContainText("192.168.1.1");
});
