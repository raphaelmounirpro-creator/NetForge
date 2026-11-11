import { EXERCISE_FORMAT, EXERCISE_VERSION, parseExercise, type Exercise, type ExerciseStep } from "@netforge/engine";
import { getModel, type NfgDocument } from "@netforge/project";
import { fill, formatIssue, messages } from "../../../i18n";

const t = messages.evaluations;

/**
 * Valeurs par défaut prises dans la topologie : un poste source, une cible,
 * un ONT. La cible est de préférence un autre poste (un contrôle vers la
 * passerelle du poste source réussirait sans rien corriger).
 */
export function topologyDefaults(project: NfgDocument): { from: string; to: string; ont: string } {
  const devices = project.topology.devices;
  const kindOf = (id: string) => {
    const device = devices.find((item) => item.id === id);
    return device ? getModel(device.model).kind : null;
  };
  const source = devices.find((device) => getModel(device.model).kind === "pc") ?? devices.find((device) => getModel(device.model).ipCapable) ?? devices[0];
  const from = source?.id ?? "pc1";
  const addresses = Object.entries(project.configurations).flatMap(([id, config]) =>
    Object.values(config.interfaces).flatMap((value) => (value.ipv4 && id !== from ? [{ address: value.ipv4.address, host: kindOf(id) === "pc" }] : [])),
  );
  const target = addresses.find((item) => item.host) ?? addresses[0];
  const ont = devices.find((device) => getModel(device.model).kind === "ont")?.id ?? from;
  return { from, to: target?.address ?? "192.168.1.1", ont };
}

export function newStep(kind: ExerciseStep["kind"], project: NfgDocument): ExerciseStep {
  const { from, to } = topologyDefaults(project);
  const title = t.newStepTitle;
  switch (kind) {
    case "observe":
      return { kind, title, instruction: t.newInstruction, check: { kind: "ping-observed", from, to, outcome: "failure" }, points: 0 };
    case "hypothesis":
      return {
        kind,
        title,
        question: t.newQuestion,
        choices: [
          { id: "a", text: `${t.newChoice} 1`, correct: true, feedback: t.newFeedback },
          { id: "b", text: `${t.newChoice} 2`, correct: false, feedback: t.newFeedback },
        ],
        points: 10,
        retryPoints: 5,
      };
    case "measure":
      return { kind, title, question: t.newQuestion, answer: { kind: "network", value: "192.168.1.0/24" }, wrongFeedback: t.newFeedback, points: 10 };
    case "fix":
      return { kind, title, instruction: t.newInstruction, criteria: [{ kind: "ping-succeeds", from, to }], points: 20 };
    case "retest":
      return { kind, title, instruction: t.newInstruction, check: { kind: "ping-observed", from, to, outcome: "success" }, points: 10 };
    case "debrief":
      return { kind, title: t.newDebriefTitle, text: t.newDebrief };
  }
}

/** Nouvel exercice valide : la topologie du projet ouvert et un bilan à compléter. */
export function newExercise(project: NfgDocument): Exercise {
  return {
    format: EXERCISE_FORMAT,
    version: EXERCISE_VERSION,
    id: `exercice-${crypto.randomUUID().slice(0, 8)}`,
    revision: 1,
    title: t.newTitle,
    summary: t.newSummary,
    level: "beginner",
    objective: t.newObjective,
    statement: t.newStatement,
    allowed: ["simulation", "console", "addressing", "routes"],
    project,
    steps: [newStep("debrief", project)],
    hints: [],
    hintPenalty: 0,
  };
}

/** Identifiant libre pour une nouvelle proposition (lettres a, b, c… puis suffixe numérique). */
export function nextChoiceId(used: readonly string[]): string {
  for (const letter of "abcdefghijklmnopqrstuvwxyz") if (!used.includes(letter)) return letter;
  let index = 1;
  while (used.includes(`choix-${String(index)}`)) index += 1;
  return `choix-${String(index)}`;
}

/** Problèmes de validation du moteur, rendus lisibles (lieu, puis problèmes du projet). */
export function draftProblems(draft: Exercise): string[] {
  const parsed = parseExercise(draft);
  if (parsed.ok) return [];
  const places = new Set<string>();
  for (const path of parsed.paths) {
    const [head, index] = path.split(".");
    if (head === "steps" && index !== undefined && /^\d+$/.test(index)) places.add(fill(t.problemStep, { n: Number(index) + 1 }));
    else if (head && head in t.problemPlaces) places.add(t.problemPlaces[head as keyof typeof t.problemPlaces]);
    else if (head) places.add(head);
  }
  return [...[...places].map((place) => fill(t.problemAt, { place })), ...parsed.issues.slice(0, 10).map(formatIssue)];
}

/** Brouillon prêt à enregistrer : la révision du contenu suit celle du compte. */
export function withRevision(draft: Exercise, revision: number): Exercise {
  return { ...draft, revision };
}
