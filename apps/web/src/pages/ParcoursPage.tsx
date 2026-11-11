import { maxScore } from "@netforge/engine";
import { useState } from "react";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { fill, messages } from "../i18n";
import { exercises, invalidExercises } from "../features/exercises/catalog";
import { startExercise } from "../features/exercises/progress";

const t = messages.exercises;

/** Page Parcours : exercices guidés embarqués (entraînement local). */
export function ParcoursPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">{t.title}</h1>
        <p className="text-text-muted">{t.intro}</p>
        <p className="text-sm text-text-muted">{t.local}</p>
      </header>
      {error && <Notice tone="danger">{t.startError}</Notice>}
      {invalidExercises.map((id) => (
        <Notice key={id} tone="warning">
          {fill(t.invalid, { id })}
        </Notice>
      ))}
      <ul className="flex flex-col gap-4">
        {exercises.map((exercise) => (
          <li key={exercise.id}>
            <article aria-labelledby={`exercise-${exercise.id}`} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`exercise-${exercise.id}`} className="text-lg font-semibold text-text">
                  {exercise.title}
                </h2>
                <span className="text-xs text-text-muted">
                  {t.levels[exercise.level]} · {fill(t.meta, { steps: exercise.steps.length, points: maxScore(exercise) })}
                </span>
              </div>
              <p className="text-sm text-text">{exercise.summary}</p>
              <p className="text-sm text-text-muted">
                <span className="font-semibold text-text">{t.objective} : </span>
                {exercise.objective}
              </p>
              <Button
                variant="primary"
                className="self-start"
                busy={busy === exercise.id}
                onClick={() => {
                  setBusy(exercise.id);
                  setError(false);
                  void startExercise(exercise).then((started) => {
                    setBusy(null);
                    if (!started) setError(true);
                  });
                }}
              >
                {t.start}
              </Button>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
