import { EVALUATOR_VERSION, ENGINE_VERSION, switchLoopScenario, twoRoutersScenario } from "@netforge/engine";
import { addStaticRoute, setInterfaceIpv4, type CommandResult, type NfgDocument } from "@netforge/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Browser, expectStatus, signedIn, startTestApp, type TestApp } from "../test-support/test-app.js";

/*
 * Exercices du compte et évaluations notées par le serveur (phase 6) :
 * critères privés, indices comptés, score déclaré refusé, plusieurs
 * solutions valides, limites d'évaluation, versionnement des instantanés.
 */
let test: TestApp;

beforeEach(async () => {
  test = await startTestApp();
});

afterEach(async () => {
  await test.close();
});

// Lecture typée des corps de réponse (supertest les type `any`) : le paramètre ne sert qu'au retour, par choix.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const body = <T>(response: { body: unknown }) => response.body as T;
const code = (response: { body: unknown }) => body<{ code?: string }>(response).code;

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

const SECRETS = [
  "Retour réservé : la route de retour manque sur R2.",
  "Retour réservé : la passerelle de PC1 est correcte.",
  "Retour réservé : relisez la table de R2.",
  "Bilan réservé : un échange IP exige une route dans chaque sens.",
  "Indice réservé 1 : regardez R2.",
  "Indice réservé 2 : route vers le réseau de PC1.",
];
const PRIVATE_KEYS = ['"criteria"', '"correct"', '"answer"', '"check"', '"feedback"', '"wrongFeedback"', '"retryPoints"', '"ping-succeeds"'];

function exercise(project: NfgDocument = twoRoutersScenario({ r2Route: false }), overrides: Record<string, unknown> = {}) {
  return {
    format: "netforge-exercise",
    version: 2,
    id: "retour-evalue",
    revision: 1,
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
          { id: "retour", text: "La route de retour sur R2", correct: true, feedback: SECRETS[0] },
          { id: "passerelle", text: "La passerelle de PC1", correct: false, feedback: SECRETS[1] },
        ],
        points: 10,
        retryPoints: 5,
      },
      { kind: "measure", title: "Mesure", question: "Quel réseau manque à R2 ?", answer: { kind: "network", value: "10.0.1.0/24" }, wrongFeedback: SECRETS[2], points: 10 },
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
      { kind: "debrief", title: "À retenir", text: SECRETS[3] },
    ],
    hints: [SECRETS[4], SECRETS[5]],
    hintPenalty: 5,
    ...overrides,
  };
}

const start = twoRoutersScenario({ r2Route: false });
const exactRoute = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "10.0.1.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
const defaultRoute = ok(addStaticRoute(start, { deviceId: "r2", route: { destination: "0.0.0.0", prefixLength: 0, nextHop: "10.0.12.1" } }));
const rightAnswers = [
  { step: 1, choice: "retour" },
  { step: 2, value: "10.0.1.0/24" },
];

async function publishAs(author: Browser, content: object = exercise(), maxAttempts = 2): Promise<{ id: string; code: string }> {
  const created = await author.post("/api/exercises", { exercise: content });
  expectStatus(created, 201);
  const id = body<{ id: string }>(created).id;
  const published = await author.post(`/api/exercises/${id}/publications`, { maxAttempts });
  expectStatus(published, 201);
  return { id, code: body<{ code: string }>(published).code };
}

/** Aucun secret dans la réponse, hormis ceux légitimement révélés (indice demandé, bilan après la note). */
function expectNoSecret(response: { body: unknown }, revealed: readonly (string | undefined)[] = []): void {
  const json = JSON.stringify(response.body);
  for (const secret of SECRETS) {
    if (revealed.includes(secret)) continue;
    expect(json, secret).not.toContain(secret);
  }
  for (const key of PRIVATE_KEYS) expect(json, key).not.toContain(key);
}

describe("exercices de l'auteur", () => {
  it("exigent une session sur un compte validé", async () => {
    const anonymous = new Browser(test);
    expect((await anonymous.get("/api/exercises")).status).toBe(401);
    expect((await anonymous.get("/api/evaluations/abcdefghijkl")).status).toBe(401);
  });

  it("sont validés par le moteur, privés à leur auteur, versionnés par révision", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const invalid = await author.post("/api/exercises", { exercise: { ...exercise(), steps: [] } });
    expect([invalid.status, code(invalid)]).toEqual([400, "exercise.invalid"]);
    expect(body<{ paths: string[] }>(invalid).paths).toContain("steps");

    const created = await author.post("/api/exercises", { exercise: exercise() });
    expectStatus(created, 201);
    const { id } = body<{ id: string }>(created);
    expect(body(await author.get("/api/exercises"))).toMatchObject({ exercises: [{ id, title: "Le retour manquant (évalué)", revision: 1, publicationCount: 0 }] });

    const other = await signedIn(test, "curieux@exemple.test");
    expect([(await other.get(`/api/exercises/${id}`)).status, (await other.put(`/api/exercises/${id}`, { exercise: exercise(), expectedRevision: 1 })).status]).toEqual([404, 404]);

    const renamed = await author.put(`/api/exercises/${id}`, { exercise: exercise(undefined, { title: "Nouveau titre" }), expectedRevision: 1 });
    expect(body(renamed)).toMatchObject({ revision: 2 });
    const stale = await author.put(`/api/exercises/${id}`, { exercise: exercise(), expectedRevision: 1 });
    expect([stale.status, code(stale), body<{ storedRevision: number }>(stale).storedRevision]).toEqual([409, "exercise.conflict", 2]);
  });

  it("refusent la publication d'un exercice sans point notable en évaluation", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const observeOnly = exercise(undefined, { steps: [exercise().steps[0]] });
    const created = await author.post("/api/exercises", { exercise: observeOnly });
    const refused = await author.post(`/api/exercises/${body<{ id: string }>(created).id}/publications`, { maxAttempts: 1 });
    expect([refused.status, code(refused), body<{ reason: string }>(refused).reason]).toEqual([422, "evaluation.not-ready", "no-graded-points"]);
  });
});

describe("évaluation notée par le serveur", () => {
  it("n'envoie à l'élève ni critères, ni bonnes réponses, ni retours, ni bilan, ni indices non demandés", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { code: evaluation } = await publishAs(author);
    const student = await signedIn(test, "eleve@exemple.test");

    const view = await student.get(`/api/evaluations/${evaluation}`);
    expectStatus(view, 200);
    expectNoSecret(view);
    expect(body(view)).toMatchObject({ code: evaluation, maxAttempts: 2, closed: false, attempts: [], exercise: { title: "Le retour manquant (évalué)", hintCount: 2, maxScore: 70 } });

    const attempt = await student.post(`/api/evaluations/${evaluation}/attempts`);
    expectStatus(attempt, 201);
    expectNoSecret(attempt);
    const { id } = body<{ id: string }>(attempt);

    const hint = await student.post(`/api/attempts/${id}/hints`);
    expect(body(hint)).toMatchObject({ hints: [SECRETS[4]], hintCount: 2 });
    expect(JSON.stringify(hint.body)).not.toContain(SECRETS[5]);
    expect((await test.prisma.attempt.findUniqueOrThrow({ where: { id } })).hintsRevealed).toBe(1);

    const graded = await student.post(`/api/attempts/${id}/submission`, { project: exactRoute, answers: rightAnswers });
    expectStatus(graded, 200);
    expectNoSecret(graded, [SECRETS[4], SECRETS[3]]);
    expect(body<{ debrief: unknown }>(graded).debrief).toEqual([{ title: "À retenir", text: SECRETS[3] }]);
  });

  it("refuse un score déclaré par le navigateur et calcule la note lui-même", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { code: evaluation } = await publishAs(author);
    const student = await signedIn(test, "eleve@exemple.test");
    const { id } = body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`));

    for (const forged of [{ project: start, answers: [], score: 70 }, { project: start, answers: [], result: { score: 70 } }, { project: start, answers: [{ step: 1, choice: "retour", points: 10 }] }]) {
      const refused = await student.post(`/api/attempts/${id}/submission`, forged);
      expect([refused.status, code(refused)]).toEqual([400, "request.invalid"]);
    }
    expect(await test.prisma.attempt.findUniqueOrThrow({ where: { id } })).toMatchObject({ submittedAt: null, score: null });

    // Projet de départ non corrigé : seules les réponses justes rapportent des points.
    const graded = await student.post(`/api/attempts/${id}/submission`, { project: start, answers: rightAnswers });
    expect(body(graded)).toMatchObject({ result: { score: 20, max: 70, evaluatorVersion: EVALUATOR_VERSION, engineVersion: ENGINE_VERSION } });
    expect(await test.prisma.attempt.findUniqueOrThrow({ where: { id } })).toMatchObject({ score: 20, maxScore: 70, evaluatorVersion: EVALUATOR_VERSION, engineVersion: ENGINE_VERSION });
    const again = await student.post(`/api/attempts/${id}/submission`, { project: exactRoute, answers: rightAnswers });
    expect([again.status, code(again)]).toEqual([409, "evaluation.already-submitted"]);
  });

  it("accepte plusieurs solutions valides avec la note maximale", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { code: evaluation } = await publishAs(author);
    for (const [email, doc] of [
      ["alice@exemple.test", exactRoute],
      ["bob@exemple.test", defaultRoute],
    ] as const) {
      const student = await signedIn(test, email);
      const { id } = body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`));
      const graded = await student.post(`/api/attempts/${id}/submission`, { project: doc, answers: rightAnswers });
      expect(body(graded)).toMatchObject({ result: { score: 70, max: 70, hintPenalty: 0 } });
    }
  });

  it("donne un diagnostic clair d'une limite d'évaluation, sans note ni tentative consommée", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const loop = switchLoopScenario();
    const stormy = exercise(loop, {
      allowed: ["simulation"],
      steps: [{ kind: "fix", title: "Joindre PC2", instruction: "Rétablissez l'échange.", criteria: [{ kind: "ping-succeeds", from: "pc1", to: "192.168.1.11" }], points: 10 }],
      hints: [],
    });
    const { code: evaluation } = await publishAs(author, stormy, 1);
    const student = await signedIn(test, "eleve@exemple.test");
    const { id } = body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`));
    const refused = await student.post(`/api/attempts/${id}/submission`, { project: loop, answers: [] });
    expect([refused.status, code(refused), body<{ step: number }>(refused).step]).toEqual([422, "evaluation.limit-exceeded", 0]);
    expect(["events", "pending-events"]).toContain(body<{ limit: string }>(refused).limit);
    expect(body<{ max: number }>(refused).max).toBeGreaterThan(0);
    expect(await test.prisma.attempt.findUniqueOrThrow({ where: { id } })).toMatchObject({ submittedAt: null, score: null });
  });

  it("refuse une modification hors des fonctions autorisées, sans consommer la tentative", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { code: evaluation } = await publishAs(author);
    const student = await signedIn(test, "eleve@exemple.test");
    const { id } = body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`));
    const readdressed = ok(setInterfaceIpv4(exactRoute, { deviceId: "pc2", portId: "eth0", ipv4: { address: "10.0.2.20", prefixLength: 24 } }));
    const refused = await student.post(`/api/attempts/${id}/submission`, { project: readdressed, answers: rightAnswers });
    expect([refused.status, code(refused), body<{ changes: string[] }>(refused).changes]).toEqual([422, "evaluation.forbidden-change", ["addressing"]]);
    const invalid = await student.post(`/api/attempts/${id}/submission`, { project: { format: "autre" }, answers: [] });
    expect([invalid.status, code(invalid)]).toEqual([422, "evaluation.invalid-project"]);
    expect(body(await student.post(`/api/attempts/${id}/submission`, { project: exactRoute, answers: rightAnswers }))).toMatchObject({ result: { score: 70 } });
  });

  it("borne les tentatives, permet la fermeture par l'auteur seul et isole les tentatives", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { code: evaluation } = await publishAs(author, exercise(), 1);
    const student = await signedIn(test, "eleve@exemple.test");
    const first = body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`));
    // Une tentative ouverte est reprise, pas dupliquée.
    expect(body<{ id: string }>(await student.post(`/api/evaluations/${evaluation}/attempts`)).id).toBe(first.id);
    await student.post(`/api/attempts/${first.id}/submission`, { project: start, answers: [] });
    const extra = await student.post(`/api/evaluations/${evaluation}/attempts`);
    expect([extra.status, code(extra)]).toEqual([409, "evaluation.no-attempts-left"]);

    const intruder = await signedIn(test, "intrus@exemple.test");
    expect((await intruder.get(`/api/attempts/${first.id}`)).status).toBe(404);
    expect((await intruder.post(`/api/attempts/${first.id}/hints`)).status).toBe(404);
    expect((await intruder.post(`/api/evaluations/${evaluation}/close`)).status).toBe(404);

    expectStatus(await author.post(`/api/evaluations/${evaluation}/close`), 200);
    const closed = await intruder.post(`/api/evaluations/${evaluation}/attempts`);
    expect([closed.status, code(closed)]).toEqual([409, "evaluation.closed"]);
    expect((await intruder.get("/api/evaluations/zzzzzzzzzzzz")).status).toBe(404);
    expect((await intruder.get("/api/evaluations/pas-un-code")).status).toBe(404);
  });

  it("versionne : une nouvelle révision republiée ne change ni l'instantané ni les notes passées", async () => {
    const author = await signedIn(test, "auteur@exemple.test");
    const { id: exerciseId, code: first } = await publishAs(author);
    const student = await signedIn(test, "eleve@exemple.test");
    const attempt = body<{ id: string }>(await student.post(`/api/evaluations/${first}/attempts`));
    await student.post(`/api/attempts/${attempt.id}/submission`, { project: exactRoute, answers: rightAnswers });

    // L'auteur rend l'exercice plus exigeant (un critère de plus), puis republie.
    const stricter = exercise();
    stricter.steps[3] = { ...stricter.steps[3], criteria: [{ kind: "ping-succeeds", from: "pc1", to: "10.0.2.10" }, { kind: "ping-fails", from: "pc1", to: "10.0.2.10" }] } as never;
    expectStatus(await author.put(`/api/exercises/${exerciseId}`, { exercise: stricter, expectedRevision: 1 }), 200);
    const second = body<{ code: string; exerciseRevision: number }>(await author.post(`/api/exercises/${exerciseId}/publications`, { maxAttempts: 1 }));
    expect(second.exerciseRevision).toBe(2);

    const [old, current] = await Promise.all([
      test.prisma.publication.findUniqueOrThrow({ where: { code: first } }),
      test.prisma.publication.findUniqueOrThrow({ where: { code: second.code } }),
    ]);
    expect([old.exerciseRevision, current.exerciseRevision]).toEqual([1, 2]);
    expect(old.contentHash).not.toBe(current.contentHash);
    expect(body(await student.get(`/api/attempts/${attempt.id}`))).toMatchObject({ code: first, result: { score: 70 } });
    expect((await test.prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).submissionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body(await author.get(`/api/exercises/${exerciseId}/publications`))).toMatchObject({
      publications: [
        { code: second.code, exerciseRevision: 2, attemptCount: 0 },
        { code: first, exerciseRevision: 1, attemptCount: 1 },
      ],
    });
    expect(body(await student.get("/api/attempts"))).toMatchObject({ attempts: [{ id: attempt.id, code: first, title: "Le retour manquant (évalué)", score: 70 }] });
  });
});
