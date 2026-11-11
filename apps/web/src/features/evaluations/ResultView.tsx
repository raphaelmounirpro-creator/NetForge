import type { AttemptResponse } from "@netforge/contracts";
import { fill, messages } from "../../i18n";

const t = messages.evaluations;

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
export const formatDate = (iso: string) => dateTime.format(new Date(iso));

const STATUS_MARK = { earned: "✓", missed: "✕", "not-graded": "–" } as const;

/** Note vérifiée par le serveur : détail par étape (symbole et texte, jamais la couleur seule), bilan et versions. */
export function ResultView({ attempt }: { attempt: AttemptResponse }) {
  const result = attempt.result;
  if (!result) return null;
  return (
    <section aria-label={t.result} className="flex flex-col gap-3">
      <p className="text-base font-semibold text-text">{fill(t.score, { score: result.score, max: result.max })}</p>
      <p className="text-sm text-text-muted">{fill(t.scoreDetail, { earned: result.earned, penalty: result.hintPenalty })}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {result.steps.map((step) => (
          <li key={step.step} className={step.status === "earned" ? "text-success" : step.status === "missed" ? "text-danger" : "text-text-muted"}>
            <span aria-hidden="true">{STATUS_MARK[step.status]} </span>
            {fill(t.stepLine, { n: step.step + 1, title: step.title, points: step.points, max: step.max, status: t.stepStatus[step.status] })}
          </li>
        ))}
      </ul>
      {attempt.debrief && attempt.debrief.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-text">{t.debrief}</h3>
          {attempt.debrief.map((item) => (
            <p key={`${item.title}-${item.text.slice(0, 20)}`} className="text-sm text-text">
              {/* Titre répété seulement s'il apporte quelque chose au-delà de « À retenir ». */}
              {item.title !== t.debrief && <span className="font-semibold">{item.title} : </span>}
              {item.text}
            </p>
          ))}
        </div>
      )}
      {attempt.submittedAt && (
        <p className="text-xs text-text-muted">{fill(t.versions, { date: formatDate(attempt.submittedAt), evaluator: result.evaluatorVersion, engine: result.engineVersion })}</p>
      )}
    </section>
  );
}
