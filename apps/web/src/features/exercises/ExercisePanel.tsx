import {
  currentScore,
  evaluateCriteria,
  maxScore,
  measurementObserved,
  pingObserved,
  sameDecibel,
  sameNetwork,
  type Exercise,
  type ExerciseProgress,
  type ExerciseStep,
} from "@netforge/engine";
import { ChevronDown, ChevronUp, GraduationCap } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { fill, formatIssue, messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { statusText } from "../optics/format";
import { powerMeasurements, useOpticsSession } from "../optics/store";
import { useSimulationStore } from "../simulation/store";
import { findExercise } from "./catalog";
import { useExerciseStore } from "./progress";

const t = messages.exercises;

type Feedback = { readonly tone: "success" | "error"; readonly lines: readonly string[] } | null;

interface StepProps<K extends ExerciseStep["kind"]> {
  readonly projectId: string;
  readonly project: OpenProject;
  readonly step: Extract<ExerciseStep, { kind: K }>;
  readonly attempts: number;
  readonly succeed: (points: number, message: string) => void;
  readonly fail: (lines: readonly string[]) => void;
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  return (
    <div role="status" aria-live="polite" className="text-sm">
      {feedback && (
        <div className={feedback.tone === "success" ? "text-success" : "text-danger"}>
          {feedback.lines.map((line, index) => (
            <p key={`${String(index)}-${line}`}>
              {index === 0 ? (feedback.tone === "success" ? "✓ " : "✕ ") : ""}
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Observer ou retester : le moteur a-t-il calculé le ping demandé, ou le
 * photomètre a-t-il donné la mesure demandée, avec le résultat attendu ?
 */
function ObserveStep({ projectId, project, step, succeed, fail }: StepProps<"observe" | "retest">) {
  const session = useSimulationStore((state) => (state.session?.projectId === projectId ? state.session : null));
  const optics = useOpticsSession(projectId);
  const verify = () => {
    const check = step.check;
    if (check.kind === "power-measured") {
      if (measurementObserved(powerMeasurements(optics), check)) {
        succeed(step.points, fill(t.measuredOk, { points: step.points }));
        return;
      }
      const device = project.document.topology.devices.find((item) => item.id === check.deviceId)?.name ?? check.deviceId;
      const params = { device, port: check.portId, direction: messages.optics.directionShort[check.direction] };
      fail([fill(step.kind === "retest" ? t.remeasureMissing : t.measuredMissing, params)]);
      return;
    }
    const pings = session ? Object.values(session.pings) : [];
    if (pingObserved(pings, check)) succeed(step.points, fill(t.observedOk, { points: step.points }));
    else if (step.kind === "retest") fail([fill(t.retestMissing, { from: check.from.toUpperCase(), to: check.to })]);
    else fail([t.observedMissing]);
  };
  return (
    <>
      <p className="text-sm text-text">{step.instruction}</p>
      <Button size="sm" variant="primary" className="self-start" onClick={verify}>
        {t.verify}
      </Button>
    </>
  );
}

function HypothesisStep({ step, attempts, succeed, fail }: StepProps<"hypothesis">) {
  const name = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const validate = () => {
    const selected = step.choices.find((item) => item.id === choice);
    if (!selected) {
      fail([t.chooseFirst]);
      return;
    }
    if (selected.correct) {
      const points = attempts === 0 ? step.points : step.retryPoints;
      succeed(points, fill(t.rightChoice, { points, feedback: selected.feedback }));
    } else fail([fill(t.wrongChoice, { feedback: selected.feedback })]);
  };
  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm text-text">{step.question}</legend>
        {step.choices.map((item) => (
          <label key={item.id} className="flex items-start gap-2 text-sm text-text">
            <input
              type="radio"
              name={name}
              value={item.id}
              checked={choice === item.id}
              onChange={() => {
                setChoice(item.id);
              }}
              className="mt-1"
            />
            {item.text}
          </label>
        ))}
      </fieldset>
      <Button size="sm" variant="primary" className="self-start" onClick={validate}>
        {t.validate}
      </Button>
    </>
  );
}

function MeasureStep({ step, succeed, fail }: StepProps<"measure">) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const expected = step.answer;
        const right = expected.kind === "network" ? sameNetwork(answer, expected.value) : sameDecibel(answer, expected.value, expected.tolerance);
        if (right) succeed(step.points, fill(t.rightMeasure, { points: step.points }));
        else fail([fill(t.wrongMeasure, { feedback: step.wrongFeedback })]);
      }}
    >
      <p className="text-sm text-text">{step.question}</p>
      <TextField
        label={t.answer}
        value={answer}
        autoComplete="off"
        spellCheck={false}
        className="max-w-xs"
        onChange={(event) => {
          setAnswer(event.target.value);
        }}
      />
      <Button type="submit" size="sm" variant="primary" className="self-start">
        {t.validate}
      </Button>
    </form>
  );
}

/** Corriger : le moteur rejoue les critères comportementaux sur la configuration actuelle. */
function FixStep({ project, step, succeed, fail }: StepProps<"fix">) {
  const nameOf = (id: string) => project.document.topology.devices.find((device) => device.id === id)?.name ?? id;
  const verify = () => {
    const evaluation = evaluateCriteria(project.document, step.criteria);
    if (!evaluation.ok) {
      fail(evaluation.issues.map(formatIssue));
      return;
    }
    const failing = evaluation.results.filter((result) => !result.passed);
    if (failing.length === 0) {
      succeed(step.points, fill(t.fixOk, { points: step.points }));
      return;
    }
    fail([
      t.fixFailed,
      ...failing.map(({ criterion, opticalStatus, activation, replies, sent }) =>
        criterion.kind === "optical-service"
          ? fill(t.criteria["optical-service"], {
              ont: nameOf(criterion.ont),
              // Symptôme seulement : le guide ne révèle pas la panne.
              status: opticalStatus ? statusText(opticalStatus, true) : t.opticalUnreached,
            })
          : criterion.kind === "ont-operational"
            ? fill(t.criteria["ont-operational"], { ont: nameOf(criterion.ont), state: activation ? messages.optics.pon.state[activation.state] : t.opticalUnreached })
            : fill(t.criteria[criterion.kind], { from: nameOf(criterion.from), to: criterion.to, replies, sent }),
      ),
    ]);
  };
  return (
    <>
      <p className="text-sm text-text">{step.instruction}</p>
      <Button size="sm" variant="primary" className="self-start" onClick={verify}>
        {t.verifyFix}
      </Button>
    </>
  );
}

function StepBody(props: StepProps<ExerciseStep["kind"]> & { onFinish: () => void; finished: boolean }) {
  const { step } = props;
  switch (step.kind) {
    case "observe":
    case "retest":
      return <ObserveStep {...props} step={step} />;
    case "hypothesis":
      return <HypothesisStep {...props} step={step} />;
    case "measure":
      return <MeasureStep {...props} step={step} />;
    case "fix":
      return <FixStep {...props} step={step} />;
    case "debrief":
      return (
        <>
          <p className="text-sm text-text">{step.text}</p>
          {!props.finished && (
            <Button size="sm" variant="primary" className="self-start" onClick={props.onFinish}>
              {t.finish}
            </Button>
          )}
        </>
      );
  }
}

function Guide({ projectId, project, exercise, progress }: { projectId: string; project: OpenProject; exercise: Exercise; progress: ExerciseProgress }) {
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const save = (next: ExerciseProgress) => {
    useExerciseStore.getState().save(projectId, next);
  };
  const index = Math.min(progress.step, exercise.steps.length - 1);
  const step = exercise.steps[index];
  const score = currentScore(exercise, progress);
  const max = maxScore(exercise);
  if (!step) return null;

  const succeed = (points: number, message: string) => {
    const earned = [...progress.earned];
    earned[index] = points;
    save({ ...progress, earned, step: Math.min(index + 1, exercise.steps.length - 1) });
    setFeedback({ tone: "success", lines: [message] });
  };
  const fail = (lines: readonly string[]) => {
    const attempts = [...progress.attempts];
    attempts[index] = (attempts[index] ?? 0) + 1;
    save({ ...progress, attempts });
    setFeedback({ tone: "error", lines });
  };
  const finish = () => {
    save({ ...progress, finished: true });
    setFeedback({ tone: "success", lines: [fill(t.finished, { score, max })] });
  };

  let body: ReactNode = null;
  if (open) {
    body = (
      <div className="flex flex-col gap-3 px-4 pt-1 pb-3">
        {index === 0 && (
          <p className="text-sm text-text-muted">
            <span className="font-semibold text-text">{t.statement} : </span>
            {exercise.statement}
          </p>
        )}
        <h3 className="text-sm font-semibold text-text">{fill(t.stepOf, { current: index + 1, total: exercise.steps.length, title: step.title })}</h3>
        <StepBody
          key={index}
          projectId={projectId}
          project={project}
          step={step}
          attempts={progress.attempts[index] ?? 0}
          succeed={succeed}
          fail={fail}
          onFinish={finish}
          finished={progress.finished}
        />
        <FeedbackLine feedback={feedback} />
        {exercise.hints.length > 0 && !progress.finished && (
          <section aria-label={t.hints} className="flex flex-col gap-1 border-t border-border pt-2">
            {exercise.hints.slice(0, progress.hintsShown).map((hint, hintIndex) => (
              <p key={hint} className="text-sm text-text">
                <span className="font-semibold">{fill(t.hintLabel, { n: hintIndex + 1 })} : </span>
                {hint}
              </p>
            ))}
            {progress.hintsShown < exercise.hints.length ? (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  save({ ...progress, hintsShown: progress.hintsShown + 1 });
                }}
              >
                {fill(t.hint, { penalty: exercise.hintPenalty })}
              </Button>
            ) : (
              <p className="text-xs text-text-muted">{t.noMoreHints}</p>
            )}
          </section>
        )}
        <p className="text-xs text-text-muted">{t.local}</p>
      </div>
    );
  }

  return (
    <section aria-label={t.panel} className="max-h-[60%] shrink-0 overflow-y-auto border-b-2 border-accent bg-surface-raised">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <GraduationCap aria-hidden="true" size={18} className="text-accent-text" />
        <h2 className="text-sm font-semibold text-text">{fill(t.heading, { title: exercise.title })}</h2>
        <span className="text-xs font-semibold text-text">{fill(t.score, { score, max })}</span>
        {!open && <span className="w-full text-xs text-text-muted">{fill(t.stepOf, { current: index + 1, total: exercise.steps.length, title: step.title })}</span>}
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
          {open ? t.hide : t.show}
        </Button>
      </div>
      {body}
    </section>
  );
}

/** Guide de l'exercice associé au projet actif (rien si le projet n'est pas un exercice). */
export function ExercisePanel({ projectId, project }: { projectId: string; project: OpenProject }) {
  const progress = useExerciseStore((state) => state.progress[projectId]);
  useEffect(() => {
    useExerciseStore.getState().load(projectId);
  }, [projectId]);
  const exercise = progress ? findExercise(progress.exerciseId) : undefined;
  if (!progress || !exercise) return null;
  return <Guide key={projectId} projectId={projectId} project={project} exercise={exercise} progress={progress} />;
}
