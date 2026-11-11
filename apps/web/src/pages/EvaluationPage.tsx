import type { AttemptResponse, EvaluationResponse } from "@netforge/contracts";
import { parsePublicExercise, type PublicExercise } from "@netforge/engine";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { fill, messages } from "../i18n";
import { apiErrorText } from "../features/account/errors";
import { useAccountStore } from "../features/account/store";
import { AccountRequired } from "../features/evaluations/AccountRequired";
import { evaluationsApi } from "../features/evaluations/api";
import { formatDate, ResultView } from "../features/evaluations/ResultView";
import { openAttempt } from "../features/evaluations/session";

const t = messages.evaluations;

type Loaded = { readonly evaluation: EvaluationResponse; readonly exercise: PublicExercise };

function AttemptHistory({ evaluation }: { evaluation: EvaluationResponse }) {
  const [shown, setShown] = useState<AttemptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (evaluation.attempts.length === 0) return null;
  return (
    <section aria-labelledby="evaluation-history" className="flex flex-col gap-3">
      <h2 id="evaluation-history" className="text-lg font-semibold text-text">
        {t.history}
      </h2>
      <ul className="flex flex-col gap-2">
        {evaluation.attempts.map((attempt) => (
          <li key={attempt.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
            <span className="text-text">
              {fill(t.attemptLine, {
                date: formatDate(attempt.startedAt),
                state: attempt.score === null ? t.inProgress : fill(t.score, { score: attempt.score, max: attempt.maxScore }),
              })}
            </span>
            {attempt.submittedAt && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                aria-expanded={shown?.id === attempt.id}
                onClick={() => {
                  if (shown?.id === attempt.id) {
                    setShown(null);
                    return;
                  }
                  setError(null);
                  void evaluationsApi.attempt(attempt.id).then(setShown, (failure: unknown) => {
                    setError(apiErrorText(failure));
                  });
                }}
              >
                {shown?.id === attempt.id ? t.hideResult : t.viewResult}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <Notice tone="danger">{error}</Notice>}
      {shown && (
        <div className="rounded-md border border-border bg-surface p-4">
          <ResultView attempt={shown} />
        </div>
      )}
    </section>
  );
}

function Details({ code }: { code: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void evaluationsApi.evaluation(code).then(
      (evaluation) => {
        const exercise = parsePublicExercise(evaluation.exercise);
        if (exercise) setData({ evaluation, exercise });
        else setError(messages.apiErrors["server.unavailable"]);
      },
      (failure: unknown) => {
        setError(apiErrorText(failure));
      },
    );
  }, [code]);

  useEffect(load, [load]);

  if (!data) {
    return error ? (
      <Notice
        tone="danger"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setError(null);
              load();
            }}
          >
            {t.retry}
          </Button>
        }
      >
        {error}
      </Notice>
    ) : (
      <p role="status" className="text-text-muted">
        {t.loadingAttempt}
      </p>
    );
  }

  const { evaluation, exercise } = data;
  const open = evaluation.attempts.find((attempt) => attempt.submittedAt === null);
  const exhausted = !open && evaluation.attempts.length >= evaluation.maxAttempts;
  const allowed = exercise.allowed.map((name) => t.functions[name]).join(", ");

  const start = () => {
    setBusy(true);
    setError(null);
    void evaluationsApi.start(code).then(
      async (attempt) => {
        const opened = await openAttempt(code, attempt.id, exercise);
        setBusy(false);
        if (!opened) setError(t.startError);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(apiErrorText(failure));
        load();
      },
    );
  };

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text">{fill(t.pageTitle, { title: exercise.title })}</h1>
        <p className="text-text">{exercise.summary}</p>
        <p className="text-sm text-text-muted">
          {messages.exercises.levels[exercise.level]} · {fill(t.rules, { max: exercise.maxScore, penalty: exercise.hintPenalty, attempts: evaluation.maxAttempts })}
        </p>
      </header>
      <Notice tone="info">{t.verified}</Notice>
      <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-5 text-sm">
        <p className="text-text">
          <span className="font-semibold">{messages.exercises.objective} : </span>
          {exercise.objective}
        </p>
        <p className="text-text">
          <span className="font-semibold">{messages.exercises.statement} : </span>
          {exercise.statement}
        </p>
        {allowed && <p className="text-text-muted">{fill(t.allowedList, { list: allowed })}</p>}
        <p className="text-text-muted">{fill(t.attemptsUsed, { used: evaluation.attempts.length, max: evaluation.maxAttempts })}</p>
      </section>
      {error && <Notice tone="danger">{error}</Notice>}
      {evaluation.closed ? (
        <Notice tone="warning">{t.closedNotice}</Notice>
      ) : exhausted ? (
        <Notice tone="warning">{t.noAttemptsLeft}</Notice>
      ) : (
        <Button variant="primary" className="self-start" busy={busy} onClick={start}>
          {open ? t.resume : t.start}
        </Button>
      )}
      <AttemptHistory evaluation={evaluation} />
    </>
  );
}

/** Page d'une évaluation publiée (/evaluation/<code>) : partie publique, tentatives, résultats. */
export function EvaluationPage({ code }: { code: string }) {
  const status = useAccountStore((state) => state.status);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      {status === "signed-in" ? <Details key={code} code={code} /> : status === "checking" ? null : <AccountRequired path={`/evaluation/${code}`} />}
    </div>
  );
}
