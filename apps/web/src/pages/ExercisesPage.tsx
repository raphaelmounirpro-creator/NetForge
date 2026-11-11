import type { ExerciseSummaryDto } from "@netforge/contracts";
import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "../app/router";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Notice } from "../components/ui/Notice";
import { fill, messages } from "../i18n";
import { apiErrorText } from "../features/account/errors";
import { useAccountStore } from "../features/account/store";
import { AccountRequired } from "../features/evaluations/AccountRequired";
import { evaluationsApi } from "../features/evaluations/api";
import { newExercise } from "../features/evaluations/editor/draft";
import { ExerciseEditor } from "../features/evaluations/editor/ExerciseEditor";
import { formatDate } from "../features/evaluations/ResultView";
import { useLabStore } from "../features/lab/store";

const t = messages.evaluations;

function ExerciseList() {
  const [exercises, setExercises] = useState<readonly ExerciseSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ExerciseSummaryDto | null>(null);
  const activeProject = useLabStore((state) => (state.activeId ? (state.projects[state.activeId] ?? null) : null));

  const load = useCallback(() => {
    void evaluationsApi.listExercises().then(
      (response) => {
        setExercises(response.exercises);
      },
      (failure: unknown) => {
        setError(apiErrorText(failure));
      },
    );
  }, []);
  useEffect(load, [load]);

  const create = () => {
    if (!activeProject) return;
    setBusy(true);
    setError(null);
    void evaluationsApi.createExercise(newExercise(activeProject.document)).then(
      (created) => {
        setBusy(false);
        navigate(`/exercices/${created.id}`);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(apiErrorText(failure));
      },
    );
  };

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">{t.listTitle}</h1>
        <p className="text-text-muted">{t.listIntro}</p>
      </header>
      <div className="flex flex-col gap-2">
        <Button variant="primary" className="self-start" busy={busy} disabled={!activeProject} onClick={create}>
          {t.create}
        </Button>
        <p className="text-xs text-text-muted">{activeProject ? t.createHint : t.noOpenProject}</p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {exercises?.length === 0 && <p className="text-text-muted">{t.empty}</p>}
      <ul className="flex flex-col gap-3">
        {exercises?.map((exercise) => (
          <li key={exercise.id}>
            <article aria-label={exercise.title} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-base font-semibold text-text">{exercise.title}</h2>
                <p className="text-xs text-text-muted">{fill(t.summaryLine, { revision: exercise.revision, publications: exercise.publicationCount, date: formatDate(exercise.savedAt) })}</p>
              </div>
              <Link to={`/exercices/${exercise.id}`} className="inline-flex min-h-8 items-center rounded-md border border-border-strong px-3 text-xs text-text hover:border-accent-text hover:text-accent-text">
                {t.edit}
              </Link>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setRemoving(exercise);
                }}
              >
                {t.remove}
              </Button>
            </article>
          </li>
        ))}
      </ul>
      <Dialog
        open={removing !== null}
        title={t.removeTitle}
        onClose={() => {
          setRemoving(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRemoving(null);
              }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (!target) return;
                void evaluationsApi.deleteExercise(target.id).then(load, (failure: unknown) => {
                  setError(apiErrorText(failure));
                });
              }}
            >
              {t.remove}
            </Button>
          </>
        }
      >
        {removing && fill(t.removeBody, { title: removing.title })}
      </Dialog>
    </>
  );
}

/** Exercices du compte : liste (/exercices) et éditeur (/exercices/<id>). */
export function ExercisesPage({ exerciseId }: { exerciseId: string | null }) {
  const status = useAccountStore((state) => state.status);
  const path = exerciseId ? `/exercices/${exerciseId}` : "/exercices";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      {status === "signed-in" ? exerciseId ? <ExerciseEditor key={exerciseId} exerciseId={exerciseId} /> : <ExerciseList /> : status === "checking" ? null : <AccountRequired path={path} />}
    </div>
  );
}
