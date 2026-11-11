import { EXERCISE_FORMAT, EXERCISE_VERSION, ftthScenario } from "@netforge/engine";

/**
 * Exercice embarqué n° 2 : dépannage FTTH. Topologie : scénario de référence
 * FTTH (OLT, tiroir, coupleurs 1:8 puis 1:4, PBO, trois PTO et trois ONT),
 * avec un connecteur sale à la sortie de PTO3 (+4,5 dB). La panne est
 * masquée à l'élève : il ne voit que les symptômes et ses mesures.
 */
const project = ftthScenario({ dirtyPto3: true });

export const connecteurSale = {
  format: EXERCISE_FORMAT,
  version: EXERCISE_VERSION,
  id: "abonne-sans-service",
  revision: 1,
  title: "L'abonné sans service",
  summary: "Sur un réseau FTTH, l'abonné 3 n'a plus de service alors que ses voisins fonctionnent. Mesurez, localisez, intervenez.",
  level: "beginner",
  objective:
    "Localiser une perte optique en comparant les branches d'un coupleur et en mesurant de proche en proche, puis choisir l'intervention adaptée et la vérifier par une nouvelle mesure.",
  statement:
    "Un OLT dessert trois abonnés par un tiroir optique, un coupleur 1:8 puis un coupleur 1:4, un PBO et trois prises terminales (PTO). Le réseau a été réceptionné avec une marge d'environ 3 dB pour chaque abonné. Depuis une intervention chez l'abonné 3, son ONT ne reçoit plus assez de lumière. Les ONT 1 et 2 fonctionnent.",
  allowed: ["optics", "topology"],
  project: { ...project, metadata: { ...project.metadata, id: "exercice-abonne-sans-service", name: "Exercice — L'abonné sans service" } },
  steps: [
    {
      kind: "observe",
      title: "Constater le symptôme",
      instruction:
        "Dans la vue Optique, ouvrez l'onglet Mesures, choisissez ONT3 (liste « Équipement à mesurer » ou canevas) et mesurez en descendant (1 490 nm) au port pon. Comparez la puissance mesurée à la puissance attendue, puis cliquez sur « Vérifier ».",
      check: { kind: "power-measured", deviceId: "ont3", portId: "pon", direction: "downstream", outcome: "deviation" },
      points: 10,
    },
    {
      kind: "hypothesis",
      title: "Situer le défaut",
      question: "Mesurez aussi aux ports pon de ONT1 et ONT2 : leurs mesures sont conformes au bilan. Où se trouve le défaut le plus probable ?",
      choices: [
        {
          id: "tronc-commun",
          text: "Sur le tronc commun : OLT, tiroir optique, câble de transport ou coupleur CPL1.",
          correct: false,
          feedback: "Un défaut du tronc commun affaiblirait aussi ONT1 et ONT2, or leurs mesures sont conformes.",
        },
        {
          id: "branche-ont3",
          text: "Sur la branche propre à ONT3, après le dernier point commun (coupleur CPL2).",
          correct: true,
          feedback: "Exact : seule la branche d'ONT3 présente un écart. Le défaut se situe entre la sortie de CPL2 et ONT3.",
        },
        {
          id: "olt-faible",
          text: "L'OLT émet trop faiblement.",
          correct: false,
          feedback: "Un émetteur affaibli pénaliserait tous les abonnés du port PON, pas un seul.",
        },
      ],
      points: 25,
      retryPoints: 10,
    },
    {
      kind: "measure",
      title: "Mesurer de proche en proche",
      question:
        "Mesurez en descendant à la sortie de PTO3 (port out), avant la jarretière de l'abonné. Quel écart, en dB, le photomètre indique-t-il par rapport au bilan prévisionnel ? Exemple de notation : 2,5.",
      answer: { kind: "decibel", value: 4.5, tolerance: 0.2 },
      wrongFeedback: "Relisez la ligne du journal pour PTO3 out : l'écart est la différence entre la puissance attendue et la puissance mesurée.",
      points: 20,
    },
    {
      kind: "fix",
      title: "Intervenir",
      instruction:
        "Le défaut est présent dès la sortie de PTO3 : la jarretière de l'abonné n'est pas en cause. Inspectez les connecteurs concernés (bouton « Inspecter »), puis effectuez l'intervention adaptée dans l'onglet Interventions. Cliquez ensuite sur « Vérifier la correction » : le moteur recalcule le bilan des trois abonnés.",
      criteria: [
        { kind: "optical-service", ont: "ont3" },
        { kind: "optical-service", ont: "ont1" },
        { kind: "optical-service", ont: "ont2" },
      ],
      points: 35,
    },
    {
      kind: "retest",
      title: "Remesurer",
      instruction: "Remesurez en descendant au port pon d'ONT3 : la mesure doit être conforme au bilan. Cliquez ensuite sur « Vérifier ».",
      check: { kind: "power-measured", deviceId: "ont3", portId: "pon", direction: "downstream", outcome: "conform" },
      points: 10,
    },
    {
      kind: "debrief",
      title: "À retenir",
      text: "Un connecteur sale ajoute une perte (ici 4,5 dB) qui suffit à faire passer un abonné sous la sensibilité de son ONT, alors que la conception lui laissait environ 3 dB de marge. Méthode : comparer les branches pour situer le défaut après le dernier point commun, mesurer de proche en proche pour l'encadrer, inspecter avant de nettoyer, puis remesurer pour vérifier. Un connecteur s'inspecte toujours avant d'être raccordé : une poussière invisible à l'œil nu suffit.",
    },
  ],
  hints: [
    "Comparez ONT3 avec ONT1 et ONT2 : quel est le dernier équipement commun à leurs trois chemins ?",
    "Sur la branche d'ONT3, seuls deux ports ont un connecteur : PTO3 out et ONT3 pon. Inspectez-les.",
  ],
  hintPenalty: 5,
};
