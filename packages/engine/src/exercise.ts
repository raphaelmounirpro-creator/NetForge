import { idSchema, parseIpv4Input, parseNfgValue, type Issue, type NfgDocument } from "@netforge/project";
import { z } from "zod";
import { analyzeOptics, CONFORMITY_TOLERANCE_DB, type OpticalStatus, type PowerMeasurement } from "./optics.js";
import { createSimulation } from "./simulation.js";
import type { PingView } from "./views.js";

/**
 * Exercices guidés (format « netforge-exercise », version 1).
 *
 * Un exercice décrit une topologie initiale, des étapes pédagogiques
 * (observer, formuler une hypothèse, mesurer, corriger, retester, comprendre)
 * et des critères COMPORTEMENTAUX vérifiés par le moteur : toute
 * configuration qui produit le comportement attendu est acceptée.
 * Entraînement local, dont la correction n'est pas une note fiable (la
 * notation vérifiée côté serveur arrive en phase 6).
 * Version 2 (phase 4) : mesures optiques (photomètre, réponses en dB) et
 * critère de service optique. Un exercice version 1 reste valide tel quel.
 */
export const EXERCISE_FORMAT = "netforge-exercise";
export const EXERCISE_VERSION = 2;

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = z.string().regex(/^[a-z0-9-]{1,64}$/);
/** Référence à un équipement du projet : même forme que les identifiants du format .nfg.json. */
const deviceRef = idSchema;
const ipv4 = z.string().max(15);

export const criterionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ping-succeeds"), from: deviceRef, to: ipv4 }),
  z.strictObject({ kind: z.literal("ping-fails"), from: deviceRef, to: ipv4 }),
  /** Le bilan optique (pannes comprises) de chaque chemin vers cet ONT est dans les limites de réception. */
  z.strictObject({ kind: z.literal("optical-service"), ont: deviceRef }),
]);
export type Criterion = z.infer<typeof criterionSchema>;

const pingCheckSchema = z.strictObject({
  kind: z.literal("ping-observed"),
  from: deviceRef,
  to: ipv4,
  outcome: z.enum(["success", "failure"]),
});
export type PingCheck = z.infer<typeof pingCheckSchema>;

/** Une mesure au photomètre a été faite à ce port, avec ce résultat comparé au bilan prévisionnel. */
const powerCheckSchema = z.strictObject({
  kind: z.literal("power-measured"),
  deviceId: deviceRef,
  portId: z.string().regex(/^[a-z]{1,8}\d{0,3}$/),
  direction: z.enum(["downstream", "upstream"]),
  outcome: z.enum(["conform", "deviation"]),
});
export type PowerCheck = z.infer<typeof powerCheckSchema>;

const observationCheckSchema = z.discriminatedUnion("kind", [pingCheckSchema, powerCheckSchema]);
export type ObservationCheck = z.infer<typeof observationCheckSchema>;

const points = z.int().min(0).max(100);

const stepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observe"), title: text(80), instruction: text(1000), check: observationCheckSchema, points }),
  z.strictObject({
    kind: z.literal("hypothesis"),
    title: text(80),
    question: text(500),
    choices: z
      .array(z.strictObject({ id: identifier, text: text(300), correct: z.boolean(), feedback: text(600) }))
      .min(2)
      .max(6)
      .refine((choices) => choices.some((choice) => choice.correct), "au moins une réponse juste"),
    points,
    retryPoints: points,
  }),
  z.strictObject({
    kind: z.literal("measure"),
    title: text(80),
    question: text(500),
    answer: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("network"), value: z.string().max(18) }),
      /** Valeur en dB ou dBm, acceptée à la tolérance près. */
      z.strictObject({ kind: z.literal("decibel"), value: z.number().min(-60).max(60), tolerance: z.number().min(0.01).max(5) }),
    ]),
    wrongFeedback: text(600),
    points,
  }),
  z.strictObject({ kind: z.literal("fix"), title: text(80), instruction: text(1000), criteria: z.array(criterionSchema).min(1).max(10), points }),
  z.strictObject({ kind: z.literal("retest"), title: text(80), instruction: text(1000), check: observationCheckSchema, points }),
  z.strictObject({ kind: z.literal("debrief"), title: text(80), text: text(3000) }),
]);
export type ExerciseStep = z.infer<typeof stepSchema>;

export const exerciseSchema = z.strictObject({
  format: z.literal(EXERCISE_FORMAT),
  version: z.union([z.literal(1), z.literal(EXERCISE_VERSION)]),
  id: identifier,
  revision: z.int().min(1),
  title: text(120),
  summary: text(500),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  objective: text(1000),
  statement: text(2000),
  /** Fonctions utiles à l'exercice (indicatif en phase 3). */
  allowed: z.array(z.enum(["simulation", "addressing", "routes", "console", "topology", "optics", "switching"])).max(7),
  project: z.unknown(),
  steps: z.array(stepSchema).min(1).max(12),
  hints: z.array(text(600)).max(5),
  hintPenalty: points,
});

export type Exercise = Omit<z.infer<typeof exerciseSchema>, "project"> & { readonly project: NfgDocument };

export type ParseExerciseResult = { readonly ok: true; readonly exercise: Exercise } | { readonly ok: false; readonly issues: readonly Issue[]; readonly paths: readonly string[] };

/** Valide un exercice (donnée externe) et son projet initial (format .nfg.json). */
export function parseExercise(raw: unknown): ParseExerciseResult {
  const parsed = exerciseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [], paths: parsed.error.issues.map((issue) => issue.path.map(String).join(".")) };
  const project = parseNfgValue(parsed.data.project);
  if (!project.ok) return { ok: false, issues: project.errors, paths: ["project"] };
  return { ok: true, exercise: { ...parsed.data, project: project.document } };
}

export function maxScore(exercise: Exercise): number {
  return exercise.steps.reduce((sum, step) => sum + ("points" in step ? step.points : 0), 0);
}

/** Réponse de mesure : même réseau, quelle que soit la notation (« /24 » ou masque décimal). */
export function sameNetwork(answer: string, expected: string): boolean {
  const split = (value: string) => {
    const trimmed = value.trim().replace(/\s+/g, " ");
    const slash = trimmed.indexOf("/");
    if (slash >= 0) return parseIpv4Input(trimmed.slice(0, slash), trimmed.slice(slash + 1));
    const [address = "", mask = ""] = trimmed.split(" ");
    return parseIpv4Input(address, mask);
  };
  const given = split(answer);
  const wanted = split(expected);
  if (!given.ok || !wanted.ok) return false;
  return given.ipv4.address === wanted.ipv4.address && given.ipv4.prefixLength === wanted.ipv4.prefixLength;
}

/**
 * Réponse numérique en dB ou dBm : virgule ou point décimal, signe moins
 * typographique accepté, unité facultative.
 */
export function sameDecibel(answer: string, expected: number, tolerance: number): boolean {
  const cleaned = answer.trim().replace(/\s+/g, "").replace(/[−–]/g, "-").replace(",", ".").replace(/dBm?$/i, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return false;
  return Math.abs(Number(cleaned) - expected) <= tolerance + 1e-9;
}

/** Résultat d'une mesure au regard du bilan prévisionnel ; null si rien n'a pu être mesuré. */
export function measurementConformity(measurement: PowerMeasurement): "conform" | "deviation" | null {
  if (measurement.outcome === "not-measurable" || measurement.outcome === "no-source") return null;
  if (measurement.outcome !== "light") return "deviation";
  return (measurement.deviationDb ?? 0) < CONFORMITY_TOLERANCE_DB ? "conform" : "deviation";
}

/** Une mesure correspondante a-t-elle été faite (journal des mesures de la session) ? */
export function measurementObserved(measurements: readonly PowerMeasurement[], check: PowerCheck): boolean {
  return measurements.some(
    (measurement) =>
      measurement.point.deviceId === check.deviceId &&
      measurement.point.portId === check.portId &&
      measurement.direction === check.direction &&
      measurementConformity(measurement) === check.outcome,
  );
}

/** Un ping correspondant a-t-il été observé (terminé) dans la simulation, avec le résultat attendu ? */
export function pingObserved(pings: readonly PingView[], check: PingCheck): boolean {
  return pings.some((view) => {
    if (!view.done || view.deviceId !== check.from || view.destination !== check.to) return false;
    const replies = view.attempts.filter((attempt) => attempt.status === "reply").length;
    return check.outcome === "success" ? replies === view.attempts.length : replies < view.attempts.length;
  });
}

export interface CriterionResult {
  readonly criterion: Criterion;
  readonly passed: boolean;
  readonly sent: number;
  readonly replies: number;
  /** Critère optique : état le plus défavorable des chemins vers l'ONT (null s'il n'est atteint par aucun OLT). */
  readonly opticalStatus: OpticalStatus | null;
}

const IN_SERVICE: ReadonlySet<OpticalStatus> = new Set<OpticalStatus>(["ok", "low-margin"]);

const EVALUATION_ECHOES = 2;
const EVALUATION_MAX_EVENTS = 100_000;

/**
 * Vérifie des critères comportementaux sur un document : chaque critère est
 * évalué dans une simulation neuve (caches vides, graine fixe), bornée en
 * événements. Le moteur décide ; aucune configuration de référence n'est comparée.
 */
export function evaluateCriteria(doc: NfgDocument, criteria: readonly Criterion[]): { ok: true; results: CriterionResult[] } | { ok: false; issues: readonly Issue[] } {
  const results: CriterionResult[] = [];
  let optics: ReturnType<typeof analyzeOptics> | null = null;
  for (const criterion of criteria) {
    if (criterion.kind === "optical-service") {
      optics ??= analyzeOptics(doc);
      const paths = optics.paths.filter((path) => path.ont.deviceId === criterion.ont);
      const statuses = paths.map((path) => path.status);
      const worst = statuses.length === 0 ? null : (statuses.find((status) => !IN_SERVICE.has(status)) ?? statuses[0] ?? null);
      results.push({ criterion, passed: paths.length > 0 && statuses.every((status) => IN_SERVICE.has(status)), sent: 0, replies: 0, opticalStatus: worst });
      continue;
    }
    const created = createSimulation(doc, { seed: 1, parameters: { limits: { maxEvents: EVALUATION_MAX_EVENTS } } });
    if (!created.ok) return { ok: false, issues: created.issues };
    const sim = created.simulation;
    const outcome = sim.enqueue({ type: "ping", deviceId: criterion.from, destination: criterion.to, count: EVALUATION_ECHOES });
    if (!outcome.ok) {
      results.push({ criterion, passed: false, sent: 0, replies: 0, opticalStatus: null });
      continue;
    }
    sim.run({ stopWhenIdle: true, maxEvents: EVALUATION_MAX_EVENTS });
    const view = sim.snapshot().pings.find((ping) => ping.id === outcome.sessionId);
    const replies = view?.attempts.filter((attempt) => attempt.status === "reply").length ?? 0;
    const sent = view?.attempts.length ?? 0;
    const succeeded = view?.done === true && sent > 0 && replies === sent;
    const failed = view?.done === true && replies === 0;
    results.push({ criterion, passed: criterion.kind === "ping-succeeds" ? succeeded : failed, sent, replies, opticalStatus: null });
  }
  return { ok: true, results };
}

/**
 * Progression locale d'un exercice (enregistrée sur l'appareil, relue comme
 * une donnée externe). Les points acquis le sont étape par étape.
 */
export const exerciseProgressSchema = z.strictObject({
  exerciseId: identifier,
  revision: z.int().min(1),
  step: z.int().min(0).max(12),
  earned: z.array(z.int().min(0).max(100)).max(12),
  attempts: z.array(z.int().min(0).max(1000)).max(12),
  hintsShown: z.int().min(0).max(5),
  finished: z.boolean(),
});
export type ExerciseProgress = z.infer<typeof exerciseProgressSchema>;

export function newProgress(exercise: Exercise): ExerciseProgress {
  return {
    exerciseId: exercise.id,
    revision: exercise.revision,
    step: 0,
    earned: exercise.steps.map(() => 0),
    attempts: exercise.steps.map(() => 0),
    hintsShown: 0,
    finished: false,
  };
}

/** Score courant : points acquis moins les indices consultés (jamais négatif). */
export function currentScore(exercise: Exercise, progress: ExerciseProgress): number {
  const earned = progress.earned.reduce((sum, value) => sum + value, 0);
  return Math.max(0, earned - progress.hintsShown * exercise.hintPenalty);
}
