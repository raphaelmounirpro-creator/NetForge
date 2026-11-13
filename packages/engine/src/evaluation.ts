import { parseNfgValue, type Issue, type NfgDocument } from "@netforge/project";
import { z } from "zod";
import { sameDecibel, sameNetwork, measurementConformity, type Criterion, type Exercise, type ExerciseStep, type ObservationCheck } from "./exercise.js";
import { analyzeOptics, measurePower, type OpticalStatus } from "./optics.js";
import { analyzePon } from "./pon.js";
import { createSimulation } from "./simulation.js";

/**
 * Évaluations notées (phase 6). L'exercice complet (critères, bonnes
 * réponses, retours, bilan, indices) reste côté serveur ; le navigateur ne
 * reçoit que sa partie publique. Le serveur note la soumission (projet final
 * et réponses) avec ce module : simulation neuve à graine fixe pour chaque
 * contrôle, limites de taille et d'événements, aucune configuration de
 * référence comparée. Un dépassement de limite produit un diagnostic, jamais
 * une note.
 *
 * EVALUATOR_VERSION change dès qu'une même soumission peut recevoir une note
 * différente (règles de notation, limites, moteur). Version 2 : VLAN et STP
 * (format v5), fonction autorisée « switching » pour la configuration des
 * switches (ports d'accès et trunks, Spanning Tree). Version 3 : DHCP (format v6),
 * configuration des clients et des plages protégée par « addressing ». Version 4 :
 * DNS (format v7), résolveur des postes et service des routeurs protégés par
 * « addressing » ; moteur capable de pings par nom. Version 5 : RIP (format v8),
 * participation des interfaces protégée par « routes » ; contrôles après la
 * convergence initiale. Version 6 : OSPF (format v9), mode, coût et priorité
 * des interfaces protégés par « routes » ; routes OSPF préférées à RIP.
 * Version 7 : VRRP (format v10), groupes des routeurs protégés par « routes »
 * (passerelle des postes) ; contrôles après l'élection du maître. Version 8 :
 * zones OSPF (format v11), zone des interfaces protégée par « routes ».
 * Version 9 : BGP (format v12), AS, voisins et réseaux annoncés protégés par
 * « routes » ; contrôles après l'établissement des sessions.
 * Version 10 : PON (format v13), autorisations des OLT et numéros de série des
 * ONT protégés par la fonction « pon » ; critère « ONT en fonctionnement ».
 */
export const EVALUATOR_VERSION = 10;

export const EVALUATION_LIMITS = {
  /** Équipements et liens du projet soumis. */
  maxDevices: 120,
  maxLinks: 240,
  /** Contrôles simulés par soumission (critères de correction et contrôles de retest). */
  maxChecks: 24,
  /** Événements traités par contrôle (un ping de deux échos sur un réseau sain en demande quelques centaines). */
  maxEventsPerCheck: 100_000,
} as const;

/** Fonctions autorisées qui correspondent à des modifications du projet (les autres sont des moyens d'agir). */
export const GUARDED_FUNCTIONS = ["topology", "addressing", "routes", "optics", "switching", "pon"] as const;
export type GuardedFunction = (typeof GUARDED_FUNCTIONS)[number];
/** Modification refusée : une fonction non autorisée, ou des pannes ajoutées ou modifiées (jamais permis). */
export type ForbiddenChange = GuardedFunction | "faults";

const identifier = z.string().regex(/^[a-z0-9-]{1,64}$/);

/** Réponse de l'élève à une étape « hypothèse » (choix) ou « mesure » (valeur saisie). */
export const answerSchema = z.strictObject({
  step: z.int().min(0).max(11),
  choice: identifier.optional(),
  value: z.string().max(40).optional(),
});
export type EvaluationAnswer = z.infer<typeof answerSchema>;

export type PublicStep =
  | { readonly kind: "observe"; readonly title: string; readonly instruction: string; readonly points: 0 }
  | { readonly kind: "hypothesis"; readonly title: string; readonly question: string; readonly choices: readonly { readonly id: string; readonly text: string }[]; readonly points: number }
  | { readonly kind: "measure"; readonly title: string; readonly question: string; readonly answerKind: "network" | "decibel"; readonly points: number }
  | { readonly kind: "fix"; readonly title: string; readonly instruction: string; readonly points: number }
  | { readonly kind: "retest"; readonly title: string; readonly instruction: string; readonly points: number }
  | { readonly kind: "debrief"; readonly title: string; readonly points: 0 };

/** Ce que l'élève reçoit : ni critères, ni bonnes réponses, ni retours, ni bilan, ni texte des indices. */
export interface PublicExercise {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly summary: string;
  readonly level: Exercise["level"];
  readonly objective: string;
  readonly statement: string;
  readonly allowed: Exercise["allowed"];
  readonly project: NfgDocument;
  readonly steps: readonly PublicStep[];
  readonly hintCount: number;
  readonly hintPenalty: number;
  readonly maxScore: number;
}

/** Étapes notées en évaluation : l'observation est une démarche, invérifiable a posteriori. */
function gradedMax(step: ExerciseStep): number {
  return step.kind === "hypothesis" || step.kind === "measure" || step.kind === "fix" || step.kind === "retest" ? step.points : 0;
}

export function evaluationMaxScore(exercise: Exercise): number {
  return exercise.steps.reduce((sum, step) => sum + gradedMax(step), 0);
}

function publicStep(step: ExerciseStep): PublicStep {
  switch (step.kind) {
    case "observe":
      return { kind: "observe", title: step.title, instruction: step.instruction, points: 0 };
    case "hypothesis":
      return { kind: "hypothesis", title: step.title, question: step.question, choices: step.choices.map(({ id, text }) => ({ id, text })), points: step.points };
    case "measure":
      return { kind: "measure", title: step.title, question: step.question, answerKind: step.answer.kind, points: step.points };
    case "fix":
      return { kind: "fix", title: step.title, instruction: step.instruction, points: step.points };
    case "retest":
      return { kind: "retest", title: step.title, instruction: step.instruction, points: step.points };
    case "debrief":
      return { kind: "debrief", title: step.title, points: 0 };
  }
}

const shortText = z.string().min(1).max(3000);
const publicStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observe"), title: shortText, instruction: shortText, points: z.literal(0) }),
  z.strictObject({
    kind: z.literal("hypothesis"),
    title: shortText,
    question: shortText,
    choices: z.array(z.strictObject({ id: identifier, text: shortText })).min(2).max(6),
    points: z.int().min(0).max(100),
  }),
  z.strictObject({ kind: z.literal("measure"), title: shortText, question: shortText, answerKind: z.enum(["network", "decibel"]), points: z.int().min(0).max(100) }),
  z.strictObject({ kind: z.literal("fix"), title: shortText, instruction: shortText, points: z.int().min(0).max(100) }),
  z.strictObject({ kind: z.literal("retest"), title: shortText, instruction: shortText, points: z.int().min(0).max(100) }),
  z.strictObject({ kind: z.literal("debrief"), title: shortText, points: z.literal(0) }),
]);

const publicExerciseSchema = z.strictObject({
  id: identifier,
  revision: z.int().min(1),
  title: shortText,
  summary: shortText,
  level: z.enum(["beginner", "intermediate", "advanced"]),
  objective: shortText,
  statement: shortText,
  allowed: z.array(z.enum(["simulation", "addressing", "routes", "console", "topology", "optics", "switching", "pon"])).max(8),
  project: z.unknown(),
  steps: z.array(publicStepSchema).min(1).max(12),
  hintCount: z.int().min(0).max(5),
  hintPenalty: z.int().min(0).max(100),
  maxScore: z.int().min(0),
});

/** Relit la partie publique reçue de l'API (donnée externe), projet initial compris. */
export function parsePublicExercise(raw: unknown): PublicExercise | null {
  const parsed = publicExerciseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const project = parseNfgValue(parsed.data.project);
  return project.ok ? { ...parsed.data, project: project.document } : null;
}

export function publicExercise(exercise: Exercise): PublicExercise {
  return {
    id: exercise.id,
    revision: exercise.revision,
    title: exercise.title,
    summary: exercise.summary,
    level: exercise.level,
    objective: exercise.objective,
    statement: exercise.statement,
    allowed: exercise.allowed,
    project: exercise.project,
    steps: exercise.steps.map(publicStep),
    hintCount: exercise.hints.length,
    hintPenalty: exercise.hintPenalty,
    maxScore: evaluationMaxScore(exercise),
  };
}

/** Nombre de contrôles simulés qu'exige la notation de l'exercice. */
export function evaluationChecks(exercise: Exercise): number {
  return exercise.steps.reduce((sum, step) => sum + (step.kind === "fix" ? step.criteria.length : step.kind === "retest" ? 1 : 0), 0);
}

/** Un exercice publiable en évaluation : au moins un point noté, contrôles dans les limites. */
export function evaluationReadiness(exercise: Exercise): { readonly ok: true } | { readonly ok: false; readonly reason: "no-graded-points" | "too-many-checks"; readonly max?: number } {
  if (evaluationMaxScore(exercise) === 0) return { ok: false, reason: "no-graded-points" };
  if (evaluationChecks(exercise) > EVALUATION_LIMITS.maxChecks) return { ok: false, reason: "too-many-checks", max: EVALUATION_LIMITS.maxChecks };
  return { ok: true };
}

// --- Fonctions autorisées -------------------------------------------------

const stable = (value: unknown): string => JSON.stringify(value);

const byId = (a: { readonly id: string }, b: { readonly id: string }) => a.id.localeCompare(b.id);

function topologyOf(doc: NfgDocument): string {
  const devices = [...doc.topology.devices].sort(byId).map(({ id, model }) => [id, model]);
  const links = [...doc.topology.links].sort(byId).map((link) => [link.id, link.endpoints.map((end) => `${end.deviceId}:${end.portId}`).sort(), link.fiber]);
  return stable({ devices, links });
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Adresses présentes seulement : une configuration vide (nouvel équipement) n'est pas un changement d'adressage.
 * Services IP de base compris : plages DHCP, résolveur et service DNS.
 */
function addressingOf(doc: NfgDocument): string {
  const devices = sortedEntries(doc.configurations).map(([id, config]) => ({
    id,
    addresses: sortedEntries(config.interfaces)
      .filter(([, value]) => value.ipv4 !== null || value.dhcp)
      .map(([port, value]) => [port, value.ipv4, value.dhcp]),
    pools: sortedEntries(config.dhcpPools),
    dnsServer: config.dnsServer,
    dnsRecords: config.dnsRecords === null ? null : sortedEntries(config.dnsRecords),
  }));
  return stable(devices.filter((device) => device.addresses.length > 0 || device.pools.length > 0 || device.dnsServer !== null || device.dnsRecords !== null));
}

/** Configuration des switches : ports (accès dans un VLAN autre que 1, trunks) et Spanning Tree. */
function switchingOf(doc: NfgDocument): string {
  return stable(
    sortedEntries(doc.configurations)
      .filter(([, config]) => Object.keys(config.switchports).length > 0 || config.stp !== null)
      .map(([id, config]) => [id, sortedEntries(config.switchports), config.stp]),
  );
}

/** Passerelles, routes statiques et routage dynamique (interfaces RIP). */
function routesOf(doc: NfgDocument): string {
  return stable(
    sortedEntries(doc.configurations)
      .filter(
        ([, config]) =>
          config.defaultGateway !== null || config.staticRoutes.length > 0 || Object.keys(config.ripInterfaces).length > 0 || Object.keys(config.ospfInterfaces).length > 0 || Object.keys(config.vrrpGroups).length > 0 || config.bgp !== null,
      )
      .map(([id, config]) => [id, config.defaultGateway, config.staticRoutes, sortedEntries(config.ripInterfaces), sortedEntries(config.ospfInterfaces), sortedEntries(config.vrrpGroups), config.bgp]),
  );
}

/** ONT autorisés par port d'OLT (seuls les ports qui en portent). */
function authorizationsOf(doc: NfgDocument): string {
  return stable(
    sortedEntries(doc.configurations)
      .filter(([, config]) => Object.keys(config.ponAuthorizations).length > 0)
      .map(([id, config]) => [id, sortedEntries(config.ponAuthorizations)]),
  );
}

/**
 * Configuration PON modifiée : autorisations des OLT, ou numéro de série d'un
 * ONT du projet initial. Un ONT ajouté (topologie) porte un numéro d'usine :
 * ce n'est pas une modification PON.
 */
function ponChanged(initial: NfgDocument, submitted: NfgDocument): boolean {
  if (authorizationsOf(initial) !== authorizationsOf(submitted)) return true;
  return Object.entries(initial.configurations).some(([id, config]) => {
    const after = submitted.configurations[id];
    return config.serialNumber !== null && after !== undefined && after.serialNumber !== config.serialNumber;
  });
}

/**
 * Modifications du projet soumis qui dépassent les fonctions autorisées.
 * Noms, disposition, notes et métadonnées restent libres. Les sous-interfaces,
 * DHCP et DNS relèvent de l'adressage ; ports de switch et Spanning Tree de « switching ». « optics » permet
 * de retirer des pannes (interventions), jamais d'en ajouter ou d'en modifier.
 */
export function forbiddenChanges(initial: NfgDocument, submitted: NfgDocument, allowed: readonly string[]): ForbiddenChange[] {
  const violations: ForbiddenChange[] = [];
  if (!allowed.includes("topology") && topologyOf(initial) !== topologyOf(submitted)) violations.push("topology");
  if (!allowed.includes("addressing") && addressingOf(initial) !== addressingOf(submitted)) violations.push("addressing");
  if (!allowed.includes("routes") && routesOf(initial) !== routesOf(submitted)) violations.push("routes");
  if (!allowed.includes("switching") && switchingOf(initial) !== switchingOf(submitted)) violations.push("switching");
  if (!allowed.includes("pon") && ponChanged(initial, submitted)) violations.push("pon");
  const initialFaults = new Map(initial.faults.map((fault) => [fault.id, stable(fault)]));
  if (submitted.faults.some((fault) => initialFaults.get(fault.id) !== stable(fault))) violations.push("faults");
  else if (submitted.faults.length !== initial.faults.length && !allowed.includes("optics")) violations.push("optics");
  return violations;
}

// --- Notation ---------------------------------------------------------------

export type EvaluationLimit = "devices" | "links" | "checks" | "events" | "pending-events" | "time";

export interface StepGrade {
  readonly step: number;
  readonly kind: ExerciseStep["kind"];
  readonly title: string;
  readonly points: number;
  readonly max: number;
  readonly status: "earned" | "missed" | "not-graded";
}

export type GradeOutcome =
  | {
      readonly ok: true;
      readonly evaluatorVersion: number;
      readonly steps: readonly StepGrade[];
      readonly earned: number;
      readonly hintPenalty: number;
      readonly score: number;
      readonly max: number;
    }
  | { readonly ok: false; readonly reason: "limit"; readonly limit: EvaluationLimit; readonly max: number; readonly step: number | null }
  | { readonly ok: false; readonly reason: "forbidden-change"; readonly changes: readonly ForbiddenChange[] }
  | { readonly ok: false; readonly reason: "invalid-project"; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly reason: "invalid-answer"; readonly step: number };

type CheckOutcome = { readonly ok: true; readonly passed: boolean } | { readonly ok: false; readonly limit: EvaluationLimit; readonly max: number } | { readonly ok: false; readonly issues: readonly Issue[] };

const ECHOES = 2;
const IN_SERVICE: ReadonlySet<OpticalStatus> = new Set<OpticalStatus>(["ok", "low-margin"]);

/** Ping de deux échos dans une simulation neuve, borné ; « limite » si le moteur s'interrompt. */
function pingCheck(doc: NfgDocument, from: string, to: string): { ok: true; sent: number; replies: number; done: boolean } | Exclude<CheckOutcome, { ok: true }> {
  const max = EVALUATION_LIMITS.maxEventsPerCheck;
  const created = createSimulation(doc, { seed: 1, parameters: { limits: { maxEvents: max } } });
  if (!created.ok) return { ok: false, issues: created.issues };
  const sim = created.simulation;
  // Les services de démarrage (DHCP) doivent avoir une chance de configurer le poste.
  const startup = sim.run({ stopWhenIdle: true, maxEvents: max });
  const initial = sim.snapshot();
  if (initial.diagnostic) {
    const diagnostic = initial.diagnostic;
    return { ok: false, limit: diagnostic.code === "limit.pending-events" ? "pending-events" : diagnostic.code === "limit.time" ? "time" : "events", max: diagnostic.limit };
  }
  if (startup.stop === "budget") return { ok: false, limit: "events", max };
  const outcome = sim.enqueue({ type: "ping", deviceId: from, destination: to, count: ECHOES });
  if (!outcome.ok) return { ok: true, sent: 0, replies: 0, done: false };
  const run = sim.run({ stopWhenIdle: true, maxEvents: max - initial.processedEvents });
  const snapshot = sim.snapshot();
  const diagnostic = snapshot.diagnostic;
  if (diagnostic) {
    const limit: EvaluationLimit = diagnostic.code === "limit.pending-events" ? "pending-events" : diagnostic.code === "limit.time" ? "time" : "events";
    return { ok: false, limit, max: diagnostic.limit };
  }
  if (run.stop === "budget") return { ok: false, limit: "events", max };
  const view = snapshot.pings.find((ping) => ping.id === outcome.sessionId);
  const sent = view?.attempts.length ?? 0;
  return { ok: true, sent, replies: view?.attempts.filter((attempt) => attempt.status === "reply").length ?? 0, done: view?.done === true };
}

function criterionCheck(doc: NfgDocument, criterion: Criterion, optics: () => ReturnType<typeof analyzeOptics>): CheckOutcome {
  if (criterion.kind === "ont-operational") {
    return { ok: true, passed: analyzePon(doc, optics()).onts.some((ont) => ont.ontId === criterion.ont && ont.state === "O5") };
  }
  if (criterion.kind === "optical-service") {
    const statuses = optics()
      .paths.filter((path) => path.ont.deviceId === criterion.ont)
      .map((path) => path.status);
    return { ok: true, passed: statuses.length > 0 && statuses.every((status) => IN_SERVICE.has(status)) };
  }
  const ping = pingCheck(doc, criterion.from, criterion.to);
  if (!ping.ok) return ping;
  const passed = criterion.kind === "ping-succeeds" ? ping.done && ping.sent > 0 && ping.replies === ping.sent : ping.done && ping.replies === 0;
  return { ok: true, passed };
}

/** Contrôle d'un retest, rejoué sur le projet soumis (le résultat attendu après correction). */
function observationCheck(doc: NfgDocument, check: ObservationCheck): CheckOutcome {
  if (check.kind === "ping-observed") {
    const ping = pingCheck(doc, check.from, check.to);
    if (!ping.ok) return ping;
    const success = ping.done && ping.sent > 0 && ping.replies === ping.sent;
    return { ok: true, passed: check.outcome === "success" ? success : ping.done && !success };
  }
  const point = { deviceId: check.deviceId, portId: check.portId };
  const measurements =
    check.direction === "downstream"
      ? [measurePower(doc, { direction: "downstream", point })]
      : doc.topology.devices.map((device) => measurePower(doc, { direction: "upstream", point, ontId: device.id }));
  const conformities = measurements.map(measurementConformity).filter((value) => value !== null);
  return { ok: true, passed: conformities.length > 0 && conformities.every((value) => value === check.outcome) };
}

function answerGrade(step: Extract<ExerciseStep, { kind: "hypothesis" | "measure" }>, answer: EvaluationAnswer | undefined): boolean {
  if (!answer) return false;
  if (step.kind === "hypothesis") return step.choices.some((choice) => choice.id === answer.choice && choice.correct);
  if (answer.value === undefined) return false;
  return step.answer.kind === "network" ? sameNetwork(answer.value, step.answer.value) : sameDecibel(answer.value, step.answer.value, step.answer.tolerance);
}

/**
 * Note une soumission. Déterministe : la même soumission reçoit toujours la
 * même note pour une même version du correcteur. `submitted` doit déjà être
 * un document valide (format .nfg.json) ; `hintsRevealed` est compté par le
 * serveur, jamais déclaré par le navigateur.
 */
export function gradeSubmission(exercise: Exercise, submitted: NfgDocument, answers: readonly EvaluationAnswer[], hintsRevealed: number): GradeOutcome {
  if (submitted.topology.devices.length > EVALUATION_LIMITS.maxDevices) return { ok: false, reason: "limit", limit: "devices", max: EVALUATION_LIMITS.maxDevices, step: null };
  if (submitted.topology.links.length > EVALUATION_LIMITS.maxLinks) return { ok: false, reason: "limit", limit: "links", max: EVALUATION_LIMITS.maxLinks, step: null };
  if (evaluationChecks(exercise) > EVALUATION_LIMITS.maxChecks) return { ok: false, reason: "limit", limit: "checks", max: EVALUATION_LIMITS.maxChecks, step: null };

  const seen = new Set<number>();
  for (const answer of answers) {
    const step = exercise.steps[answer.step];
    const fits = step !== undefined && ((step.kind === "hypothesis" && answer.value === undefined) || (step.kind === "measure" && answer.choice === undefined));
    if (!fits || seen.has(answer.step)) return { ok: false, reason: "invalid-answer", step: answer.step };
    seen.add(answer.step);
  }

  const violations = forbiddenChanges(exercise.project, submitted, exercise.allowed);
  if (violations.length > 0) return { ok: false, reason: "forbidden-change", changes: violations };

  let optics: ReturnType<typeof analyzeOptics> | null = null;
  const opticsOf = () => (optics ??= analyzeOptics(submitted));
  const steps: StepGrade[] = [];
  for (const [index, step] of exercise.steps.entries()) {
    const max = gradedMax(step);
    const base = { step: index, kind: step.kind, title: step.title, max };
    if (step.kind === "observe" || step.kind === "debrief") {
      steps.push({ ...base, points: 0, status: "not-graded" });
      continue;
    }
    let passed: boolean;
    if (step.kind === "hypothesis" || step.kind === "measure") {
      passed = answerGrade(step, answers.find((answer) => answer.step === index));
    } else {
      const checks = step.kind === "fix" ? step.criteria.map((criterion) => () => criterionCheck(submitted, criterion, opticsOf)) : [() => observationCheck(submitted, step.check)];
      passed = true;
      for (const check of checks) {
        const outcome = check();
        if (!outcome.ok) {
          if ("issues" in outcome) return { ok: false, reason: "invalid-project", issues: outcome.issues };
          return { ok: false, reason: "limit", limit: outcome.limit, max: outcome.max, step: index };
        }
        if (!outcome.passed) passed = false;
      }
    }
    steps.push({ ...base, points: passed ? max : 0, status: passed ? "earned" : "missed" });
  }
  const earned = steps.reduce((sum, step) => sum + step.points, 0);
  const hintPenalty = hintsRevealed * exercise.hintPenalty;
  return { ok: true, evaluatorVersion: EVALUATOR_VERSION, steps, earned, hintPenalty, score: Math.max(0, earned - hintPenalty), max: evaluationMaxScore(exercise) };
}
