import type { PublicExercise } from "@netforge/engine";
import { error as issueOf, ISSUE_CODES, type IssueCode } from "@netforge/project";
import { fill, formatIssue, messages } from "../../i18n";
import { ApiRequestError } from "../account/api";
import { apiErrorText } from "../account/errors";

const t = messages.evaluations;

/**
 * Diagnostic d'une soumission refusée par le serveur : la raison exacte
 * (limite atteinte, modification interdite, projet invalide), sans note et
 * sans tentative consommée. Les autres erreurs gardent leur texte commun.
 */
export function submissionDiagnostic(error: unknown, exercise: PublicExercise): string[] {
  if (!(error instanceof ApiRequestError)) return [apiErrorText(error)];
  const body = error.body;
  switch (body.code) {
    case "evaluation.limit-exceeded": {
      const limit = body.limit ? fill(t.limits[body.limit], { max: (body.max ?? 0).toLocaleString("fr-FR") }) : messages.apiErrors["evaluation.limit-exceeded"];
      const step = body.step === null || body.step === undefined ? undefined : exercise.steps[body.step];
      return [fill(t.limitDiagnostic, { limit, where: step ? fill(t.limitWhere, { title: step.title }) : "" })];
    }
    case "evaluation.forbidden-change":
      return [fill(t.forbiddenDiagnostic, { changes: changesText(body.changes ?? []) })];
    case "evaluation.invalid-project":
      // Codes relus comme donnée externe : seuls les codes connus du format sont affichés.
      return [
        t.invalidProjectDiagnostic,
        ...(body.issues ?? [])
          .filter((issue): issue is { code: IssueCode; params: Record<string, string | number> } => (ISSUE_CODES as readonly string[]).includes(issue.code))
          .slice(0, 10)
          .map((issue) => formatIssue(issueOf(issue.code, issue.params))),
      ];
    case "evaluation.invalid-answer":
      return [fill(t.invalidAnswerDiagnostic, { n: (body.step ?? 0) + 1 })];
    default:
      return [apiErrorText(error)];
  }
}

export function changesText(changes: readonly (keyof typeof t.changes)[]): string {
  return changes.map((change) => t.changes[change]).join(", ");
}
