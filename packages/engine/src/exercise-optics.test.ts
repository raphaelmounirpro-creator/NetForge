import { disconnect, repair, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { evaluateCriteria, measurementConformity, measurementObserved, parseExercise, sameDecibel } from "./exercise.js";
import { measurePower } from "./optics.js";
import { ftthScenario } from "./scenarios.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

describe("critère de service optique", () => {
  it("échoue tant que la panne est présente et passe après la bonne intervention", () => {
    const broken = ftthScenario({ dirtyPto3: true });
    const before = evaluateCriteria(broken, [{ kind: "optical-service", ont: "ont3" }, { kind: "optical-service", ont: "ont1" }]);
    expect(before.ok && before.results.map((item) => [item.passed, item.opticalStatus])).toEqual([
      [false, "below-sensitivity"],
      [true, "ok"],
    ]);
    const fixed = ok(repair(broken, { action: "clean", target: { kind: "port", deviceId: "pto3", portId: "out" } }));
    const after = evaluateCriteria(fixed, [{ kind: "optical-service", ont: "ont3" }]);
    expect(after.ok && after.results[0]).toMatchObject({ passed: true, opticalStatus: "ok" });
  });

  it("échoue pour un ONT qu'aucun OLT n'atteint (correction « débrancher » refusée)", () => {
    const unplugged = ok(disconnect(ftthScenario({ dirtyPto3: true }), { linkId: "l12" }));
    const result = evaluateCriteria(unplugged, [{ kind: "optical-service", ont: "ont3" }]);
    expect(result.ok && result.results[0]).toMatchObject({ passed: false, opticalStatus: null });
  });
});

describe("réponses et observations optiques", () => {
  it("compare une valeur en dB quelle que soit la notation", () => {
    expect(sameDecibel("4,5", 4.5, 0.2)).toBe(true);
    expect(sameDecibel(" 4.6 dB ", 4.5, 0.2)).toBe(true);
    expect(sameDecibel("−27,4 dBm", -27.41, 0.1)).toBe(true);
    expect(sameDecibel("5", 4.5, 0.2)).toBe(false);
    expect(sameDecibel("environ 4", 4.5, 0.2)).toBe(false);
    expect(sameDecibel("", 4.5, 0.2)).toBe(false);
  });

  it("classe une mesure conforme ou en écart par rapport au bilan prévisionnel", () => {
    const doc = ftthScenario({ dirtyPto3: true });
    const atOnt3 = measurePower(doc, { direction: "downstream", point: { deviceId: "ont3", portId: "pon" } });
    const atOnt1 = measurePower(doc, { direction: "downstream", point: { deviceId: "ont1", portId: "pon" } });
    const notMeasurable = measurePower(doc, { direction: "downstream", point: { deviceId: "pbo1", portId: "out3" } });
    expect([measurementConformity(atOnt3), measurementConformity(atOnt1), measurementConformity(notMeasurable)]).toEqual(["deviation", "conform", null]);
    const check = { kind: "power-measured", deviceId: "ont3", portId: "pon", direction: "downstream", outcome: "deviation" } as const;
    expect(measurementObserved([atOnt1, atOnt3], check)).toBe(true);
    expect(measurementObserved([atOnt1], check)).toBe(false);
    expect(measurementObserved([atOnt3], { ...check, outcome: "conform" })).toBe(false);
    expect(measurementObserved([atOnt3], { ...check, direction: "upstream" })).toBe(false);
  });
});

describe("format des exercices, version 2", () => {
  const exercise = (version: number) => ({
    format: "netforge-exercise",
    version,
    id: "essai-ftth",
    revision: 1,
    title: "Essai",
    summary: "Résumé",
    level: "beginner",
    objective: "Objectif",
    statement: "Énoncé",
    allowed: ["optics"],
    project: ftthScenario({ dirtyPto3: true }),
    steps: [
      {
        kind: "observe",
        title: "Mesurer",
        instruction: "Mesurer à l'ONT3",
        check: { kind: "power-measured", deviceId: "ont3", portId: "pon", direction: "downstream", outcome: "deviation" },
        points: 10,
      },
      { kind: "measure", title: "Écart", question: "Quel écart ?", answer: { kind: "decibel", value: 4.5, tolerance: 0.2 }, wrongFeedback: "Non", points: 10 },
      { kind: "fix", title: "Réparer", instruction: "Réparer", criteria: [{ kind: "optical-service", ont: "ont3" }], points: 40 },
    ],
    hints: [],
    hintPenalty: 5,
  });

  it("accepte les mesures optiques et reste compatible avec la version 1 ; la version 3 (PON) les accepte aussi, la 4 n'existe pas", () => {
    expect(parseExercise(exercise(2)).ok).toBe(true);
    expect(parseExercise(exercise(1)).ok).toBe(true);
    expect(parseExercise(exercise(3)).ok).toBe(true);
    expect(parseExercise(exercise(4)).ok).toBe(false);
  });

  it("refuse une tolérance nulle ou une mesure sans sens", () => {
    const base = exercise(2);
    const steps = (step: unknown) => ({ ...base, steps: [step] });
    expect(parseExercise(steps({ ...base.steps[1], answer: { kind: "decibel", value: 4.5, tolerance: 0 } })).ok).toBe(false);
    const { direction: _removed, ...check } = base.steps[0]?.check ?? {};
    expect(parseExercise(steps({ ...base.steps[0], check })).ok).toBe(false);
  });
});
