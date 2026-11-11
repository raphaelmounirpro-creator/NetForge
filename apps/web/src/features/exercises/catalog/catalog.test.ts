import { evaluateCriteria, measurePower, sameDecibel, type Exercise } from "@netforge/engine";
import { addStaticRoute, repair, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { exercises, findExercise, invalidExercises } from "./index";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

function fixCriteria(exercise: Exercise) {
  return exercise.steps.flatMap((step) => (step.kind === "fix" ? step.criteria : []));
}

function exercise(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`exercice ${id} absent`);
  return found;
}

describe("catalogue des exercices embarqués", () => {
  it("charge tous les exercices sans erreur de format", () => {
    expect(invalidExercises).toEqual([]);
    expect(exercises.map((item) => item.id)).toEqual(["retour-manquant", "abonne-sans-service"]);
  });

  it("chaque critère de correction échoue sur la topologie de départ", () => {
    for (const item of exercises) {
      const result = evaluateCriteria(item.project, fixCriteria(item));
      expect(result.ok && result.results.some((criterion) => !criterion.passed), item.id).toBe(true);
    }
  });

  it("« Le retour manquant » est résolu par une route de retour sur R2", () => {
    const item = exercise("retour-manquant");
    const fixed = ok(addStaticRoute(item.project, { deviceId: "r2", route: { destination: "10.0.1.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
    const result = evaluateCriteria(fixed, fixCriteria(item));
    expect(result.ok && result.results.every((criterion) => criterion.passed)).toBe(true);
  });

  it("« L'abonné sans service » : la réponse attendue correspond à la mesure du moteur et le nettoyage résout la panne", () => {
    const item = exercise("abonne-sans-service");
    const measureStep = item.steps.find((step) => step.kind === "measure");
    if (measureStep?.answer.kind !== "decibel") throw new Error("étape de mesure en dB attendue");
    const reading = measurePower(item.project, { direction: "downstream", point: { deviceId: "pto3", portId: "out" } });
    expect(reading.deviationDb).not.toBeNull();
    expect(sameDecibel(String(reading.deviationDb), measureStep.answer.value, measureStep.answer.tolerance)).toBe(true);

    // Une intervention au mauvais endroit (jarretière de l'abonné) ne corrige rien.
    expect(repair(item.project, { action: "clean", target: { kind: "port", deviceId: "ont3", portId: "pon" } }).ok).toBe(false);
    const fixed = ok(repair(item.project, { action: "clean", target: { kind: "port", deviceId: "pto3", portId: "out" } }));
    const result = evaluateCriteria(fixed, fixCriteria(item));
    expect(result.ok && result.results.every((criterion) => criterion.passed)).toBe(true);
  });
});
