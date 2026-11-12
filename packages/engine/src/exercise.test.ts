import { addStaticRoute, setDefaultGateway, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { evaluateCriteria, maxScore, parseExercise, pingObserved, sameNetwork, type Criterion } from "./exercise.js";
import { dhcpScenario, twoRoutersScenario } from "./scenarios.js";
import type { PingView } from "./views.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

const bothWays: Criterion[] = [
  { kind: "ping-succeeds", from: "pc1", to: "10.0.2.10" },
  { kind: "ping-succeeds", from: "pc2", to: "10.0.1.10" },
];

describe("critères comportementaux", () => {
  it("attendent l'attribution DHCP avant le ping de contrôle", () => {
    const result = evaluateCriteria(dhcpScenario(), [{ kind: "ping-succeeds", from: "pc1", to: "10.0.0.2" }]);
    expect(result.ok && result.results[0]).toMatchObject({ passed: true, replies: 2 });
  });
  it("échouent sur la topologie de départ (route de retour manquante)", () => {
    const result = evaluateCriteria(twoRoutersScenario({ r2Route: false }), bothWays);
    expect(result.ok && result.results.map((item) => item.passed)).toEqual([false, false]);
  });

  it("acceptent plusieurs corrections valides", () => {
    const start = twoRoutersScenario({ r2Route: false });
    const exact = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "10.0.1.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
    const byDefault = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "0.0.0.0", prefixLength: 0, nextHop: "10.0.12.1" } }));
    const broader = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "10.0.0.0", prefixLength: 16, nextHop: "10.0.12.1" } }));
    for (const doc of [exact, byDefault, broader]) {
      const result = evaluateCriteria(doc, bothWays);
      expect(result.ok && result.results.every((item) => item.passed)).toBe(true);
    }
  });

  it("refusent une correction qui en casse une autre", () => {
    const start = twoRoutersScenario({ r2Route: false });
    let doc = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "10.0.1.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
    doc = ok(setDefaultGateway(doc, { deviceId: "pc2", gateway: null }));
    const result = evaluateCriteria(doc, bothWays);
    expect(result.ok && result.results.map((item) => item.passed)).toEqual([false, false]);
  });

  it("vérifient aussi qu'un échange doit échouer", () => {
    const result = evaluateCriteria(twoRoutersScenario({ r2Route: false }), [{ kind: "ping-fails", from: "pc1", to: "10.0.2.10" }]);
    expect(result.ok && result.results[0]?.passed).toBe(true);
  });

  it("ne passent pas pour un équipement inconnu", () => {
    const result = evaluateCriteria(twoRoutersScenario(), [{ kind: "ping-succeeds", from: "absent", to: "10.0.2.10" }]);
    expect(result.ok && result.results[0]).toMatchObject({ passed: false, sent: 0 });
  });
});

describe("mesure et observation", () => {
  it("compare un réseau quelle que soit la notation", () => {
    expect(sameNetwork("10.0.1.0/24", "10.0.1.0/24")).toBe(true);
    expect(sameNetwork(" 10.0.1.0   255.255.255.0 ", "10.0.1.0/24")).toBe(true);
    expect(sameNetwork("10.0.1.0/16", "10.0.1.0/24")).toBe(false);
    expect(sameNetwork("10.0.2.0/24", "10.0.1.0/24")).toBe(false);
    expect(sameNetwork("n'importe quoi", "10.0.1.0/24")).toBe(false);
  });

  it("reconnaît un ping observé avec le résultat attendu", () => {
    const view = (statuses: Array<"reply" | "timeout">): PingView => ({
      id: "ping-1",
      deviceId: "pc1",
      destination: "10.0.2.10",
      count: statuses.length,
      identifier: 1,
      done: true,
      attempts: statuses.map((status, index) => ({
        sequence: index + 1,
        status,
        sentAt: 0,
        rtt: null,
        ttl: null,
        from: null,
        errorType: null,
        errorCode: null,
        failure: null,
      })),
    });
    const failure = { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "failure" } as const;
    const success = { ...failure, outcome: "success" } as const;
    expect(pingObserved([view(["timeout", "timeout"])], failure)).toBe(true);
    expect(pingObserved([view(["reply", "reply"])], failure)).toBe(false);
    expect(pingObserved([view(["reply", "reply"])], success)).toBe(true);
    expect(pingObserved([{ ...view(["reply"]), done: false }], success)).toBe(false);
    expect(pingObserved([view(["reply"])], { ...success, to: "10.0.9.9" })).toBe(false);
  });
});

describe("format des exercices", () => {
  const minimal = {
    format: "netforge-exercise",
    version: 1,
    id: "essai",
    revision: 1,
    title: "Essai",
    summary: "Résumé",
    level: "beginner",
    objective: "Objectif",
    statement: "Énoncé",
    allowed: ["simulation"],
    project: twoRoutersScenario(),
    steps: [
      { kind: "fix", title: "Corriger", instruction: "Faire passer le ping", criteria: bothWays, points: 40 },
      { kind: "debrief", title: "À retenir", text: "Texte" },
    ],
    hints: [],
    hintPenalty: 5,
  };

  it("accepte un exercice valide et calcule le score maximal", () => {
    const result = parseExercise(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(maxScore(result.exercise)).toBe(40);
  });

  it("refuse un exercice mal formé ou dont le projet est invalide", () => {
    expect(parseExercise({ ...minimal, steps: [] }).ok).toBe(false);
    expect(parseExercise({ ...minimal, inconnu: true }).ok).toBe(false);
    const badProject = parseExercise({ ...minimal, project: { format: "autre" } });
    expect(badProject.ok ? [] : badProject.paths).toEqual(["project"]);
    const noCorrect = parseExercise({
      ...minimal,
      steps: [{ kind: "hypothesis", title: "H", question: "?", choices: [{ id: "a", text: "A", correct: false, feedback: "non" }, { id: "b", text: "B", correct: false, feedback: "non" }], points: 10, retryPoints: 5 }],
    });
    expect(noCorrect.ok).toBe(false);
  });
});
