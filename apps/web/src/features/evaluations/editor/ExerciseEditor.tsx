import { evaluationMaxScore, maxScore, parseExercise, type Exercise, type ExerciseStep } from "@netforge/engine";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "../../../app/router";
import { Button } from "../../../components/ui/Button";
import { Notice } from "../../../components/ui/Notice";
import { SelectField } from "../../../components/ui/SelectField";
import { TextArea } from "../../../components/ui/TextArea";
import { TextField } from "../../../components/ui/TextField";
import { fill, messages } from "../../../i18n";
import { apiErrorText } from "../../account/errors";
import { startExercise } from "../../exercises/progress";
import { rememberTried } from "../../exercises/tried";
import { useLabStore } from "../../lab/store";
import { evaluationsApi } from "../api";
import { draftProblems, newStep, withRevision } from "./draft";
import { PublicationsPanel } from "./PublicationsPanel";
import { StepEditor } from "./StepEditor";

const t = messages.evaluations;

const FUNCTIONS = ["simulation", "console", "addressing", "routes", "vlans", "topology", "optics"] as const;
const STEP_KINDS = ["observe", "hypothesis", "measure", "fix", "retest", "debrief"] as const;
const LEVELS = ["beginner", "intermediate", "advanced"] as const;

type Saved = { readonly revision: number; readonly snapshot: string };
type Status = { readonly tone: "success" | "danger" | "info"; readonly text: string } | null;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Editor({ exerciseId, initial, initialRevision }: { exerciseId: string; initial: Exercise; initialRevision: number }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState<Saved>({ revision: initialRevision, snapshot: JSON.stringify(initial) });
  const [busy, setBusy] = useState<"save" | "try" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [newKind, setNewKind] = useState<ExerciseStep["kind"]>("fix");
  const activeProject = useLabStore((state) => (state.activeId ? (state.projects[state.activeId] ?? null) : null));

  const problems = useMemo(() => draftProblems(draft), [draft]);
  const dirty = JSON.stringify(draft) !== saved.snapshot;
  const update = (patch: Partial<Exercise>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setSteps = (steps: ExerciseStep[]) => {
    update({ steps });
  };

  const save = () => {
    const next = withRevision(draft, saved.revision + 1);
    setBusy("save");
    setStatus(null);
    void evaluationsApi.updateExercise(exerciseId, next, saved.revision).then(
      (response) => {
        setBusy(null);
        setDraft(next);
        setSaved({ revision: response.revision, snapshot: JSON.stringify(next) });
        setStatus({ tone: "success", text: fill(t.saved, { revision: response.revision }) });
      },
      (error: unknown) => {
        setBusy(null);
        setStatus({ tone: "danger", text: apiErrorText(error) });
      },
    );
  };

  const tryIt = () => {
    const parsed = parseExercise({ ...draft, id: `essai-${exerciseId.slice(0, 8)}` });
    if (!parsed.ok) return;
    rememberTried(parsed.exercise);
    setBusy("try");
    void startExercise(parsed.exercise).then((started) => {
      setBusy(null);
      if (!started) setStatus({ tone: "danger", text: t.tryError });
    });
  };

  const devices = draft.project.topology.devices.length;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link to="/exercices" className="self-start text-sm text-accent-text underline underline-offset-4">
          {t.back}
        </Link>
        <h1 className="text-2xl font-semibold text-text">{draft.title || t.editorTitle}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" busy={busy === "save"} disabled={!dirty || problems.length > 0} onClick={save}>
            {t.save}
          </Button>
          <Button variant="secondary" busy={busy === "try"} disabled={problems.length > 0} onClick={tryIt}>
            {t.try}
          </Button>
          <span role="status" aria-live="polite" className="text-sm text-text-muted">
            {dirty ? t.unsaved : fill(t.saved, { revision: saved.revision })}
          </span>
        </div>
        <p className="text-xs text-text-muted">{t.tryHint}</p>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        {problems.length > 0 && (
          <Notice tone="warning" title={t.problems}>
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        )}
      </header>

      <Section id="exercise-general" title={t.general}>
        <TextField label={t.fields.title} mono={false} value={draft.title} maxLength={120} onChange={(event) => { update({ title: event.target.value }); }} />
        <TextArea label={t.fields.summary} value={draft.summary} maxLength={500} rows={2} onChange={(event) => { update({ summary: event.target.value }); }} />
        <SelectField
          label={t.fields.level}
          value={draft.level}
          className="w-56"
          options={LEVELS.map((value) => ({ value, label: messages.exercises.levels[value] }))}
          onChange={(event) => {
            const level = LEVELS.find((value) => value === event.target.value);
            if (level) update({ level });
          }}
        />
        <TextArea label={t.fields.objective} value={draft.objective} maxLength={1000} onChange={(event) => { update({ objective: event.target.value }); }} />
        <TextArea label={t.fields.statement} value={draft.statement} maxLength={2000} rows={4} onChange={(event) => { update({ statement: event.target.value }); }} />
      </Section>

      <Section id="exercise-topology" title={t.topology}>
        <p className="text-sm text-text">
          {fill(t.topologySummary, { name: draft.project.metadata.name, devices, links: draft.project.topology.links.length, faults: draft.project.faults.length })}
        </p>
        <Button
          variant="secondary"
          className="self-start"
          disabled={!activeProject}
          onClick={() => {
            if (!activeProject) return;
            update({ project: activeProject.document });
            setStatus({ tone: "info", text: fill(t.replaced, { name: activeProject.document.metadata.name }) });
          }}
        >
          {t.replaceTopology}
        </Button>
        {!activeProject && <p className="text-xs text-text-muted">{t.noOpenProject}</p>}
      </Section>

      <Section id="exercise-allowed" title={t.allowed}>
        <p className="text-sm text-text-muted">{t.allowedHint}</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">{t.allowed}</legend>
          {FUNCTIONS.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={draft.allowed.includes(name)}
                onChange={(event) => {
                  update({ allowed: event.target.checked ? FUNCTIONS.filter((value) => value === name || draft.allowed.includes(value)) : draft.allowed.filter((value) => value !== name) });
                }}
              />
              {t.functions[name]}
            </label>
          ))}
        </fieldset>
      </Section>

      <Section id="exercise-steps" title={t.steps}>
        <p className="text-sm text-text-muted">{fill(t.scale, { training: maxScore(draft), evaluated: evaluationMaxScore(draft) })}</p>
        <ol className="flex flex-col gap-3">
          {draft.steps.map((step, index) => (
            <StepEditor
              key={`${String(index)}-${step.kind}`}
              step={step}
              index={index}
              total={draft.steps.length}
              project={draft.project}
              onChange={(next) => {
                setSteps(draft.steps.map((item, position) => (position === index ? next : item)));
              }}
              onMove={(delta) => {
                const steps = [...draft.steps];
                const target = index + delta;
                const [moved] = steps.splice(index, 1);
                if (!moved) return;
                steps.splice(target, 0, moved);
                setSteps(steps);
              }}
              onRemove={() => {
                setSteps(draft.steps.filter((_, position) => position !== index));
              }}
            />
          ))}
        </ol>
        {draft.steps.length < 12 && (
          <div className="flex flex-wrap items-end gap-2">
            <SelectField
              label={t.stepKind}
              value={newKind}
              className="w-48"
              options={STEP_KINDS.map((value) => ({ value, label: t.stepKinds[value] }))}
              onChange={(event) => {
                const kind = STEP_KINDS.find((value) => value === event.target.value);
                if (kind) setNewKind(kind);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => {
                setSteps([...draft.steps, newStep(newKind, draft.project)]);
              }}
            >
              {t.addStep}
            </Button>
          </div>
        )}
      </Section>

      <Section id="exercise-hints" title={t.hints}>
        {draft.hints.map((hint, index) => (
          <div key={`${String(index)}-hint`} className="flex items-end gap-2">
            <TextArea
              label={fill(t.hintN, { n: index + 1 })}
              value={hint}
              maxLength={600}
              rows={2}
              className="flex-1"
              onChange={(event) => {
                update({ hints: draft.hints.map((item, position) => (position === index ? event.target.value : item)) });
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                update({ hints: draft.hints.filter((_, position) => position !== index) });
              }}
            >
              {fill(t.removeHint, { n: index + 1 })}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          {draft.hints.length < 5 && (
            <Button
              variant="secondary"
              onClick={() => {
                update({ hints: [...draft.hints, ""] });
              }}
            >
              {t.addHint}
            </Button>
          )}
          <TextField
            label={t.hintPenalty}
            type="number"
            min={0}
            max={100}
            value={draft.hintPenalty}
            className="w-48"
            onChange={(event) => {
              update({ hintPenalty: Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0))) });
            }}
          />
        </div>
      </Section>

      <PublicationsPanel exerciseId={exerciseId} revision={saved.revision} dirty={dirty} />
    </div>
  );
}

/** Éditeur d'un exercice du compte (/exercices/<id>) : chargé puis validé comme donnée externe. */
export function ExerciseEditor({ exerciseId }: { exerciseId: string }) {
  const [state, setState] = useState<{ exercise: Exercise; revision: number } | { error: string } | null>(null);
  useEffect(() => {
    void evaluationsApi.getExercise(exerciseId).then(
      (response) => {
        const parsed = parseExercise(response.exercise);
        setState(parsed.ok ? { exercise: parsed.exercise, revision: response.revision } : { error: messages.apiErrors["exercise.invalid"] });
      },
      (error: unknown) => {
        setState({ error: apiErrorText(error) });
      },
    );
  }, [exerciseId]);
  if (!state) return <p role="status" className="text-text-muted">{t.loading}</p>;
  if ("error" in state) return <Notice tone="danger">{state.error}</Notice>;
  return <Editor exerciseId={exerciseId} initial={state.exercise} initialRevision={state.revision} />;
}
