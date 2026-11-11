import { EXERCISE_FORMAT, EXERCISE_VERSION, twoRoutersScenario } from "@netforge/engine";

/**
 * Exercice embarqué n° 1 (contenu pédagogique, validé par parseExercise au
 * chargement). Topologie : scénario de référence « deux routeurs » sans la
 * route de retour de R2.
 */
const project = twoRoutersScenario({ r2Route: false });

export const retourManquant = {
  format: EXERCISE_FORMAT,
  version: EXERCISE_VERSION,
  id: "retour-manquant",
  revision: 1,
  title: "Le retour manquant",
  summary: "PC1 n'arrive pas à joindre PC2 à travers deux routeurs. Trouvez pourquoi en suivant l'échange, puis corrigez.",
  level: "beginner",
  objective: "Comprendre qu'un ping exige un aller ET un retour, et que chaque routeur ne décide qu'à partir de sa propre table de routage.",
  statement:
    "Le réseau relie PC1 (10.0.1.10/24) à PC2 (10.0.2.10/24) par deux routeurs, R1 et R2. Le technicien précédent affirme que « tout est configuré ». Pourtant, le ping de PC1 vers PC2 échoue. Observez, formulez une hypothèse, mesurez, corrigez puis vérifiez.",
  allowed: ["simulation", "routes", "console"],
  project: { ...project, metadata: { ...project.metadata, id: "exercice-retour-manquant", name: "Exercice — Le retour manquant" } },
  steps: [
    {
      kind: "observe",
      title: "Observer le symptôme",
      instruction:
        "Dans la vue Simulation, lancez un ping de PC1 vers PC2 (10.0.2.10), puis « Terminer les échanges ». Regardez le résultat dans l'onglet Pings, puis cliquez sur « Vérifier ».",
      check: { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "failure" },
      points: 10,
    },
    {
      kind: "hypothesis",
      title: "Formuler une hypothèse",
      question:
        "Suivez un écho en échec (bouton « Pourquoi ? ») : PC2 reçoit bien la demande d'écho. Quelle est la cause la plus probable de l'échec ?",
      choices: [
        {
          id: "pc2-sans-adresse",
          text: "PC2 n'a pas d'adresse IP.",
          correct: false,
          feedback: "PC2 a reçu la demande d'écho adressée à 10.0.2.10 : son adresse est bien configurée.",
        },
        {
          id: "r2-sans-retour",
          text: "R2 ne sait pas joindre le réseau de PC1 : la réponse ne peut pas revenir.",
          correct: true,
          feedback: "Exact : l'aller fonctionne, c'est le retour qui échoue. Vérifiez-le dans la table de routage de R2.",
        },
        {
          id: "cable-r1-r2",
          text: "Le câble entre R1 et R2 est coupé.",
          correct: false,
          feedback: "La demande d'écho a traversé R1 puis R2 pour atteindre PC2 : ce câble transmet.",
        },
        {
          id: "pc1-sans-passerelle",
          text: "PC1 n'a pas de passerelle par défaut.",
          correct: false,
          feedback: "Sans passerelle, PC1 n'aurait rien émis vers 10.0.2.10 ; or sa demande a atteint PC2.",
        },
      ],
      points: 30,
      retryPoints: 15,
    },
    {
      kind: "measure",
      title: "Mesurer",
      question:
        "Consultez la table de routage de R2 (panneau « État d'exécution », ou « show routes » dans la console de R2). Quel réseau de destination manque-t-il pour joindre PC1 ? Exemple de notation : 192.168.5.0/24.",
      answer: { kind: "network", value: "10.0.1.0/24" },
      wrongFeedback:
        "Ce n'est pas le réseau attendu. Comparez l'adresse de PC1 (10.0.1.10/24) avec les destinations présentes dans la table de R2.",
      points: 20,
    },
    {
      kind: "fix",
      title: "Corriger",
      instruction:
        "Donnez à R2 un moyen de joindre le réseau de PC1 : sous-onglet Routes de R2 (vue Topologie) ou console de R2 (« configure » puis « route add … via … »). Plusieurs solutions sont acceptées. Cliquez ensuite sur « Vérifier la correction » : le moteur teste le ping dans les deux sens.",
      criteria: [
        { kind: "ping-succeeds", from: "pc1", to: "10.0.2.10" },
        { kind: "ping-succeeds", from: "pc2", to: "10.0.1.10" },
      ],
      points: 30,
    },
    {
      kind: "retest",
      title: "Retester",
      instruction:
        "Dans la vue Simulation, réinitialisez avec la nouvelle configuration, relancez le ping de PC1 vers 10.0.2.10 et terminez les échanges : toutes les réponses doivent revenir. Cliquez ensuite sur « Vérifier ».",
      check: { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "success" },
      points: 10,
    },
    {
      kind: "debrief",
      title: "À retenir",
      text: "Un ping réussi exige un aller ET un retour. Chaque routeur décide seul, à partir de sa propre table : R1 savait joindre 10.0.2.0/24, mais R2 ignorait le chemin vers 10.0.1.0/24 et abandonnait la réponse de PC2, en prévenant PC2 et jamais PC1. Côté PC1, on ne voit qu'un délai d'attente dépassé : c'est en suivant l'échange jusqu'au bout qu'on trouve la cause. Une route vers 10.0.1.0/24, une route plus large ou une route par défaut vers R1 corrigent toutes le problème : c'est le comportement qui compte.",
    },
  ],
  hints: [
    "Dans l'onglet Pings, cliquez sur « Pourquoi ? » : quel équipement abandonne un paquet, et lequel ?",
    "Le paquet abandonné est la réponse de PC2, pas la demande de PC1 : regardez la table de routage de R2.",
    "Sur R2 : « configure », puis « route add 10.0.1.0/24 via 10.0.12.1 » (ou le sous-onglet Routes de R2).",
  ],
  hintPenalty: 5,
};
