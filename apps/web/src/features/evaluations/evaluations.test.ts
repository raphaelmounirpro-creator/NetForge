import { API_ERROR_CODES } from "@netforge/contracts";
import { ftthScenario, parseExercise, twoRoutersScenario, type ExerciseStep } from "@netforge/engine";
import { describe, expect, it } from "vitest";
import { messages } from "../../i18n";
import { draftProblems, newExercise, newStep, nextChoiceId, topologyDefaults } from "./editor/draft";
import { evaluationCodeOf } from "./ParcoursSections";

const KINDS: ExerciseStep["kind"][] = ["observe", "hypothesis", "measure", "fix", "retest", "debrief"];

describe("accès à une évaluation", () => {
  it("lit un code seul ou un lien complet, sans tenir compte de la casse", () => {
    expect(evaluationCodeOf("abcdefgh2345")).toBe("abcdefgh2345");
    expect(evaluationCodeOf("  ABCDEFGH2345 ")).toBe("abcdefgh2345");
    expect(evaluationCodeOf("https://netforge-amber.vercel.app/evaluation/abcdefgh2345")).toBe("abcdefgh2345");
    expect(evaluationCodeOf("https://netforge-amber.vercel.app/evaluation/abcdefgh2345/")).toBe("abcdefgh2345");
  });

  it("refuse un code de mauvaise longueur ou hors alphabet", () => {
    for (const input of ["", "abc", "abcdefgh23456", "abcdefgh2341", "https://exemple.fr/evaluation/"]) {
      expect(evaluationCodeOf(input), input).toBeNull();
    }
  });
});

describe("brouillon de l'éditeur", () => {
  it("crée un exercice valide pour le moteur à partir d'un projet", () => {
    expect(parseExercise(newExercise(twoRoutersScenario())).ok).toBe(true);
  });

  it("propose pour chaque type d'étape un modèle valide, fondé sur la topologie", () => {
    const project = twoRoutersScenario();
    const draft = newExercise(project);
    const full = { ...draft, steps: KINDS.map((kind) => newStep(kind, project)) };
    const parsed = parseExercise(full);
    expect(parsed.ok).toBe(true);
    const fix = full.steps.find((step) => step.kind === "fix");
    expect(fix?.kind === "fix" && fix.criteria[0]).toMatchObject({ kind: "ping-succeeds", from: topologyDefaults(project).from });
  });

  it("vise par défaut un autre poste, pas la passerelle du poste source (contrôle non trivial)", () => {
    expect(topologyDefaults(twoRoutersScenario({ r2Route: false }))).toMatchObject({ from: "pc1", to: "10.0.2.10" });
  });

  it("choisit un ONT comme cible optique quand la topologie en contient", () => {
    const project = ftthScenario();
    const ont = project.topology.devices.find((device) => device.model.startsWith("ONT"));
    expect(topologyDefaults(project).ont).toBe(ont?.id);
  });

  it("nomme les propositions sans doublon", () => {
    expect(nextChoiceId(["a", "b"])).toBe("c");
    expect(nextChoiceId("abcdefghijklmnopqrstuvwxyz".split(""))).toBe("choix-1");
  });

  it("rend les problèmes de validation lisibles, par lieu", () => {
    const draft = newExercise(twoRoutersScenario());
    const broken = { ...draft, title: "  ", steps: [draft.steps[0] ?? newStep("debrief", draft.project), { ...newStep("hypothesis", draft.project), question: "" }] };
    const problems = draftProblems(broken);
    expect(problems).toContain("Titre : valeur manquante ou invalide.");
    expect(problems).toContain("Étape 2 : valeur manquante ou invalide.");
    expect(draftProblems(draft)).toEqual([]);
  });
});

describe("textes des erreurs de l'API", () => {
  it("fournissent un message français pour chaque code, évaluations comprises", () => {
    for (const code of API_ERROR_CODES) expect(messages.apiErrors[code], code).toBeTruthy();
  });
});
