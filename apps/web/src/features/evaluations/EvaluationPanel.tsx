import type { AttemptResponse, SubmissionRequest } from "@netforge/contracts";
import { forbiddenChanges, parsePublicExercise, type PublicExercise, type PublicStep } from "@netforge/engine";
import { ChevronDown, ChevronUp, ClipboardCheck } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextField } from "../../components/ui/TextField";
import { fill, messages } from "../../i18n";
import { apiErrorText } from "../account/errors";
import type { OpenProject } from "../lab/store";
import { evaluationsApi } from "./api";
import { changesText, submissionDiagnostic } from "./diagnostics";
import { useEvaluationLinks, type EvaluationLink } from "./links";
import { ResultView } from "./ResultView";

const t = messages.evaluations;

type Loaded = { readonly exercise: PublicExercise; readonly attempt: AttemptResponse };

/** Réponses saisies, au format de la soumission (le serveur les corrige ; rien n'est corrigé ici). */
function answersOf(exercise: PublicExercise, link: EvaluationLink): SubmissionRequest["answers"] {
  return exercise.steps.flatMap((step, index): SubmissionRequest["answers"] => {
    const value = link.answers[String(index)]?.trim() ?? "";
    if (value === "") return [];
    if (step.kind === "hypothesis") return [{ step: index, choice: value }];
    if (step.kind === "measure") return [{ step: index, value: value.slice(0, 40) }];
    return [];
  });
}

function StepItem({ step, index, projectId, link, disabled }: { step: PublicStep; index: number; projectId: string; link: EvaluationLink; disabled: boolean }) {
  const name = useId();
  const value = link.answers[String(index)] ?? "";
  const setAnswer = (answer: string) => {
    useEvaluationLinks.getState().setAnswer(projectId, index, answer);
  };
  const graded = step.kind !== "observe" && step.kind !== "debrief";
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-2">
      <p className="text-sm font-semibold text-text">
        {index + 1}. {step.title}
        <span className="ml-2 text-xs font-normal text-text-muted">{graded ? fill(t.pointsLabel, { points: step.points }) : t.notGraded}</span>
      </p>
      {(step.kind === "observe" || step.kind === "fix" || step.kind === "retest") && <p className="text-sm text-text">{step.instruction}</p>}
      {step.kind === "hypothesis" && (
        <fieldset className="flex flex-col gap-1" disabled={disabled}>
          <legend className="mb-1 text-sm text-text">{step.question}</legend>
          {step.choices.map((choice) => (
            <label key={choice.id} className="flex items-start gap-2 text-sm text-text">
              <input
                type="radio"
                name={name}
                value={choice.id}
                checked={value === choice.id}
                onChange={() => {
                  setAnswer(choice.id);
                }}
                className="mt-1"
              />
              {choice.text}
            </label>
          ))}
        </fieldset>
      )}
      {step.kind === "measure" && (
        <>
          <p className="text-sm text-text">{step.question}</p>
          <TextField
            label={t.yourAnswer}
            value={value}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className="max-w-xs"
            onChange={(event) => {
              setAnswer(event.target.value);
            }}
          />
        </>
      )}
    </li>
  );
}

function Guide({ projectId, project, link }: { projectId: string; project: OpenProject; link: EvaluationLink }) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"hint" | "submit" | null>(null);
  const [feedback, setFeedback] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    void Promise.all([evaluationsApi.evaluation(link.code), evaluationsApi.attempt(link.attemptId)]).then(
      ([evaluation, attempt]) => {
        const exercise = parsePublicExercise(evaluation.exercise);
        if (exercise) setData({ exercise, attempt });
        else setLoadError(messages.apiErrors["server.unavailable"]);
      },
      (error: unknown) => {
        setLoadError(apiErrorText(error));
      },
    );
  }, [link.code, link.attemptId]);

  useEffect(load, [load]);

  if (!data) {
    return (
      <section aria-label={t.panel} className="shrink-0 border-b-2 border-accent bg-surface-raised px-4 py-2">
        <p role="status" className="text-sm text-text-muted">
          {loadError ?? t.loadingAttempt}
        </p>
        {loadError && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setLoadError(null);
              load();
            }}
          >
            {t.retry}
          </Button>
        )}
      </section>
    );
  }

  const { exercise, attempt } = data;
  const submitted = attempt.result !== null;
  const answers = answersOf(exercise, link);
  const questions = exercise.steps.filter((step) => step.kind === "hypothesis" || step.kind === "measure").length;
  const violations = forbiddenChanges(exercise.project, project.document, exercise.allowed);

  const requestHint = () => {
    setBusy("hint");
    setFeedback([]);
    void evaluationsApi.hint(attempt.id).then(
      (updated) => {
        setBusy(null);
        setData({ exercise, attempt: updated });
      },
      (error: unknown) => {
        setBusy(null);
        setFeedback([apiErrorText(error)]);
      },
    );
  };

  const submit = () => {
    setConfirming(false);
    setBusy("submit");
    setFeedback([]);
    void evaluationsApi.submit(attempt.id, { project: project.document, answers }).then(
      (graded) => {
        setBusy(null);
        setData({ exercise, attempt: graded });
      },
      (error: unknown) => {
        setBusy(null);
        setFeedback(submissionDiagnostic(error, exercise));
      },
    );
  };

  return (
    <section aria-label={t.panel} className="max-h-[60%] shrink-0 overflow-y-auto border-b-2 border-accent bg-surface-raised">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <ClipboardCheck aria-hidden="true" size={18} className="text-accent-text" />
        <h2 className="text-sm font-semibold text-text">{fill(t.heading, { title: exercise.title })}</h2>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
          {open ? t.hidePanel : t.showPanel}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 px-4 pt-1 pb-3">
          {submitted ? (
            <ResultView attempt={attempt} />
          ) : (
            <>
              <p className="text-sm text-text-muted">{t.panelIntro}</p>
              <p className="text-sm text-text">
                <span className="font-semibold">{messages.exercises.statement} : </span>
                {exercise.statement}
              </p>
              {/* Les bilans ne sont révélés qu'avec la note : ils ne figurent pas dans la liste avant. */}
              <ol className="flex flex-col gap-2">
                {exercise.steps.map((step, index) =>
                  step.kind === "debrief" ? null : <StepItem key={`${String(index)}-${step.kind}`} step={step} index={index} projectId={projectId} link={link} disabled={busy === "submit"} />,
                )}
              </ol>
              {exercise.hintCount > 0 && (
                <div className="flex flex-col gap-1 border-t border-border pt-2">
                  <h3 className="text-sm font-semibold text-text">{messages.exercises.hints}</h3>
                  {attempt.hints.map((hint, index) => (
                    <p key={hint} className="text-sm text-text">
                      <span className="font-semibold">{fill(messages.exercises.hintLabel, { n: index + 1 })} : </span>
                      {hint}
                    </p>
                  ))}
                  <p className="text-xs text-text-muted">{fill(t.hintsUsed, { used: attempt.hints.length, count: attempt.hintCount })}</p>
                  {attempt.hints.length < attempt.hintCount && (
                    <Button size="sm" variant="secondary" className="self-start" busy={busy === "hint"} onClick={requestHint}>
                      {fill(t.hintButton, { penalty: exercise.hintPenalty })}
                    </Button>
                  )}
                </div>
              )}
              <Button
                variant="primary"
                className="self-start"
                busy={busy === "submit"}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t.submit}
              </Button>
            </>
          )}
          <div role="status" aria-live="polite" className="text-sm text-danger empty:hidden">
            {feedback.map((line, index) => (
              <p key={`${String(index)}-${line}`}>
                {index === 0 ? "✕ " : ""}
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
      <Dialog
        open={confirming}
        title={t.confirmTitle}
        onClose={() => {
          setConfirming(false);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t.cancel}
            </Button>
            <Button variant="primary" onClick={submit}>
              {t.confirmSubmit}
            </Button>
          </>
        }
      >
        <p>{t.confirmBody}</p>
        {answers.length < questions && <p className="mt-2">{fill(t.unanswered, { count: questions - answers.length })}</p>}
        {violations.length > 0 && <p className="mt-2 text-warning">{fill(t.confirmWarn, { changes: changesText(violations) })}</p>}
      </Dialog>
    </section>
  );
}

/** Évaluation liée au projet actif (rien si le projet n'est pas une tentative d'évaluation). */
export function EvaluationPanel({ projectId, project }: { projectId: string; project: OpenProject }) {
  const link = useEvaluationLinks((state) => state.links[projectId]);
  useEffect(() => {
    useEvaluationLinks.getState().load(projectId);
  }, [projectId]);
  if (!link) return null;
  return <Guide key={projectId} projectId={projectId} project={project} link={link} />;
}
