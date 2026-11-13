import { addDevice, addStaticRoute, moveDevice, renameDevice, removeFault, setDhcpPool, setDnsEnabled, setDnsRecord, setDnsServer, setInterfaceDhcp, setBgpAs, setOspfInterface, setRipInterface, setVrrpGroup, setInterfaceIpv4, setStp, setSwitchport, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { EVALUATION_LIMITS, EVALUATOR_VERSION, evaluationMaxScore, evaluationReadiness, forbiddenChanges, gradeSubmission, parsePublicExercise, publicExercise, type EvaluationAnswer } from "./evaluation.js";
import { parseExercise, type Exercise } from "./exercise.js";
import { dhcpScenario, dnsScenario, ftthScenario, bgpScenario, ospfScenario, ripScenario, vrrpScenario, performanceScenario, switchLoopScenario, twoRoutersScenario, vlanScenario } from "./scenarios.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

const SECRETS = {
  rightFeedback: "Retour réservé : la route de retour manque sur R2.",
  wrongFeedback: "Retour réservé : la passerelle de PC1 est correcte.",
  measureFeedback: "Retour réservé : relisez la table de R2.",
  debrief: "Bilan réservé : un échange IP exige une route dans chaque sens.",
  hints: ["Indice réservé 1 : regardez R2.", "Indice réservé 2 : route vers 10.0.1.0/24."],
};

function exerciseOn(project: NfgDocument, overrides: Record<string, unknown> = {}): Exercise {
  const parsed = parseExercise({
    format: "netforge-exercise",
    version: 2,
    id: "retour-evalue",
    revision: 3,
    title: "Le retour manquant (évalué)",
    summary: "Rétablir l'échange entre deux réseaux.",
    level: "beginner",
    objective: "Rétablir les échanges entre PC1 et PC2.",
    statement: "PC1 n'obtient aucune réponse de PC2.",
    allowed: ["simulation", "routes", "console"],
    project,
    steps: [
      { kind: "observe", title: "Observer", instruction: "Lancez un ping de PC1 vers PC2.", check: { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "failure" }, points: 10 },
      {
        kind: "hypothesis",
        title: "Hypothèse",
        question: "Où est le défaut ?",
        choices: [
          { id: "retour", text: "La route de retour sur R2", correct: true, feedback: SECRETS.rightFeedback },
          { id: "passerelle", text: "La passerelle de PC1", correct: false, feedback: SECRETS.wrongFeedback },
        ],
        points: 10,
        retryPoints: 5,
      },
      { kind: "measure", title: "Mesure", question: "Quel réseau manque à R2 ?", answer: { kind: "network", value: "10.0.1.0/24" }, wrongFeedback: SECRETS.measureFeedback, points: 10 },
      {
        kind: "fix",
        title: "Corriger",
        instruction: "Rétablissez l'échange dans les deux sens.",
        criteria: [
          { kind: "ping-succeeds", from: "pc1", to: "10.0.2.10" },
          { kind: "ping-succeeds", from: "pc2", to: "10.0.1.10" },
        ],
        points: 40,
      },
      { kind: "retest", title: "Retester", instruction: "Relancez le ping.", check: { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "success" }, points: 10 },
      { kind: "debrief", title: "À retenir", text: SECRETS.debrief },
    ],
    hints: SECRETS.hints,
    hintPenalty: 5,
    ...overrides,
  });
  if (!parsed.ok) throw new Error(`exercice invalide : ${parsed.paths.join(", ")}`);
  return parsed.exercise;
}

const start = twoRoutersScenario({ r2Route: false });
const exercise = exerciseOn(start);
const rightAnswers: EvaluationAnswer[] = [
  { step: 1, choice: "retour" },
  { step: 2, value: "10.0.1.0 255.255.255.0" },
];
const exactRoute = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "10.0.1.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
const defaultRoute = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "0.0.0.0", prefixLength: 0, nextHop: "10.0.12.1" } }));

describe("partie publique d'un exercice évalué", () => {
  it("ne contient ni critères, ni bonnes réponses, ni retours, ni bilan, ni texte des indices", () => {
    const view = publicExercise(exercise);
    const json = JSON.stringify(view);
    for (const secret of [SECRETS.rightFeedback, SECRETS.wrongFeedback, SECRETS.measureFeedback, SECRETS.debrief, ...SECRETS.hints]) {
      expect(json).not.toContain(secret);
    }
    for (const key of ['"criteria"', '"correct"', '"answer"', '"check"', '"feedback"', '"wrongFeedback"', '"hints"', '"retryPoints"']) {
      expect(json).not.toContain(key);
    }
    expect(view.hintCount).toBe(2);
    expect(view.steps.map((step) => step.kind)).toEqual(["observe", "hypothesis", "measure", "fix", "retest", "debrief"]);
    expect(view.steps[1]).toEqual({ kind: "hypothesis", title: "Hypothèse", question: "Où est le défaut ?", choices: [{ id: "retour", text: "La route de retour sur R2" }, { id: "passerelle", text: "La passerelle de PC1" }], points: 10 });
  });

  it("se relit côté client comme une donnée externe (aller-retour JSON), et refuse une forme altérée", () => {
    const view = publicExercise(exercise);
    expect(parsePublicExercise(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(parsePublicExercise({ ...view, steps: [{ kind: "fix", title: "x", instruction: "y", points: 1, criteria: [] }] })).toBeNull();
    expect(parsePublicExercise({ ...view, project: { format: "autre" } })).toBeNull();
  });

  it("annonce le barème évalué : l'étape « observer » n'est pas notée", () => {
    expect(evaluationMaxScore(exercise)).toBe(70);
    expect(publicExercise(exercise).maxScore).toBe(70);
  });
});

describe("notation d'une soumission", () => {
  it("accepte plusieurs corrections valides avec la note maximale", () => {
    for (const doc of [exactRoute, defaultRoute]) {
      const grade = gradeSubmission(exercise, doc, rightAnswers, 0);
      expect(grade).toMatchObject({ ok: true, score: 70, max: 70, earned: 70, hintPenalty: 0, evaluatorVersion: EVALUATOR_VERSION });
    }
  });

  it("ne donne aucun point de correction ni de retest au projet de départ", () => {
    const grade = gradeSubmission(exercise, start, rightAnswers, 0);
    if (!grade.ok) throw new Error(grade.reason);
    expect(grade.steps.map((step) => [step.kind, step.status, step.points])).toEqual([
      ["observe", "not-graded", 0],
      ["hypothesis", "earned", 10],
      ["measure", "earned", 10],
      ["fix", "missed", 0],
      ["retest", "missed", 0],
      ["debrief", "not-graded", 0],
    ]);
    expect(grade.score).toBe(20);
  });

  it("note les réponses : mauvais choix, valeur fausse ou absente", () => {
    const grade = gradeSubmission(exercise, exactRoute, [{ step: 1, choice: "passerelle" }, { step: 2, value: "10.0.2.0/24" }], 0);
    expect(grade.ok && grade.steps.slice(1, 3).map((step) => step.points)).toEqual([0, 0]);
    const silent = gradeSubmission(exercise, exactRoute, [], 0);
    expect(silent.ok && silent.score).toBe(50);
  });

  it("retire la pénalité des indices comptés par le serveur, sans note négative", () => {
    expect(gradeSubmission(exercise, exactRoute, rightAnswers, 2)).toMatchObject({ ok: true, earned: 70, hintPenalty: 10, score: 60 });
    expect(gradeSubmission(exerciseOn(start, { hintPenalty: 100 }), start, [], 2)).toMatchObject({ ok: true, score: 0 });
  });

  it("est déterministe : même soumission, même résultat", () => {
    expect(gradeSubmission(exercise, defaultRoute, rightAnswers, 1)).toEqual(gradeSubmission(exercise, defaultRoute, rightAnswers, 1));
  });

  it("refuse une réponse adressée à une étape qui n'est pas une question, ou en double", () => {
    expect(gradeSubmission(exercise, exactRoute, [{ step: 3, value: "x" }], 0)).toEqual({ ok: false, reason: "invalid-answer", step: 3 });
    expect(gradeSubmission(exercise, exactRoute, [{ step: 1, choice: "retour" }, { step: 1, choice: "passerelle" }], 0)).toEqual({ ok: false, reason: "invalid-answer", step: 1 });
    expect(gradeSubmission(exercise, exactRoute, [{ step: 1, value: "retour" }], 0)).toEqual({ ok: false, reason: "invalid-answer", step: 1 });
  });
});

describe("fonctions autorisées", () => {
  it("notent un poste après son attribution DHCP, avec le même budget global de calcul", () => {
    const project = dhcpScenario();
    const exercise = exerciseOn(project, { allowed: ["simulation"], steps: [{ kind: "fix", title: "Joindre le réseau distant", instruction: "Vérifiez le service.", criteria: [{ kind: "ping-succeeds", from: "pc1", to: "10.0.0.2" }], points: 10 }], hints: [] });
    expect(gradeSubmission(exercise, project, [], 0)).toMatchObject({ ok: true, score: 10, max: 10 });
  });
  it("laissent libres les noms et la disposition", () => {
    const cosmetic = ok(moveDevice(ok(renameDevice(exactRoute, { deviceId: "pc1", name: "Poste-A" })), { deviceId: "pc1", position: { x: 5, y: 5 } }));
    expect(forbiddenChanges(start, cosmetic, exercise.allowed)).toEqual([]);
    expect(gradeSubmission(exercise, cosmetic, rightAnswers, 0)).toMatchObject({ ok: true, score: 70 });
  });

  it("refusent un changement d'adressage ou de topologie non autorisé", () => {
    const readdressed = ok(setInterfaceIpv4(exactRoute, { deviceId: "pc2", portId: "eth0", ipv4: { address: "10.0.2.20", prefixLength: 24 } }));
    expect(gradeSubmission(exercise, readdressed, rightAnswers, 0)).toEqual({ ok: false, reason: "forbidden-change", changes: ["addressing"] });
    const extended = ok(addDevice(exactRoute, { id: "pc9", model: "PC", position: { x: 0, y: 0 } }));
    expect(gradeSubmission(exercise, extended, rightAnswers, 0)).toEqual({ ok: false, reason: "forbidden-change", changes: ["topology"] });
  });

  it("acceptent ces changements quand l'exercice les autorise", () => {
    const readdressed = ok(setInterfaceIpv4(exactRoute, { deviceId: "pc2", portId: "eth0", ipv4: { address: "10.0.2.20", prefixLength: 24 } }));
    expect(forbiddenChanges(start, readdressed, ["routes", "addressing"])).toEqual([]);
  });

  it("ne laissent modifier VLAN et Spanning Tree des switches qu'avec « switching » ; les sous-interfaces relèvent de l'adressage", () => {
    const start = vlanScenario();
    const moved = ok(setSwitchport(start, { deviceId: "sw1", portId: "ge1", switchport: { mode: "access", vlan: 20 } }));
    expect(forbiddenChanges(start, moved, ["simulation", "addressing"])).toEqual(["switching"]);
    expect(forbiddenChanges(start, moved, ["switching"])).toEqual([]);
    const stpOff = ok(setStp(start, { deviceId: "sw1", enabled: true, priority: 4096 }));
    expect(forbiddenChanges(start, stpOff, ["addressing"])).toEqual(["switching"]);
    const subinterface = ok(setInterfaceIpv4(start, { deviceId: "r1", portId: "ge0.30", ipv4: { address: "192.168.30.1", prefixLength: 24 } }));
    expect(forbiddenChanges(start, subinterface, ["switching"])).toEqual(["addressing"]);
  });

  it("protègent les clients et les plages DHCP par la fonction adressage", () => {
    const initial = dhcpScenario();
    const manual = ok(setInterfaceDhcp(initial, { deviceId: "pc1", portId: "eth0", enabled: false }));
    const noPool = ok(setDhcpPool(initial, { deviceId: "r1", interfaceId: "ge0", pool: null }));
    expect(forbiddenChanges(initial, manual, ["simulation", "routes"])).toEqual(["addressing"]);
    expect(forbiddenChanges(initial, noPool, ["simulation", "routes"])).toEqual(["addressing"]);
    expect(forbiddenChanges(initial, noPool, ["addressing"])).toEqual([]);
  });

  it("protègent le résolveur des postes et le service DNS des routeurs par la fonction adressage", () => {
    const initial = dnsScenario();
    const otherServer = ok(setDnsServer(initial, { deviceId: "pc2", server: "192.168.1.1" }));
    const newRecord = ok(setDnsRecord(initial, { deviceId: "r1", name: "web.lab", address: "10.0.0.10" }));
    const disabled = ok(setDnsEnabled(initial, { deviceId: "r1", enabled: false }));
    for (const changed of [otherServer, newRecord, disabled]) {
      expect(forbiddenChanges(initial, changed, ["simulation", "routes", "switching"])).toEqual(["addressing"]);
      expect(forbiddenChanges(initial, changed, ["addressing"])).toEqual([]);
    }
    // Un routeur ajouté sans service DNS n'est pas un changement d'adressage.
    const extended = ok(addDevice(initial, { id: "r9", model: "R-200", position: { x: 0, y: 0 } }));
    expect(forbiddenChanges(initial, extended, ["topology"])).toEqual([]);
  });

  it("protègent la participation des interfaces à RIP par la fonction « routes »", () => {
    const initial = ripScenario();
    const passive = ok(setRipInterface(initial, { deviceId: "r1", interfaceId: "ge1", mode: "passive" }));
    expect(forbiddenChanges(initial, passive, ["simulation", "addressing"])).toEqual(["routes"]);
    expect(forbiddenChanges(initial, passive, ["routes"])).toEqual([]);
  });

  it("protègent le mode, le coût et la priorité OSPF par la fonction « routes »", () => {
    const initial = ospfScenario();
    const cheaper = ok(setOspfInterface(initial, { deviceId: "r1", interfaceId: "ge2", ospf: { mode: "active", cost: 1, priority: 1, area: "0.0.0.0" } }));
    const removed = ok(setOspfInterface(initial, { deviceId: "r2", interfaceId: "ge2", ospf: null }));
    for (const changed of [cheaper, removed]) {
      expect(forbiddenChanges(initial, changed, ["simulation", "addressing", "switching"])).toEqual(["routes"]);
      expect(forbiddenChanges(initial, changed, ["routes"])).toEqual([]);
    }
  });

  it("notent un ping qui dépend de routes OSPF, après l'attente et l'échange de base", () => {
    const project = ospfScenario();
    const steps = [{ kind: "fix" as const, title: "Joindre PC3", instruction: "Vérifiez le routage.", criteria: [{ kind: "ping-succeeds" as const, from: "pc1", to: "10.3.0.10" }], points: 10 }];
    expect(gradeSubmission(exerciseOn(project, { allowed: ["simulation"], steps, hints: [] }), project, [], 0)).toMatchObject({ ok: true, score: 10, max: 10 });
    const withoutOspf = ospfScenario({ ospf: false });
    expect(gradeSubmission(exerciseOn(withoutOspf, { allowed: ["simulation"], steps, hints: [] }), withoutOspf, [], 0)).toMatchObject({ ok: true, score: 0 });
  });

  it("protègent les groupes VRRP par la fonction « routes » et notent un ping après l'élection du maître", () => {
    const initial = vrrpScenario();
    const lower = ok(setVrrpGroup(initial, { deviceId: "r1", interfaceId: "ge0", group: { vrid: 1, address: "192.168.1.1", priority: 90, preempt: true } }));
    expect(forbiddenChanges(initial, lower, ["simulation", "addressing"])).toEqual(["routes"]);
    expect(forbiddenChanges(initial, lower, ["routes"])).toEqual([]);
    const steps = [{ kind: "fix" as const, title: "Joindre PC2", instruction: "Vérifiez la passerelle.", criteria: [{ kind: "ping-succeeds" as const, from: "pc1", to: "10.3.0.10" }], points: 10 }];
    expect(gradeSubmission(exerciseOn(initial, { allowed: ["simulation"], steps, hints: [] }), initial, [], 0)).toMatchObject({ ok: true, score: 10, max: 10 });
  });

  it("protègent BGP par la fonction « routes » et notent un ping après l'établissement des sessions", () => {
    const initial = bgpScenario();
    const otherAs = ok(setBgpAs(initial, { deviceId: "r1", as: 65010 }));
    expect(forbiddenChanges(initial, otherAs, ["simulation", "addressing"])).toEqual(["routes"]);
    expect(forbiddenChanges(initial, otherAs, ["routes"])).toEqual([]);
    const steps = [{ kind: "fix" as const, title: "Joindre PC3", instruction: "Vérifiez BGP.", criteria: [{ kind: "ping-succeeds" as const, from: "pc1", to: "10.3.0.10" }], points: 10 }];
    expect(gradeSubmission(exerciseOn(initial, { allowed: ["simulation"], steps, hints: [] }), initial, [], 0)).toMatchObject({ ok: true, score: 10, max: 10 });
  });

  it("notent un ping qui dépend de routes RIP, après la convergence initiale", () => {
    const project = ripScenario();
    const exercise = exerciseOn(project, { allowed: ["simulation"], steps: [{ kind: "fix", title: "Joindre PC3", instruction: "Vérifiez le routage.", criteria: [{ kind: "ping-succeeds", from: "pc1", to: "10.3.0.10" }], points: 10 }], hints: [] });
    expect(gradeSubmission(exercise, project, [], 0)).toMatchObject({ ok: true, score: 10, max: 10 });
    const withoutRip = ripScenario({ rip: false });
    const blocked = exerciseOn(withoutRip, { allowed: ["simulation"], steps: [{ kind: "fix", title: "Joindre PC3", instruction: "Vérifiez le routage.", criteria: [{ kind: "ping-succeeds", from: "pc1", to: "10.3.0.10" }], points: 10 }], hints: [] });
    expect(gradeSubmission(blocked, withoutRip, [], 0)).toMatchObject({ ok: true, score: 0 });
  });

  it("n'autorisent le retrait d'une panne optique qu'avec « optics », et jamais son ajout ou sa modification", () => {
    const faulty = ftthScenario({ dirtyPto3: true });
    const fault = faulty.faults[0];
    if (!fault) throw new Error("panne attendue");
    const cleaned = ok(removeFault(faulty, { id: fault.id }));
    expect(forbiddenChanges(faulty, cleaned, ["optics"])).toEqual([]);
    expect(forbiddenChanges(faulty, cleaned, ["simulation"])).toEqual(["optics"]);
    const worse = { ...faulty, faults: [{ ...fault, extraLoss: 1 }] };
    expect(forbiddenChanges(faulty, worse, ["optics"])).toEqual(["faults"]);
  });
});

describe("limites d'évaluation", () => {
  it("donnent un diagnostic, jamais une note, quand une tempête de diffusion dépasse le budget d'événements", () => {
    const loop = switchLoopScenario();
    const stormy = exerciseOn(loop, {
      allowed: ["simulation"],
      steps: [{ kind: "fix", title: "Joindre PC2", instruction: "Rétablissez l'échange.", criteria: [{ kind: "ping-succeeds", from: "pc1", to: "192.168.1.11" }], points: 10 }],
      hints: [],
    });
    const grade = gradeSubmission(stormy, loop, [], 0);
    expect(grade.ok).toBe(false);
    if (grade.ok || grade.reason !== "limit") throw new Error("diagnostic de limite attendu");
    expect(["events", "pending-events"]).toContain(grade.limit);
    expect(grade.step).toBe(0);
    expect(grade.max).toBeGreaterThan(0);
  });

  it("refusent un projet soumis trop grand avant toute simulation", () => {
    let big = performanceScenario();
    for (let index = 0; big.topology.devices.length <= EVALUATION_LIMITS.maxDevices; index += 1) {
      big = ok(addDevice(big, { id: `extra${String(index)}`, model: "PC", position: { x: index, y: 0 } }));
    }
    const open = exerciseOn(start, { allowed: ["topology", "addressing", "routes"] });
    expect(gradeSubmission(open, big, [], 0)).toEqual({ ok: false, reason: "limit", limit: "devices", max: EVALUATION_LIMITS.maxDevices, step: null });
  });

  it("signalent avant publication un exercice sans point noté ou trop coûteux à corriger", () => {
    const observeOnly = exerciseOn(start, {
      steps: [{ kind: "observe", title: "Observer", instruction: "Lancez un ping.", check: { kind: "ping-observed", from: "pc1", to: "10.0.2.10", outcome: "failure" }, points: 10 }],
    });
    expect(evaluationReadiness(observeOnly)).toEqual({ ok: false, reason: "no-graded-points" });
    const criterion = { kind: "ping-succeeds", from: "pc1", to: "10.0.2.10" };
    const heavy = exerciseOn(start, {
      steps: Array.from({ length: 3 }, (_, index) => ({ kind: "fix", title: `Corriger ${String(index)}`, instruction: "Corrigez.", criteria: Array.from({ length: 10 }, () => criterion), points: 10 })),
    });
    expect(evaluationReadiness(heavy)).toEqual({ ok: false, reason: "too-many-checks", max: EVALUATION_LIMITS.maxChecks });
    expect(evaluationReadiness(exercise)).toEqual({ ok: true });
  });
});
